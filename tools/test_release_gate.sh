#!/bin/bash
# Tests tools/release-gate.sh with a fake `gh`: what release.yml's first job lets through and what it stops.
# The fake answers the compare call with $FAKE_COMPARE and the runs call with the next line of $FAKE_RUNS_FILE
# (one line per look; `|` separates runs, `-` is "no runs"; the last line repeats), so a run can finish while waiting.
set -uo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/bin"
cat > "$tmp/bin/gh" <<'EOF'
#!/bin/bash
case "$2" in
  */compare/*) [ "$FAKE_COMPARE" = error ] && exit 1; echo "$FAKE_COMPARE" ;;
  */actions/workflows/ci.yml/runs*)
    n=$(cat "$FAKE_COUNT" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$FAKE_COUNT"
    line=$(sed -n "${n}p" "$FAKE_RUNS_FILE"); [ -n "$line" ] || line=$(tail -1 "$FAKE_RUNS_FILE")
    [ "$line" = error ] && exit 1
    [ "$line" = - ] || printf '%s\n' "$line" | tr '|' '\n' ;;
  *) echo "unexpected gh call: $*" >&2; exit 2 ;;
esac
EOF
chmod +x "$tmp/bin/gh"
fails=0
# t NAME WANT_EXIT WANT_TEXT COMPARE RUNS_LINE...
t() {
  local name=$1 want=$2 text=$3 compare=$4; shift 4
  printf '%s\n' "$@" > "$tmp/runs"; rm -f "$tmp/count"
  local out code
  out=$(PATH="$tmp/bin:$PATH" GITHUB_REPOSITORY=o/r GITHUB_SHA=abc123 FAKE_COMPARE="$compare" FAKE_RUNS_FILE="$tmp/runs" \
    FAKE_COUNT="$tmp/count" HM_GATE_POLL=0 HM_GATE_WAIT=0 HM_GATE_START=0 tools/release-gate.sh 2>&1); code=$?
  if [ "$code" = "$want" ] && printf '%s' "$out" | grep -q "$text"; then echo "PASS  $name"
  else echo "FAIL  $name: exit $code (want $want), output: $out"; fails=$((fails+1)); fi
}
t "on main, CI passed"                      0 "CI passed"            ahead     "completed success"
t "main's newest commit, CI passed"         0 "CI passed"            identical "completed success"
t "a failed run and a passing re-run"       0 "CI passed"            ahead     "completed failure|completed success"
t "not on main (diverged)"                  1 "not on main"          diverged  "completed success"
t "not on main (ahead of it)"               1 "not on main"          behind    "completed success"
t "the compare call fails"                  1 "could not compare"    error     "completed success"
t "CI failed"                               1 "did not pass"         ahead     "completed failure"
t "CI cancelled"                            1 "did not pass"         ahead     "completed cancelled"
t "no CI run on the commit"                 1 "CI never ran"         ahead     "-"
t "CI still running when the wait ends"     1 "still running"        ahead     "in_progress "
t "the runs call fails"                     1 "could not read"       ahead     "error"

# With time to wait: a run that appears, then finishes, is let through; one that then fails is stopped.
w() {
  local name=$1 want=$2 text=$3; shift 3
  printf '%s\n' "$@" > "$tmp/runs"; rm -f "$tmp/count"
  local out code
  out=$(PATH="$tmp/bin:$PATH" GITHUB_REPOSITORY=o/r GITHUB_SHA=abc123 FAKE_COMPARE=ahead FAKE_RUNS_FILE="$tmp/runs" \
    FAKE_COUNT="$tmp/count" HM_GATE_POLL=1 HM_GATE_WAIT=5 HM_GATE_START=5 tools/release-gate.sh 2>&1); code=$?
  if [ "$code" = "$want" ] && printf '%s' "$out" | grep -q "$text"; then echo "PASS  $name"
  else echo "FAIL  $name: exit $code (want $want), output: $out"; fails=$((fails+1)); fi
}
w "waits for a run to appear and pass"      0 "CI passed"    "-" "queued " "in_progress " "completed success"
w "waits, then the run fails"               1 "did not pass" "in_progress " "completed failure"

# release.yml runs the gate first, and nothing builds without it.
y=.github/workflows/release.yml
grep -q 'run: tools/release-gate.sh' "$y" && echo "PASS  release.yml runs the gate" || { echo "FAIL  release.yml doesn't run tools/release-gate.sh"; fails=$((fails+1)); }
awk '/^  web:/{w=1} w && /^  apk:/{w=0} w && /needs: gate/{f=1} END{exit !f}' "$y" \
  && echo "PASS  the web job needs the gate" || { echo "FAIL  release.yml's web job doesn't need the gate"; fails=$((fails+1)); }
awk '/^  apk:/{a=1} a && /needs: web/{f=1} END{exit !f}' "$y" \
  && echo "PASS  the apk job needs the web job" || { echo "FAIL  release.yml's apk job doesn't need web"; fails=$((fails+1)); }
echo; [ "$fails" = 0 ] && echo "ALL PASSED" || { echo "$fails FAILED"; exit 1; }
