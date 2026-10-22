#!/bin/bash
# Background host smoke test on an emulator/phone over adb (shell uid, no Shizuku needed).
# Usage: tools/test_bghost.sh <dex-or-apk on the device> [package to drive]
# Exits non-zero on the first failed check. Leaves no display, no host and no files behind.
set -u
CP=${1:?classpath on the device}; PKG=${2:-com.android.settings}
TOK=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
fails=0
check() { if [ "$2" = 1 ]; then echo "  [PASS] $1"; else echo "  [FAIL] $1  ($3)"; fails=$((fails+1)); fi; }
sh_() { adb shell "$@" 2>/dev/null | tr -d '\r'; }
# Android's shell has no curl: talk to the host from this computer through an adb forward.
LP=19131; adb forward tcp:$LP tcp:9131 >/dev/null
trap 'adb forward --remove tcp:$LP >/dev/null 2>&1' EXIT
req() { if [ -n "${2:-}" ]; then curl -s -m 30 -H "X-HM-Token: $TOK" -H 'Content-Type: application/json' "http://127.0.0.1:$LP$1" -d "$2"; else curl -s -m 30 -H "X-HM-Token: $TOK" "http://127.0.0.1:$LP$1"; fi; }
# the focused window of display 0 (the user's screen); a plain grep can hit the hidden display's section
userwin() { sh_ "dumpsys window displays" | awk '/Display: mDisplayId=/{d=($0 ~ /mDisplayId=0 /)} d && /mCurrentFocus/{print; exit}'; }
focus() { sh_ "dumpsys window | grep -m1 mTopFocusedDisplayId" | tr -dc '0-9'; }

adb shell "cd /data/local/tmp; (HM_TOKEN=$TOK CLASSPATH=$CP setsid nohup app_process / com.omarqaterge.hermesmobile.bg.BgHost 9131 </dev/null >/data/local/tmp/hm-bghost.log 2>&1 &)"
sleep 3
r=$(curl -s -H 'X-HM-Token: wrong' "http://127.0.0.1:$LP/status"); check "wrong token refused" "$([[ $r == *forbidden* ]] && echo 1)" "$r"
r=$(req /status); check "status answers" "$([[ $r == *'"ok":true'* ]] && echo 1)" "$r"
r=$(req /apps); check "lists launcher apps" "$([[ $r == *$PKG* ]] && echo 1)" "${r:0:200}"
before=$(userwin)
r=$(req /open "{\"pkg\":\"$PKG\"}"); check "opens $PKG on the hidden display" "$([[ $r == *'"ok":true'* ]] && echo 1)" "$r"
check "focus stays on the user's display after open" "$([ "$(focus)" = 0 ] && echo 1)" "$(focus)"
cap=$(req /capture '{"tree":true}'); n=$(printf %s "$cap" | grep -o '"n":[0-9]*' | wc -l | tr -d ' ')
check "capture returns elements" "$([ "$n" -gt 2 ] && echo 1)" "${cap:0:300}"
r=$(req /scroll '{"direction":"down"}'); check "scroll" "$([[ $r == *'"ok":true'* ]] && echo 1)" "$r"
check "focus stays after scroll" "$([ "$(focus)" = 0 ] && echo 1)" "$(focus)"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "X-HM-Token: $TOK" "http://127.0.0.1:$LP/frame?w=360")
check "frame is a JPEG" "$([ "$code" = 200 ] && echo 1)" "$code"
after=$(userwin)
check "the user's window kept focus" "$([ "$before" = "$after" ] && echo 1)" "$before -> $after"
r=$(req /hand_over '{}'); check "hand over" "$([[ $r == *'"moved":'[1-9]* ]] && echo 1)" "$r"
sleep 2
check "the app is now on the real screen" "$(userwin | grep -q "$PKG" && echo 1)" "$(userwin)"
check "no hidden display left" "$([ "$(sh_ 'dumpsys display | grep -c hermes-bg')" = 0 ] && echo 1)" ""
check "host exited" "$([ -z "$(sh_ 'pidof app_process')" ] && echo 1)" "$(sh_ 'pidof app_process')"
adb shell input keyevent KEYCODE_HOME; adb shell am force-stop "$PKG"; sleep 1

# Round 2: tap the first clickable element and press back. Apps may close themselves on back (first-run screens):
# then later actions must say so clearly. Ends with close.
adb shell "cd /data/local/tmp; (HM_TOKEN=$TOK CLASSPATH=$CP setsid nohup app_process / com.omarqaterge.hermesmobile.bg.BgHost 9131 </dev/null >/data/local/tmp/hm-bghost.log 2>&1 &)"
sleep 3
r=$(req /open "{\"pkg\":\"$PKG\"}"); check "opens again" "$([[ $r == *'"ok":true'* ]] && echo 1)" "$r"
cap=$(req /capture '{"tree":true}')
first=$(printf %s "$cap" | python3 -c 'import json,sys;e=json.load(sys.stdin).get("elements",[]);print(next((x["n"] for x in e if x.get("click")),""))' 2>/dev/null)
r=$(req /tap "{\"n\":${first:-1}}"); check "tap by element" "$([[ $r == *'"ok":true'* ]] && echo 1)" "$r"
check "focus stays after tap" "$([ "$(focus)" = 0 ] && echo 1)" "$(focus)"
for i in 1 2 3; do r=$(req /key '{"name":"back"}'); done
r=$(req /capture '{"tree":true}')
check "after back: elements, or a clear 'app closed' error" "$([[ $r == *'"elements"'* || $r == *'closed itself'* ]] && echo 1)" "${r:0:200}"
check "focus stays after keys" "$([ "$(focus)" = 0 ] && echo 1)" "$(focus)"
r=$(req /close '{}'); check "close" "$([[ $r == *'"ok":true'* ]] && echo 1)" "$r"
sleep 1
check "no hidden display left after close" "$([ "$(sh_ 'dumpsys display | grep -c hermes-bg')" = 0 ] && echo 1)" ""
check "no task of $PKG dropped on the user's screen" "$(userwin | grep -q "$PKG" || echo 1)" "$(userwin)"
check "host exited after close" "$([ -z "$(sh_ 'pidof app_process')" ] && echo 1)" "$(sh_ 'pidof app_process')"
adb shell input keyevent KEYCODE_HOME
adb shell rm -f /data/local/tmp/hm-bghost.log
echo "$([ $fails = 0 ] && echo 'ALL PASSED' || echo "$fails FAILED")"
exit $fails
