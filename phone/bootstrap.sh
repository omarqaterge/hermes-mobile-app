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
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
# Debian runs under proot-distro (no root needed) or chroot-distro (rooted phones, HM_DISTRO=chroot). The choice is kept in
# ~/.hermes-mobile/distro for install.sh, ~/bin/hermes-debian, the supervisor and the app.
mkdir -p "$HOME/.hermes-mobile"
HM_DISTRO=${HM_DISTRO:-$(cat "$HOME/.hermes-mobile/distro" 2>/dev/null || true)}  # "|| true": set -e
[ "$HM_DISTRO" = chroot ] || HM_DISTRO=proot
echo "$HM_DISTRO" > "$HOME/.hermes-mobile/distro"
ROOT="$PREFIX/var/lib/proot-distro/containers/debian/rootfs/root"
STEP=start
say() { echo "== HMSETUP $*"; /system/bin/log -t hmsetup "HMSETUP $*" 2>/dev/null || true; }
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

step debian "Debian inside Termux (a few minutes)"
if [ "$HM_DISTRO" = chroot ]; then
  chroot-distro login debian -- true </dev/null >/dev/null 2>&1 || chroot-distro install --name debian debian:trixie
else
  [ -d "$ROOT" ] || proot-distro install debian
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
deb "export DEBIAN_FRONTEND=noninteractive; apt-get update -y && apt-get install -y curl git ca-certificates xz-utils procps"

step hermes "Hermes Agent (10-30 minutes on a phone)"
# install-stamp.json is written only when Hermes's installer finished; a crashed install can still leave a working `hermes`.
# An interrupted install can leave EMPTY launchers in ~/.local/bin: they "run" fine (exit 0, no output) and Hermes's
# installer never replaces files it doesn't recognise as its own. Drop them so the installer writes real ones.
deb 'find /root/.local/bin -maxdepth 1 -name "hermes*" -type f -size 0 -delete 2>/dev/null; true'
if deb "hermes --version 2>/dev/null | grep -q Hermes && test -f /root/.hermes/hermes-agent/install-stamp.json"; then
  say "hermes already installed, skipping"
else
  hermes_install() { deb "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive"; }
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

step plugin "Hermes Mobile plugin, supervisor, and access to the phone (files, Termux:API, Shizuku; no root needed)"
# Run from a clone: its own install.sh (and plugin); otherwise the latest from GitHub.
src=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
if [ -n "$src" ] && [ -f "$src/install.sh" ] && [ -d "$src/../hermes-plugin/hermes-mobile" ]; then
  HM_NO_APK=1 bash "$src/install.sh"
else
  curl -fsSL https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/phone/install.sh -o "$HOME/hm-install.sh"
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
say "DONE"
