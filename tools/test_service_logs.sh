#!/bin/bash
# Tests phone/hermes-services' log handling with a fake home: a service log stays bounded and keeps its newest part (also
# while a program still appends to it), a program that fails is recorded for the diagnostic log with its exit code and
# nothing else, the loops that end on purpose aren't, and the switch in the app stops the recording. Also the dashboard's
# loop: it starts nothing while a dashboard it didn't start answers, restarts soon after a real exit, and backs off quick exits.
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
awk '/^(trim_log|loop_exit|dash_answers|wait_other_dashboard|run_loop)\(\) \{/{f=1} /^dash_port=/{print} f{print} f&&/^}/{f=0}' phone/hermes-services > "$loopf"
# shellcheck disable=SC1090
source "$loopf"
set +e  # the script runs without -e, and the loops inherit it from here
STARTS="$T/starts"; SLEEPS="$T/sleeps"; DL="$HOME/logs/dashboard.log"; E="$HOME/logs/loop-events.log"
sleep() { echo "$1" >> "$SLEEPS"; perl -e 'select(undef,undef,undef,0.02)'; }
serve() { python3 -m http.server "$HM_DASH_PORT" --bind 127.0.0.1 --directory "$T/bin" >/dev/null 2>&1 & srv=$!; for _ in $(seq 1 200); do dash_answers && return; perl -e 'select(undef,undef,undef,0.05)'; done; }
unserve() { kill "$srv" 2>/dev/null; wait "$srv" 2>/dev/null || true; }
fresh() { HM_DASH_PORT=$(free_port); dash_port=$HM_DASH_PORT; rm -f "$STARTS" "$SLEEPS" "$E" "$DL" "$HOME/logs/dashboard.pid"; touch "$STARTS" "$SLEEPS"; }
stop_loop() { kill "$(cat "$HOME/logs/dashboard.pid")" 2>/dev/null; wait "$(cat "$HOME/logs/dashboard.pid")" 2>/dev/null || true; }
upto() { for _ in $(seq 1 400); do eval "$1" && return 0; perl -e 'select(undef,undef,undef,0.02)'; done; return 1; }  # eight seconds
lines() { wc -l < "$1" | tr -d ' '; }
waits() { grep -c '^60$' "$SLEEPS" || true; }

# What the phone showed: every loop was stopped, its dashboard stayed, and a new run of the script started new loops.
fresh; serve; echo 999999 > "$HOME/logs/dashboard.pid"
fake_quick() { echo run >> "$STARTS"; return 3; }
run_loop dashboard fake_quick
upto '[ "$(waits)" -ge 30 ]' || true
check "[ \"\$(waits)\" -ge 30 ] && [ \"\$(lines '$STARTS')\" = 0 ]" "another dashboard answers: thirty waits and Debian never started"
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
