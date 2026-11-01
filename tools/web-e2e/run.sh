#!/bin/bash
# Browser tests of the built web UI against a mock Hermes (mock.cjs) — no phone needed.
# Builds web/, starts the mock on 127.0.0.1:9119 and web/devserver.py on :5180, runs test.cjs, stops both.
# 9119 must be free: remove an `adb forward tcp:9119` first (the test refuses to touch a real Hermes).
# Browser: Playwright's own, or set CHROMIUM=/path/to/chrome (cloud sessions: /opt/pw-browsers/chromium-*/chrome-linux/chrome).
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:-} npm install --silent
if [ -z "${CHROMIUM:-}" ]; then
  c=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1 || true)
  [ -n "$c" ] && export CHROMIUM="$c"
fi
# HM_E2E_SKIP_BUILD=1: web/dist is already built (CI builds it in its own step).
[ "${HM_E2E_SKIP_BUILD:-}" = 1 ] || ( cd ../../web && npm run build >/dev/null )
node mock.cjs & MOCK=$!
( cd ../../web && exec python3 devserver.py >/dev/null 2>&1 ) & DEV=$!
trap 'kill $MOCK $DEV 2>/dev/null || true' EXIT
sleep 1.5
kill -0 $MOCK || { echo "mock didn't start"; exit 1; }
node test.cjs
