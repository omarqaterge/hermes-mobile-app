#!/bin/bash
# Tests phone/hermes-services' log handling with a fake home: a service log stays bounded and keeps its newest part (also
# while a program still appends to it), a program that fails is recorded for the diagnostic log with its exit code and
# nothing else, the loops that end on purpose aren't, and the switch in the app stops the recording.
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

[ "$fails" = 0 ] && echo "ALL PASSED" || { echo "$fails FAILED"; exit 1; }
