#!/bin/bash
# Fails when a commit credits an AI tool: an author or committer that is Claude / Anthropic (or another AI tool's bot
# address), or a message line such as `Co-Authored-By: Claude …` or "Generated with Claude Code". The repository's
# work is its owner's (AGENTS.md "Rules").
#   tools/check-attribution.sh [RANGE]     commits in a git range (default origin/main..HEAD)
#   tools/check-attribution.sh --stdin     records on stdin: one per commit, fields separated by a tab
#                                          (sha, author name, author email, committer name, committer email,
#                                          message with newlines as \n), as CI builds them from the GitHub API
set -uo pipefail
cd "$(dirname "$0")/.."
who='claude|anthropic|copilot|openai|chatgpt|codex|cursor|devin|gemini'
records() {
  if [ "${1:-}" = --stdin ]; then cat
  else git log --format='%H%x09%an%x09%ae%x09%cn%x09%ce%x09%B%x00' "${1:-origin/main..HEAD}" | tr '\n' '\036' | tr '\000' '\n' |
    sed 's/^\x1e//; s/\x1e/\\n/g'
  fi
}
bad=0
while IFS=$'\t' read -r sha an ae cn ce msg; do
  [ -n "$sha" ] || continue
  why=()
  printf '%s\n' "$an $ae" | grep -qiE "$who" && why+=("author $an <$ae>")
  printf '%s\n' "$cn $ce" | grep -qiE "$who" && why+=("committer $cn <$ce>")
  printf '%b\n' "$msg" | grep -qiE "^co-authored-by:.*($who)|generated (with|by) .*($who)" && why+=("an AI credit line in the message")
  if [ ${#why[@]} -gt 0 ]; then
    bad=$((bad + 1))
    echo "  ${sha:0:9}: $(IFS=', '; echo "${why[*]}")"
  fi
done < <(records "$@")
if [ "$bad" -gt 0 ]; then
  echo "check-attribution: $bad commit(s) credit an AI tool. Commit as the owner and drop such lines (AGENTS.md \"Rules\");"
  echo "fix with: git rebase -i, or git commit --amend --reset-author for the last commit."
  exit 1
fi
echo "check-attribution: no AI credit in these commits."
