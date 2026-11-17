#!/bin/bash
# Which commits say how they were verified: a `Verified:` line in the message naming what was run or looked at
# (`Verified: tools/check.sh web; opened the sheet in the browser; no phone`), or `Verified: none` with the reason
# (AGENTS.md "Verify, and say how"). Merge commits are not looked at.
#   tools/check-verified.sh [RANGE]            lists the commits without one (default origin/main..HEAD); exit 0
#   tools/check-verified.sh --enforce [RANGE]  the same, exit 1 when a commit has none
# Report only by default: tools/check.sh prints the list as a note, so what it would stop can be seen before it
# stops anything. HM_REPO_DIR points it at another checkout (its test).
set -uo pipefail
cd "${HM_REPO_DIR:-$(dirname "$0")/..}"
enforce=0
[ "${1:-}" = --enforce ] && { enforce=1; shift; }
range=${1:-origin/main..HEAD}
total=0
missing=0
while IFS=$'\t' read -r sha subject; do
  [ -n "$sha" ] || continue
  total=$((total + 1))
  if ! git log -1 --format=%B "$sha" | grep -qiE '^Verified: *[^ ]'; then
    missing=$((missing + 1))
    echo "  ${sha:0:9} $subject"
  fi
done < <(git log --no-merges --format='%H%x09%s' "$range" 2>/dev/null)
if [ "$missing" -gt 0 ]; then
  echo "check-verified: $missing of $total commit(s) don't say how they were verified. Add a line to the message:"
  echo "  Verified: what you ran and looked at, and what you could not (or: Verified: none, with the reason)"
  [ "$enforce" = 1 ] && exit 1
  exit 0
fi
echo "check-verified: all $total commit(s) say how they were verified."
