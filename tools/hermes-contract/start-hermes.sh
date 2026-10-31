#!/bin/bash
# Installs and starts the pinned Hermes (web/vendor/hermes-shared/.hermes-commit) with hermes/patches applied, the way
# the phone runs it (`hermes dashboard --host 127.0.0.1`), for tools/hermes-contract/run.sh. Everything lives in
# <work dir>: the clone, its uv venv, a throwaway HERMES_HOME seeded with one chat (seed.py) and the app's plugin
# (hermes-plugin/hermes-mobile, copied in and enabled like phone/install.sh does), and a stub web dist (the app has its own
# UI; the dashboard only needs an index.html to put its session token in). No model provider, no key. The dashboard runs with HOME=<work dir>/userhome (HERMES_HOME is its .hermes), so
# nothing it or the plugin writes (~/.hermes/installs, ~/.hermes/mobile) lands in the real home.
# Usage: start-hermes.sh <work dir> <port>    (the dashboard's output goes to <work dir>/dashboard.log)
set -euo pipefail
here=$(cd "$(dirname "$0")/../.." && pwd)
work=$1 port=$2
[ "$port" != 9119 ] || { echo "start-hermes: not on 9119 (the mock's port, and the phone's when adb forwards it)" >&2; exit 2; }
pin=$(cat "$here/web/vendor/hermes-shared/.hermes-commit")
src=$work/hermes-agent
mkdir -p "$work"
if [ ! -d "$src/.git" ]; then
  git clone -q --filter=blob:none https://github.com/NousResearch/hermes-agent.git "$src"
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

# The app's plugin, as phone/install.sh puts it into Debian (a copy, not a link, so Python's caches stay out of the repo).
mkdir -p "$home/plugins"
cp -R "$here/hermes-plugin/hermes-mobile" "$home/plugins/hermes-mobile"
find "$home/plugins" -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true

(cd "$src" && HOME="$uhome" HERMES_HOME="$home" .venv/bin/python "$here/tools/hermes-contract/seed.py")

cd "$src"
# The plugin finds the chats and the bots under /root/.hermes unless told (the phone's Debian home).
HOME="$uhome" HERMES_HOME="$home" HERMES_HOME_ROOT="$uhome" HERMES_MOBILE_ROOT="$home" HERMES_WEB_DIST="$dist" nohup .venv/bin/hermes dashboard --host 127.0.0.1 --port "$port" --no-open --skip-build \
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
