#!/bin/bash
# Which slow check groups a change needs. Reads changed paths (one per line) on stdin, or the word "all", and prints
# `web=true|false` and `contract=true|false` lines (the format of $GITHUB_OUTPUT). CI's `changes` job runs it on a
# PR's file list; on `main` it gets "all". The fast jobs (plugin, patches, Android) always run, so they have no group.
#   web       the web UI's unit tests, build and browser e2e
#   contract  the mock Hermes checked against the real pinned Hermes
set -euo pipefail
web=false
contract=false
while IFS= read -r p; do
  case "$p" in
    all) web=true; contract=true ;;
    .github/workflows/ci.yml|tools/ci-changes.sh) web=true; contract=true ;;
    web/vendor/*) web=true; contract=true ;;
    web/*) web=true ;;
    tools/web-e2e/mock.cjs|tools/web-e2e/package.json|tools/web-e2e/package-lock.json|tools/web-e2e/fixtures/*) web=true; contract=true ;;
    tools/web-e2e/*) web=true ;;
    tools/hermes-contract/*|hermes/*) contract=true ;;
  esac
done
echo "web=$web"
echo "contract=$contract"
