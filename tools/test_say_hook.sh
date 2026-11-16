#!/bin/bash
# Tests the installer's progress hook: say() in phone/bootstrap.sh and phone/phone-access.sh POSTs each line to the app
# (HermesService 127.0.0.1:9121/setup) when HM_APP_TOKEN is set, with a fake curl on PATH. Checks: nothing is sent without
# a token, the JSON body (quotes and backslashes escaped), the 2 s timeout, a failing curl never fails the install (set -e),
# the token never reaches the screen, and DONE writes ~/.hermes-mobile/installed (the app's "finished" marker).
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fails=0
check() { if eval "$1"; then echo "PASS  $2"; else echo "FAIL  $2"; fails=$((fails+1)); fi; }
mkdir -p "$T/bin" "$T/home/.hermes-mobile"
cat > "$T/bin/curl" <<'SH'
#!/bin/bash
# fake curl: records its arguments and the body it was given on stdin, exits with $FAKE_CURL_RC
n=$(ls "$CURL_LOG" 2>/dev/null | wc -l | tr -d ' ')
printf '%s\n' "$@" > "$CURL_LOG/$n.args"
cat > "$CURL_LOG/$n.body"
exit "${FAKE_CURL_RC:-0}"
SH
chmod +x "$T/bin/curl"
for script in phone/bootstrap.sh phone/phone-access.sh; do
  fn="$T/say-$(basename "$script")"
  awk '/^say\(\) \{/{f=1} f{print} f&&(/^}/||/; }$/){exit}' "$script" > "$fn"
  check "[ -s '$fn' ] && grep -q HM_APP_TOKEN '$fn'" "$script: say() has the HM_APP_TOKEN hook"
  run() { # run <token> <rc> <line…>: say the line under set -eE with an ERR trap, like the installers
    rm -rf "$T/log"; mkdir -p "$T/log"
    env -i PATH="$T/bin:/usr/bin:/bin" HOME="$T/home" CURL_LOG="$T/log" FAKE_CURL_RC="$2" HM_APP_TOKEN="$1" \
      bash -c "set -eE -o pipefail; trap 'echo TRAPPED' ERR; source '$fn'; say \"\$@\"; echo AFTER" _ "${@:3}"
  }
  out=$(run '' 0 'STEP packages Termux packages')
  check "[ -z \"\$(ls '$T/log')\" ]" "$script: no token → nothing is sent"
  check "[[ '$out' == *AFTER* ]]" "$script: no token → say carries on"
  out=$(run abc123 0 'phone: tap "Allow" \ then Install')
  check "[ -f '$T/log/0.args' ]" "$script: with a token → one POST"
  check "grep -qx 'http://127.0.0.1:9121/setup' '$T/log/0.args'" "$script: posts to 127.0.0.1:9121/setup"
  check "grep -qx -- '-m' '$T/log/0.args' && grep -qx 2 '$T/log/0.args'" "$script: 2 s timeout (-m 2)"
  check "grep -qx -- '--data-binary' '$T/log/0.args' && grep -qx '@-' '$T/log/0.args'" "$script: body on stdin (not on the command line)"
  check "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); d.pop(\"ts\", None); sys.exit(0 if d == {\"token\": \"abc123\", \"line\": \"phone: tap \\\"Allow\\\" \\\\ then Install\"} else 1)' '$T/log/0.body'" "$script: JSON body with quotes and backslashes escaped"
  check "! grep -q abc123 <<< '$out'" "$script: the token never reaches the screen"
  out=$(run abc123 7 'STEP debian Debian')
  check "[[ '$out' == *AFTER* ]] && [[ '$out' != *TRAPPED* ]]" "$script: a failing curl (app not running) never fails the install"
done
rm -f "$T/home/.hermes-mobile/installed"
env -i PATH="$T/bin:/usr/bin:/bin" HOME="$T/home" CURL_LOG="$T/log" bash -c "set -eE; source '$T/say-bootstrap.sh'; say 'STEP start x'"
check "[ ! -e '$T/home/.hermes-mobile/installed' ]" "bootstrap: no installed marker before DONE"
env -i PATH="$T/bin:/usr/bin:/bin" HOME="$T/home" CURL_LOG="$T/log" bash -c "set -eE; source '$T/say-bootstrap.sh'; say DONE" >/dev/null
check "[ -e '$T/home/.hermes-mobile/installed' ]" "bootstrap: DONE writes ~/.hermes-mobile/installed (also without a token)"
# The liveness beat: ALIVE with the token at once and every HM_BEAT_SECS, nothing without a token, gone with its script.
awk '/^beat\(\) \{/{f=1} f{print} f&&/^}/{exit}' phone/bootstrap.sh > "$T/beat.sh"
check "[ -s '$T/beat.sh' ]" "bootstrap: has beat()"
rm -rf "$T/log"; mkdir -p "$T/log"
env -i PATH="$T/bin:/usr/bin:/bin" HOME="$T/home" CURL_LOG="$T/log" HM_APP_TOKEN='' bash -c "set -eE; source '$T/beat.sh'; beat; sleep 1"
check "[ -z \"\$(ls '$T/log')\" ]" "beat: no token → nothing is sent"
rm -rf "$T/log"; mkdir -p "$T/log"
out=$(env -i PATH="$T/bin:/usr/bin:/bin" HOME="$T/home" CURL_LOG="$T/log" HM_APP_TOKEN=bt1 HM_BEAT_SECS=1 \
  bash -c "set -eE; trap 'echo TRAPPED' ERR; source '$T/beat.sh'; beat; sleep 2.5; echo AFTER")
n_end=$(ls "$T/log"/*.body 2>/dev/null | wc -l | tr -d ' ')
check "[ \"$n_end\" -ge 2 ]" "beat: sends at once and again while the script runs ($n_end beats)"
check "python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])) == {\"token\": \"bt1\", \"line\": \"ALIVE\"} else 1)' '$T/log/0.body'" "beat: the body is {token, line: ALIVE}"
check "grep -qx 'http://127.0.0.1:9121/setup' '$T/log/0.args' && grep -qx -- '-m' '$T/log/0.args'" "beat: posts to /setup with a timeout"
check "[[ '$out' == AFTER ]]" "beat: prints nothing, never trips the ERR trap"
sleep 2.5
n_later=$(ls "$T/log"/*.body 2>/dev/null | wc -l | tr -d ' ')
check "[ \"$n_later\" -le \$((n_end + 1)) ]" "beat: stops once its script has ended ($n_end then $n_later)"
rm -rf "$T/log"; mkdir -p "$T/log"
out=$(env -i PATH="$T/bin:/usr/bin:/bin" HOME="$T/home" CURL_LOG="$T/log" FAKE_CURL_RC=7 HM_APP_TOKEN=bt2 HM_BEAT_SECS=1 \
  bash -c "set -eE -o pipefail; trap 'echo TRAPPED' ERR; source '$T/beat.sh'; beat; sleep 1.5; echo AFTER")
check "[[ '$out' == AFTER ]]" "beat: a failing curl (app not running) changes nothing"
# Order in the script: the old marker goes before the first beat, so a beat seen means this run's DONE writes the marker.
rm_line=$(grep -n '^rm -f "\$HOME/.hermes-mobile/installed"$' phone/bootstrap.sh | cut -d: -f1)
beat_line=$(grep -n '^beat$' phone/bootstrap.sh | cut -d: -f1)
pkg_line=$(grep -n '^step packages ' phone/bootstrap.sh | cut -d: -f1)
check "[ -n '$rm_line' ] && [ -n '$beat_line' ] && [ '$rm_line' -lt '$beat_line' ] && [ '$beat_line' -lt '$pkg_line' ]" "bootstrap: removes the old marker, then beats, before the first step"
model_end=$(awk '/^if \[ "\$\{1:-\}" = model \]; then/{f=1} f&&/^fi$/{print NR; exit}' phone/bootstrap.sh)
check "[ -n '$model_end' ] && [ '$model_end' -lt '$rm_line' ]" "bootstrap: 'model' (setting a model later) leaves the marker alone"
# On the app route the app is already installed: bootstrap must not download and offer it again.
check "grep -q 'if \\[ -z \"\\\${HM_NO_APK:-}\\\${HM_APP_TOKEN:-}\" \\]' phone/bootstrap.sh" "bootstrap: no APK prompt on the app route (HM_APP_TOKEN)"
echo
[ $fails -eq 0 ] && echo "ALL PASSED" || { echo "$fails FAILED"; exit 1; }
