#!/bin/bash
# One command for the checks a change needs, with one summary at the end.
#   tools/check.sh            the groups your branch's changes need (vs origin/main, including uncommitted files)
#   tools/check.sh --all      every group
#   tools/check.sh web plugin only these groups
# Groups: spec (always: check_spec.py, changelog.py check), web (typecheck, unit tests, browser e2e), plugin,
# patches (Hermes patches and phone scripts) and android. The plugin, patches and android commands are read from the
# matching jobs in .github/workflows/ci.yml, so a test added there runs here too. Something the machine lacks (JDK,
# Android SDK, network for the pinned Hermes) is reported as SKIP, not FAIL; CI still runs it. The Hermes contract
# check (tools/hermes-contract/run.sh) is CI-only.
set -uo pipefail
cd "$(dirname "$0")/.."
results=()
failed=0
run() { # run "label" command...
  local label=$1; shift
  echo "== $label"
  if "$@"; then results+=("PASS  $label"); else results+=("FAIL  $label"); failed=$((failed + 1)); fi
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
  shards=$(sed -nE "s/^ *shard: \[(.*)\]/\1/p" .github/workflows/ci.yml | tr -d "' " | tr ',' ' ')
  [ -n "$shards" ] || shards=all
  if ! (cd web && npm run --silent build >/dev/null); then results+=("FAIL  web build"); failed=$((failed + 1)); return; fi
  dir=$(mktemp -d "${TMPDIR:-/tmp}/hm-check.XXXXXX")
  for sh in $shards; do
    if [ "$sh" = all ]; then set --; else set -- --only "$sh"; fi
    HM_E2E_SKIP_BUILD=1 HM_E2E_MOCK_PORT=0 HM_E2E_WEB_PORT=0 tools/web-e2e/run.sh "$@" > "$dir/$sh.log" 2>&1 &
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
    [ -n "$(printf '%s\n' "$changed" | bash tools/ci-changes.sh | grep -x 'web=true')" ] && groups+=(web)
    want '^(hermes-plugin/|tools/test_[a-z_]+\.py$|tools/[a-z_]+\.py$)' && groups+=(plugin)
    want '^(hermes/|phone/|tools/[a-z_-]+\.sh$)' && groups+=(patches)
    want '^(android/|tools/(java-check|api-check|test_setup_lines|test_autostart|test_devtools_guard)\.sh$)' && groups+=(android)
    ;;
  *) groups=("$@") ;;
esac
echo "Groups: spec ${groups[*]:-}"

run "check_spec.py" python3 tools/check_spec.py
run "changelog.py check" python3 tools/changelog.py check

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
      done < <(ci_runs plugin | grep -v -E 'check_spec\.py$|changelog\.py check$')
      ;;
    patches)
      while IFS= read -r cmd; do run "$cmd" bash -c "$cmd"; done < <(ci_runs hermes-patches)
      ;;
    android)
      if ! command -v java >/dev/null; then skip "android (no JDK 21)"; continue; fi
      while IFS= read -r cmd; do
        if [[ "$cmd" == *api-check.sh* ]] && [ -z "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] && [ ! -d "$HOME/Library/Android/sdk" ] && [ ! -d "$HOME/Android/Sdk" ]; then
          skip "$cmd (no Android SDK; CI runs it)"
        else
          run "$cmd" bash -c "$cmd"
        fi
      done < <(ci_runs android)
      ;;
    *) echo "unknown group: $g (web, plugin, patches, android)"; failed=$((failed + 1)) ;;
  esac
done

echo
printf '%s\n' "${results[@]}"
[ "$failed" = 0 ] && echo "ALL PASSED" || echo "$failed FAILED"
[ "$failed" = 0 ]
