#!/bin/bash
# Checks that every install route does the same Android-side requirement: Shizuku is taken off the battery limits
# (dumpsys deviceidle whitelist +moe.shizuku.privileged.api), after Shizuku is installed, and that the phone-side
# installer does it through rish without ever failing the install. Static checks on the scripts (no device needed).
# Also: the app download takes hermux.apk and falls back to the old file name.
set -uo pipefail
cd "$(dirname "$0")/.."
fails=0
check() { if eval "$1"; then echo "PASS  $2"; else echo "FAIL  $2"; fails=$((fails+1)); fi; }
PKG='moe.shizuku.privileged.api'
check "grep -q 'deviceidle whitelist +$PKG' tools/setup-phone.sh" "setup-phone.sh whitelists Shizuku"
check "grep -q 'deviceidle whitelist +$PKG' tools/setup-phone.ps1" "setup-phone.ps1 whitelists Shizuku"
check "grep -q 'deviceidle whitelist +$PKG' AGENT_INSTALL.md" "AGENT_INSTALL.md whitelists Shizuku"
check "grep -q \"rish\\\" -c 'dumpsys deviceidle whitelist +$PKG'\" phone/phone-access.sh" "phone-access.sh whitelists Shizuku through rish"
check "grep \"deviceidle whitelist +$PKG\" phone/phone-access.sh | grep -q '|| true'" "phone-access.sh: the whitelist never fails the installer"
# order in the computer routes: Shizuku is installed (line with the APK install) before the whitelist line
first() { grep -n "$2" "$1" | head -1 | cut -d: -f1; }
check "[ \"\$(first tools/setup-phone.sh 'adb install -r \"\$WORK/shizuku.apk\"')\" -lt \"\$(first tools/setup-phone.sh 'deviceidle whitelist +$PKG')\" ]" "setup-phone.sh: Shizuku is installed before it is whitelisted"
check "[ \"\$(first tools/setup-phone.ps1 'A install -r \$apk')\" -lt \"\$(first tools/setup-phone.ps1 'deviceidle whitelist +$PKG')\" ]" "setup-phone.ps1: Shizuku is installed before it is whitelisted"
check "bash -n tools/setup-phone.sh && bash -n phone/phone-access.sh" "scripts parse"

# The app download: hermux.apk first, hermes-mobile.apk if the latest release doesn't have it yet. The download parts of
# the phone scripts run with a fake curl that answers 404 for what isn't in $SERVED (no network, no phone).
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
cat > "$T/bin/curl" <<'SH'
#!/bin/bash
out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2 ;; -*) shift ;; *) url=$1; shift ;; esac; done
echo "${url##*/}" >> "$CALLS"
case " $SERVED " in *" ${url##*/} "*) echo "$url" > "$out" ;; *) exit 22 ;; esac
SH
printf '#!/bin/sh\necho "$@" >> "$OPENED"\n' > "$T/bin/termux-open"
chmod +x "$T/bin/"*
sed -n '/^apk="\$HOME\/hermes-mobile.apk"/,/^fi$/p' phone/install.sh > "$T/install-part.sh"
{ echo 'say() { echo "$*"; }'; sed -n '/^if \[ -z "\${HM_NO_APK:-}\${HM_APP_TOKEN:-}" \]; then/,/^fi$/p' phone/bootstrap.sh; } > "$T/bootstrap-part.sh"
{ echo 'WORK="$HOME"; set -e'; grep -E '^APK_URL(_OLD)?=' tools/setup-phone.sh; grep -E '^curl .*APK_URL' tools/setup-phone.sh; } > "$T/setup-part.sh"
check "grep -q curl '$T/install-part.sh' && grep -q curl '$T/bootstrap-part.sh' && grep -q curl '$T/setup-part.sh'" "the download parts of the scripts were found"
apk_run() { # script, what the release serves -> $saved (the address downloaded), $asked (the files asked for, in order), $rc
  local h="$T/h"; rm -rf "$h" "$T/calls" "$T/opened"; mkdir -p "$h"; touch "$T/calls"
  env HOME="$h" PATH="$T/bin:$PATH" CALLS="$T/calls" OPENED="$T/opened" SERVED="$2" REPO=https://github.com/x/y bash "$T/$1" >"$T/out" 2>&1; rc=$?
  saved=$(cat "$h/hermes-mobile.apk" 2>/dev/null); asked=$(tr '\n' ' ' < "$T/calls")
}
for s in install-part.sh bootstrap-part.sh setup-part.sh; do
  apk_run $s "hermes-mobile.apk hermux.apk"
  check '[ "$rc" = 0 ] && [ "$asked" = "hermux.apk " ] && [ "${saved##*/}" = hermux.apk ]' "$s: a release with both names: downloads hermux.apk only"
  apk_run $s "hermes-mobile.apk"
  check '[ "$rc" = 0 ] && [ "$asked" = "hermux.apk hermes-mobile.apk " ] && [ "${saved##*/}" = hermes-mobile.apk ]' "$s: a release with only the old name: falls back to it"
done
for s in install-part.sh bootstrap-part.sh; do
  apk_run $s "hermes-mobile.apk"
  check '[ -s "$T/opened" ]' "$s: the installer opens after the fallback"
  apk_run $s ""
  check '[ "$rc" = 0 ] && [ -z "$saved" ] && [ ! -s "$T/opened" ] && [ ! -e "$T/h/hermes-mobile.apk" ]' "$s: no app file at all: doesn't fail, leaves nothing"
done
apk_run setup-part.sh ""
check '[ "$rc" != 0 ]' "setup-phone.sh: no app file at all: stops"
check "grep -q 'try { Get \\\$APK_URL \\\$apk } catch { Get \\\$APK_URL_OLD \\\$apk }' tools/setup-phone.ps1 && grep -q 'download/hermux.apk' tools/setup-phone.ps1 && grep -q 'download/hermes-mobile.apk' tools/setup-phone.ps1" "setup-phone.ps1: hermux.apk, then the old name"
check "grep -A1 'download/hermux.apk' AGENT_INSTALL.md | grep -q 'download/hermes-mobile.apk'" "AGENT_INSTALL.md: hermux.apk, then the old name"
# Shizuku's rish in phone-access.sh: the APK is checked against its pinned SHA-256 before unzip touches it. Only the pins
# and the rish block are cut out and run, with a fake curl (serves $T/shizuku-served as the APK) and a fake unzip.
check "grep -qE '^SHIZUKU_APK_SHA256=\"[0-9a-f]{64}\"\$' phone/phone-access.sh" "phone-access.sh: SHIZUKU_APK_SHA256 is a 64-character hex checksum"
mkdir -p "$T/rb"
cat > "$T/rb/curl" <<'SH'
#!/bin/bash
out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2 ;; -*) shift ;; *) url=$1; shift ;; esac; done
echo "$url" >> "$CALLS"
[ -f "$SERVED_APK" ] || exit 22
cp "$SERVED_APK" "$out"
SH
cat > "$T/rb/unzip" <<'SH'
#!/bin/bash
# unzip -qo APK assets/rish assets/rish_shizuku.dex -d DIR
dir=""; while [ $# -gt 0 ]; do [ "$1" = -d ] && dir=$2; shift; done
echo unzip >> "$CALLS"; mkdir -p "$dir/assets"
printf '#!/bin/sh\nPKG="PKG"\n' > "$dir/assets/rish"; echo dex > "$dir/assets/rish_shizuku.dex"
SH
chmod +x "$T/rb/"*
{ sed -n '/^SHIZUKU_APK=/,/^say() {/p' phone/phone-access.sh | sed '$d'
  echo 'TODO="$HOME/todo"; : > "$TODO"; todo() { echo "$*" >> "$TODO"; }'
  sed -n '/^# Shizuku.s rish:/,/^# rish gets/p' phone/phone-access.sh | sed '$d'
  echo 'echo carried-on'; } > "$T/rish-part.sh"
check "grep -q '^sha() ' '$T/rish-part.sh' && grep -q 'unzip -qo' '$T/rish-part.sh' && grep -q 'HM_SHIZUKU_APK_URL' '$T/rish-part.sh'" "the rish part of phone-access.sh was found"
printf 'a stand-in for the Shizuku APK\n' > "$T/apk-ok"; printf 'another file, not the pinned APK\n' > "$T/apk-bad"
apk_sum=$( (sha256sum "$T/apk-ok" 2>/dev/null || shasum -a 256 "$T/apk-ok") | cut -c1-64)
rish_run() { # served file, then VAR=value ... -> $rc, $out, $asked, $unzipped; the home is $T/rh
  local served=$1; shift
  rm -rf "$T/rh" "$T/rcalls"; mkdir -p "$T/rh/bin"; : > "$T/rcalls"
  out=$(env -i HOME="$T/rh" PATH="$T/rb:$PATH" CALLS="$T/rcalls" SERVED_APK="$served" TMPDIR="$T" "$@" bash "$T/rish-part.sh" 2>&1); rc=$?
  asked=$(grep -c . "$T/rcalls" 2>/dev/null); unzipped=$(grep -c '^unzip$' "$T/rcalls")
}
rish_run "$T/apk-ok" HM_SHIZUKU_APK_URL=https://example.invalid/s.apk HM_SHIZUKU_APK_SHA256="$apk_sum"
check '[ "$rc" = 0 ] && [ "$unzipped" = 1 ] && grep -q "com.termux" "$T/rh/bin/rish" && [ -x "$T/rh/bin/rish" ] && [ -s "$T/rh/bin/rish_shizuku.dex" ] && [ ! -s "$T/rh/todo" ]' "rish: a download that matches its checksum installs rish and the dex, no TODO"
rish_run "$T/apk-bad" HM_SHIZUKU_APK_URL=https://example.invalid/s.apk HM_SHIZUKU_APK_SHA256="$apk_sum"
check '[ "$rc" = 0 ] && [ "$unzipped" = 0 ] && [ ! -e "$T/rh/bin/rish" ] && [ ! -e "$T/rh/bin/rish_shizuku.dex" ] && grep -q "was not the expected one" "$T/rh/todo" && grep -q "run the installer again" "$T/rh/todo" && ! grep -q "$T" "$T/rh/todo"' "rish: a download that does not match installs nothing, unzip never runs, a TODO says so"
check '[ "$out" = carried-on ] && ! ls -d "$T"/tmp.* 2>/dev/null | grep -q .' "rish: after a mismatch the script carries on and the download is removed"
rish_run "$T/apk-ok"
check '[ "$unzipped" = 0 ] && [ ! -e "$T/rh/bin/rish" ] && grep -q "was not the expected one" "$T/rh/todo" && grep -qF "releases/download/v13.6.0/" "$T/rcalls"' "rish: with no test hook the pinned URL and checksum apply (a different file is refused)"
rish_run "$T/apk-ok" HM_SHIZUKU_APK_SHA256="$apk_sum"
check '[ "$unzipped" = 0 ] && [ ! -e "$T/rh/bin/rish" ]' "rish: the test checksum alone (no test URL) is ignored"
rish_run "$T/apk-ok" HM_SHIZUKU_APK_URL=https://example.invalid/s.apk
check '[ "$unzipped" = 0 ] && [ ! -e "$T/rh/bin/rish" ]' "rish: a test URL alone is still checked against the pinned checksum"
rish_run /nonexistent
check '[ "$rc" = 0 ] && [ "$unzipped" = 0 ] && [ ! -s "$T/rh/todo" ] && [ "$out" = carried-on ]' "rish: a failed download behaves as before (no unzip, carries on)"
[ "$fails" = 0 ] && echo "ALL PASSED" || { echo "$fails FAILED"; exit 1; }
