#!/bin/bash
# The dashboard's session token on the Termux side (phone/hermes-services), in a sandbox HOME with stub Termux/Debian
# commands: minted once (0600, hex), handed to the dashboard with HERMES_DASHBOARD_TOKEN_IN_PAGE=0, kept across runs,
# and a dashboard loop an older hermes-services started (no token) replaced once. Usage: tools/test_dash_token.sh
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
T=$(mktemp -d)
H="$T/home"
mkdir -p "$H/bin" "$H/logs" "$T/stub"
fails=0
check() { if eval "$1"; then echo "PASS  $2"; else echo "FAIL  $2"; fails=$((fails + 1)); fi; }
cleanup() {
  for p in "$H"/logs/*.pid; do
    [ -f "$p" ] || continue
    pid=$(cat "$p"); pkill -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null
  done
  [ -f "$T/old.pid" ] && { pkill -P "$(cat "$T/old.pid")" 2>/dev/null; kill "$(cat "$T/old.pid")" 2>/dev/null; }
  pkill -f "$T/stub/hermes" 2>/dev/null
  rm -rf "$T"
}
trap cleanup EXIT

# Stubs: Termux commands do nothing; ~/bin/hermes-debian runs "Debian" commands here and logs --restart; a fake
# `hermes dashboard` records the environment it got, then idles like the real one.
for c in termux-wake-unlock am sshd; do printf '#!/bin/bash\nexit 0\n' > "$T/stub/$c"; done
rm -f "$T/stub/sshd"
cat > "$T/stub/hermes" <<EOF
#!/bin/bash
echo "token=\${HERMES_DASHBOARD_SESSION_TOKEN:-} in_page=\${HERMES_DASHBOARD_TOKEN_IN_PAGE:-} args=\$*" >> "$T/dash.env"
exec sleep 1000
EOF
cat > "$H/bin/hermes-debian" <<EOF
#!/bin/bash
case "\${1:-}" in
  --restart) echo restart >> "$T/restarts"; pkill -f "$T/stub/hermes" ; exit 0 ;;
  --exists) exit 1 ;;
esac
exec "\$@"
EOF
chmod +x "$T"/stub/* "$H/bin/hermes-debian"
export PATH="$T/stub:$PATH"
run() { HOME="$H" bash "$ROOT/phone/hermes-services" >/dev/null 2>&1; }
wait_env() { for _ in $(seq 1 50); do [ "$( { wc -l < "$T/dash.env"; } 2>/dev/null || echo 0)" -ge "$1" ] && return 0; sleep 0.1; done; return 1; }

# 1. An older hermes-services left a dashboard loop running (no marker file).
( while true; do sleep 1000; done ) >/dev/null 2>&1 & echo $! > "$T/old.pid"
cp "$T/old.pid" "$H/logs/dashboard.pid"
old=$(cat "$T/old.pid")
run
wait_env 1
tok=$(cat "$H/.hermes-mobile/dash-token" 2>/dev/null)
check '[[ "$tok" =~ ^[0-9a-f]{48}$ ]]' "a token is minted (48 hex chars)"
check '[ "$(stat -c %a "$H/.hermes-mobile/dash-token")" = 600 ]' "the token file is 0600"
check '! kill -0 "$old" 2>/dev/null' "the old dashboard loop is stopped"
check '[ "$(cat "$T/restarts" 2>/dev/null)" = restart ]' "and its dashboard restarted (hermes-debian --restart)"
check '[ "$(cat "$H/logs/dashboard.pid")" != "$old" ] && kill -0 "$(cat "$H/logs/dashboard.pid")"' "a new dashboard loop runs"
check 'grep -qx "token=$tok in_page=0 args=dashboard --host 127.0.0.1 --port 9119 --no-open" "$T/dash.env"' "the dashboard gets the token and IN_PAGE=0 ($(head -1 "$T/dash.env" 2>/dev/null))"
check '[ "$(cat "$H/logs/dashboard.loop")" = token ]' "the loop is marked as started with the token"

# 2. Run again (the app's start, Termux:Boot): same token, same loop, no restart.
loop=$(cat "$H/logs/dashboard.pid")
run
sleep 0.5
check '[ "$(cat "$H/.hermes-mobile/dash-token")" = "$tok" ]' "the token is kept across runs"
check '[ "$(cat "$H/logs/dashboard.pid")" = "$loop" ]' "the running loop is left alone"
check '[ "$(wc -l < "$T/restarts")" = 1 ]' "no second restart"
check '[ "$(wc -l < "$T/dash.env")" = 1 ]' "no second dashboard"

# 3. Debian reads the file itself: the token never sits on a command line (ps in Termux would show it).
check 'grep -qF "HERMES_DASHBOARD_SESSION_TOKEN=\\\$(cat \$tokf" "$ROOT/phone/hermes-services"' "the token is read inside Debian, never put on a command line"

[ $fails = 0 ] && echo "test_dash_token: OK" || { echo "test_dash_token: $fails FAILED"; exit 1; }
