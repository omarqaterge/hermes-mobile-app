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
t "main runs everything" "web=true contract=true patches=true " all
t "docs only: nothing slow" "web=false contract=false patches=false " docs/spec/03-04-composer.md README.md changes/2026-11-01-x.md
t "plugin only: nothing slow" "web=false contract=false patches=false " hermes-plugin/hermes-mobile/__init__.py tools/test_canvas.py
t "android only: nothing slow" "web=false contract=false patches=false " android/src/com/omarqaterge/hermesmobile/MainActivity.java
t "web source: web" "web=true contract=false patches=false " web/src/gateway.ts
t "a check file: web" "web=true contract=false patches=false " tools/web-e2e/checks/03-streaming-and-goal.cjs
t "the mock: web and contract" "web=true contract=true patches=false " tools/web-e2e/mock.cjs
t "vendored Hermes types: both" "web=true contract=true patches=true " web/vendor/hermes-shared/.hermes-commit
t "contract tool: contract" "web=false contract=true patches=false " tools/hermes-contract/contract.cjs
t "Hermes patches: contract and patches" "web=false contract=true patches=true " hermes/patches/0001-x.patch
t "the workflow itself: both" "web=true contract=true patches=true " .github/workflows/ci.yml
t "a phone script: patches" "web=false contract=false patches=true " phone/bootstrap.sh
t "a tools/ shell script: patches" "web=false contract=false patches=true " tools/device-lock.sh
t "the image packer: patches" "web=false contract=false patches=true " tools/pack_image.py
t "the e2e runner script: web only" "web=true contract=false patches=false " tools/web-e2e/run.sh
t "a plugin test: no patches" "web=false contract=false patches=false " tools/test_canvas.py
t "other vendored files: no patches" "web=true contract=true patches=false " web/vendor/hermes-shared/src/x.ts
t "no files: nothing slow" "web=false contract=false patches=false "
echo "ci-changes: $fails failure(s)"
[ "$fails" = 0 ]
