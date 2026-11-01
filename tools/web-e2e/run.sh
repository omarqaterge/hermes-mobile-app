#!/bin/bash
# Browser tests of the built web UI against a mock Hermes (mock.cjs) — no phone needed.
# Builds web/, starts the mock on 127.0.0.1:9119 and web/devserver.py on :5180, runs test.cjs, stops both.
# When 9119 or 5180 is taken (another agent's run, an `adb forward tcp:9119` to the phone), it picks free ports and
# says so; HM_E2E_MOCK_PORT / HM_E2E_WEB_PORT choose them. Each run has its own call log, so runs never mix.
# Browser: Playwright's own, or set CHROMIUM=/path/to/chrome (cloud sessions: /opt/pw-browsers/chromium-*/chrome-linux/chrome;
# on a Mac without Playwright's browser, Google Chrome is used).
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:-} npm install --silent
if [ -z "${CHROMIUM:-}" ]; then
  c=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1 || true)
  [ -n "$c" ] && export CHROMIUM="$c"
fi
mac_chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ -z "${CHROMIUM:-}" ] && [ -x "$mac_chrome" ] && ! ls -d "$HOME/Library/Caches/ms-playwright"/chromium-* >/dev/null 2>&1; then
  export CHROMIUM="$mac_chrome"
fi
# A port: the given one if free, else a free one the system picks.
port() {
  python3 - "$1" <<'PY'
import socket, sys
want = int(sys.argv[1])
for p in (want, 0):
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", p))
        print(s.getsockname()[1])
        break
    except OSError:
        pass
    finally:
        s.close()
PY
}
want_mock=${HM_E2E_MOCK_PORT:-9119}
want_web=${HM_E2E_WEB_PORT:-5180}
export HM_E2E_MOCK_PORT=$(port "$want_mock")
export HM_E2E_WEB_PORT=$(port "$want_web")
[ "$HM_E2E_MOCK_PORT" = "$want_mock" ] && [ "$HM_E2E_WEB_PORT" = "$want_web" ] ||
  echo "run.sh: $want_mock or $want_web is taken; using mock $HM_E2E_MOCK_PORT, page $HM_E2E_WEB_PORT"
run_dir=$(mktemp -d "${TMPDIR:-/tmp}/hm-web-e2e.XXXXXX")
export HM_E2E_LOG=${HM_E2E_LOG:-$run_dir/calls.jsonl}
# HM_E2E_SKIP_BUILD=1: web/dist is already built (CI builds it in its own step).
[ "${HM_E2E_SKIP_BUILD:-}" = 1 ] || ( cd ../../web && npm run build >/dev/null )
MOCK= DEV=
trap 'kill $MOCK $DEV 2>/dev/null || true; rm -rf "$run_dir"' EXIT
# Start the mock and the page server, and wait until each says it listens. A port found free above can be taken
# before our server binds it (another run started at the same moment): that server then exits, and we try again on
# ports the system picks. Each server's own line counts, never an answer on the port, which could be another run's.
for try in 1 2 3; do
  : > "$run_dir/mock.out"; : > "$run_dir/dev.out"
  node mock.cjs > "$run_dir/mock.out" & MOCK=$!
  ( cd ../../web && HM_HERMES_URL="http://127.0.0.1:$HM_E2E_MOCK_PORT" HM_DEV_PORT=$HM_E2E_WEB_PORT exec python3 devserver.py > "$run_dir/dev.out" 2>/dev/null ) & DEV=$!
  up=
  for _ in $(seq 100); do
    grep -q '^mock on ' "$run_dir/mock.out" && grep -q '^devserver on ' "$run_dir/dev.out" && { up=1; break; }
    kill -0 $MOCK 2>/dev/null && kill -0 $DEV 2>/dev/null || break
    sleep 0.1
  done
  [ -n "$up" ] && break
  kill $MOCK $DEV 2>/dev/null || true
  [ "$try" = 3 ] && { echo "run.sh: the mock or the page server didn't start"; exit 1; }
  export HM_E2E_MOCK_PORT=$(port 0) HM_E2E_WEB_PORT=$(port 0)
  echo "run.sh: a port was taken meanwhile; trying mock $HM_E2E_MOCK_PORT, page $HM_E2E_WEB_PORT"
done
node test.cjs "$@"
