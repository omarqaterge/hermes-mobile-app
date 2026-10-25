#!/bin/bash
# Tests phone/hm-shizuku (Termux: pair Termux's adb with Wireless debugging through rish, start Shizuku's server with it,
# tell the app) with a fake rish, adb, curl and getprop on PATH. The fake rish answers `uiautomator dump` with the real
# AOSP screen dumps in tools/fixtures/hm-shizuku/ (Android 15 emulator) and follows taps by the node under the tapped point,
# so the script has to find what it taps from the dump. Checks: pairing code + ip:port read from the dumps, the
# "Allow wireless debugging on this network?" dialog, the screen and Wireless debugging put back, already-paired fast
# path, rish retries, vendor screens that don't match (clear detail, non-zero), start with a given port / scan fallback /
# not paired / no port, exit codes and the shizuku-auto event JSON (+ key header). No device needed.
set -uo pipefail
cd "$(dirname "$0")/.."
REPO=$(pwd)
FX="$REPO/tools/fixtures/hm-shizuku"
PY=$(command -v python3) || { echo "python3 needed"; exit 1; }
T=$(mktemp -d); LISTENERS=""
cleanup() { for p in $LISTENERS; do kill "$p" 2>/dev/null; done; rm -rf "$T"; }
trap cleanup EXIT
fails=0
check() { if eval "$1"; then echo "PASS  $2"; else echo "FAIL  $2"; fails=$((fails+1)); fi; }

mkdir -p "$T/bin" "$T/fx"
# Fixture variants: the list before it has filled in, and screens whose ids don't match (another Settings app).
sed 's/text="10\.0\.2\.16:40279"/text=""/' "$FX/wd-screen.xml" > "$T/fx/wd-empty.xml"
sed 's#android:id/summary#com.example.settings:id/sub#g' "$FX/wd-screen.xml" > "$T/fx/wd-other.xml"
sed 's#com.android.settings:id/pairing_code#com.example.settings:id/code#' "$FX/pair-dialog.xml" > "$T/fx/pair-other.xml"

# Which node is under (x, y): the smallest one whose bounds hold the point. Prints "resource-id|text".
cat > "$T/hit.py" <<'PY'
import re, sys
xml, x, y = open(sys.argv[1]).read(), int(sys.argv[2]), int(sys.argv[3])
best = None
for n in re.finditer(r'<node [^>]*>', xml):
    a = n.group(0)
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', a)
    if not b: continue
    x1, y1, x2, y2 = map(int, b.groups())
    if x1 <= x < x2 and y1 <= y < y2:
        area = (x2 - x1) * (y2 - y1)
        if best is None or area < best[0]:
            rid = re.search(r'resource-id="([^"]*)"', a); txt = re.search(r' text="([^"]*)"', a)
            best = (area, (rid.group(1) if rid else '') + '|' + (txt.group(1) if txt else ''))
print(best[1] if best else '|')
PY

# fake rish: `rish -c <cmd>` in the shell uid. State in $FAKE_S: set_<setting>, screen (home|trust|wd|pair), flags.
cat > "$T/rish" <<'SH'
#!/bin/bash
S=$FAKE_S; FX=$FAKE_FX
[ "$1" = -c ] || exit 64; c=$2
echo "$c" >> "$S/rish.log"
if [ -s "$S/rish_flaky" ]; then n=$(cat "$S/rish_flaky"); if [ "$n" -gt 0 ]; then echo $((n-1)) > "$S/rish_flaky"; echo "Request timeout" >&2; exit 1; fi; fi
[ -f "$S/shizuku_down" ] && { echo "Request timeout" >&2; exit 1; }
screen=$(cat "$S/screen" 2>/dev/null || echo home)
fx() { # fixture for the current screen
  case $screen in
    trust) [ -f "$S/trust_unknown" ] && echo "$FX/home.xml" || echo "$FX/trust-dialog.xml" ;;
    wd) if [ -s "$S/wd_empty" ] && [ "$(cat "$S/wd_empty")" -gt 0 ]; then echo $(( $(cat "$S/wd_empty") - 1 )) > "$S/wd_empty"; echo "$FAKE_T/fx/wd-empty.xml"
        else cat "$S/fx_wd" 2>/dev/null || echo "$FX/wd-screen.xml"; fi ;;
    pair) cat "$S/fx_pair" 2>/dev/null || echo "$FX/pair-dialog.xml" ;;
    *) echo "$FX/home.xml" ;;
  esac; }
case "$c" in
  id) echo "uid=2000(shell) gid=2000(shell) groups=2000(shell)" ;;
  "cmd wifi status") echo "Wifi is enabled"; if [ -f "$S/no_wifi" ]; then echo "Wifi is disconnected"; else echo 'Wifi is connected to "AndroidWifi"'; fi ;;
  "settings get global adb_wifi_enabled") if [ -s "$S/empty_wd_get" ] && [ "$(cat "$S/empty_wd_get")" -gt 0 ]; then
      echo $(( $(cat "$S/empty_wd_get") - 1 )) > "$S/empty_wd_get"; exit 0; fi   # rish sometimes answers nothing, exit 0
    cat "$S/set_adb_wifi_enabled" ;;
  "settings get global "*) cat "$S/set_${c##* }" 2>/dev/null || echo null ;;
  "settings put global "*) set -- $c; k=$4; v=$5
    if [ "$k" = adb_wifi_enabled ] && [ "$v" = 1 ] && [ -f "$S/untrusted" ]; then echo 0 > "$S/set_$k"; echo trust > "$S/screen"
    else echo "$v" > "$S/set_$k"; fi ;;
  "uiautomator dump /dev/stdout"*) f=$(fx); echo "dump $(basename "$f")" >> "$S/screens"; cat "$f"; echo "UI hierchary dumped to: /dev/stdout" ;;
  "am start "*QS_TILE_PREFERENCES*) echo wd > "$S/screen"; echo "Starting: Intent { act=android.service.quicksettings.action.QS_TILE_PREFERENCES }" ;;
  "input tap "*) set -- $c; f=$(fx); hit=$("$FAKE_PY" "$FAKE_T/hit.py" "$f" "$3" "$4"); echo "$screen $hit" >> "$S/taps"
    case "$screen|$hit" in
      "trust|android:id/alwaysUse|"*) touch "$S/always" ;;
      "trust|android:id/button1|"*) echo 1 > "$S/set_adb_wifi_enabled"; rm -f "$S/untrusted"; echo home > "$S/screen" ;;
      "wd|"*"|Pair device with pairing code") echo pair > "$S/screen" ;;
    esac ;;
  "input keyevent BACK") case $screen in pair) echo wd ;; *) echo home ;; esac > "$S/screen" ;;
  "input keyevent HOME") echo home > "$S/screen" ;;
  "am force-stop com.android.settings") echo home > "$S/screen" ;;
  "dumpsys window"*) case $screen in wd|pair) echo "  mCurrentFocus=Window{a1 u0 com.android.settings/com.android.settings.SubSettings}" ;;
    trust) echo "  mCurrentFocus=Window{b2 u0 com.android.systemui/com.android.systemui.wifi.WifiDebuggingActivity}" ;;
    *) echo "  mCurrentFocus=Window{c3 u0 com.android.launcher3/com.android.launcher3.Launcher}" ;; esac ;;
  "pm grant "*) : ;;
  *) echo "fake rish: unexpected: $c" >&2; echo "$c" >> "$S/unexpected"; exit 1 ;;
esac
SH

# fake adb (Termux android-tools). The "phone" pairs with the code/port shown in pair-dialog.xml and trusts the key it
# paired; $S/adbport is the Wireless debugging connect port.
cat > "$T/bin/adb" <<'SH'
#!/bin/bash
S=$FAKE_S; K=$HOME/.android
echo "$*" >> "$S/adb.log"
[ "$1" = -s ] && shift 2
case "$1" in
  start-server) mkdir -p "$K"; [ -f "$K/adbkey.pub" ] || echo "key-$$-$RANDOM" > "$K/adbkey.pub" ;;
  kill-server) : ;;
  pair) [ -f "$S/user_leaves" ] && echo home > "$S/screen"   # the user switched away meanwhile
        if [ "$2" = "127.0.0.1:40367" ] && [ "$3" = 182068 ]; then cp "$K/adbkey.pub" "$S/trusted_key"; echo "Successfully paired to $2 [guid=adb-FAKE]"
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
  OUT=$(env -i PATH="$T/bin:/usr/bin:/bin" HOME="$H" FAKE_S="$S" FAKE_FX="$FX" FAKE_T="$T" FAKE_PY="$PY" FAKE_SDK="${FAKE_SDK:-35}" \
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

# ── pair, trusted network, Wireless debugging and developer options off ──
fresh pair; hm pair
check "[ \$RC = 0 ]" "pair: exit 0 (got $RC: $(echo "$OUT" | tail -1))"
check "grep -qx 'pair 127.0.0.1:40367 182068' '$S/adb.log'" "pair: code 182068 and port 40367 read from the pairing dialog, paired over loopback"
check "grep -q 'Pair device with pairing code' '$S/taps'" "pair: tapped 'Pair device with pairing code' found in the dump"
check "[ \"\$(cat '$S/set_development_settings_enabled')\" = 1 ]" "pair: developer options turned on"
check "grep -qx 'settings put global adb_wifi_enabled 1' '$S/rish.log'" "pair: Wireless debugging turned on"
check "[ \"\$(cat '$S/set_adb_wifi_enabled')\" = 0 ]" "pair: Wireless debugging off again (this run turned it on)"
check "[ \"\$(cat '$S/screen')\" = home ]" "pair: Settings closed again"
check "grep -qx 'am force-stop com.android.settings' '$S/rish.log' && ! grep -q 'keyevent' '$S/rish.log'" "pair: closed the Settings it opened (not with Back, which reopens it)"
check "grep -q 'am start --activity-clear-task ' '$S/rish.log'" "pair: Settings opened in a fresh task"
check "[ -s '$H/.hermes-mobile/adb-paired' ]" "pair: writes ~/.hermes-mobile/adb-paired"
check "ev 'e==dict(kind=\"shizuku-auto\",paired=True,result=\"ok\",detail=e[\"detail\"]) and isinstance(e[\"detail\"],str)'" "pair: event {kind:shizuku-auto, paired:true, result:ok, detail}"
check "grep -qx 'http://127.0.0.1:9121/event' '$S/curl.0.args'" "pair: event goes to 127.0.0.1:9121/event"
check "grep -qx 'X-Hermes-Mobile-Key: k3y-for-test' '$S/curl.0.headers' && grep -qx 'Content-Type: application/json' '$S/curl.0.headers'" "pair: key + JSON headers (same as the plugin)"
check "! grep -q k3y-for-test '$S/curl.0.args'" "pair: the key is not on curl's command line"
check "[ ! -f '$S/unexpected' ]" "pair: no unexpected rish/adb calls ($(cat "$S/unexpected" 2>/dev/null | head -2 | tr '\n' ' '))"
hm status
check "echo \"\$OUT\" | grep -qx paired" "status after pair: paired"

# already paired: fast, Settings not opened
: > "$S/rish.log"; hm pair
check "[ \$RC = 0 ] && ! grep -q 'am start' '$S/rish.log'" "pair again: exit 0 without opening Settings"
check "ev 'e[\"result\"]==\"ok\" and e[\"paired\"] is True'" "pair again: event ok"
# --force pairs again
: > "$S/rish.log"; hm pair --force
check "[ \$RC = 0 ] && grep -q 'am start' '$S/rish.log'" "pair --force: pairs again"
# a new adb key (pairing lost on this side) → not paired any more → pair runs the scrape
rm -f "$H/.android/adbkey.pub"; hm status
check "echo \"\$OUT\" | grep -qx unpaired" "status: unpaired when the adb key changed"

# the user switched to another app meanwhile: Settings isn't in front, nothing is closed
fresh away; touch "$S/user_leaves"; hm pair
check "[ \$RC = 0 ] && ! grep -q 'force-stop\\|keyevent' '$S/rish.log'" "pair: Settings no longer in front → nothing closed, no keys pressed"

# ── Wireless debugging already on: stays on ──
fresh wdon; echo 1 > "$S/set_adb_wifi_enabled"; echo 1 > "$S/set_development_settings_enabled"; hm pair
check "[ \$RC = 0 ] && [ \"\$(cat '$S/set_adb_wifi_enabled')\" = 1 ]" "pair: Wireless debugging that was on stays on"
check "! grep -q 'settings put global development_settings_enabled' '$S/rish.log'" "pair: developer options already on: not written"
fresh empty; echo 1 > "$S/set_adb_wifi_enabled"; echo 2 > "$S/empty_wd_get"; hm pair
check "[ \$RC = 0 ] && ! grep -q 'adb_wifi_enabled 1' '$S/rish.log' && [ \"\$(cat '$S/set_adb_wifi_enabled')\" = 1 ]" "pair: an empty rish answer is read again (Wireless debugging that was on is not turned off)"

# ── the list fills in late: waits for the ip:port summary ──
fresh late; echo 2 > "$S/wd_empty"; hm pair
check "[ \$RC = 0 ] && [ \$(grep -c 'dump wd-empty' '$S/screens') = 2 ]" "pair: waits until the Wireless debugging list has filled in"

# ── untrusted network: SystemUI's dialog answered (Always allow + Allow) ──
fresh trust; touch "$S/untrusted"; hm pair
check "[ \$RC = 0 ]" "pair on a new network: exit 0 ($(echo "$OUT" | tail -1))"
check "grep -q '^trust android:id/alwaysUse|' '$S/taps' && grep -q '^trust android:id/button1|' '$S/taps'" "pair: ticked 'Always allow on this network' and tapped Allow (found by id)"
check "[ \$(grep -n alwaysUse '$S/taps' | cut -d: -f1) -lt \$(grep -n button1 '$S/taps' | cut -d: -f1) ]" "pair: Always allow before Allow"
fresh trust2; touch "$S/untrusted" "$S/trust_unknown"; hm pair
check "[ \$RC = 4 ] && ev 'e[\"result\"]==\"untrusted-network\" and e[\"paired\"] is False'" "pair: dialog not recognised → exit 4, result untrusted-network"
check "! grep -q 'am start' '$S/rish.log'" "pair: untrusted network → Settings not opened"

# ── no Wi-Fi ──
fresh nowifi; touch "$S/no_wifi"; hm pair
check "[ \$RC = 3 ] && ev 'e[\"result\"]==\"no-wifi\"'" "pair off Wi-Fi: exit 3, result no-wifi"
check "! grep -q 'adb_wifi_enabled 1' '$S/rish.log'" "pair off Wi-Fi: Wireless debugging not touched"

# ── screens that don't match AOSP: clear detail, non-zero, screen and setting put back ──
fresh vendor1; echo "$T/fx/pair-other.xml" > "$S/fx_pair"; hm pair
check "[ \$RC = 5 ] && ev 'e[\"result\"]==\"failed\" and \"pairing screen not recognised\" in e[\"detail\"] and e[\"paired\"] is False'" "pair: unknown pairing dialog → exit 5, 'pairing screen not recognised'"
check "[ \"\$(cat '$S/screen')\" = home ] && [ \"\$(cat '$S/set_adb_wifi_enabled')\" = 0 ]" "pair failed: Settings closed, Wireless debugging off again"
check "[ ! -e '$H/.hermes-mobile/adb-paired' ] && ! grep -q '^pair ' '$S/adb.log'" "pair failed: no adb pair, no marker"
fresh vendor2; echo "$T/fx/wd-other.xml" > "$S/fx_wd"; hm pair
check "[ \$RC = 5 ] && ev '\"not recognised\" in e[\"detail\"]'" "pair: unknown Wireless debugging screen → exit 5, 'not recognised'"
check "[ \"\$(cat '$S/screen')\" = home ]" "pair failed early: Settings closed"

# ── rish: retried (Request timeout), or not usable ──
fresh flaky; echo 2 > "$S/rish_flaky"; hm pair
check "[ \$RC = 0 ]" "pair: rish 'Request timeout' twice → retried, paired"
fresh down; touch "$S/shizuku_down"; hm pair
check "[ \$RC = 2 ] && ev 'e[\"result\"]==\"failed\" and \"Shizuku\" in e[\"detail\"]'" "pair without Shizuku: exit 2, failed, says Shizuku"
fresh old; FAKE_SDK=29 hm pair
check "[ \$RC != 0 ] && ev 'e[\"result\"]==\"failed\" and \"Android 11\" in e[\"detail\"]'" "pair on Android 10: fails with a clear detail"
fresh nokey; rm "$H/.hermes-mobile/key"; hm pair
check "[ \$RC = 0 ] && [ \$(nevents) = 0 ]" "no app key: pairs, posts nothing"

# ── start ──
fresh start; hm pair; echo 41234 > "$S/adbport"; hm start 41234
check "[ \$RC = 0 ] && [ -f '$S/server' ]" "start <port>: exit 0, shizuku_server runs"
check "grep -qx 'connect 127.0.0.1:41234' '$S/adb.log' && grep -qx -- '-s 127.0.0.1:41234 shell id -u' '$S/adb.log'" "start: adb connect 127.0.0.1:<port>, checked to be adbd (id -u)"
check "grep -q 'lib/\\*/libshizuku.so' '$S/starter'" "start: runs Shizuku's libshizuku.so (any ABI)"
check "ev 'e==dict(kind=\"shizuku-auto\",paired=True,result=\"ok\",detail=e[\"detail\"])'" "start: event ok"
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
if [ $((hi - lo)) -gt 3000 ]; then hi=$lo; fi   # keep the scan short; the other listener stays a non-adb port if in range
fresh scan; hm pair; echo "$P" > "$S/adbport"; SCAN_FROM=$((lo-5)) SCAN_TO=$((hi+5)) hm start
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
echo 999999 > "$H/.hermes-mobile/hm-shizuku.lock/pid"; hm pair
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
check "[ \$(grep -c 'install proot-distro git curl termux-api unzip android-tools\\|install python git curl termux-api unzip android-tools' phone/bootstrap.sh) = 2 ]" "bootstrap.sh: android-tools in both Termux package lines"
check "grep -q 'cp \"\$here/phone/hm-shizuku\" \"\$HOME/bin/hm-shizuku\"' phone/install.sh && grep -q 'chmod +x.*\$HOME/bin/hm-shizuku' phone/install.sh" "install.sh: installs ~/bin/hm-shizuku"
check "[ \$(grep -n 'bin/hm-shizuku' phone/install.sh | head -1 | cut -d: -f1) -lt \$(grep -n 'phone-access.sh' phone/install.sh | grep bash | head -1 | cut -d: -f1) ]" "install.sh: hm-shizuku is in ~/bin before phone-access.sh runs"
check "grep -q 'need+=(android-tools)' phone/phone-access.sh" "phone-access.sh: installs android-tools when adb is missing"
check "grep -q \"rish\\\" -c 'pm grant com.omarqaterge.hermesmobile android.permission.WRITE_SECURE_SETTINGS' </dev/null.*|| true\" phone/phone-access.sh" "phone-access.sh: grants the app WRITE_SECURE_SETTINGS through rish (best effort)"
check "grep -q 'timeout [0-9]* bash \"\$hms\" pair </dev/null' phone/phone-access.sh" "phone-access.sh: pairs (bounded, </dev/null)"
check "grep -A4 'bash \"\$hms\" pair' phone/phone-access.sh | grep -q \"todo \\\"Shizuku can't start by itself yet\" && ! grep -A4 'bash \"\$hms\" pair' phone/phone-access.sh | grep -q 'say \\\"FAIL'" "phone-access.sh: a failed pairing is a to-do line, never FAIL"
check "grep -q 'ro.build.version.sdk' phone/phone-access.sh" "phone-access.sh: pairs only on Android 11+"
check "grep -q 'pm grant \$APP android.permission.WRITE_SECURE_SETTINGS 2>/dev/null || true' tools/setup-phone.sh" "setup-phone.sh: grants the app WRITE_SECURE_SETTINGS (best effort)"
check "grep -q 'Sh \"pm grant \$APP android.permission.WRITE_SECURE_SETTINGS\"' tools/setup-phone.ps1" "setup-phone.ps1: same grant"
first() { grep -n "$2" "$1" | head -1 | cut -d: -f1; }
check "[ \"\$(first tools/setup-phone.sh 'hermes-mobile.apk\" 2>&1')\" -lt \"\$(first tools/setup-phone.sh 'pm grant \$APP android.permission.WRITE_SECURE_SETTINGS')\" ]" "setup-phone.sh: the grant comes after the app is installed"
check "grep -q 'starts again' tools/setup-phone.sh && grep -q 'starts again' tools/setup-phone.ps1 && grep -q 'Android 10 and older' tools/setup-phone.ps1" "setup-phone.sh/.ps1: final Shizuku note rewritten in both"
check "grep -q 'hermes-debian hm-shizuku rish' phone/uninstall.sh" "uninstall.sh removes ~/bin/hm-shizuku"

[ "$fails" = 0 ] && echo "ALL PASSED" || { echo "$fails FAILED"; exit 1; }
