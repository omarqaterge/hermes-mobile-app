#!/usr/bin/env bash
# The Hermes that bootstrap.sh installs must be the one the app vendors (web/vendor/hermes-shared/.hermes-commit).
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
pin=$(tr -d '[:space:]' < "$here/web/vendor/hermes-shared/.hermes-commit")
full=$(sed -n 's/^HERMES_COMMIT=\([0-9a-f]\{40\}\).*/\1/p' "$here/phone/bootstrap.sh")
[ -n "$full" ] || { echo "FAIL: bootstrap.sh has no 40-char HERMES_COMMIT=…"; exit 1; }
case "$full" in "$pin"*) echo "bootstrap pin: OK ($full)";; *) echo "FAIL: bootstrap pins $full, the app vendors $pin"; exit 1;; esac
grep -Eq -- '--commit \\?"?\$HERMES_COMMIT' "$here/phone/bootstrap.sh" || { echo "FAIL: installer not called with --commit"; exit 1; }
