#!/bin/bash
# Checks that every install route does the same Android-side requirement: Shizuku is taken off the battery limits
# (dumpsys deviceidle whitelist +moe.shizuku.privileged.api), after Shizuku is installed, and that the phone-side
# installer does it through rish without ever failing the install. Static checks on the scripts (no device needed).
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
[ "$fails" = 0 ] && echo "ALL PASSED" || { echo "$fails FAILED"; exit 1; }
