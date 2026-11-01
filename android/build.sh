#!/bin/bash
# Build the Hermes phone app without Gradle: aapt2 + javac + d8 + zipalign + apksigner.
# Output: build/hermes-mobile.apk (signed with a local key in ~/.android/hermes-mobile.keystore, or $KEYSTORE).
set -euo pipefail
# A release build (KEYSTORE is the release key CI passes) must never carry WebView remote debugging. This check is
# first, before any SDK check, so tools/test_devtools_guard.sh needs no Android SDK.
if [ -n "${HM_DEVTOOLS:-}" ] && [ -n "${KEYSTORE:-}" ]; then
  echo "refusing to build: HM_DEVTOOLS (WebView remote debugging) can't be combined with KEYSTORE (a release build)" >&2
  exit 1
fi
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"
PLATFORM=35          # targetSdk
COMPILE_PLATFORM=36  # compile against Android 16 APIs (Live Updates)
BT="$SDK/build-tools/35.0.0"
ANDROID_JAR="$SDK/platforms/android-$COMPILE_PLATFORM/android.jar"
VERSION_NAME="${VERSION_NAME:-0.1.0}"
VERSION_CODE="${VERSION_CODE:-1}"
DEVTOOLS=0
if [ "${HM_DEVTOOLS:-}" = "1" ]; then DEVTOOLS=1; VERSION_NAME="$VERSION_NAME+devtools"; fi
KS="${KEYSTORE:-$HOME/.android/hermes-mobile.keystore}"  # CI passes the release key here

[ -f "$ANDROID_JAR" ] || { echo "missing $ANDROID_JAR (sdkmanager \"platforms;android-$COMPILE_PLATFORM\")"; exit 1; }
[ -x "$BT/aapt2" ] || { echo "missing build-tools 35.0.0"; exit 1; }

# 1. web UI → assets
( cd ../web && npx vite build >/dev/null )
mkdir -p assets/www
cp ../web/dist/index.html assets/www/index.html
# Settings → Uninstall Hermes runs this in Termux (Uninstall.java); shipped in the APK so it matches the app.
mkdir -p assets/phone
cp ../phone/uninstall.sh assets/phone/uninstall.sh
# "Test model" in Settings → Voice → Speech recognition transcribes this clip (LibriSpeech, CC BY 4.0; see THIRD_PARTY.md).
mkdir -p assets/stt
cp stt/sample.wav assets/stt/sample.wav

rm -rf build && mkdir -p build/gen build/classes build/dex

# 2. resources + manifest
"$BT/aapt2" compile --dir res -o build/res.zip
RES_ZIPS=(build/res.zip)
# Emulator tests only: the setup flow's installer command fetches this URL instead of main's bootstrap.sh (a working tree
# served from the Mac). MainActivity accepts only http://10.0.2.2:<port>/… (the emulator's host). Never set for a release.
if [ -n "${HM_TEST_BOOTSTRAP_URL:-}" ]; then
  echo "TEST BUILD: installer command uses $HM_TEST_BOOTSTRAP_URL" >&2
  mkdir -p build/res-test/values
  printf '<resources><string name="hm_test_bootstrap" translatable="false">%s</string></resources>\n' "$HM_TEST_BOOTSTRAP_URL" > build/res-test/values/test.xml
  "$BT/aapt2" compile --dir build/res-test -o build/res-test.zip
  RES_ZIPS+=(build/res-test.zip)
fi
# Test builds only: HM_DEVTOOLS=1 adds the string resource hm_devtools, which MainActivity.devtoolsBuild reads to turn on
# WebView remote debugging, and "+devtools" on the version name, which makes the page show its warning strip.
if [ "$DEVTOOLS" = 1 ]; then
  echo "TEST BUILD: WebView remote debugging is on" >&2
  mkdir -p build/res-devtools/values
  printf '<resources><string name="hm_devtools" translatable="false">1</string></resources>\n' > build/res-devtools/values/devtools.xml
  "$BT/aapt2" compile --dir build/res-devtools -o build/res-devtools.zip
  RES_ZIPS+=(build/res-devtools.zip)
fi
"$BT/aapt2" link -I "$ANDROID_JAR" --manifest AndroidManifest.xml -A assets \
  --min-sdk-version 26 --target-sdk-version "$PLATFORM" \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  --java build/gen -o build/unsigned.apk "${RES_ZIPS[@]}"

# 3. Java → classes → dex. On-device dictation (LocalStt) runs on sherpa-onnx: its pure-Java API jar is compiled in and
# its native library (lib/<abi>/libsherpa-onnx-jni.so, onnxruntime linked in) goes into the APK.
SHERPA=$(../tools/sherpa-onnx.sh)
SHERPA_JAR=$(sed -n 1p <<< "$SHERPA")
SHERPA_LIBS=$(sed -n 2p <<< "$SHERPA")
find src build/gen -name '*.java' > build/sources.txt
javac -encoding UTF-8 -source 11 -target 11 -Xlint:-options -classpath "$ANDROID_JAR:$SHERPA_JAR" -d build/classes @build/sources.txt
"$BT/d8" --min-api 26 --lib "$ANDROID_JAR" --output build/dex $(find build/classes -name '*.class') "$SHERPA_JAR"
( cd build/dex && zip -q -j ../unsigned.apk classes.dex )
( cd "$SHERPA_LIBS" && zip -q -r "$OLDPWD/build/unsigned.apk" lib -x '*.done' )

# 4. align + sign
[ -f "$KS" ] || keytool -genkeypair -keystore "$KS" -storepass hermesmobile -keypass hermesmobile \
  -alias hermes -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Hermes Mobile, O=omarqaterge" >/dev/null 2>&1
"$BT/zipalign" -f -p 4 build/unsigned.apk build/aligned.apk
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:hermesmobile --key-pass pass:hermesmobile \
  --out build/hermes-mobile.apk build/aligned.apk
"$BT/apksigner" verify build/hermes-mobile.apk
ls -la build/hermes-mobile.apk
