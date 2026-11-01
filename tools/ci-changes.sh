#!/bin/bash
# Which slow check groups a change needs. Reads changed paths (one per line) on stdin, or the word "all", and prints
# `web=`, `contract=` and `patches=` lines, each true or false (the format of $GITHUB_OUTPUT). CI's `changes` job runs
# it on a PR's file list; on `main` it gets "all". The fast jobs (plugin, which also checks the spec, and Android) always
# run, so they have no group.
#   web       the web UI's unit tests, build and browser e2e
#   contract  the mock Hermes checked against the real pinned Hermes
#   patches   the Hermes patches against the pinned Hermes (a clone of it) and the phone-script tests
set -euo pipefail
web=false
contract=false
patches=false
while IFS= read -r p; do
  case "$p" in
    all) web=true; contract=true; patches=true ;;
    .github/workflows/ci.yml|tools/ci-changes.sh) web=true; contract=true; patches=true ;;
    web/vendor/*) web=true; contract=true ;;
    web/*) web=true ;;
    tools/web-e2e/mock.cjs|tools/web-e2e/package.json|tools/web-e2e/package-lock.json|tools/web-e2e/fixtures/*) web=true; contract=true ;;
    tools/web-e2e/*) web=true ;;
    tools/hermes-contract/*|hermes/*) contract=true ;;
  esac
  # What the hermes-patches job reads: the patches and the pin, the phone scripts, and the shell scripts and helpers
  # directly in tools/ (its tests, device-lock.sh, build-image.sh, pack_image.py, setup-phone.*).
  case "$p" in
    hermes/*|phone/*|web/vendor/hermes-shared/.hermes-commit) patches=true ;;
    tools/*/*) ;;
    tools/*.sh|tools/*.ps1|tools/pack_image.py) patches=true ;;
  esac
done
echo "web=$web"
echo "contract=$contract"
echo "patches=$patches"
