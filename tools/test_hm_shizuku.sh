#!/bin/bash
# Tests phone/hm-shizuku (Termux: pair Termux's adb from a code the user typed, start Shizuku's server with it, tell the
# app) with a fake adb, curl, getprop and rish on PATH. Checks: `pair PORT CODE` is only `adb pair 127.0.0.1:PORT CODE`
# (no rish, nothing tapped), usage errors, exit codes, start with a given port / scan fallback / not paired / no port,
# and the shizuku-auto event JSON (+ key header). No device needed.
set -uo pipefail
cd "$(dirname "$0")/.."
REPO=$(pwd)
PY=$(command -v python3) || { echo "python3 needed"; exit 1; }
T=$(mktemp -d); LISTENERS=""
cleanup() { for p in $LISTENERS; do kill "$p" 2>/dev/null; done; rm -rf "$T"; }
trap cleanup EXIT
fails=0
check() { if eval "$1"; then echo "PASS  $2"; else echo "FAIL  $2"; fails=$((fails+1)); fi; }

mkdir -p "$T/bin"

# fake rish: only logs; `pair` must never call it (no screen control).
cat > "$T/rish" <<'SH'
#!/bin/bash
echo "$*" >> "$FAKE_S/rish.log"; exit 1
SH

# fake adb (Termux android-tools). The "phone" pairs with port 40367 and code 182068 (or 012345) and trusts the key it
# paired; $S/adbport is the Wireless debugging connect port.
cat > "$T/bin/adb" <<'SH'
#!/bin/bash
S=$FAKE_S; K=$HOME/.android
echo "$*" >> "$S/adb.log"
[ "$1" = -s ] && shift 2
case "$1" in
  start-server) mkdir -p "$K"; [ -f "$K/adbkey.pub" ] || echo "key-$$-$RANDOM" > "$K/adbkey.pub" ;;
  kill-server) : ;;
  pair) if [ "$2" = "127.0.0.1:40367" ] && [ "$3" = 182068 ] || [ "$3" = 012345 ]; then cp "$K/adbkey.pub" "$S/trusted_key"; echo "Successfully paired to $2 [guid=adb-FAKE]"
        else echo "Failed: Unable to start pairing client."; exit 1; fi ;;
  connect) p=${2##*:}
    if [ "$p" = "$(cat "$S/adbport" 2>/dev/null)" ]; then
      if cmp -s "$S/trusted_key" "$K/adbkey.pub"; then echo "connected to $2"; else echo "failed to authenticate to $2"; fi
    else echo "failed to connect to '$2': Connection refused"; fi ;;   # real adb exits 0 here too
  disconnect) echo "disconnected ${2:-everything}" ;;
  shell) shift; c="$*"
    case "$c" in
      "id -u") echo 2000 ;;
      *libshizuku.so*) echo "$c" >> "$S/starter"; [ -f "$S/starter_broken" ] && { echo "fatal: cannot start"; exit 1; }
        touch "$S/server"; echo "info: shizuku_server pid is 4242"; echo "info: shizuku_starter exit with 0" ;;
      "ps -A -o NAME") echo init; echo adbd; [ -f "$S/server" ] && echo shizuku_server; true ;;
      *) echo "fake adb shell: unexpected: $c" >> "$S/unexpected" ;;
    esac ;;
  *) echo "fake adb: unexpected: $*" >> "$S/unexpected" ;;
esac
SH

# fake curl: records the URL, the headers (also -H @file) and the body
cat > "$T/bin/curl" <<'SH'
#!/bin/bash
S=$FAKE_S; n=$(ls "$S" | grep -c '^curl\.[0-9]*\.args$')
: > "$S/curl.$n.args"
while [ $# -gt 0 ]; do
  case "$1" in -H) shift; case "$1" in @*) cat "${1#@}" >> "$S/curl.$n.headers" ;; *) echo "$1" >> "$S/curl.$n.headers" ;; esac ;;
    *) echo "$1" >> "$S/curl.$n.args" ;; esac; shift
done
cat > "$S/curl.$n.body"
SH
printf '#!/bin/bash\necho "${FAKE_SDK:-35}"\n' > "$T/bin/getprop"
# macOS has no `timeout`: a pass-through one (CI's Linux uses the real one)
if ! command -v timeout >/dev/null; then
  printf '#!/bin/bash\nwhile :; do case "$1" in -s|-k) shift 2;; --*) shift;; *) break;; esac; done\nshift\nexec "$@"\n' > "$T/bin/timeout"
fi
chmod +x "$T"/bin/* "$T/rish"

# fresh <name>: a new HOME with rish + key, a new fake phone state. Developer options off, Wireless debugging off.
fresh() {
  H="$T/$1/home"; S="$T/$1/state"; rm -rf "$T/$1"; mkdir -p "$H/bin" "$H/.hermes-mobile" "$S"
  cp "$T/rish" "$H/bin/rish"; echo "k3y-for-test" > "$H/.hermes-mobile/key"; echo 0 > "$S/set_adb_wifi_enabled"
}
hm() { # hm <args…>: run the script like Termux would; output in $OUT, exit code in $RC
  OUT=$(env -i PATH="$T/bin:/usr/bin:/bin" HOME="$H" FAKE_S="$S" FAKE_SDK="${FAKE_SDK:-35}" \
        HM_SHIZUKU_NAP=0 HM_SCAN_FROM="${SCAN_FROM:-61000}" HM_SCAN_TO="${SCAN_TO:-61000}" bash "$REPO/phone/hm-shizuku" "$@" 2>&1); RC=$?
}
last_event() { local f; f=$(ls "$S" | grep '^curl\.[0-9]*\.body$' | sort -t. -k2 -n | tail -1); [ -n "$f" ] && cat "$S/$f"; }
ev() { # ev <python expression on the last event e>
  last_event | "$PY" -c "import json,sys; e=json.load(sys.stdin); sys.exit(0 if ($1) else 1)" 2>/dev/null
}
nevents() { ls "$S" | grep -c '^curl\.[0-9]*\.body$'; }

[ -f phone/hm-shizuku ] || { echo "FAIL  phone/hm-shizuku exists"; echo "1 FAILED"; exit 1; }
check "bash -n phone/hm-shizuku" "hm-shizuku parses"

# ── status ──
fresh status; hm status
check "[ \$RC = 0 ] && echo \"\$OUT\" | grep -qx unpaired && echo \"\$OUT\" | grep -qx adb=ok" "status: unpaired, adb=ok"
check "[ \$(nevents) = 0 ]" "status posts no event"
mv "$T/bin/adb" "$T/adb.off"; hm status; mv "$T/adb.off" "$T/bin/adb"
check "echo \"\$OUT\" | grep -qx adb=missing" "status: adb=missing without android-tools"

# ── pair <port> <code>: adb pair over loopback, nothing on the screen ──
fresh pair; hm pair 40367 182068
check "[ \$RC = 0 ]" "pair: exit 0 (got $RC: $(echo "$OUT" | tail -1))"
check "grep -qx 'pair 127.0.0.1:40367 182068' '$S/adb.log'" "pair: adb pair 127.0.0.1:<port> <code>"
check "[ ! -s '$S/rish.log' ]" "pair: no rish call at all (no screen, no settings)"
check "[ ! -s '$S/taps' ]" "pair: nothing tapped"
check "[ -s '$H/.hermes-mobile/adb-paired' ]" "pair: writes ~/.hermes-mobile/adb-paired"
check "ev 'e==dict(kind=\"shizuku-auto\",cmd=\"pair\",paired=True,result=\"ok\",detail=e[\"detail\"])'" "pair: event {kind, cmd:pair, paired:true, result:ok, detail}"
check "grep -qx 'http://127.0.0.1:9121/event' '$S/curl.0.args'" "pair: event goes to 127.0.0.1:9121/event"
check "grep -qx 'X-Hermes-Mobile-Key: k3y-for-test' '$S/curl.0.headers' && grep -qx 'Content-Type: application/json' '$S/curl.0.headers'" "pair: key + JSON headers (same as the plugin)"
check "! grep -q k3y-for-test '$S/curl.0.args'" "pair: the key is not on curl's command line"
check "[ ! -f '$S/unexpected' ]" "pair: no unexpected adb calls"
hm status
check "echo \"\$OUT\" | grep -qx paired" "status after pair: paired"

fresh pair-wrong; hm pair 40367 000000
check "[ \$RC = 6 ]" "pair: wrong code → exit 6 (got $RC)"
check "ev 'e[\"cmd\"]==\"pair\" and e[\"paired\"] is False and e[\"result\"]==\"failed\"'" "pair: wrong code → event paired:false, result:failed"
check "[ ! -s '$H/.hermes-mobile/adb-paired' ]" "pair: wrong code writes no mark"

fresh pair-zero; hm pair 40367 012345
check "grep -qx 'pair 127.0.0.1:40367 012345' '$S/adb.log'" "pair: a code with a leading zero is passed as typed"

for bad in "abc 182068" "0 182068" "70000 182068" "40367 18206" "40367 1820681" "40367 18206x" "40367"; do
  fresh pair-bad; hm pair $bad
  check "[ \$RC = 64 ] && [ ! -s '$S/adb.log' ]" "pair: '$bad' → usage (64), adb not called"
done
fresh pair-old; hm pair
check "[ \$RC = 64 ] && ev 'e[\"result\"]==\"failed\" and \"update Hermes Mobile\" in e[\"detail\"]'" "pair: bare 'pair' (older app) → 64 + event asks to update the app"
fresh pair-noadb; mv "$T/bin/adb" "$T/adb.off"; hm pair 40367 182068; mv "$T/adb.off" "$T/bin/adb"
check "[ \$RC = 2 ] && ev 'e[\"result\"]==\"failed\" and \"adb\" in e[\"detail\"]'" "pair without adb: exit 2, event says adb is missing"
fresh old; FAKE_SDK=29 hm pair 40367 182068
check "[ \$RC = 2 ] && ev 'e[\"result\"]==\"failed\" and \"Android 11\" in e[\"detail\"]' && [ ! -s '$S/adb.log' ]" "pair on Android 10: exit 2, clear detail, adb pair not tried"
fresh nokey; rm "$H/.hermes-mobile/key"; hm pair 40367 182068
check "[ \$RC = 0 ] && [ \$(nevents) = 0 ]" "no app key: pairs, posts nothing"
# a new adb key (pairing lost on this side) → not paired any more
fresh keychg; hm pair 40367 182068; rm -f "$H/.android/adbkey.pub"; hm status
check "echo \"\$OUT\" | grep -qx unpaired" "status: unpaired when the adb key changed"

# ── start ──
fresh start; hm pair 40367 182068; echo 41234 > "$S/adbport"; hm start 41234
check "[ \$RC = 0 ] && [ -f '$S/server' ]" "start <port>: exit 0, shizuku_server runs"
check "grep -qx 'connect 127.0.0.1:41234' '$S/adb.log' && grep -qx -- '-s 127.0.0.1:41234 shell id -u' '$S/adb.log'" "start: adb connect 127.0.0.1:<port>, checked to be adbd (id -u)"
check "grep -q 'lib/\\*/libshizuku.so' '$S/starter'" "start: runs Shizuku's libshizuku.so (any ABI)"
check "ev 'e==dict(kind=\"shizuku-auto\",cmd=\"start\",paired=True,result=\"ok\",detail=e[\"detail\"])'" "start: event ok (cmd:start)"
: > "$S/starter"; hm start 41234
check "[ \$RC = 0 ] && [ ! -s '$S/starter' ]" "start: already running → exit 0, not started twice"
# not paired (the phone dropped the pairing / new key)
rm -f "$S/server"; rm "$S/trusted_key"; hm start 41234
check "[ \$RC = 9 ] && ev 'e[\"result\"]==\"not-paired\" and e[\"paired\"] is False'" "start when not paired: exit 9, result not-paired"
check "[ ! -e '$H/.hermes-mobile/adb-paired' ]" "start when not paired: marker removed (Setup shows Set up again)"
hm status; check "echo \"\$OUT\" | grep -qx unpaired" "status after a refused key: unpaired"

# scan fallback: a real listener on loopback stands for adbd's port
listen() { "$PY" -c 'import socket,sys,time
s=socket.socket(); s.bind(("127.0.0.1",0)); s.listen(5); print(s.getsockname()[1]); sys.stdout.flush(); time.sleep(120)' > "$T/port.$1" & LISTENERS="$LISTENERS $!"
  for _ in $(seq 1 50); do [ -s "$T/port.$1" ] && break; sleep 0.1; done; cat "$T/port.$1"; }
P=$(listen a); Q=$(listen b)
lo=$P; hi=$Q; [ "$lo" -gt "$hi" ] && { lo=$Q; hi=$P; }
if [ $((hi - lo)) -gt 3000 ]; then lo=$P; hi=$P; fi   # keep the scan short (around adbd's port P); the other listener stays a non-adb port if in range
fresh scan; hm pair 40367 182068; echo "$P" > "$S/adbport"; SCAN_FROM=$((lo-5)) SCAN_TO=$((hi+5)) hm start
check "[ \$RC = 0 ] && grep -qx \"connect 127.0.0.1:$P\" '$S/adb.log' && [ -f '$S/server' ]" "start without a port: loopback scan finds adbd's port, starts"
rm -f "$S/server"; : > "$S/adb.log"; SCAN_FROM=$((lo-5)) SCAN_TO=$((hi+5)) hm start 40001
check "[ \$RC = 0 ] && grep -qx 'connect 127.0.0.1:40001' '$S/adb.log' && grep -qx \"connect 127.0.0.1:$P\" '$S/adb.log'" "start with a stale port: falls back to the scan"
rm -f "$S/server"; SCAN_FROM=61010 SCAN_TO=61020 hm start
check "[ \$RC = 7 ] && ev 'e[\"result\"]==\"no-port\"'" "start, nothing listening: exit 7, result no-port"
touch "$S/starter_broken"; SCAN_FROM=$((lo-5)) SCAN_TO=$((hi+5)) hm start "$P"
check "[ \$RC = 8 ] && ev 'e[\"result\"]==\"failed\"'" "start, server doesn't come up: exit 8, failed"
# one run at a time: a live run holds the lock → exit 10 and no event (that run reports); a stale lock is taken over
printf 'sleep 30\n' > "$T/hm-shizuku-busy.sh"; bash "$T/hm-shizuku-busy.sh" & BUSY=$!; disown $BUSY 2>/dev/null; LISTENERS="$LISTENERS $BUSY"
fresh busy; mkdir "$H/.hermes-mobile/hm-shizuku.lock"; echo "$BUSY" > "$H/.hermes-mobile/hm-shizuku.lock/pid"; hm start 41234
check "[ \$RC = 10 ] && [ \$(nevents) = 0 ]" "start while another run holds the lock: exit 10, no event"
check "[ \"\$(cat '$H/.hermes-mobile/hm-shizuku.lock/pid')\" = $BUSY ]" "busy: the other run's lock is left alone"
echo 999999 > "$H/.hermes-mobile/hm-shizuku.lock/pid"; hm pair 40367 182068
check "[ \$RC = 0 ] && [ ! -e '$H/.hermes-mobile/hm-shizuku.lock' ]" "a stale lock is taken over and removed afterwards"
hm start abc; check "[ \$RC = 64 ]" "start with a bad port: usage error"
hm frobnicate; check "[ \$RC = 64 ]" "unknown command: usage error"

# ── static rules ──
check "! grep -n 'RISH\"* -c' phone/hm-shizuku | grep -v '</dev/null' | grep -q ." "every rish call gets </dev/null"
check "grep -E '^A\\(\\)' phone/hm-shizuku | grep -q 'timeout' && grep -E '^A\\(\\)' phone/hm-shizuku | grep -q '</dev/null'" "the adb helper A() is bounded and gets </dev/null"
check "! grep -nE '^[^#]*(^|[;&|(] *)adb (connect|pair|shell|-s|start-server|disconnect)' phone/hm-shizuku | grep -q ." "adb is only called through A()"
check "! grep -qiE 'xiaomi|miui|hyperos|samsung|one ?ui|oppo|vivo|huawei|oneplus' phone/hm-shizuku" "no vendor names"
check "! grep -q 'mdns' phone/hm-shizuku || grep 'mdns' phone/hm-shizuku | grep -q '^ *#'" "no adb mdns (Termux's adb has none)"

# ── the installers use it ──
check "! grep -nE 'hm-shizuku\" pair|[$]hms|bash .*hm-shizuku' phone/phone-access.sh | grep -q ." "phone-access.sh: no pair call (the user pairs from the app)"
check "! grep -qE 'uiautomator|input tap|force-stop|QS_TILE|adb_wifi_enabled|development_settings' phone/hm-shizuku phone/phone-access.sh" "hm-shizuku, phone-access.sh: no screen or settings code"
check "! grep -n \"todo.*start by itself\" phone/phone-access.sh | grep -q ." "phone-access.sh: no TODO line for pairing"
check "[ \$(grep -c 'install proot-distro git curl termux-api unzip android-tools\\|install python git curl termux-api unzip android-tools' phone/bootstrap.sh) = 2 ]" "bootstrap.sh: android-tools in both Termux package lines"
check "grep -q 'cp \"\$here/phone/hm-shizuku\" \"\$HOME/bin/hm-shizuku\"' phone/install.sh && grep -q 'chmod +x.*\$HOME/bin/hm-shizuku' phone/install.sh" "install.sh: installs ~/bin/hm-shizuku"
check "[ \$(grep -n 'bin/hm-shizuku' phone/install.sh | head -1 | cut -d: -f1) -lt \$(grep -n 'phone-access.sh' phone/install.sh | grep bash | head -1 | cut -d: -f1) ]" "install.sh: hm-shizuku is in ~/bin before phone-access.sh runs"
check "grep -q 'need+=(android-tools)' phone/phone-access.sh" "phone-access.sh: installs android-tools when adb is missing"
check "grep -q \"rish\\\" -c 'pm grant com.omarqaterge.hermesmobile android.permission.WRITE_SECURE_SETTINGS' </dev/null.*|| true\" phone/phone-access.sh" "phone-access.sh: grants the app WRITE_SECURE_SETTINGS through rish (best effort)"
check "grep -q 'pm grant \$APP android.permission.WRITE_SECURE_SETTINGS 2>/dev/null || true' tools/setup-phone.sh" "setup-phone.sh: grants the app WRITE_SECURE_SETTINGS (best effort)"
check "grep -q 'Sh \"pm grant \$APP android.permission.WRITE_SECURE_SETTINGS\"' tools/setup-phone.ps1" "setup-phone.ps1: same grant"
first() { grep -n "$2" "$1" | head -1 | cut -d: -f1; }
check "[ \"\$(first tools/setup-phone.sh 'hermes-mobile.apk\" 2>&1')\" -lt \"\$(first tools/setup-phone.sh 'pm grant \$APP android.permission.WRITE_SECURE_SETTINGS')\" ]" "setup-phone.sh: the grant comes after the app is installed"
check "grep -q 'asks you to pair Termux' tools/setup-phone.sh && grep -q 'asks you to pair Termux' tools/setup-phone.ps1 && grep -q 'Android 10 and older' tools/setup-phone.ps1" "setup-phone.sh/.ps1: closing note says the app asks for the pairing"
check "grep -q 'hermes-debian hm-shizuku rish' phone/uninstall.sh" "uninstall.sh removes ~/bin/hm-shizuku"

[ "$fails" = 0 ] && echo "ALL PASSED" || { echo "$fails FAILED"; exit 1; }
