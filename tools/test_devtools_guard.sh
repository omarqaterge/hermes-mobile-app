#!/bin/bash
# Proves android/build.sh refuses a release-key build (KEYSTORE set) that also asks for WebView remote debugging
# (HM_DEVTOOLS set), and that it refuses before any SDK check, so this test needs no Android SDK.
# Also checks the test-only switch is wired the same way everywhere. Usage: tools/test_devtools_guard.sh
set -u
cd "$(dirname "$0")/.."
fails=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; fails=$((fails + 1)); }

out=$(KEYSTORE=/nonexistent HM_DEVTOOLS=1 ANDROID_HOME=/nonexistent android/build.sh 2>&1); rc=$?
[ "$rc" = 1 ] && pass "KEYSTORE + HM_DEVTOOLS=1 exits 1" || fail "KEYSTORE + HM_DEVTOOLS=1 exits $rc, not 1"
case "$out" in *"HM_DEVTOOLS"*"KEYSTORE"*) pass "the message names both variables" ;; *) fail "refusal message missing: $out" ;; esac
case "$out" in *missing*) fail "an SDK check ran before the refusal: $out" ;; *) pass "refused before any SDK check" ;; esac

# Any value counts as "set": a release can't carry the flag by a typo either.
KEYSTORE=/nonexistent HM_DEVTOOLS=0 ANDROID_HOME=/nonexistent android/build.sh >/dev/null 2>&1; rc=$?
[ "$rc" = 1 ] && pass "any HM_DEVTOOLS value with KEYSTORE is refused" || fail "HM_DEVTOOLS=0 with KEYSTORE exits $rc"

# Without KEYSTORE the guard lets it through (it then stops at the missing SDK, which is what this test must not need).
out=$(env -u KEYSTORE HM_DEVTOOLS=1 ANDROID_HOME=/nonexistent android/build.sh 2>&1); rc=$?
case "$out" in *"refusing to build"*) fail "refused without KEYSTORE" ;; *) pass "HM_DEVTOOLS alone is not refused" ;; esac

grep -q 'hm_devtools' .github/workflows/release.yml \
  && pass "release.yml checks the APK for hm_devtools" || fail "release.yml has no hm_devtools check"
[ "$(grep -c 'HM_DEVTOOLS=' .github/workflows/release.yml)" = 0 ] && pass "release.yml never sets HM_DEVTOOLS" || fail "release.yml sets HM_DEVTOOLS"

[ "$fails" = 0 ] && { echo "ALL PASSED"; exit 0; }
echo "$fails FAILED"; exit 1
