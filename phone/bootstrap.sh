#!/data/data/com.termux/files/usr/bin/bash
# The whole phone side in one go, no questions asked: Termux packages, Debian, Hermes Agent, the Hermes Mobile plugin and
# the supervisor. Run it in TERMUX (not inside Debian). Made for a computer agent driving the phone over adb (see
# AGENT_INSTALL.md), works by hand too:
#   curl -fsSL https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/phone/bootstrap.sh -o hm.sh && bash hm.sh
# Rooted phone and you'd rather run Debian with chroot-distro (native speed) than proot-distro: HM_DISTRO=chroot bash hm.sh
# Then set the model (the key goes to Hermes's .env, never anywhere else):
#   bash hm.sh model <provider> <model> [ENV_NAME=key]     e.g.  bash hm.sh model openrouter openai/gpt-5 OPENROUTER_API_KEY=sk-...
# Progress goes to the screen AND to Android's log, so a computer can follow it:  adb logcat -s hmsetup
# The last line is "HMSETUP DONE" or "HMSETUP FAIL <step>". Safe to run again: finished steps are skipped or refreshed.
set -eE -o pipefail
# The Hermes this installs = the build the app and hermes/patches are tested against. Bump together with
# web/vendor/hermes-shared/.hermes-commit and .hermes-version (hermes/README.md; tools/test_bootstrap_pin.sh enforces it in CI).
HERMES_COMMIT=b8a8be185d6e88b35e0a4fa794fea64fb06ed85b
# A ready-made Debian with this Hermes in it (tools/build-image.sh; .github/workflows/image.yml publishes it as release
# hermes-image-<first 12 of HERMES_COMMIT>): a NEW install downloads it instead of installing Debian and running Hermes's
# installer here. Found by the pin alone; when there is none for this pin (404) the normal install runs. MB = free space
# the restore needs (download + unpacked + margin; build-image.sh prints the real number).
HERMES_IMAGE_BASE=https://github.com/omarqaterge/hermes-mobile-app/releases/download
HERMES_IMAGE_MB=5200
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
# Debian runs under proot-distro (no root needed) or chroot-distro (rooted phones, HM_DISTRO=chroot). The choice is kept in
# ~/.hermes-mobile/distro for install.sh, ~/bin/hermes-debian, the supervisor and the app.
mkdir -p "$HOME/.hermes-mobile"
HM_DISTRO=${HM_DISTRO:-$(cat "$HOME/.hermes-mobile/distro" 2>/dev/null || true)}  # "|| true": set -e
[ "$HM_DISTRO" = chroot ] || HM_DISTRO=proot
echo "$HM_DISTRO" > "$HOME/.hermes-mobile/distro"
ROOT="$PREFIX/var/lib/proot-distro/containers/debian/rootfs/root"
STEP=start
# HM_APP_TOKEN (set by the command the app copies): each line also goes to the app's setup flow, HermesService on
# 127.0.0.1:9121/setup (2 s timeout, never fails the install, the token is never printed). DONE also writes
# ~/.hermes-mobile/installed, which the app's probe reads as "the install finished" (every route).
say() {
  echo "== HMSETUP $*"; /system/bin/log -t hmsetup "HMSETUP $*" 2>/dev/null || true
  if [ "$*" = DONE ]; then : > "$HOME/.hermes-mobile/installed" 2>/dev/null || true; fi
  if [ -n "${HM_APP_TOKEN:-}" ]; then
    local l="$*"; l=${l//\\/\\\\}; l=${l//\"/\\\"}
    printf '{"token":"%s","line":"%s"}' "$HM_APP_TOKEN" "$l" | curl -s -m 2 -o /dev/null -X POST -H 'Content-Type: application/json' \
      --data-binary @- http://127.0.0.1:9121/setup 2>/dev/null || true
  fi
}
step() { STEP=$1; shift; say "STEP $STEP $*"; }
if [ "$HM_DISTRO" = chroot ]; then
  # chroot-distro 3.2 answers 0 for a failed command when stdin is a terminal: pass the exit code back in a file instead.
  deb() {
    local f rc; f=$(mktemp "$HOME/.hermes-mobile/rc.XXXXXX")   # Debian sees Termux's home at the same path
    chroot-distro login debian -- bash -lc "PATH=\"\$HOME/.local/bin:\$PATH\"; $1; echo \$? > $f"
    rc=$(cat "$f" 2>/dev/null); rm -f "$f"; return "${rc:-1}"
  }
else
  deb() { proot-distro login debian -- bash -lc "PATH=\"\$HOME/.local/bin:\$PATH\"; $1"; }
fi
trap 'say "FAIL $STEP (line $LINENO)"; termux-wake-unlock 2>/dev/null || true' ERR

if [ "${1:-}" = model ]; then
  [ $# -ge 3 ] || { echo "usage: bash $0 model <provider> <model> [ENV_NAME=key]"; exit 2; }
  STEP=model; prov=$2; model=$3; shift 3
  for kv in "$@"; do
    case "$kv" in [A-Z]*=?*) ;; *) say "FAIL model (expected ENV_NAME=value)"; exit 2 ;; esac
    deb "hermes config set '${kv%%=*}' '${kv#*=}' >/dev/null"   # quiet: the key is not echoed back
  done
  deb "hermes config set model.provider '$prov' && hermes config set model.default '$model'"
  # Restart a running dashboard so nothing keeps the old key (exact PIDs; the hermes-services loop starts it again).
  if [ -x "$HOME/bin/hermes-debian" ]; then
    pids=$(curl -fs -o /dev/null http://127.0.0.1:9119/ && echo running || true)   # chroot: root's processes are hidden from Termux
  else
    pids=$(pgrep -f "hermes dashboard --host 127.0.0.1 --port 9119" || true)
  fi
  if [ -n "$pids" ]; then
    if [ -x "$HOME/bin/hermes-debian" ]; then "$HOME/bin/hermes-debian" --restart; else kill -9 $pids 2>/dev/null || true; fi
    sleep 3
    for _ in $(seq 1 60); do curl -fs -o /dev/null http://127.0.0.1:9119/ && break; sleep 3; done
  fi
  say "MODEL SET $prov $model"
  exit 0
fi

# Bounded: held only while this script runs, released on success and on failure.
termux-wake-lock 2>/dev/null || true

step packages "Termux packages (a few minutes)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get -y -o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef upgrade
if [ "$HM_DISTRO" = chroot ]; then
  apt-get -y -o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef install python git curl termux-api unzip
  command -v chroot-distro >/dev/null || pip install chroot-distro
  step root "Root access for Termux (chroot-distro)"
  say "phone: if your root manager (Magisk, KernelSU…) asks whether Termux may have root, tap Grant"
  su -c id 2>/dev/null | grep -q 'uid=0' || { say "FAIL root (Termux has no root: grant it in your root manager, or run without HM_DISTRO=chroot)"; exit 1; }
else
  apt-get -y -o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef install proot-distro git curl termux-api unzip
fi

# Run from a clone: its own scripts (and plugin); otherwise the latest from GitHub.
src=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || src=""
RAW=https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main

# Phone access early (it is run again by install.sh): rish exists from here on, and the files / Shizuku prompts come while
# the user is still looking at the phone. Never fails; what is missing goes to ~/.hermes-mobile/todo.
step access "Access to the phone (files, Termux:API, Shizuku)"
if [ -n "$src" ] && [ -f "$src/phone-access.sh" ]; then
  bash "$src/phone-access.sh" || true
else
  curl -fsSL --retry 4 --retry-delay 15 "$RAW/phone/phone-access.sh" -o "$HOME/hm-phone-access.sh" && bash "$HOME/hm-phone-access.sh" || true
fi

# Android 12+ stops Termux ("signal 9") when it has many child processes, as a long install does. Shizuku's shell lifts
# the limit, like the computer route does over adb. Keep these three commands identical to tools/setup-phone.sh (and .ps1).
step android "Android child-process limit"
sdk=$(getprop ro.build.version.sdk 2>/dev/null || echo 0)
if [ -n "${HM_NO_APK:-}" ]; then
  # HM_NO_APK=1 = run by a computer route (tools/setup-phone.sh / .ps1), which already did this over adb.
  say "android: child-process limit already lifted by the computer"
elif [ "${sdk:-0}" -ge 31 ]; then
  # (output into a variable: with pipefail, `... | grep -q` fails when grep exits first and rish dies of SIGPIPE)
  shizuku_id=""; [ -x "$HOME/bin/rish" ] && shizuku_id=$(timeout 20 "$HOME/bin/rish" -c id </dev/null 2>/dev/null || true)
  if [ "${shizuku_id#*uid=2000}" != "$shizuku_id" ]; then
    "$HOME/bin/rish" -c 'device_config set_sync_disabled_for_tests persistent; device_config put activity_manager max_phantom_processes 2147483647; settings put global settings_enable_monitor_phantom_procs false' </dev/null >/dev/null 2>&1 || true
    say "android: child-process limit lifted (via Shizuku)"
  else
    say "phone: Android may stop this install (\"signal 9\"). To prevent it: Developer options → Disable child process restrictions (Android 14+). Then carry on."
  fi
fi

# --- ready-made image (keep this block together) ------------------------------------------------------------------
# The ready-made Debian + Hermes for this pin, for a NEW Debian only: existing installs never download it. Any problem
# (no image for this pin, HM_IMAGE=0, not arm64, too little space, download, sha256, restore) logs one line, removes what
# it left behind and returns 1: the normal install then runs. Tests: HM_IMAGE_URL = another image (its sha256 is read
# from HM_IMAGE_URL.sha256), tools/test_bootstrap_image.sh.
image_restore() {
  local name="hermes-debian-${HERMES_COMMIT:0:12}-arm64.tar.zst" url sum got free img="$HOME/hm-debian-image.tar.zst"
  url=${HM_IMAGE_URL:-$HERMES_IMAGE_BASE/hermes-image-${HERMES_COMMIT:0:12}/$name}
  [ "${HM_IMAGE:-1}" != 0 ] || { say "image: HM_IMAGE=0, installing Debian normally"; return 1; }
  if [ "$HM_DISTRO" = chroot ]; then
    say "image: not used with chroot-distro yet, installing Debian normally"; return 1
  fi
  [ "$(uname -m)" = aarch64 ] || { say "image: only for arm64 phones, installing Debian normally"; return 1; }
  # The .sha256 next to the image: a small download that also tells whether an image exists for this pin.
  sum=$(curl -fsSL --retry 2 "$url.sha256" 2>/dev/null | head -1 | cut -c1-64 || true)
  case "$sum" in
    *[!0-9a-f]* | "") say "image: none for this Hermes ($url), installing Debian normally"; return 1 ;;
  esac
  [ ${#sum} = 64 ] || { say "image: bad sha256 file, installing Debian normally"; return 1; }
  free=$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2 {print int($4/1024)}' || true)
  [ "${free:-0}" -ge "${HM_IMAGE_MB:-$HERMES_IMAGE_MB}" ] || {
    say "image: ${free:-?} MB free, it needs ${HM_IMAGE_MB:-$HERMES_IMAGE_MB} MB; installing Debian normally"; return 1; }
  say "image: downloading the ready-made Debian + Hermes (about 900 MB)"
  rm -f "$img"
  if ! curl -fL --retry 3 --retry-delay 5 -o "$img" "$url"; then
    rm -f "$img"; say "image: download failed, installing Debian normally"; return 1
  fi
  got=$(sha256sum "$img" 2>/dev/null | cut -c1-64 || true)
  if [ "$got" != "$sum" ]; then
    rm -f "$img"; say "image: sha256 does not match, installing Debian normally"; return 1
  fi
  say "image: unpacking (a few minutes)"
  if ! proot-distro restore "$img" </dev/null || [ ! -f "$ROOT/.hermes/hermes-agent/install-stamp.json" ]; then
    rm -f "$img"; say "image: unpacking failed, installing Debian normally"
    proot-distro remove debian </dev/null >/dev/null 2>&1 || true
    # a restore that stopped early may leave a rootfs without a manifest, which `remove` doesn't know
    local c="$PREFIX/var/lib/proot-distro/containers/debian"
    [ ! -e "$c" ] || { chmod -R u+rwX "$c" 2>/dev/null; rm -rf "$c"; } || true
    return 1
  fi
  rm -f "$img"
  # The image has the patches of its build; install.sh applies this installer's own set, so take the image's out first.
  deb "bash /root/.hermes/scripts/hermes-patches.sh revert /root/.hermes/hermes-mobile-patches" >/dev/null 2>&1 || true
  say "image: using the ready-made Debian + Hermes (Debian and Hermes install steps skipped)"
}
# --- end of ready-made image -----------------------------------------------------------------------------------------

step debian "Debian inside Termux (a few minutes)"
if [ "$HM_DISTRO" = chroot ]; then
  chroot-distro login debian -- true </dev/null >/dev/null 2>&1 || image_restore || chroot-distro install --name debian debian:trixie
else
  [ -d "$ROOT" ] || image_restore || proot-distro install debian
fi
# proot-distro appends Termux's bin dirs to PATH inside Debian. Termux's binaries are Android builds (its python3.14 made
# Hermes's installer build for "linux-android" and fail), so Debian's login shells drop them.
# "zz-": it must run after proot-distro's own termux-profile.sh, which appends them.
if [ "$HM_DISTRO" = chroot ]; then  # Debian's files belong to root: write it from inside
  nopath() {
    cat > "$HOME/.hermes-mobile/zz-no-termux-path.sh"
    chroot-distro login debian -- cp "$HOME/.hermes-mobile/zz-no-termux-path.sh" /etc/profile.d/ </dev/null
    rm -f "$HOME/.hermes-mobile/zz-no-termux-path.sh"
  }
else
  nopath() { mkdir -p "$ROOT/../etc/profile.d" && cat > "$ROOT/../etc/profile.d/zz-no-termux-path.sh"; }
fi
nopath <<'PROFILE'
# proot-distro appends Termux bin dirs to PATH; Termux binaries are Android/bionic
# builds (e.g. its python3.14) and must never be picked up inside Debian.
PATH=$(printf %s "$PATH" | tr : "\n" | grep -v "^/data/data/com.termux" | paste -sd: -)
export PATH
PROFILE
# CHROMIUM_LIBS: the shared libraries Hermes's browser (Chromium, downloaded by its installer) needs to start; minimal Debian
# has none of them and neither installer adds them (without them: "libglib-2.0.so.0: cannot open shared object file").
CHROMIUM_LIBS="libglib2.0-0t64 libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libcups2t64 libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64"
deb "export DEBIAN_FRONTEND=noninteractive; apt-get update -y && apt-get install -y curl git ca-certificates xz-utils procps libatomic1 && apt-get install -y --no-install-recommends $CHROMIUM_LIBS"

step hermes "Hermes Agent (10-30 minutes on a phone)"
# libatomic1 (above): the glibc Node.js Hermes downloads links it, minimal Debian lacks it, and the pinned build's installer
# (unlike the hosted one) does not install it.
# install-stamp.json is written only when Hermes's installer finished; a crashed install can still leave a working `hermes`.
# An interrupted install can leave EMPTY launchers in ~/.local/bin: they "run" fine (exit 0, no output) and Hermes's
# installer never replaces files it doesn't recognise as its own. Drop them so the installer writes real ones.
deb 'find /root/.local/bin -maxdepth 1 -name "hermes*" -type f -size 0 -delete 2>/dev/null; true'
if deb "hermes --version 2>/dev/null | grep -q Hermes && test -f /root/.hermes/hermes-agent/install-stamp.json"; then
  say "hermes already installed, skipping"
else
  # The pin's own installer script (not the hosted one), so the install is reproducible: the hosted one changes over time.
  # Downloaded to a file first: piped into bash, a failed download (GitHub answers 429 when busy) ran an empty script and
  # "succeeded". --retry also covers 429/5xx.
  hermes_install() { deb "curl -fsSL --retry 4 --retry-delay 15 -o /root/hermes-install.sh https://raw.githubusercontent.com/NousResearch/hermes-agent/$HERMES_COMMIT/scripts/install.sh && bash /root/hermes-install.sh --non-interactive --commit $HERMES_COMMIT"; }  # hex only: no quotes (deb() wraps this in bash -lc "...")
  if ! hermes_install; then
    # Under proot, uv's freshly downloaded Python reports its real Android path as sys.prefix, so
    # `uv python find --managed-python` rejects it and Hermes's installer stops ("bootstrap Python lookup failed").
    # Its fallback looks on PATH, so put that Python there and try once more.
    say "retrying with uv's Python on PATH (proot workaround)"
    deb 'p=$(ls -d /root/.local/share/uv/python/cpython-3.*-gnu/bin/python3.[0-9]* 2>/dev/null | grep -v config | sort -V | tail -1); [ -n "$p" ] && ln -sf "$p" /usr/local/bin/'
    hermes_install
  fi
fi
deb "hermes --version | grep Hermes"
# The browser tools are an optional package for Hermes's installer: a failed Chromium download (a CDN outage did this)
# still ends without an error and without a browser. Try once more here; never fail the setup over it.
# Hermes keeps agent-browser in its own package store (~/.hermes/tools/agent-browser-<version>-<target>/bin), not on PATH.
has_browser='ls /root/.hermes/tools/agent-browser-*/bin/agent-browser-* >/dev/null 2>&1 || command -v agent-browser >/dev/null'
if ! deb "$has_browser"; then
  say "browser tools missing, installing them again"
  deb "hermes pm install agent-browser" || true
  deb "$has_browser" || say "TODO browser: Hermes has no web browser yet. Run the installer again later (bash hm.sh)"
fi

step plugin "Hermes Mobile plugin, supervisor, and access to the phone (files, Termux:API, Shizuku; no root needed)"
if [ -n "$src" ] && [ -f "$src/install.sh" ] && [ -d "$src/../hermes-plugin/hermes-mobile" ]; then
  HM_NO_APK=1 bash "$src/install.sh"
else
  curl -fsSL --retry 4 --retry-delay 15 "$RAW/phone/install.sh" -o "$HOME/hm-install.sh"
  HM_NO_APK=1 bash "$HOME/hm-install.sh"
fi
# Termux:Boot (if installed) starts Hermes after a reboot.
mkdir -p "$HOME/.termux/boot"
printf '#!/data/data/com.termux/files/usr/bin/bash\n~/bin/hermes-services\n' > "$HOME/.termux/boot/10-hermes"
chmod +x "$HOME/.termux/boot/10-hermes"

step start "Starting Hermes (first start can take a minute or two)"
"$HOME/bin/hermes-services"
for _ in $(seq 1 90); do
  curl -fs -o /dev/null http://127.0.0.1:9119/ && break
  sleep 4
done
curl -fs -o /dev/null http://127.0.0.1:9119/ || { say "FAIL start (dashboard not answering on 127.0.0.1:9119, see ~/logs/dashboard.log)"; termux-wake-unlock 2>/dev/null || true; exit 1; }

termux-wake-unlock 2>/dev/null || true
# Hermes's access to the phone (phone/phone-access.sh, run by install.sh): what is still missing. Hermes runs without it, but
# can't reach that part of the phone until it's done. The app's Setup check lists the same.
while IFS= read -r t; do [ -n "$t" ] && say "TODO $t"; done < "$HOME/.hermes-mobile/todo" 2>/dev/null || true
# The app: open Android's installer (the computer routes install it over adb and pass HM_NO_APK=1; on the app route,
# HM_APP_TOKEN, the app is already installed and running this). Never fails the setup.
if [ -z "${HM_NO_APK:-}${HM_APP_TOKEN:-}" ]; then
  apk="$HOME/hermes-mobile.apk"
  if curl -fsL -o "$apk" "https://github.com/omarqaterge/hermes-mobile-app/releases/latest/download/hermes-mobile.apk"; then
    say "phone: tap Install (if Android asks which app to use, pick Package installer; allow Termux to install apps if asked), then open Hermes Mobile"
    termux-open --content-type application/vnd.android.package-archive "$apk" 2>/dev/null || say "TODO app: open $apk (termux-open $apk) to install Hermes Mobile"
  else
    rm -f "$apk"
    say "TODO app: download hermes-mobile.apk from the latest release (github.com/omarqaterge/hermes-mobile-app/releases)"
  fi
fi
say "DONE"
