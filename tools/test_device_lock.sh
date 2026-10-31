#!/bin/bash
# Tests tools/device-lock.sh (one session at a time per phone or emulator) in a temp lock folder. Checks: hold/busy/
# extend/release, only the holder releases, expired locks are taken over, run releases even when the command fails and
# passes its exit code on, serials with ':' and bad arguments. No device needed.
set -uo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HM_DEVICE_LOCKS="$T/locks"
L=tools/device-lock.sh
fails=0
check() { if eval "$1"; then echo "PASS  $2"; else echo "FAIL  $2"; fails=$((fails+1)); fi; }

out=$($L status); check '[[ $out == *"no device is locked"* ]]' "status with nothing locked"
$L hold emulator-5554 A >/dev/null; check '[ $? = 0 ]' "A takes the emulator"
out=$($L hold emulator-5554 B); rc=$?
check '[ $rc = 75 ] && [[ $out == *busy*A* ]]' "B is told it is busy, and by whom (exit 75)"
$L hold emulator-5554 A 60 >/dev/null; check '[ $? = 0 ]' "A extends its own lock"
out=$($L status); check '[[ $out == emulator-5554:\ A\ until* ]]' "status lists the holder"
$L release emulator-5554 B >/dev/null; check '[ $? = 1 ] && [ -d "$HM_DEVICE_LOCKS/emulator-5554" ]' "B can't release A's lock"
$L release emulator-5554 A >/dev/null; check '[ $? = 0 ] && [ ! -d "$HM_DEVICE_LOCKS/emulator-5554" ]' "A releases it"
$L hold emulator-5554 B >/dev/null; check '[ $? = 0 ]' "then B gets it"
$L release emulator-5554 B >/dev/null

# an expired lock (a session that died) is taken over
$L hold phone A >/dev/null
printf 'who=A\nuntil=%s\n' "$(( $(date +%s) - 1 ))" > "$HM_DEVICE_LOCKS/phone/owner"
$L hold phone B >/dev/null; check '[ $? = 0 ] && grep -q "^who=B$" "$HM_DEVICE_LOCKS/phone/owner"' "an expired lock is taken over"
out=$($L status); check '[[ $out == *phone:\ B* ]]' "status shows the new holder"
$L release phone B >/dev/null

# run: releases afterwards, passes the exit code on, refuses when busy
$L run 192.168.1.5:5555 A sh -c 'test -d "$HM_DEVICE_LOCKS/192.168.1.5_5555"' >/dev/null
check '[ $? = 0 ]' "run holds the lock while the command runs (':' in the serial is safe)"
check '[ ! -d "$HM_DEVICE_LOCKS/192.168.1.5_5555" ]' "run releases it afterwards"
$L run phone A sh -c 'exit 3' >/dev/null; rc=$?
check '[ $rc = 3 ] && [ ! -d "$HM_DEVICE_LOCKS/phone" ]' "run passes a failure's exit code on and still releases"
$L hold phone A >/dev/null
$L run phone B sh -c 'touch "$HM_DEVICE_LOCKS/ran"' >/dev/null; rc=$?
check '[ $rc = 75 ] && [ ! -e "$HM_DEVICE_LOCKS/ran" ]' "run doesn't run the command when the device is busy"
$L release phone A >/dev/null

# bad arguments
$L hold phone >/dev/null 2>&1; check '[ $? = 2 ]' "hold without WHO is a usage error"
$L hold phone A abc >/dev/null; check '[ $? = 2 ]' "MINUTES must be a number"
$L hold phone A 999 >/dev/null; check '[ $? = 2 ] && [ ! -d "$HM_DEVICE_LOCKS/phone" ]' "MINUTES is capped at 240"
$L nonsense >/dev/null; check '[ $? = 2 ]' "unknown command is a usage error"

echo "device-lock: $fails failure(s)"
[ $fails = 0 ]
