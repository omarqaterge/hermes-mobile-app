#!/bin/bash
# Tests for tools/ci-changes.sh: which check groups each kind of change turns on.
set -uo pipefail
cd "$(dirname "$0")/.."
fails=0
t() { # t "what" "expected output" paths...
  local what=$1 want=$2; shift 2
  local got
  got=$(printf '%s\n' "$@" | bash tools/ci-changes.sh | tr '\n' ' ')
  if [ "$got" = "$want" ]; then echo "  [PASS] $what"; else echo "  [FAIL] $what: got '$got', want '$want'"; fails=$((fails + 1)); fi
}
t "main runs everything" "web=true contract=true " all
t "docs only: nothing slow" "web=false contract=false " docs/spec/03-04-composer.md README.md changes/2026-11-01-x.md
t "plugin only: nothing slow" "web=false contract=false " hermes-plugin/hermes-mobile/__init__.py tools/test_canvas.py
t "android only: nothing slow" "web=false contract=false " android/src/com/omarqaterge/hermesmobile/MainActivity.java
t "web source: web" "web=true contract=false " web/src/gateway.ts
t "a check file: web" "web=true contract=false " tools/web-e2e/checks/03-streaming-and-goal.cjs
t "the mock: web and contract" "web=true contract=true " tools/web-e2e/mock.cjs
t "vendored Hermes types: both" "web=true contract=true " web/vendor/hermes-shared/.hermes-commit
t "contract tool: contract" "web=false contract=true " tools/hermes-contract/contract.cjs
t "Hermes patches: contract" "web=false contract=true " hermes/patches/0001-x.patch
t "the workflow itself: both" "web=true contract=true " .github/workflows/ci.yml
t "no files: nothing slow" "web=false contract=false "
echo "ci-changes: $fails failure(s)"
[ "$fails" = 0 ]
