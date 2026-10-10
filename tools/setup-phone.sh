#!/usr/bin/env bash
# Sets up Hermes + Hermes Mobile on an Android phone from a Mac or Linux computer, over adb. Plug the phone in with USB
# debugging on, then:
#   curl -fsSL https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/tools/setup-phone.sh -o setup-phone.sh && bash setup-phone.sh
# Windows: tools/setup-phone.ps1. What it does, step by step: AGENT_INSTALL.md (same steps, for AI agents).
#
# At the end it offers to set an API key. Skip it (Enter) to connect a model in the app instead, which also does
# subscription sign-ins (ChatGPT, Claude, Grok, Nous Portal). To run without questions, set them first:
#   HM_PROVIDER=openrouter HM_MODEL=<model id> HM_KEY_NAME=OPENROUTER_API_KEY HM_KEY=sk-... bash setup-phone.sh
# or HM_SKIP_MODEL=1 to leave the model to the app's first-run screen.
# Options: -s <serial> picks a device when several are connected. Safe to run again.
set -euo pipefail

RAW="https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main"
APK_URL="https://github.com/omarqaterge/hermes-mobile-app/releases/latest/download/hermes-mobile.apk"
APP=com.omarqaterge.hermesmobile
WORK="${HM_WORK:-$HOME/.hermes-mobile-setup}"
mkdir -p "$WORK"
while getopts "s:" o; do case $o in s) export ANDROID_SERIAL=$OPTARG ;; *) exit 2 ;; esac; done

b() { printf '\n\033[1m%s\033[0m\n' "$*"; }
say() { printf '  %s\n' "$*"; }
die() { printf '\n\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }
ask() { local a; read -r -p "  $1 " a </dev/tty; printf '%s' "$a"; }

# ---------------------------------------------------------------- 1. adb
b "1/9 adb"
ADB=$(command -v adb || true)
if [ -z "$ADB" ]; then
  ADB="$WORK/platform-tools/adb"
  if [ ! -x "$ADB" ]; then
    case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) die "Unsupported OS: use tools/setup-phone.ps1 on Windows" ;; esac
    say "Downloading Google's platform-tools (adb) into $WORK"
    curl -fsSL -o "$WORK/pt.zip" "https://dl.google.com/android/repository/platform-tools-latest-$os.zip"
    if command -v unzip >/dev/null; then unzip -qo "$WORK/pt.zip" -d "$WORK"; else python3 -m zipfile -e "$WORK/pt.zip" "$WORK"; fi
    chmod +x "$ADB"; rm -f "$WORK/pt.zip"
  fi
fi
adb() { "$ADB" "$@"; }
say "$("$ADB" version | head -1)"

# ---------------------------------------------------------------- 2. phone
b "2/9 Connecting to the phone"
shown=""
while :; do
  devs=$(adb devices | awk 'NR>1 && NF>=2 {print $1" "$2}')
  if [ -n "${ANDROID_SERIAL:-}" ]; then devs=$(printf '%s\n' "$devs" | awk -v s="$ANDROID_SERIAL" '$1==s')
  fi
  n=$(printf '%s' "$devs" | grep -c . || true)
  if [ "$n" -gt 1 ]; then die "Several devices are connected:
$devs
Pick one with: bash setup-phone.sh -s <serial>"; fi
  state=$(printf '%s' "$devs" | awk '{print $2}')
  [ "$state" = device ] && break
  if [ -z "$shown" ]; then
    shown=1
    say "Waiting for the phone. On the phone:"
    say " - Settings → About phone → tap 'Build number' 7 times (Xiaomi: 'OS version')"
    say " - Developer options → USB debugging ON (Xiaomi: also 'Install via USB' and 'USB debugging (Security settings)')"
    say " - plug it in and tap Allow on 'Allow USB debugging?'"
  fi
  [ "$state" = unauthorized ] && say "Phone found: tap Allow on the phone's 'Allow USB debugging?' prompt."
  sleep 3
done
export ANDROID_SERIAL=$(adb get-serialno)
abi=$(adb shell getprop ro.product.cpu.abi | tr -d '\r')
sdk=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
free_kb=$(adb shell df -k /data | awk 'NR==2 {print $4}' | tr -d '\r')
say "$(adb shell getprop ro.product.model | tr -d '\r'), Android SDK $sdk, $abi, $((free_kb / 1048576)) GB free"
[ "$abi" = arm64-v8a ] || die "This phone is $abi; Hermes Mobile needs arm64-v8a."
[ "$sdk" -ge 26 ] || die "Android 8 or newer is needed."
need=6000000  # a re-run has most of it installed already
adb shell pm list packages com.termux | tr -d '\r' | grep -qx package:com.termux && need=2000000
[ "$free_kb" -ge "$need" ] || die "At least $((need / 1000000)) GB free space is needed."

# ---------------------------------------------------------------- 3. Termux
b "3/9 Termux"
fdroid_install() {  # package
  local code
  code=$(curl -fsSL "https://f-droid.org/api/v1/packages/$1" | sed -n 's/.*"suggestedVersionCode":\([0-9]*\).*/\1/p')
  [ -n "$code" ] || die "Couldn't ask F-Droid for $1"
  say "Downloading $1 from F-Droid"
  curl -fL --progress-bar -o "$WORK/$1.apk" "https://f-droid.org/repo/${1}_$code.apk"
  say "Installing $1"
  adb install -r "$WORK/$1.apk" >/dev/null || die "Installing $1 failed (Xiaomi: turn on 'Install via USB' in Developer options)."
  rm -f "$WORK/$1.apk"
}
if adb shell pm list packages com.termux | tr -d '\r' | grep -qx package:com.termux; then
  ver=$(adb shell dumpsys package com.termux | sed -n 's/.*versionName=\([0-9.]*\).*/\1/p' | head -1)
  minor=$(printf '%s' "$ver" | cut -d. -f2)
  say "Termux $ver is already installed"
  [ "${minor:-0}" -ge 118 ] || die "Termux $ver is too old (Play Store build?). Uninstall it (this deletes its files) and run this again."
else
  fdroid_install com.termux
fi
if ! adb shell pm list packages com.termux.boot | tr -d '\r' | grep -qx package:com.termux.boot; then
  fdroid_install com.termux.boot || true
fi
adb shell am start -n com.termux.boot/.BootActivity >/dev/null 2>&1 || true  # it must be opened once to work
# Hermes's access to the phone: Termux:API (battery, location, clipboard, notifications…) and Shizuku (screen, taps,
# apps, logs, without root). Termux:API must come from the same place as Termux (F-Droid), or Android refuses it.
if ! adb shell pm list packages com.termux.api | tr -d '\r' | grep -qx package:com.termux.api; then
  fdroid_install com.termux.api
fi
SHIZUKU=moe.shizuku.privileged.api
if ! adb shell pm list packages $SHIZUKU | tr -d '\r' | grep -qx package:$SHIZUKU; then
  say "Downloading Shizuku from GitHub"
  curl -fL --progress-bar -o "$WORK/shizuku.apk" "https://github.com/RikkaApps/Shizuku/releases/download/v13.6.0/shizuku-v13.6.0.r1086.2650830c-release.apk"
  adb install -r "$WORK/shizuku.apk" >/dev/null || die "Installing Shizuku failed (Xiaomi: turn on 'Install via USB' in Developer options)."
  rm -f "$WORK/shizuku.apk"
fi

# ---------------------------------------------------------------- 4. Android settings
b "4/9 Android settings (keep Termux alive, screen on during the install)"
adb shell svc power stayon true
adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard >/dev/null 2>&1 || true  # a PIN/pattern still needs the user
adb shell cmd appops set com.termux RUN_ANY_IN_BACKGROUND allow || true
adb shell dumpsys deviceidle whitelist +com.termux >/dev/null || true
# Files for Hermes (/sdcard), so the installer doesn't stop at Android's prompt.
adb shell pm grant com.termux android.permission.READ_EXTERNAL_STORAGE 2>/dev/null || true
adb shell pm grant com.termux android.permission.WRITE_EXTERNAL_STORAGE 2>/dev/null || true
# Start Shizuku the way its own "Start by adb" does. It stops on every reboot without root; see the README.
if ! adb shell ps -A -o NAME | tr -d '\r' | grep -qx shizuku_server; then
  adb shell 'p=$(pm path moe.shizuku.privileged.api | head -1 | cut -d: -f2); "$(dirname "$p")/lib/arm64/libshizuku.so"' >/dev/null 2>&1 || true
  sleep 2
fi
adb shell ps -A -o NAME | tr -d '\r' | grep -qx shizuku_server && say "Shizuku is running" || say "Shizuku didn't start; the installer will say what to do"
# Lets Shizuku start itself after a reboot (Android 13+, without root, after one start via Wireless debugging).
adb shell pm grant moe.shizuku.privileged.api android.permission.WRITE_SECURE_SETTINGS 2>/dev/null || true
if [ "$sdk" -ge 31 ]; then  # Android 12+ kills apps with many child processes ("signal 9" in Termux)
  adb shell device_config set_sync_disabled_for_tests persistent >/dev/null 2>&1 || true
  adb shell device_config put activity_manager max_phantom_processes 2147483647 >/dev/null 2>&1 || true
  adb shell settings put global settings_enable_monitor_phantom_procs false >/dev/null 2>&1 || true
fi
restore() { adb shell svc power stayon false >/dev/null 2>&1 || true; [ -n "${LOGPID:-}" ] && kill "$LOGPID" 2>/dev/null || true; }
trap restore EXIT

# ---------------------------------------------------------------- 5. Termux ready
b "5/9 Opening Termux (keep the phone unlocked; don't touch it while this runs)"
type_line() {  # text without ' or %; typed into the app in front, then Enter
  adb shell "input text '${1// /%s}'"
  adb shell input keyevent 66
}
termux_front() {
  adb shell am start -n com.termux/.app.TermuxActivity >/dev/null 2>&1
  sleep 2
  adb shell dumpsys window | grep mCurrentFocus | grep -q com.termux
}
LOG="$WORK/hmsetup.log"
: > "$LOG"
adb logcat -c 2>/dev/null || true
adb logcat -v brief -s 'hmsetup:*' > "$LOG" 2>/dev/null & LOGPID=$!
ready=""
for i in $(seq 1 30); do
  if termux_front; then
    type_line "/system/bin/log -t hmsetup HMSETUP READY"
    sleep 4
    if grep -q "HMSETUP READY" "$LOG"; then ready=1; break; fi
  else
    say "Termux isn't in front. Is the phone locked? Unlock it and leave Termux open."
  fi
  [ "$i" = 1 ] && say "Waiting for Termux to finish its first start…"
  sleep 6
done
[ -n "$ready" ] || die "Termux didn't respond. Open it on the phone, wait for the \$ prompt, and run this again."

# ---------------------------------------------------------------- 6. install on the phone
b "6/9 Installing Debian + Hermes on the phone (20-40 minutes)"
type_line "curl -fsSL $RAW/phone/bootstrap.sh -o hm.sh && bash hm.sh"
seen=0; start=$(date +%s)
while :; do
  sleep 5
  total=$(grep -c 'HMSETUP' "$LOG" || true)
  if [ "$total" -gt "$seen" ]; then
    grep 'HMSETUP' "$LOG" | tail -n $((total - seen)) | sed 's/.*HMSETUP /  /' | grep -v READY || true
    seen=$total
  fi
  grep -q 'HMSETUP DONE' "$LOG" && break
  if grep -q 'HMSETUP FAIL' "$LOG"; then
    adb exec-out screencap -p > "$WORK/termux-error.png" 2>/dev/null || true
    die "The phone-side install failed (see the line above). The Termux screen is saved in $WORK/termux-error.png.
Fix it (AGENT_INSTALL.md step 6 lists the usual causes), then run this again: finished parts are skipped."
  fi
  if ! adb get-state >/dev/null 2>&1; then die "The phone disconnected. Reconnect it and run this again."; fi
  [ $(( $(date +%s) - start )) -lt 7200 ] || die "No result after 2 hours. Look at Termux on the phone."
done

# ---------------------------------------------------------------- 7. model
b "7/9 Model"
prov=${HM_PROVIDER:-}
if [ -z "${HM_SKIP_MODEL:-}" ] && [ -z "$prov" ]; then
  say "Using a subscription (ChatGPT, Claude, Grok, Nous Portal)? Press Enter: the app signs you in when it first opens."
  say "Using an API key? Type the provider: openrouter (one key for every model), anthropic, openai, gemini (free tier), deepseek."
  prov=$(ask "Provider [Enter = set it up in the app]:")
fi
if [ -n "${HM_SKIP_MODEL:-}" ] || [ -z "$prov" ]; then
  say "Skipped. The app asks you to connect a model when it first opens."
else
  model=${HM_MODEL:-}; kname=${HM_KEY_NAME:-}; key=${HM_KEY:-}
  if [ -z "$kname" ]; then
    case "$prov" in openrouter) kname=OPENROUTER_API_KEY ;; anthropic) kname=ANTHROPIC_API_KEY ;; openai) kname=OPENAI_API_KEY ;;
      gemini) kname=GEMINI_API_KEY ;; deepseek) kname=DEEPSEEK_API_KEY ;; *) kname=$(ask "Name of its API key variable (e.g. FOO_API_KEY):") ;; esac
  fi
  if [ -z "$model" ]; then
    say "Model id as $prov names it (OpenRouter's list: https://openrouter.ai/models). You can change it in the app later."
    model=$(ask "Model:")
    [ -n "$model" ] || die "No model given. Run this again, or press Enter at the provider question and connect it in the app."
  fi
  if [ -z "$key" ]; then read -r -s -p "  $kname (hidden): " key </dev/tty; echo; fi
  [[ "$key" =~ ^[A-Za-z0-9._:/+=-]+$ ]] || die "That key has characters this script can't type into the phone. Set it in the app instead (Settings → API keys)."
  [[ "$prov$model$kname" =~ ^[A-Za-z0-9._:/+-]+$ ]] || die "Provider/model names can only have letters, digits and . _ : / + -"
  termux_front || die "Termux isn't in front. Unlock the phone and run this again."
  type_line "bash hm.sh model $prov $model $kname=$key"
  for _ in $(seq 1 120); do grep -qE 'HMSETUP (MODEL SET|FAIL model)' "$LOG" && break; sleep 2; done
  type_line "history -c && clear"   # the key off the screen and out of the shell history
  grep -q 'HMSETUP MODEL SET' "$LOG" || die "Setting the model failed. Set it in the app: Settings → API keys, then Default models."
  say "$prov / $model"
  unset key
fi

# ---------------------------------------------------------------- 8. app
b "8/9 Hermes Mobile app"
curl -fL --progress-bar -o "$WORK/hermes-mobile.apk" "$APK_URL"
if ! out=$(adb install -r "$WORK/hermes-mobile.apk" 2>&1); then
  case "$out" in *UPDATE_INCOMPATIBLE*) die "Another build of Hermes Mobile is installed (signed differently). Uninstall it from the phone and run this again." ;;
    *) die "Installing the app failed: $out" ;; esac
fi
rm -f "$WORK/hermes-mobile.apk"
adb shell pm grant $APP com.termux.permission.RUN_COMMAND || true
adb shell pm grant $APP android.permission.POST_NOTIFICATIONS 2>/dev/null || true
adb shell dumpsys deviceidle whitelist +$APP >/dev/null || true
adb shell am start -n $APP/.MainActivity >/dev/null

# ---------------------------------------------------------------- 9. check
b "9/9 Checking"
port=$(adb forward tcp:0 tcp:9119)
ok=""
for _ in $(seq 1 30); do curl -fs -o /dev/null "http://127.0.0.1:$port/" && { ok=1; break; }; sleep 2; done
adb forward --remove "tcp:$port" >/dev/null 2>&1 || true
[ -n "$ok" ] && say "Hermes is running on the phone." || say "Hermes didn't answer yet; the app's Setup check shows what's missing."

b "Done. Say hi in Hermes Mobile on the phone."
grep 'HMSETUP TODO' "$LOG" | sed 's/.*HMSETUP TODO /  Still to do: /' || true
say "Xiaomi/HyperOS: also turn on Autostart for Termux and Hermes Mobile (Settings → Apps)."
say "Keep the Termux notification: Hermes runs inside Termux."
say "Shizuku (Hermes's access to the screen and apps) stops when the phone restarts. Without root, start it once via"
say "  Shizuku → Start via Wireless debugging: on Android 13+ it then restarts by itself on Wi-Fi. Rooted phones: it always does."
say "Update later: run this script again."
