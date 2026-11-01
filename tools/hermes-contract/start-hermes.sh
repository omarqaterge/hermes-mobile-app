#!/bin/bash
# Installs and starts the pinned Hermes (web/vendor/hermes-shared/.hermes-commit) with hermes/patches applied, the way
# the phone runs it (`hermes dashboard --host 127.0.0.1`), for tools/hermes-contract/run.sh. Everything lives in
# <work dir>: the clone, its uv venv, a throwaway HERMES_HOME seeded with one chat (seed.py) and the app's plugin
# (hermes-plugin/hermes-mobile, copied in and enabled like phone/install.sh does), a stub web dist (the app has its own UI;
# the dashboard only needs an index.html to put its session token in), and a fake local model (fake-model.py) the seeded
# config points at. No real model provider, no key. The dashboard runs with HOME=<work dir>/userhome (HERMES_HOME is its .hermes), so
# nothing it or the plugin writes (~/.hermes/installs, ~/.hermes/mobile) lands in the real home.
# Usage: start-hermes.sh <work dir> <port>    (the dashboard's output goes to <work dir>/dashboard.log; the fake model's
# pid is <work dir>/model.pid)
set -euo pipefail
here=$(cd "$(dirname "$0")/../.." && pwd)
work=$1 port=$2
[ "$port" != 9119 ] || { echo "start-hermes: not on 9119 (the mock's port, and the phone's when adb forwards it)" >&2; exit 2; }
pin=$(cat "$here/web/vendor/hermes-shared/.hermes-commit")
src=$work/hermes-agent
mkdir -p "$work"
# Only the pinned commit, without history: a blob-less clone fetched each file the patch checks read one at a time
# (about 40 s in CI). Fetching by id takes the full id, which phone/bootstrap.sh has (tools/test_bootstrap_pin.sh keeps
# the two pins the same). A reused work dir fetches only when the pin moved.
if [ ! -d "$src/.git" ]; then
  git init -q "$src"
  git -C "$src" remote add origin https://github.com/NousResearch/hermes-agent.git
fi
if ! git -C "$src" cat-file -e "$pin^{commit}" 2>/dev/null; then
  git -C "$src" fetch -q --depth=1 origin "$(sed -n 's/^HERMES_COMMIT=\([0-9a-f]\{40\}\).*/\1/p' "$here/phone/bootstrap.sh")"
fi
git -C "$src" -c advice.detachedHead=false checkout -q "$pin"
HERMES_AGENT_DIR="$src" bash "$here/phone/hermes-patches.sh" apply "$here/hermes/patches"
# The pinned lock file, the dashboard's web extra only (fastapi, uvicorn); Python as the pin asks (3.14).
(cd "$src" && uv sync -q --frozen --extra web --python 3.14)
# Keep uv's caches and Pythons where they are when HOME changes below.
export UV_CACHE_DIR=${UV_CACHE_DIR:-$(uv cache dir)} UV_PYTHON_INSTALL_DIR=${UV_PYTHON_INSTALL_DIR:-$(uv python dir)}

# HOME is a folder of its own and HERMES_HOME is its .hermes, as on the phone (the plugin keeps some files under ~/.hermes,
# and finds the chats in the same place). A rerun with the same work dir keeps ~/.hermes/installs (Hermes's own runtime,
# slow to build) and starts everything else from scratch.
uhome=$work/userhome home=$work/userhome/.hermes dist=$work/dist
mkdir -p "$home" "$dist"
find "$home" -mindepth 1 -maxdepth 1 ! -name installs -exec rm -rf {} +
printf '<!doctype html><html><head></head><body>hermes-contract</body></html>\n' > "$dist/index.html"

# The fake model: a free port on 127.0.0.1, a note for its read_file call.
rm -f "$work/model.port" "$work/model.log" "$work/model-requests.jsonl"
printf 'contract note\n' > "$work/note.txt"
# The files of the other scripted turns (fake-model.py): x for the chmod Hermes asks to approve, site/ for the edits.
rm -rf "$work/site" && mkdir -p "$work/site" && printf 'old\n' > "$work/site/b.txt" && : > "$work/x" && chmod 644 "$work/x"
nohup "$src/.venv/bin/python" "$here/tools/hermes-contract/fake-model.py" "$work/model.port" "$work/note.txt" \
  "$work/model-requests.jsonl" > "$work/model.log" 2>&1 &
echo $! > "$work/model.pid"
for _ in $(seq 1 50); do [ -s "$work/model.port" ] && break; sleep 0.2; done
[ -s "$work/model.port" ] || { echo "start-hermes: the fake model did not start" >&2; cat "$work/model.log" >&2; exit 1; }

# The app's plugin, as phone/install.sh puts it into Debian (a copy, not a link, so Python's caches stay out of the repo).
mkdir -p "$home/plugins"
cp -R "$here/hermes-plugin/hermes-mobile" "$home/plugins/hermes-mobile"
find "$home/plugins" -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true

(cd "$src" && HOME="$uhome" HERMES_HOME="$home" HM_FAKE_MODEL_URL="http://127.0.0.1:$(cat "$work/model.port")/v1" \
  .venv/bin/python "$here/tools/hermes-contract/seed.py")

cd "$src"
# The plugin finds the chats and the bots under /root/.hermes unless told (the phone's Debian home).
# File checkpoints (snapshots before write_file / patch, for the plugin's /checkpoints) are on, as the app uses them.
HERMES_TUI_CHECKPOINTS=1 HOME="$uhome" HERMES_HOME="$home" HERMES_HOME_ROOT="$uhome" HERMES_MOBILE_ROOT="$home" HERMES_WEB_DIST="$dist" nohup .venv/bin/hermes dashboard --host 127.0.0.1 --port "$port" --no-open --skip-build \
  > "$work/dashboard.log" 2>&1 &
echo $! > "$work/dashboard.pid"
for _ in $(seq 1 90); do
  curl -fs -o /dev/null "http://127.0.0.1:$port/" && exit 0
  kill -0 "$(cat "$work/dashboard.pid")" 2>/dev/null || break
  sleep 2
done
echo "start-hermes: the dashboard did not answer on 127.0.0.1:$port" >&2
tail -50 "$work/dashboard.log" >&2
exit 1
