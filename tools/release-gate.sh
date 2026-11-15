#!/bin/bash
# The check release.yml runs before it builds anything: the tagged commit is on main, and the CI workflow passed on it.
# A tag pushed right after a merge waits for that commit's CI run to finish instead of racing it.
#   GITHUB_REPOSITORY, GITHUB_SHA   the repository (owner/name) and the tagged commit, as Actions sets them
#   GH_TOKEN                        a token that reads the code and the workflow runs (contents: read, actions: read)
#   HM_GATE_WAIT   seconds to wait for a CI run still going (default 1200)
#   HM_GATE_START  seconds to wait for a CI run to appear at all (default 120)
#   HM_GATE_POLL   seconds between looks (default 30)
# Exit 0 = release; 1 = don't, with the reason and what to do on the last line.
set -uo pipefail
repo=${GITHUB_REPOSITORY:?}
sha=${GITHUB_SHA:?}
wait_s=${HM_GATE_WAIT:-1200}
start_s=${HM_GATE_START:-120}
poll=${HM_GATE_POLL:-30}
no() { echo "release-gate: $*" >&2; exit 1; }

# compare/<sha>...main: "ahead" or "identical" means main has the commit; "diverged" or "behind" means it doesn't.
status=$(gh api "repos/$repo/compare/$sha...main" --jq .status) || no "could not compare $sha with main"
case "$status" in
  ahead|identical) echo "release-gate: $sha is on main" ;;
  *) no "$sha is not on main ($status). Tag a commit that is on main." ;;
esac

waited=0
while :; do
  # One line per CI run that a push to main started on this commit: "<status> <conclusion>".
  runs=$(gh api "repos/$repo/actions/workflows/ci.yml/runs?head_sha=$sha&event=push&branch=main&per_page=20" \
    --jq '.workflow_runs[] | .status + " " + (.conclusion // "")') || no "could not read the CI runs for $sha"
  if printf '%s\n' "$runs" | grep -qx 'completed success'; then
    echo "release-gate: CI passed on $sha"
    exit 0
  fi
  if [ -z "$runs" ]; then
    [ "$waited" -lt "$start_s" ] ||
      no "CI never ran on $sha. Tag the commit a merge to main produced (the newest one), not one inside a merged branch."
    echo "release-gate: no CI run on $sha yet, waiting"
  elif printf '%s\n' "$runs" | grep -qv '^completed '; then
    [ "$waited" -lt "$wait_s" ] || no "CI on $sha is still running after ${waited}s. Run this workflow again when it has passed."
    echo "release-gate: CI is still running on $sha, waiting"
  else
    no "CI did not pass on $sha ($(printf '%s\n' "$runs" | head -1)). Re-run its failed jobs, then run this workflow again."
  fi
  sleep "$poll"
  waited=$((waited + poll))
done
