#!/bin/bash
# Our fixes to Hermes itself (hermes/patches/*.patch), applied to the Hermes checkout as plain working-tree changes,
# so `git diff` in the checkout shows exactly what we changed and `revert` gives back upstream's files.
# Runs inside Debian.   Usage: hermes-patches.sh status|apply|revert [patch dir]
# A patch upstream already contains reads as "upstream" or "applied" and is skipped; one that no longer fits
# stops `apply` with nothing changed. Restart the Hermes dashboard afterwards so the change is loaded.
set -euo pipefail
cmd=${1:-status}
dir=$(cd "${2:-$(dirname "$0")/../hermes/patches}" && pwd)
cd "${HERMES_AGENT_DIR:-$HOME/.hermes/hermes-agent}"

state() {
  # A patch taken from an upstream commit (its "From <sha>" line) is in once Hermes contains that commit.
  local sha
  sha=$(sed -n '1s/^From \([0-9a-f]\{40\}\) .*/\1/p' "$1")
  if [ -n "$sha" ] && git merge-base --is-ancestor "$sha" HEAD 2>/dev/null; then echo upstream
  elif git apply -R --check "$1" 2>/dev/null; then echo applied
  elif git apply --check "$1" 2>/dev/null; then echo pending
  else echo conflict; fi
}

patches=("$dir"/*.patch)
case $cmd in
  status)
    for p in "${patches[@]}"; do echo "$(state "$p") $(basename "$p")"; done ;;
  apply)
    # All or nothing: a later patch can only be checked once the earlier ones are in, so a conflict
    # undoes what this run applied.
    done_now=()
    for p in "${patches[@]}"; do
      s=$(state "$p")
      if [ "$s" = conflict ]; then
        for ((i = ${#done_now[@]} - 1; i >= 0; i--)); do git apply -R "${done_now[$i]}"; done
        echo "conflict $(basename "$p"): Hermes changed there, the patch needs updating; nothing was changed" >&2
        exit 2
      fi
      if [ "$s" = pending ]; then git apply "$p"; done_now+=("$p"); echo "applied $(basename "$p")"
      else echo "already in $(basename "$p")"; fi
    done ;;
  revert)
    for ((i = ${#patches[@]} - 1; i >= 0; i--)); do
      p=${patches[$i]}
      if [ "$(state "$p")" = applied ]; then git apply -R "$p"; echo "reverted $(basename "$p")"; fi
    done ;;
  *) echo "usage: $0 status|apply|revert [patch dir]" >&2; exit 1 ;;
esac
