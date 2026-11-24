#!/bin/bash
# Checks the mock Hermes of the browser tests (tools/web-e2e/mock.cjs) against the real, pinned Hermes: starts the mock
# on 127.0.0.1:9119 and the pinned Hermes (start-hermes.sh) on 127.0.0.1:${HM_CONTRACT_PORT:-9229}, then runs
# contract.cjs, after checking web/vendor/hermes-commands.json against the clone (hermes-commands.py --check). Needs git, uv, Node 22 and tools/web-e2e's node_modules (the mock uses `ws`) and python3 for the fake model
# the Hermes talks to (fake-model.py). No real model or key is used.
# Usage: tools/hermes-contract/run.sh [work dir]   (default: a new temp dir; pass one to reuse the clone and venv)
set -euo pipefail
work=${1:-$(mktemp -d)}
mkdir -p "$work"
work=$(cd "$work" && pwd)
cd "$(dirname "$0")"
port=${HM_CONTRACT_PORT:-9229}
[ -d ../web-e2e/node_modules ] || (cd ../web-e2e && npm ci --silent)
cleanup() {
  kill "${MOCK:-}" 2>/dev/null || true
  [ -f "$work/dashboard.pid" ] && kill "$(cat "$work/dashboard.pid")" 2>/dev/null || true
  [ -f "$work/model.pid" ] && kill "$(cat "$work/model.pid")" 2>/dev/null || true
}
trap cleanup EXIT
# HM_E2E_MOCK_PORT: another port for the mock when something holds 9119 (an adb forward, say).
export HM_E2E_MOCK_PORT=${HM_E2E_MOCK_PORT:-9119}
export HM_CONTRACT_NOTE="$work/userhome/note.txt"
HM_E2E_LOG="$work/mock-calls.jsonl" node ../web-e2e/mock.cjs > "$work/mock.log" 2>&1 & MOCK=$!
export HM_CONTRACT_KEY=contract-event-key
./start-hermes.sh "$work" "$port"
# The app's copy of Hermes's command table (web/vendor/hermes-commands.json, which the lock screen and the background-task
# rules read names by) must be the pinned Hermes's.
python3 ../hermes-commands.py "$work/hermes-agent" --check
kill -0 "$MOCK" || { echo "the mock didn't start:"; cat "$work/mock.log"; exit 1; }
status=0
node contract.cjs "http://127.0.0.1:$HM_E2E_MOCK_PORT" "http://127.0.0.1:$port" || status=$?
if [ "$status" != 0 ]; then echo "--- dashboard.log (last 40 lines)"; tail -40 "$work/dashboard.log"; fi
exit "$status"
