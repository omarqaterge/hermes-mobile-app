#!/usr/bin/env bash
# Builds the ready-made Debian + Hermes image that phone/bootstrap.sh restores on a new install instead of installing
# Debian and running Hermes's installer on the phone. bootstrap.sh finds it by the pin alone: release tag
# hermes-image-<first 12 of HERMES_COMMIT>, asset <name> plus <name>.sha256 (.github/workflows/image.yml publishes both).
# Debian is set up exactly as bootstrap.sh does it: its apt line (with CHROMIUM_LIBS), its zz-no-termux-path profile
# file and its call of the pinned Hermes's own installer are read out of bootstrap.sh, so the two cannot drift. Then the
# browser tools, hermes/patches (phone/hermes-patches.sh), a scrub (tools/pack_image.py: the build fails if a scrubbed
# path is in the archive), proot-distro's backup layout (debian/manifest.json + debian/rootfs/...), zstd -19 --long=27.
# Runs in an arm64 debian:trixie container: on an arm64 machine with docker (Apple Silicon with OrbStack/Docker Desktop,
# GitHub's ubuntu-24.04-arm runners: .github/workflows/image.yml).
#   tools/build-image.sh [OUT_DIR]   writes OUT_DIR/<name> and OUT_DIR/<name>.sha256 (default OUT_DIR: ./image-out)
#   tools/build-image.sh --name      prints <name> (hermes-debian-<pin12>-arm64.tar.zst)
# hermes/patches are applied in the image (and their hash is in its manifest), but bootstrap.sh reverts them after the
# restore and install.sh applies the installer's own set, so a patch change does not need a new image.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
BOOT="$here/phone/bootstrap.sh"

sha256() { if command -v sha256sum >/dev/null; then sha256sum | cut -c1-64; else shasum -a 256 | cut -c1-64; fi; }
pin=$(sed -n 's/^HERMES_COMMIT=\([0-9a-f]\{40\}\).*/\1/p' "$BOOT")
[ -n "$pin" ] || { echo "build-image: no HERMES_COMMIT in phone/bootstrap.sh" >&2; exit 1; }
# hash of hermes/patches: the patch files' contents, in name order
patches_hash() { (cd "$here/hermes/patches" && for f in $(LC_ALL=C ls ./*.patch); do cat "$f"; done) | sha256 | cut -c1-12; }
image_name() { echo "hermes-debian-${pin:0:12}-arm64.tar.zst"; }

if [ "${1:-}" = --name ]; then image_name; exit 0; fi

if [ "${1:-}" = --inside ]; then
  # Inside the container (repo mounted read-only at /hm). Every command below is taken from bootstrap.sh.
  set -x
  export DEBIAN_FRONTEND=noninteractive HOME=/root
  cd /root
  deb() { bash -lc "PATH=\"\$HOME/.local/bin:\$PATH\"; $1"; }   # = bootstrap.sh's deb() for proot
  libs=$(sed -n 's/^CHROMIUM_LIBS="\(.*\)"$/\1/p' "$BOOT")
  apt_line=$(sed -n 's/^deb "\(export DEBIAN_FRONTEND=noninteractive; apt-get update .*\)"$/\1/p' "$BOOT")
  inst=$(sed -n 's/^ *hermes_install() { deb "\(curl [^"]*\)"; }.*/\1/p' "$BOOT")
  [ -n "$libs" ] && [ -n "$apt_line" ] && [ -n "$inst" ] || { echo "build-image: bootstrap.sh changed shape (CHROMIUM_LIBS / apt line / hermes_install not found)"; exit 1; }
  CHROMIUM_LIBS=$libs HERMES_COMMIT=$pin
  apt_line=$(eval "echo \"$apt_line\"")   # expands $CHROMIUM_LIBS like bootstrap.sh's double quotes do
  inst=$(eval "echo \"$inst\"")           # expands $HERMES_COMMIT
  # Debian step: bootstrap's profile file (the heredoc after `nopath <<'PROFILE'`), then its apt line.
  mkdir -p /etc/profile.d
  sed -n "/^nopath <<'PROFILE'$/,/^PROFILE$/p" "$BOOT" | sed '1d;$d' > /etc/profile.d/zz-no-termux-path.sh
  [ -s /etc/profile.d/zz-no-termux-path.sh ] || { echo "build-image: profile heredoc not found in bootstrap.sh"; exit 1; }
  deb "$apt_line"
  # Hermes step: the pin's own installer with --commit.
  deb "$inst"
  deb "hermes --version | grep Hermes"
  test -f /root/.hermes/hermes-agent/install-stamp.json
  [ "$(git -C /root/.hermes/hermes-agent rev-parse HEAD)" = "$pin" ] || { echo "build-image: Hermes HEAD is not the pin"; exit 1; }
  # Browser tools: required in the image (an optional package for Hermes's installer, which can end without them).
  # Hermes finds agent-browser in its own package store, not on PATH: ask Hermes (pm.installed_package), then open a page
  # the way its browser tools do (env_for("agent-browser") puts Chromium in reach).
  hpy=$(sed -n '1s/^#!\([^ ]*python[^ ]*\).*/\1/p' "$(readlink -f /root/.local/bin/hermes)")
  if [ ! -x "$hpy" ]; then   # the launcher is not a Python script: the venv Python that imports Hermes's pm
    for c in $(find /root/.hermes -maxdepth 5 -path '*/bin/python3' 2>/dev/null); do
      (cd /root/.hermes/hermes-agent && "$c" -c 'import pm, hermes_cli' 2>/dev/null) && { hpy=$c; break; }
    done
  fi
  [ -x "$hpy" ] || { echo "build-image: no Python with Hermes's pm found"; exit 1; }
  browser_ok() { (cd /root/.hermes/hermes-agent && "$hpy" -c 'import pm,sys; p=pm.installed_package("agent-browser"); print("agent-browser:", p and p.binary); sys.exit(0 if p and p.binary else 1)'); }
  browser_ok || { deb "hermes pm install agent-browser"; browser_ok; } || { echo "build-image: no agent-browser"; exit 1; }
  chrome=$(find /root/.hermes -path '*chromium*' -type f \( -name chrome -o -name headless_shell -o -name chrome-headless-shell \) | head -1)
  [ -n "$chrome" ] || { echo "build-image: no Chromium binary under /root/.hermes"; exit 1; }
  missing=$(ldd "$chrome" | grep 'not found' || true)
  [ -z "$missing" ] || { echo "build-image: Chromium misses libraries: $missing"; exit 1; }
  (cd /root/.hermes/hermes-agent && timeout -s KILL 240 "$hpy" - <<'PY') || { echo "build-image: the browser does not open a page"; exit 1; }
import os, subprocess, sys
import pm
from pm.install import env_for
b = str(pm.installed_package("agent-browser").binary)
env = env_for("agent-browser", base_env=dict(os.environ))
run = lambda *a: subprocess.run([b, *a], env=env, capture_output=True, text=True, timeout=180)
o = run("open", "https://example.com"); print("open:", o.returncode, o.stdout[-300:], o.stderr[-300:])
t = run("get", "title"); print("title:", t.stdout.strip())
run("close")
sys.exit(0 if "Example Domain" in t.stdout else 1)
PY
  # Plugin step's patch part (install.sh does the same; on the phone it then finds them "already in").
  mkdir -p /root/.hermes/hermes-mobile-patches /root/.hermes/scripts
  cp /hm/hermes/patches/*.patch /root/.hermes/hermes-mobile-patches/
  cp /hm/phone/hermes-patches.sh /root/.hermes/scripts/hermes-patches.sh
  deb "bash /root/.hermes/scripts/hermes-patches.sh apply /root/.hermes/hermes-mobile-patches"
  st=$(deb "bash /root/.hermes/scripts/hermes-patches.sh status /root/.hermes/hermes-mobile-patches")
  echo "$st"
  [ "$(echo "$st" | grep -c '^applied ')" = "$(ls /hm/hermes/patches/*.patch | wc -l)" ] || { echo "build-image: not every patch applied"; exit 1; }
  deb "hermes --version | head -1"
  exit 0
fi

out=${1:-$here/image-out}
for c in docker python3 zstd; do command -v "$c" >/dev/null || { echo "build-image: needs $c" >&2; exit 1; }; done
mkdir -p "$out"; out=$(cd "$out" && pwd)
name=$(image_name)
base=debian:trixie
cname="hm-image-build-$$"
tmp=$(mktemp -d)
# HM_KEEP=1: keep a failed build's container to look inside (docker start -ai / docker rm -f it afterwards)
trap '[ "${HM_KEEP:-}" = 1 ] || docker rm -f "$cname" >/dev/null 2>&1 || true; rm -rf "$tmp" "$out/$name.partial"' EXIT
t0=$(date +%s)
echo "== building $name (Hermes $pin)"
docker pull -q --platform linux/arm64 "$base"
docker run --platform linux/arm64 --name "$cname" -v "$here:/hm:ro" "$base" bash /hm/tools/build-image.sh --inside 2>&1 \
  | tee "$out/build.log" || true
[ "$(docker inspect -f '{{.State.ExitCode}}' "$cname")" = 0 ] || { echo "build-image: container build failed, see $out/build.log" >&2; exit 1; }
t1=$(date +%s)
# proot-distro's manifest: what the base image says (Env, Cmd), plus where this one comes from.
docker image inspect "$base" > "$tmp/inspect.json"
python3 - "$tmp/inspect.json" "$pin" "$(patches_hash)" > "$tmp/manifest.json" <<'PY'
import json, sys
i = json.load(open(sys.argv[1]))[0]
c = i.get('Config') or {}
print(json.dumps({
    'image_ref': 'debian:trixie', 'arch': 'aarch64',
    'image_config': {'config': {'Env': c.get('Env') or [], 'Entrypoint': [], 'Cmd': c.get('Cmd') or ['bash']},
                     'os': 'linux', 'architecture': 'arm64'},
    'hermes_mobile': {'hermes_commit': sys.argv[2], 'patches': sys.argv[3], 'base': (i.get('RepoDigests') or [''])[0]},
}, indent=2))
PY
echo "== packing (scrub + proot-distro layout + zstd -19 --long=27)"
docker export "$cname" | python3 "$here/tools/pack_image.py" pack --manifest "$tmp/manifest.json" \
  | zstd -q -19 --long=27 -T0 -o "$out/$name.partial"
docker rm -f "$cname" >/dev/null
echo "== checking the archive"
zstd -q -dc --long=27 "$out/$name.partial" | python3 "$here/tools/pack_image.py" check | tee "$tmp/check.txt"
mv "$out/$name.partial" "$out/$name"
sum=$(sha256 < "$out/$name")
echo "$sum  $name" > "$out/$name.sha256"
size=$(wc -c < "$out/$name" | tr -d ' ')
unpacked=$(sed -n 's/.*members, \([0-9]*\) bytes unpacked.*/\1/p' "$tmp/check.txt")
need=$(( (size + unpacked) / 1048576 + 1024 ))
echo "== done in $(( $(date +%s) - t0 ))s (container $(( t1 - t0 ))s)"
echo "file:     $out/$name"
echo "size:     $size bytes ($(( unpacked / 1048576 )) MB unpacked)"
echo "sha256:   $sum"
echo "free space a restore needs: $need MB (download + unpacked + 1 GB; bootstrap.sh's HERMES_IMAGE_MB must be >= this)"
echo "publish as release hermes-image-${pin:0:12}, assets $name and $name.sha256"
