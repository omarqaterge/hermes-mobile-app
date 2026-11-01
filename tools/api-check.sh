#!/bin/bash
# Fail when the Android Java calls an API newer than the app's minimum Android without a version check.
# Runs Android lint's NewApi/InlinedApi checks on the sources (no build needed). build.sh passes the minimum to aapt2
# instead of the manifest, so the check runs on a copy with <uses-sdk> added. Needs the Android SDK command-line tools
# (lint) and one platform; ANDROID_HOME or the Homebrew path. Usage: tools/api-check.sh
set -euo pipefail
cd "$(dirname "$0")/../android"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/opt/homebrew/share/android-commandlinetools}}"
LINT=$(ls "$SDK"/cmdline-tools/*/bin/lint 2>/dev/null | head -1 || true)
[ -n "$LINT" ] || { echo "api-check: no lint under $SDK/cmdline-tools" >&2; exit 2; }
PLATFORM=$(ls "$SDK/platforms" 2>/dev/null | sed -n 's/^android-\([0-9]*\)$/\1/p' | sort -n | tail -1)
[ -n "$PLATFORM" ] || { echo "api-check: no platform under $SDK/platforms" >&2; exit 2; }
MIN=$(sed -n 's/.*--min-sdk-version \([0-9]*\).*/\1/p' build.sh | head -1)
[ -n "$MIN" ] || { echo "api-check: no --min-sdk-version in build.sh" >&2; exit 2; }
SHERPA_JAR=$(../tools/sherpa-onnx.sh --jar-only | head -1) # LocalStt's speech engine, so lint resolves its classes
OUT=$(mktemp -d); trap 'rm -rf "$OUT"' EXIT
cp -R src res "$OUT/"
sed "s#<application#<uses-sdk android:minSdkVersion=\"$MIN\" />\n    <application#" AndroidManifest.xml > "$OUT/AndroidManifest.xml"
grep -q '<uses-sdk' "$OUT/AndroidManifest.xml" || { echo "api-check: could not add <uses-sdk>" >&2; exit 2; }
set +e
( cd "$OUT" && "$LINT" --quiet --check NewApi,InlinedApi --disable LintError --exitcode --sdk-home "$SDK" \
    --compile-sdk-version "$PLATFORM" --sources src --libraries "$SHERPA_JAR" --resources res --text report.txt . > lint.log 2>&1 )
rc=$?
set -e
sed "s#\.\./src/#android/src/#" "$OUT/report.txt" 2>/dev/null | grep -E '(Error|Warning):' || true
if [ $rc -ne 0 ]; then echo "api-check: FAIL (min API $MIN, compile $PLATFORM): guard each call above with Build.VERSION.SDK_INT"; exit 1; fi
echo "api-check: PASS (no call above API $MIN without a version check)"
