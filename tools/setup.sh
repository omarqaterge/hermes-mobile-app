#!/bin/bash
# Gets a fresh checkout or worktree ready for tools/check.sh: checks the tool versions, installs web/ and
# tools/web-e2e/ packages, finds a browser for the e2e tests and the plugin tests' Python packages.
# Safe to run again; fast when already set up. Works as the setup script of a cloud agent environment.
#   tools/setup.sh            everything this machine can do
#   tools/setup.sh --check    only report what is there and what is missing
# Packages: when another checkout of this repository (a sibling git worktree) has node_modules for the same
# package-lock.json, they are copied from it instead of installed again: a copy-on-write clone on macOS (cp -c), hard
# links on Linux (cp -al), so it takes seconds and no extra disk. (A symlink is not enough: Vite refuses files whose
# real path is outside the checkout.)
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
only_check=false
[ "${1:-}" = --check ] && only_check=true
ok() { echo "  ok      $*"; }
miss() { echo "  missing $*"; }

echo "Tools"
node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$node_major" -ge 22 ]; then ok "node $(node -v)"; else miss "Node 22 or newer (web/, tools/web-e2e/)"; fi
if command -v python3 >/dev/null; then ok "$(python3 --version)"; else miss "python3 (plugin tests, check_spec.py)"; fi
java_major=$(java -version 2>&1 | sed -nE 's/.*version "([0-9]+).*/\1/p' | head -1)
if [ "${java_major:-0}" -ge 21 ]; then ok "java $java_major (tools/java-check.sh)"; else miss "JDK 21+ (only for android/ changes: tools/java-check.sh)"; fi
if [ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] || [ -d "$HOME/Library/Android/sdk" ] || [ -d "$HOME/Android/Sdk" ]; then
  ok "Android SDK (tools/api-check.sh)"
else
  miss "Android SDK command-line tools (only for android/ changes: tools/api-check.sh; CI runs it anyway)"
fi

# node_modules for one package dir: copy a sibling worktree's when its lockfile is identical, else npm ci.
packages() {
  local dir=$1 lock="$1/package-lock.json"
  if [ -L "$dir/node_modules" ]; then
    rm -f "$dir/node_modules" # a link from an older setup (Vite rejects it) or to a removed worktree
  elif [ -d "$dir/node_modules" ]; then
    ok "$dir/node_modules"; return
  fi
  $only_check && { miss "$dir/node_modules (tools/setup.sh installs it)"; return; }
  local wt
  while IFS= read -r wt; do
    [ "$wt" = "$root" ] && continue
    if [ -d "$wt/$dir/node_modules" ] && [ ! -L "$wt/$dir/node_modules" ] && cmp -s "$wt/$lock" "$lock"; then
      if cp -Rc "$wt/$dir/node_modules" "$dir/" 2>/dev/null || cp -al "$wt/$dir/node_modules" "$dir/" 2>/dev/null; then
        ok "$dir/node_modules (copied from $wt)"; return
      fi
      rm -rf "$dir/node_modules"
    fi
  done < <(git worktree list --porcelain | sed -n 's/^worktree //p')
  echo "  install $dir (npm ci)"
  (cd "$dir" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --silent) && ok "$dir/node_modules" || miss "$dir/node_modules (npm ci failed)"
}

echo "Packages"
packages web
packages tools/web-e2e
if python3 -c 'import fastapi, httpx' 2>/dev/null; then
  ok "python fastapi, httpx"
elif $only_check; then
  miss "python fastapi, httpx (pip install fastapi httpx)"
else
  python3 -m pip install --quiet fastapi httpx 2>/dev/null || python3 -m pip install --quiet --user fastapi httpx 2>/dev/null ||
    python3 -m pip install --quiet --break-system-packages fastapi httpx 2>/dev/null
  python3 -c 'import fastapi, httpx' 2>/dev/null && ok "python fastapi, httpx" || miss "python fastapi, httpx (pip install fastapi httpx)"
fi

# Playwright's own Chromium on Linux also needs system libraries (libnspr4, libnss3, ...) that a bare image lacks:
# start it once, and when it can't load a library, install them (root only) or say how.
pw_launches() {
  [ "$(uname)" = Linux ] || return 0
  (cd tools/web-e2e && node -e "require('playwright').chromium.launch().then(b => b.close())" >/dev/null 2>&1)
}
pw_libs() {
  pw_launches && return 0
  if $only_check; then
    miss "the system libraries of Playwright's Chromium: run 'npx playwright install-deps chromium' in tools/web-e2e as root"
    return 1
  fi
  if [ "$(id -u)" = 0 ] && (cd tools/web-e2e && npx playwright install-deps chromium >/dev/null 2>&1) && pw_launches; then
    ok "the system libraries of Playwright's Chromium (installed)"
  else
    miss "the system libraries of Playwright's Chromium: run 'sudo npx playwright install-deps chromium' in tools/web-e2e"
    return 1
  fi
}

# True when one of the paths exists (globs that match nothing stay as text and fail the test; `ls -d a* b*` fails
# as soon as one of them matches nothing).
any_dir() { local d; for d in "$@"; do [ -d "$d" ] && return 0; done; return 1; }

echo "Browser for tools/web-e2e"
if [ -n "${CHROMIUM:-}" ] && [ -x "$CHROMIUM" ]; then
  ok "CHROMIUM=$CHROMIUM"
elif any_dir /opt/pw-browsers/chromium-*; then
  ok "Playwright's Chromium (/opt/pw-browsers)"
elif any_dir "$HOME/Library/Caches/ms-playwright"/chromium* "$HOME/.cache/ms-playwright"/chromium*; then
  pw_libs && ok "Playwright's Chromium"
elif [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  ok "Google Chrome (run.sh uses it)"
elif $only_check; then
  miss "a browser (tools/setup.sh installs Playwright's Chromium)"
elif (cd tools/web-e2e && npx playwright install chromium >/dev/null 2>&1); then
  pw_libs && ok "Playwright's Chromium (installed)"
else
  miss "a browser: run 'npx playwright install --with-deps chromium' in tools/web-e2e"
fi
echo "Next: tools/check.sh (checks for what your branch changed) or tools/check.sh --all"
