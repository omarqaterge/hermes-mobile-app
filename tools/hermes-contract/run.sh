#!/bin/bash
# Checks the mock Hermes of the browser tests (tools/web-e2e/mock.cjs) against the real, pinned Hermes: starts the mock
# on 127.0.0.1:9119 and the pinned Hermes (start-hermes.sh) on 127.0.0.1:${HM_CONTRACT_PORT:-9229}, then runs
# contract.cjs. Needs git, uv, Node 22 and tools/web-e2e's node_modules (the mock uses `ws`) and python3 for the fake model
# the Hermes talks to (fake-model.py). No real model or key is used.
# Usage: tools/hermes-contract/run.sh [work dir]   (default: a new temp dir; pass one to reuse the clone and venv)
set -euo pipefail
cd "$(dirname "$0")"
port=${HM_CONTRACT_PORT:-9229}
work=${1:-$(mktemp -d)}
mkdir -p "$work"
[ -d ../web-e2e/node_modules ] || (cd ../web-e2e && npm ci --silent)
cleanup() {
  kill "${MOCK:-}" 2>/dev/null || true
  [ -f "$work/dashboard.pid" ] && kill "$(cat "$work/dashboard.pid")" 2>/dev/null || true
  [ -f "$work/model.pid" ] && kill "$(cat "$work/model.pid")" 2>/dev/null || true
}
trap cleanup EXIT
HM_E2E_LOG="$work/mock-calls.jsonl" node ../web-e2e/mock.cjs > "$work/mock.log" 2>&1 & MOCK=$!
./start-hermes.sh "$work" "$port"
kill -0 "$MOCK" || { echo "the mock didn't start:"; cat "$work/mock.log"; exit 1; }
status=0
node contract.cjs http://127.0.0.1:9119 "http://127.0.0.1:$port" || status=$?
if [ "$status" != 0 ]; then echo "--- dashboard.log (last 40 lines)"; tail -40 "$work/dashboard.log"; fi
exit "$status"
