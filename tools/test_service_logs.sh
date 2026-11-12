#!/bin/bash
# Tests phone/hermes-services' log handling with a fake home: a service log stays bounded and keeps its newest part (also
# while a program still appends to it), a program that fails is recorded for the diagnostic log with its exit code and
# nothing else, the loops that end on purpose aren't, and the switch in the app stops the recording. Also the dashboard's
# loop: it waits only while a dashboard of ours holds the port (hm-local verifies it, or it speaks no hello and runs as this
# user), starts its own anyway when something else answers (one fixed port_taken line, the app told), restarts soon after
# a real exit, and backs off quick exits. And the app keeper: a refused port or one that doesn't verify wakes the app.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d)
cleanup() { pkill -f "$T/" 2>/dev/null || true; rm -rf "$T"; }
trap cleanup EXIT
fails=0
check() { if eval "$1"; then echo "PASS  $2"; else echo "FAIL  $2"; fails=$((fails+1)); fi; }
export HOME="$T/home"; mkdir -p "$HOME/logs" "$HOME/.hermes-mobile"
# The two functions, as written in the script.
funcs="$T/funcs.sh"
awk '/^trim_log\(\) \{/{f=1} /^loop_exit\(\) \{/{f=1} f{print} f&&/^}/{f=0}' phone/hermes-services > "$funcs"
check "grep -q 'trim_log()' '$funcs' && grep -q 'loop_exit()' '$funcs'" "found trim_log and loop_exit"
# shellcheck disable=SC1090
source "$funcs"

L="$HOME/logs/x.log"
head -c 3000 /dev/zero | tr '\0' a > "$L"; printf 'NEWEST' >> "$L"
trim_log "$L" 5000 100
check "[ \$(wc -c < '$L') -eq 3006 ]" "a log under its limit isn't touched"
trim_log "$L" 2000 100
check "[ \$(wc -c < '$L') -eq 100 ] && [ \"\$(tail -c 6 '$L')\" = NEWEST ]" "over the limit: only the newest part stays"
check "[ ! -e '$L.tmp' ]" "no temporary file stays"
trim_log "$HOME/logs/none.log" 10 5
check "[ ! -e '$HOME/logs/none.log' ]" "a missing log is fine and isn't made"

# A writer holding the file open for appending carries on at the new end, without a hole in the file.
exec 7>>"$L"
head -c 3000 /dev/zero | tr '\0' b >&7
trim_log "$L" 2000 50
printf 'AFTER' >&7
exec 7>&-
check "[ \$(wc -c < '$L') -eq 55 ] && [ \"\$(tail -c 5 '$L')\" = AFTER ]" "a program still appending carries on at the new end"

E="$HOME/logs/loop-events.log"
loop_exit dashboard 137
check "grep -Eq '^[0-9]{9,11} service loop_exit name=dashboard code=137\$' '$E'" "a program's exit is one fixed line"
head -c 70000 /dev/zero | tr '\0' z > "$E"
loop_exit cron-ticker 1
check "[ \$(wc -c < '$E') -lt 40000 ] && grep -q 'name=cron-ticker code=1' '$E'" "the events file stays bounded and gets the new line"
rm -f "$E"; touch "$HOME/.hermes-mobile/diag-off"
loop_exit dashboard 1
check "[ ! -e '$E' ]" "off in the app: nothing is recorded"
rm -f "$HOME/.hermes-mobile/diag-off"

# The real script: a failing loop is recorded, one that ends on purpose isn't. sleep 10 and the Termux-only commands are stubbed.
mkdir -p "$T/bin"
for c in termux-wake-unlock am sshd pgrep; do printf '#!/bin/bash\nexit 0\n' > "$T/bin/$c"; done
printf '#!/bin/bash\necho "$PPID $1" >> "$SLEEPS"\nexit 0\n' > "$T/bin/sleep"
export SLEEPS="$T/sleeps"
cat > "$T/bin/hermes-debian" <<'FAKE'
#!/bin/bash
[ "${1:-}" = "--exists" ] && exit 1
echo "fake program output"; exit 3
FAKE
chmod +x "$T/bin"/*
mkdir -p "$HOME/bin"; cp "$T/bin/hermes-debian" "$HOME/bin/hermes-debian"
head -c 2200000 /dev/zero | tr '\0' q > "$HOME/logs/old.log"
free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])'; }
export HM_DASH_PORT; HM_DASH_PORT=$(free_port)  # another run or a browser test may hold 9119
PATH="$T/bin:$PATH" bash phone/hermes-services >/dev/null 2>&1 || true
for _ in $(seq 1 100); do grep -q 'name=dashboard code=3' "$E" 2>/dev/null && break; perl -e 'select(undef,undef,undef,0.05)'; done
dash=$(cat "$HOME/logs/dashboard.pid")
for _ in $(seq 1 100); do [ "$(grep -c "^$dash " "$SLEEPS" 2>/dev/null)" -ge 7 ] && break; perl -e 'select(undef,undef,undef,0.05)'; done
for p in "$HOME"/logs/*.pid; do kill "$(cat "$p")" 2>/dev/null || true; done
check "grep -q 'name=dashboard code=3' '$E'" "a failing loop's exit code is recorded"
check "[ \"\$(grep '^$dash ' '$SLEEPS' | head -7 | cut -d' ' -f2 | tr '\n' ' ')\" = '10 20 40 80 160 300 300 ' ]" "a loop that keeps failing waits longer each time, up to 5 min"
check "! grep -q 'fake program output' '$E'" "the program's output never goes into the events"
check "! grep -q 'name=app-keeper code=0' '$E' && ! grep -q 'name=memory-sync' '$E'" "a loop that ends on purpose isn't recorded"
check "[ \$(wc -c < '$HOME/logs/old.log') -le 524288 ]" "a big log is trimmed when the script runs"

# The dashboard's loop, as written in the script, with a stand-in for Hermes and for the pauses (written down, then 20 ms).
for p in "$HOME"/logs/*.pid; do rm -f "$p"; done
loopf="$T/loop.sh"
awk '/^(dash_process|wake_app)\(\) \{.*\}$/{print; next}
  /^(trim_log|loop_exit|why_of|local_hello|local_line|local_port_event|dash_answers|dash_state|wait_other_dashboard|keep_app|run_loop)\(\) \{/{f=1}
  /^(dash_port|app_port|keeper_hello_every|keeper_wake_every|hm_local|dash_taken|keeper_round)=/{print} /^case "\$keeper_hello_every"/{print}
  f{print} f&&/^}/{f=0}' phone/hermes-services > "$loopf"
# shellcheck disable=SC1090
source "$loopf"
set +e  # the script runs without -e, and the loops inherit it from here
STARTS="$T/starts"; SLEEPS="$T/sleeps"; DL="$HOME/logs/dashboard.log"; E="$HOME/logs/loop-events.log"
sleep() { echo "$1" >> "$SLEEPS"; perl -e 'select(undef,undef,undef,0.02)'; }
# A stand-in for hm-local: records its arguments (and a posted body), answers with the exit code in $HM_RC (0: verified).
HM_CALLS="$T/hm-calls"; HM_POSTS="$T/hm-posts"; HM_RC="$T/hm-rc"; export HM_CALLS HM_POSTS HM_RC
printf '#!/bin/bash\necho "$*" >> "$HM_CALLS"\n[ "$1" = post ] && { cat >> "$HM_POSTS"; echo >> "$HM_POSTS"; }\nexit "$(cat "$HM_RC" 2>/dev/null || echo 0)"\n' > "$HOME/bin/hm-local"
chmod +x "$HOME/bin/hm-local"
hm_rc() { echo "$1" > "$HM_RC"; }
serve() { python3 -m http.server "$HM_DASH_PORT" --bind 127.0.0.1 --directory "$T/bin" >/dev/null 2>&1 & srv=$!; for _ in $(seq 1 200); do dash_answers && return; perl -e 'select(undef,undef,undef,0.05)'; done; }
unserve() { kill "$srv" 2>/dev/null; wait "$srv" 2>/dev/null || true; }
fresh() { HM_DASH_PORT=$(free_port); dash_port=$HM_DASH_PORT; dash_taken=""; rm -f "$STARTS" "$SLEEPS" "$E" "$DL" "$HOME/logs/dashboard.pid" "$HM_CALLS" "$HM_POSTS"; touch "$STARTS" "$SLEEPS"; hm_rc 0; }
stop_loop() { kill "$(cat "$HOME/logs/dashboard.pid")" 2>/dev/null; wait "$(cat "$HOME/logs/dashboard.pid")" 2>/dev/null || true; }
upto() { for _ in $(seq 1 400); do eval "$1" && return 0; perl -e 'select(undef,undef,undef,0.02)'; done; return 1; }  # eight seconds
lines() { wc -l < "$1" | tr -d ' '; }
waits() { grep -c '^60$' "$SLEEPS" || true; }

# What the phone showed: every loop was stopped, its dashboard stayed, and a new run of the script started new loops.
fresh; serve; echo 999999 > "$HOME/logs/dashboard.pid"
fake_quick() { echo run >> "$STARTS"; return 3; }
run_loop dashboard fake_quick
upto '[ "$(waits)" -ge 30 ]' || true
check "[ \"\$(waits)\" -ge 30 ] && [ \"\$(lines '$STARTS')\" = 0 ]" "another dashboard of ours answers (it verifies): thirty waits and Debian never started"
check "grep -qx \"hello dashboard \$HM_DASH_PORT\" '$HM_CALLS'" "it asked hm-local to verify the dashboard on its port"
check "[ \"\$(grep -c '^hello' '$HM_CALLS')\" -le 8 ]" "while waiting it asks again only every fifth minute (a plain HTTP probe in between)"
check "[ ! -e '$E' ]" "waiting is no program exit: nothing in the events"
check "[ \"\$(grep -c 'waiting for it to stop' '$DL')\" = 1 ] && grep -Eq '^[0-9-]{10}T[0-9:]{8}Z ' '$DL'" "one line with the time says so, not one per wait"
# It stops: the program starts again at once, without waiting out a long pause.
unserve
upto '[ "$(lines "$STARTS")" -ge 1 ]' || true
check "[ \"\$(lines '$STARTS')\" -ge 1 ]" "that dashboard stops: the loop starts its own"
stop_loop

# The spin itself: Hermes starts, says "already running" and exits 0.
fresh
fake_attach() { echo run >> "$STARTS"; [ -n "${srv_up:-}" ] || serve; srv_up=1; echo "Hermes dashboard already running on this host"; return 0; }
srv_up=""; run_loop dashboard fake_attach
upto '[ "$(waits)" -ge 30 ]' || true
check "[ \"\$(waits)\" -ge 30 ] && [ \"\$(lines '$STARTS')\" = 1 ]" "\"already running\" and exit 0: one start, then thirty waits and no more"
stop_loop; unserve

# A real exit: 10 s after a program that ran a while, every time.
fresh
fake_long() { echo run >> "$STARTS"; SECONDS=$((SECONDS + 100)); return 1; }
run_loop dashboard fake_long
upto '[ "$(lines "$SLEEPS")" -ge 5 ]' || true
stop_loop
check "[ \"\$(lines '$SLEEPS')\" -ge 5 ] && [ \"\$(sort -u '$SLEEPS')\" = 10 ]" "a dashboard that ran a while and died restarts after 10 s, every time"
check "grep -q 'name=dashboard code=1' '$E'" "a real exit is still recorded"

# Quick exits back off, with a limit; a run that lasts starts the count again.
fresh
fake_mix() { echo run >> "$STARTS"; [ "$(lines "$STARTS")" = 7 ] && SECONDS=$((SECONDS + 100)); return 3; }
run_loop dashboard fake_mix
upto '[ "$(lines "$SLEEPS")" -ge 9 ]' || true
stop_loop
check "[ \"\$(head -9 '$SLEEPS' | tr '\n' ' ')\" = '10 20 40 80 160 300 10 10 20 ' ]" "quick exits wait 10, 20, 40, 80, 160, 300 s; a long run starts over"

# Something answers that isn't ours: no wait, one fixed line, the app told, and the loop's own back-off.
for rc in 4 8 127; do
  fresh; serve; hm_rc "$rc"
  [ "$rc" = 127 ] && mv "$HOME/bin/hm-local" "$T/hm-local.off"
  fake_quick() { echo run >> "$STARTS"; return 3; }
  run_loop dashboard fake_quick
  upto '[ "$(lines "$STARTS")" -ge 4 ]' || true
  stop_loop; unserve
  [ "$rc" = 127 ] && mv "$T/hm-local.off" "$HOME/bin/hm-local"
  why=$(why_of "$rc"); why=${why:-no_hello}
  check "[ \"\$(lines '$STARTS')\" -ge 4 ] && [ \"\$(waits)\" = 0 ]" "not verified (hm-local exit $rc): Debian starts anyway, no waiting"
  check "[ \"\$(head -4 '$SLEEPS' | tr '\n' ' ')\" = '10 20 40 80 ' ]" "not verified (exit $rc): the loop's back-off bounds the starts"
  check "[ \"\$(grep -c ' local port_taken ' '$E')\" = 1 ] && grep -Eq '^[0-9]{9,11} local port_taken port=dashboard side=termux why=$why\$' '$E'" "not verified (exit $rc): one fixed line, why=$why"
  if [ "$rc" = 127 ]; then
    check "[ ! -s '$HM_POSTS' ]" "no hm-local: the app can't be told, nothing sent"
  else
    check "grep -qx \"post /event \$app_port\" '$HM_CALLS' && grep -qx '{\"kind\":\"local_port\",\"port\":\"dashboard\",\"state\":\"taken\"}' '$HM_POSTS'" "not verified (exit $rc): the app is told, through hm-local (verified)"
  fi
  check "[ ! -e '$DL' ] || ! grep -q 'waiting' '$DL'" "not verified (exit $rc): no 'waiting' line"
done
# No hello (an older plugin's guard) and a dashboard process of this user: ours, wait. A wrong proof: never, process or not.
fresh; serve; hm_rc 4
bash -c 'exec -a "hermes dashboard --host 127.0.0.1 --port $1 --no-open" sleep 30' x "$HM_DASH_PORT" & ours=$!
upto 'pgrep -f "hermes dashboard --host 127.0.0.1 --port $HM_DASH_PORT" >/dev/null' || true
run_loop dashboard fake_quick
upto '[ "$(waits)" -ge 3 ]' || true
check "[ \"\$(waits)\" -ge 3 ] && [ \"\$(lines '$STARTS')\" = 0 ]" "no hello, and our user's dashboard process: it waits (an older plugin)"
stop_loop; unserve; kill "$ours" 2>/dev/null; wait "$ours" 2>/dev/null || true
fresh; serve; hm_rc 8
bash -c 'exec -a "hermes dashboard --host 127.0.0.1 --port $1 --no-open" sleep 30' x "$HM_DASH_PORT" & ours=$!
upto 'pgrep -f "hermes dashboard --host 127.0.0.1 --port $HM_DASH_PORT" >/dev/null' || true
run_loop dashboard fake_quick
upto '[ "$(lines "$STARTS")" -ge 2 ]' || true
check "[ \"\$(lines '$STARTS')\" -ge 2 ] && [ \"\$(waits)\" = 0 ]" "a wrong proof: never waits, even with such a process"
stop_loop; unserve; kill "$ours" 2>/dev/null; wait "$ours" 2>/dev/null || true
# Taken, then free again: one port_ok line and the app told.
fresh; hm_rc 8; serve; wait_other_dashboard; r1=$?; unserve; wait_other_dashboard; r2=$?
check "[ \$r1 = 1 ] && [ \$r2 = 1 ] && grep -q ' local port_ok port=dashboard side=termux\$' '$E' && grep -q '\"state\":\"ok\"' '$HM_POSTS'" "free again: one port_ok line, the app told"

# The app keeper, one round at a time (sleep is the stand-in; am is recorded).
AM="$T/am-calls"; am() { echo "$*" >> "$AM"; }
kfresh() { rm -f "$AM" "$HM_CALLS" "$E"; keeper_round=0; keeper_taken=""; keeper_wait=0; keeper_hello_every=1; app_port=$(free_port); hm_rc 0; }
kfresh; keep_app
check "[ \"\$(cat '$AM')\" = 'broadcast -n com.omarqaterge.hermesmobile/.StartReceiver -f 32' ] && [ ! -e '$HM_CALLS' ]" "keeper: nothing listens: StartReceiver, no hello needed"
kfresh; python3 -c 'import socket,sys
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(("127.0.0.1",int(sys.argv[1]))); s.listen(5)
while True: s.accept()[0].close()' "$app_port" & held=$!
upto '(exec 3<>"/dev/tcp/127.0.0.1/$app_port") 2>/dev/null' || true
keep_app
check "[ ! -e '$AM' ] && grep -qx \"hello events \$app_port\" '$HM_CALLS'" "keeper: the listener verifies: nothing to do"
hm_rc 8; for _ in 1 2 3 4 5 6; do keep_app; done
check "[ \"\$(wc -l < '$AM' | tr -d ' ')\" = 2 ]" "keeper: a listener that doesn't verify: StartReceiver at once, then at most every third round"
check "[ \"\$(grep -c ' local port_taken ' '$E')\" = 1 ] && grep -Eq '^[0-9]{9,11} local port_taken port=events side=termux why=bad_proof\$' '$E'" "keeper: one fixed port_taken line per change"
hm_rc 0; rm -f "$AM"; keep_app
check "[ ! -e '$AM' ]" "keeper: verified again: nothing to do"
rm -f "$E"; hm_rc 7; for _ in 1 2 3 4 5 6 7; do keep_app; done
check "[ \"\$(wc -l < '$AM' | tr -d ' ')\" = 3 ]" "keeper: a listener naming another key: the broadcast too, capped (rounds 1, 4, 7)"
check "[ \"\$(grep -c ' local ' '$E')\" = 1 ] && grep -Eq '^[0-9]{9,11} local unverified port=events side=termux why=unknown_kid\$' '$E'" "keeper: one unverified line for it, not port_taken"
hm_rc 0; keep_app
# A refused round starts the count again: the next round that doesn't verify broadcasts at once.
rm -f "$AM"; hm_rc 8; keep_app; keep_app
kill "$held" 2>/dev/null; wait "$held" 2>/dev/null || true
keep_app
python3 -c 'import socket,sys
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(("127.0.0.1",int(sys.argv[1]))); s.listen(5)
while True: s.accept()[0].close()' "$app_port" & held=$!
upto '(exec 3<>"/dev/tcp/127.0.0.1/$app_port") 2>/dev/null' || true
keep_app
check "[ \"\$(wc -l < '$AM' | tr -d ' ')\" = 3 ]" "keeper: after a refused round, an unverified one broadcasts at once (not after the cap)"
hm_rc 0; keep_app
rm -f "$HM_CALLS"; keeper_hello_every=3; keeper_round=0; for _ in 1 2 3 4 5 6; do keep_app; done
check "[ \"\$(grep -c '^hello events' '$HM_CALLS')\" = 2 ]" "keeper every third round: two hellos in six rounds (a bare connect otherwise)"
mv "$HOME/bin/hm-local" "$T/hm-local.off"; rm -f "$AM"; keeper_hello_every=1; keep_app; mv "$T/hm-local.off" "$HOME/bin/hm-local"
check "[ ! -e '$AM' ]" "keeper without hm-local: the connect decides, as before"
kill "$held" 2>/dev/null; wait "$held" 2>/dev/null || true
check "[ \"\$(grep -c 'sleep 300\|^300\$' '$SLEEPS')\" -ge 1 ]" "keeper: each round ends with its 300 s sleep"

# dash_answers: only an HTTP reply counts.
fresh
check "! dash_answers" "nothing listening: no answer"
python3 -c 'import socket,sys,time; s=socket.socket(); s.bind(("127.0.0.1",int(sys.argv[1]))); s.listen(5); time.sleep(30)' "$HM_DASH_PORT" & mute=$!
upto '(exec 3<>"/dev/tcp/127.0.0.1/$HM_DASH_PORT") 2>/dev/null' || true
check "! dash_answers" "a port open with nobody replying (a Python without its proot): no answer, in 5 s"
kill "$mute" 2>/dev/null; wait "$mute" 2>/dev/null || true
serve
check "dash_answers" "an HTTP reply, whatever its status: answers"
unserve

[ "$fails" = 0 ] && echo "ALL PASSED" || { echo "$fails FAILED"; exit 1; }
