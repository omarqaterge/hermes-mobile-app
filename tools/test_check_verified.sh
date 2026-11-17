#!/bin/bash
# Tests tools/check-verified.sh in a temp repository: a commit with a `Verified:` line passes, one without is listed,
# `Verified: none` counts, an empty `Verified:` doesn't, merge commits are skipped, and only --enforce fails.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d "${TMPDIR:-/tmp}/hm-verified.XXXXXX")
trap 'rm -rf "$T"' EXIT
fails=0
check() { if eval "$1"; then echo "[PASS] $2"; else echo "[FAIL] $2"; fails=$((fails + 1)); fi; }
g() { git -C "$T" -c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false "$@" >/dev/null 2>&1; }
cv() { HM_REPO_DIR="$T" "$here/check-verified.sh" "$@"; }

g init -b main
g commit --allow-empty -m "base"
g commit --allow-empty -m "With a line" -m "Body." -m "Verified: tools/check.sh web; no phone"
out=$(cv main~1..main); code=$?
check '[ $code = 0 ] && grep -q "all 1 commit" <<<"$out"' "a commit with a Verified: line is fine"

g commit --allow-empty -m "Without a line" -m "Body mentions it was verified: but not on its own line."
out=$(cv main~2..main); code=$?
check '[ $code = 0 ] && grep -q "Without a line" <<<"$out" && grep -q "1 of 2" <<<"$out"' "a commit without one is listed, exit 0"
check '! grep -q "With a line" <<<"$out"' "the commit that has one is not listed"
cv --enforce main~2..main >/dev/null; code=$?
check '[ $code = 1 ]' "--enforce fails when a commit has none"

g commit --allow-empty -m "None, with a reason" -m "verified: none (docs only)"
g commit --allow-empty -m "Empty stamp" -m "Verified:"
out=$(cv main~2..main)
check 'grep -q "Empty stamp" <<<"$out" && ! grep -q "None, with a reason" <<<"$out"' "Verified: none counts, an empty Verified: doesn't"

g checkout -b side main~4
g commit --allow-empty -m "Side work" -m "Verified: by hand"
g checkout main
g merge --no-ff side -m "Merge side"
out=$(cv --enforce main~1..main); code=$?
check '[ $code = 0 ] && ! grep -q "Merge side" <<<"$out"' "a merge commit is not looked at"

out=$(cv --enforce main..main); code=$?
check '[ $code = 0 ] && grep -q "all 0 commit" <<<"$out"' "an empty range is fine"

[ "$fails" = 0 ] && echo "ALL PASSED" || echo "$fails FAILED"
[ "$fails" = 0 ]
