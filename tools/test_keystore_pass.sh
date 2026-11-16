#!/bin/bash
# android/build.sh takes the keystore password from KEYSTORE_PASS (CI: the repository secret), passes it to keytool and
# apksigner through the environment (never on the command line, where `ps` shows it), keeps the old default for a local
# build, and warns on a release build (KEYSTORE set) that has none. release.yml passes the secret. No Android SDK needed:
# build.sh decides the password before it checks for the SDK, which then stops it.
set -uo pipefail
cd "$(dirname "$0")/.."
fails=0
check() { if [ "$1" = 0 ]; then echo "PASS  $2"; else echo "FAIL  $2"; fails=$((fails + 1)); fi; }
run() { env -u KEYSTORE -u KEYSTORE_PASS -u KEYSTORE_KEY_PASS -u HM_DEVTOOLS ANDROID_HOME=/nonexistent-sdk "$@" android/build.sh 2>&1 >/dev/null; }

out=$(run KEYSTORE=/nonexistent.keystore)
grep -q '::warning::KEYSTORE_PASS is not set' <<< "$out"; check $? "a release build with no KEYSTORE_PASS warns"
out=$(run KEYSTORE=/nonexistent.keystore KEYSTORE_PASS=x)
! grep -q 'KEYSTORE_PASS is not set' <<< "$out"; check $? "a release build with KEYSTORE_PASS doesn't warn"
out=$(run)
! grep -q 'KEYSTORE_PASS is not set' <<< "$out"; check $? "a local build (no KEYSTORE) doesn't warn"

! grep -nE -- '-(store|key)pass [^ ]|--(ks|key)-pass pass:' android/build.sh; check $? "no password on keytool's or apksigner's command line"
grep -q -- '--ks-pass env:KEYSTORE_PASS --key-pass env:KEYSTORE_KEY_PASS' android/build.sh; check $? "apksigner reads both passwords from the environment"
grep -q -- '-storepass:env KEYSTORE_PASS -keypass:env KEYSTORE_KEY_PASS' android/build.sh; check $? "keytool reads both passwords from the environment"
grep -q 'KEYSTORE_PASS: \${{ secrets.KEYSTORE_PASS }}' .github/workflows/release.yml; check $? "release.yml passes the KEYSTORE_PASS secret"

[ "$fails" = 0 ] && echo "ALL PASSED" || echo "$fails FAILED"
[ "$fails" = 0 ]
