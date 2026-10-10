#!/bin/bash
# Checks hermes/patches against Hermes: they must apply to the pinned build (web/vendor/hermes-shared/.hermes-commit,
# the one the app is made for), and we report how they fare on upstream main (a heads-up for the next update).
# Usage: tools/test_hermes_patches.sh [hermes-agent clone]   (clones NousResearch/hermes-agent if none is given)
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
pin=$(cat "$here/web/vendor/hermes-shared/.hermes-commit")
src=${1:-}
if [ -z "$src" ]; then
  src=$(mktemp -d)/hermes-agent
  git clone -q --filter=blob:none https://github.com/NousResearch/hermes-agent.git "$src"
fi
work=$(mktemp -d)
trap 'git -C "$src" worktree remove --force "$work/pinned" 2>/dev/null; git -C "$src" worktree remove --force "$work/main" 2>/dev/null; rm -rf "$work"' EXIT
script="$here/phone/hermes-patches.sh"

git -C "$src" worktree add -q --detach "$work/pinned" "$pin"
echo "pinned Hermes $pin:"
HERMES_AGENT_DIR="$work/pinned" bash "$script" apply "$here/hermes/patches"
HERMES_AGENT_DIR="$work/pinned" bash "$script" status "$here/hermes/patches" | grep -qv '^\(applied\|upstream\) ' \
  && { echo "FAIL: not every patch is in after apply" >&2; exit 1; }
HERMES_AGENT_DIR="$work/pinned" bash "$script" revert "$here/hermes/patches" >/dev/null
[ -z "$(git -C "$work/pinned" status --porcelain)" ] || { echo "FAIL: revert left changes behind" >&2; exit 1; }
echo "OK: the patches apply to the pinned Hermes and revert cleanly"

git -C "$src" fetch -q origin main 2>/dev/null || true
git -C "$src" worktree add -q --detach "$work/main" origin/main
echo "upstream main $(git -C "$work/main" rev-parse --short HEAD) (information only):"
HERMES_AGENT_DIR="$work/main" bash "$script" status "$here/hermes/patches" || true
