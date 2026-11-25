#!/bin/bash
# One command for the checks a change needs, with one summary at the end.
#   tools/check.sh            the groups your branch's changes need (vs origin/main, including uncommitted files)
#   tools/check.sh --all      every group
#   tools/check.sh web plugin only these groups
# Groups: spec (always: check_spec.py, changelog.py check, check-attribution.sh, review_checklist.py --check), web (typecheck, unit tests, browser e2e), plugin,
# patches (Hermes patches and phone scripts) and android. The plugin, patches and android commands are read from the
# matching jobs in .github/workflows/ci.yml, so a test added there runs here too. Something the machine lacks (JDK,
# Android SDK, network for the pinned Hermes) is reported as SKIP, not FAIL; CI still runs it. The Hermes contract
# check (tools/hermes-contract/run.sh) is CI-only. Before the summary it prints, as notes that fail nothing, the
# review checklist items the change sets off (tools/review_checklist.py) and the commits that don't say how they
# were verified (tools/check-verified.sh).
# Every check runs with its own new, empty HOME and HERMES_HOME (removed afterwards), so no test can read, start or
# rewrite anything in a real Hermes home (a person's cron jobs, config.yaml, logs). The tools are found first, from
# the caller's PATH and home, and stay found. HM_CHECK_REAL_HOME=1 opts out on purpose: the checks then get the
# caller's own HOME and HERMES_HOME.
set -uo pipefail
cd "$(dirname "$0")/.."
results=()
failed=0

# The caller's homes, and where the tools are, settled before any check gets a temporary home. PATH's folders are
# absolute and stay as they are (they may be inside the real home, which is fine: only the home a check writes to
# changes); a `~` in PATH is expanded, and the version managers whose shims find their tools through the home are
# named. home_is_temp then checks, from inside a temporary home, that each tool still resolves to the same file.
caller_home=$(cd "${HOME:-/}" 2>/dev/null && pwd -P || echo "${HOME:-}")
caller_hermes=${HERMES_HOME:-$caller_home/.hermes}
PATH=$(printf '%s' "$PATH" | awk -v h="$caller_home" 'BEGIN { RS = ":"; ORS = "" } { sub(/^~/, h); print (NR > 1 ? ":" : "") $0 }')
export PATH
[ -z "${PYENV_ROOT:-}" ] && [ -d "$caller_home/.pyenv" ] && export PYENV_ROOT="$caller_home/.pyenv"
[ -z "${ASDF_DATA_DIR:-}" ] && [ -d "$caller_home/.asdf" ] && export ASDF_DATA_DIR="$caller_home/.asdf"
[ -z "${VOLTA_HOME:-}" ] && [ -d "$caller_home/.volta" ] && export VOLTA_HOME="$caller_home/.volta"
[ -z "${NVM_DIR:-}" ] && [ -d "$caller_home/.nvm" ] && export NVM_DIR="$caller_home/.nvm"
tools_before=$(for tool in node npm git python3 java; do echo "$tool $(command -v "$tool" 2>/dev/null)"; done)
if command -v python3 >/dev/null; then
  : "${PYTHONUSERBASE:=$(python3 -c 'import site; print(site.getuserbase())' 2>/dev/null)}"
  [ -n "$PYTHONUSERBASE" ] && export PYTHONUSERBASE # pip --user packages (fastapi, httpx) live under the home
fi
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$caller_home/.gradle}" XDG_CACHE_HOME="${XDG_CACHE_HOME:-$caller_home/.cache}"
for d in "$caller_home/Library/Android/sdk" "$caller_home/Android/Sdk"; do
  [ -z "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] && [ -d "$d" ] && export ANDROID_HOME="$d"
done
for d in "$caller_home/Library/Caches/ms-playwright" "$caller_home/.cache/ms-playwright"; do
  [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] && [ -d "$d" ] && export PLAYWRIGHT_BROWSERS_PATH="$d"
done

# temp_home command...: the command with a new, empty HOME and HERMES_HOME, removed when it ends.
temp_home() {
  if [ "${HM_CHECK_REAL_HOME:-}" = 1 ]; then "$@"; return; fi
  local t rc
  t=$(mktemp -d "${TMPDIR:-/tmp}/hm-check-home.XXXXXX") || return 1
  mkdir -p "$t/.hermes"
  HOME="$t" HERMES_HOME="$t/.hermes" "$@"
  rc=$?
  rm -rf "$t"
  return $rc
}
# Fails when the home a check gets is the caller's own HOME or Hermes home, or is not empty, or a tool resolves to
# another file there than before (checked from inside temp_home).
home_is_temp() {
  local h hh
  h=$(cd "$HOME" && pwd -P) && hh=$(cd "$HERMES_HOME" && pwd -P) || { echo "test home missing"; return 1; }
  for real in "$caller_home" "$caller_hermes" "$caller_home/.hermes"; do
    real=$(cd "$real" 2>/dev/null && pwd -P || echo "$real")
    if [ "$h" = "$real" ] || [ "$hh" = "$real" ]; then echo "a check would run in the caller's home ($real)"; return 1; fi
  done
  [ -z "$(ls -A "$HOME" | grep -vx .hermes)" ] && [ -z "$(ls -A "$HERMES_HOME")" ] || { echo "test home not empty"; return 1; }
  local after
  after=$(for tool in node npm git python3 java; do echo "$tool $(command -v "$tool" 2>/dev/null)"; done)
  [ "$after" = "$tools_before" ] || { echo "a tool resolves differently in the test home:"; diff <(echo "$tools_before") <(echo "$after"); return 1; }
}
run() { # run "label" command...
  local label=$1; shift
  echo "== $label"
  if temp_home "$@"; then results+=("PASS  $label"); else results+=("FAIL  $label"); failed=$((failed + 1)); fi
}
skip() { results+=("SKIP  $1"); echo "== $1: skipped"; }

# The `- run:` commands of one ci.yml job, minus installs.
ci_runs() {
  awk -v job="  $1:" '
    $0 == job { on = 1; next }
    on && /^  [A-Za-z0-9_-]+:$/ { on = 0 }
    on && /^      - run: / { sub(/^      - run: /, ""); print }
  ' .github/workflows/ci.yml | grep -v -E '^(pip|npm) install'
}

# The browser tests as CI runs them: the shards listed in ci.yml's web-e2e matrix, in parallel, each with its own
# mock and page on free ports; one PASS/FAIL per shard. The web build runs once first.
e2e_shards() {
  local shards dir pids=() sh
  # The quoted items of the matrix line; a shard may list several ranges ('13-16,19-21').
  shards=$(sed -nE "s/^ *shard: \[(.*)\]/\1/p" .github/workflows/ci.yml | grep -oE "'[^']+'" | tr -d "'" | tr '\n' ' ')
  [ -n "$shards" ] || shards=all
  if ! (cd web && temp_home npm run --silent build >/dev/null); then results+=("FAIL  web build"); failed=$((failed + 1)); return; fi
  dir=$(mktemp -d "${TMPDIR:-/tmp}/hm-check.XXXXXX")
  for sh in $shards; do
    if [ "$sh" = all ]; then set --; else set -- --only "$sh"; fi
    HM_E2E_SKIP_BUILD=1 HM_E2E_MOCK_PORT=0 HM_E2E_WEB_PORT=0 temp_home tools/web-e2e/run.sh "$@" > "$dir/$sh.log" 2>&1 &
    pids+=("$!:$sh")
  done
  echo "== browser e2e: shards $shards in parallel (logs in $dir)"
  for p in "${pids[@]}"; do
    if wait "${p%%:*}"; then results+=("PASS  browser e2e ${p#*:}")
    else results+=("FAIL  browser e2e ${p#*:} (see $dir/${p#*:}.log)"); failed=$((failed + 1)); grep -E '^FAIL' "$dir/${p#*:}.log" | head -5
    fi
  done
}

groups=()
case "${1:-}" in
  --all) groups=(web plugin patches android) ;;
  "")
    base=$(git merge-base HEAD origin/main 2>/dev/null || echo origin/main)
    changed=$( { git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u)
    echo "Changed since origin/main: $(printf '%s\n' "$changed" | grep -c .) file(s)"
    want() { printf '%s\n' "$changed" | grep -q -E "$1"; }
    ci=$(printf '%s\n' "$changed" | bash tools/ci-changes.sh)
    printf '%s\n' "$ci" | grep -qx 'web=true' && groups+=(web)
    want '^(hermes-plugin/|relay/|android/src/com/omarqaterge/hermesmobile/(Local(Auth|Client|Dashboard|Key|Server)|EventsListener)\.java$|tools/test_[a-z_]+\.py$|tools/[a-z_]+\.py$|tools/local-auth-vectors\.json$|phone/hm-local$)' && groups+=(plugin)
    printf '%s\n' "$ci" | grep -qx 'patches=true' && groups+=(patches)
    want '^(android/|tools/(java-check|api-check|test_setup_lines|test_pending_ask|test_island_state|test_island_motion|test_install_phase|test_bridge_key|test_diag_log|test_update_url|test_update_version|test_version_code|version-code|test_autostart|test_devtools_guard|test_notification_unlock|test_keystore_pass|test_local_auth|test_local_server|test_local_key|test_events_listener|test_local_dashboard|test_config_changes|test_voice_mic)\.sh$|tools/local-auth-vectors\.json$)' && groups+=(android)
    ;;
  *) groups=("$@") ;;
esac
echo "Groups: spec ${groups[*]:-}"

if [ "${HM_CHECK_REAL_HOME:-}" = 1 ]; then
  skip "test homes are temporary (HM_CHECK_REAL_HOME=1: the checks use your own HOME and HERMES_HOME)"
else
  run "test homes are temporary, not the caller's" home_is_temp
fi

run "check_spec.py" python3 tools/check_spec.py
run "changelog.py check" python3 tools/changelog.py check
run "no AI credit in commits" tools/check-attribution.sh
run "no emoji in the interface, notifications, plugin and phone scripts" python3 tools/check-no-emoji.py
run "review checklist items" python3 tools/review_checklist.py --check

for g in ${groups[@]+"${groups[@]}"}; do
  case "$g" in
    web)
      if [ ! -e web/node_modules ]; then skip "web (no web/node_modules: run tools/setup.sh)"; continue; fi
      run "web typecheck" bash -c 'cd web && npm run --silent typecheck'
      run "web unit tests" bash -c 'cd web && npm test --silent'
      e2e_shards
      ;;
    plugin)
      if ! python3 -c 'import fastapi, httpx' 2>/dev/null; then skip "plugin (no fastapi/httpx for this python3: pip install fastapi httpx; CI runs it)"; continue; fi
      while IFS= read -r cmd; do
        if [[ "$cmd" == *test_battery.py* ]] && [ ! -d /proc ]; then skip "$cmd (needs Linux /proc; CI runs it)"; continue; fi
        run "$cmd" bash -c "$cmd"
      done < <(ci_runs plugin | grep -v -E 'check_spec\.py$|changelog\.py check$|review_checklist\.py --check$')
      ;;
    patches)
      while IFS= read -r cmd; do run "$cmd" bash -c "$cmd"; done < <(ci_runs hermes-patches)
      ;;
    android)
      if ! command -v java >/dev/null; then skip "android (no JDK 21)"; continue; fi
      while IFS= read -r cmd; do
        if [[ "$cmd" == *api-check.sh* ]] && [ -z "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] ; then
          skip "$cmd (no Android SDK; CI runs it)"
        else
          run "$cmd" bash -c "$cmd"
        fi
      done < <(ci_runs android)
      ;;
    *) echo "unknown group: $g (web, plugin, patches, android)"; failed=$((failed + 1)) ;;
  esac
done

# Not checks, nothing here fails: what to read before the pull request. The checklist items this change sets off
# (docs/review-checklist/), and the commits that don't say how they were verified.
echo
python3 tools/review_checklist.py || true
echo
tools/check-verified.sh || true

echo
printf '%s\n' "${results[@]}"
[ "$failed" = 0 ] && echo "ALL PASSED" || echo "$failed FAILED"
[ "$failed" = 0 ]
