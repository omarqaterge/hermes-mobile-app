#!/data/data/com.termux/files/usr/bin/bash
# The whole phone side in one go, no questions asked: Termux packages, Debian, Hermes Agent, the Hermes Mobile plugin and
# the supervisor. Run it in TERMUX (not inside Debian). Made for a computer agent driving the phone over adb (see
# AGENT_INSTALL.md), works by hand too:
#   curl -fsSL https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/phone/bootstrap.sh -o hm.sh && bash hm.sh
# Then set the model (the key goes to Hermes's .env, never anywhere else):
#   bash hm.sh model <provider> <model> [ENV_NAME=key]     e.g.  bash hm.sh model openrouter openai/gpt-5 OPENROUTER_API_KEY=sk-...
# Progress goes to the screen AND to Android's log, so a computer can follow it:  adb logcat -s hmsetup
# The last line is "HMSETUP DONE" or "HMSETUP FAIL <step>". Safe to run again: finished steps are skipped or refreshed.
set -eE -o pipefail
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
ROOT="$PREFIX/var/lib/proot-distro/containers/debian/rootfs/root"
STEP=start
say() { echo "== HMSETUP $*"; /system/bin/log -t hmsetup "HMSETUP $*" 2>/dev/null || true; }
step() { STEP=$1; shift; say "STEP $STEP $*"; }
deb() { proot-distro login debian -- bash -lc "PATH=\"\$HOME/.local/bin:\$PATH\"; $1"; }
trap 'say "FAIL $STEP (line $LINENO)"; termux-wake-unlock 2>/dev/null || true' ERR

if [ "${1:-}" = model ]; then
  [ $# -ge 3 ] || { echo "usage: bash $0 model <provider> <model> [ENV_NAME=key]"; exit 2; }
  STEP=model; prov=$2; model=$3; shift 3
  for kv in "$@"; do
    case "$kv" in [A-Z]*=?*) ;; *) say "FAIL model (expected ENV_NAME=value)"; exit 2 ;; esac
    deb "hermes config set '${kv%%=*}' '${kv#*=}' >/dev/null"   # quiet: the key is not echoed back
  done
  deb "hermes config set model.provider '$prov' && hermes config set model.default '$model'"
  say "MODEL SET $prov $model"
  exit 0
fi

# Bounded: held only while this script runs, released on success and on failure.
termux-wake-lock 2>/dev/null || true

step packages "Termux packages (a few minutes)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get -y -o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef upgrade
apt-get -y -o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef install proot-distro git curl

step debian "Debian inside Termux (a few minutes)"
[ -d "$ROOT" ] || proot-distro install debian
# proot-distro appends Termux's bin dirs to PATH inside Debian. Termux's binaries are Android builds (its python3.14 made
# Hermes's installer build for "linux-android" and fail), so Debian's login shells drop them.
# "zz-": it must run after proot-distro's own termux-profile.sh, which appends them.
mkdir -p "$ROOT/../etc/profile.d"
cat > "$ROOT/../etc/profile.d/zz-no-termux-path.sh" <<'PROFILE'
# proot-distro appends Termux bin dirs to PATH; Termux binaries are Android/bionic
# builds (e.g. its python3.14) and must never be picked up inside Debian.
PATH=$(printf %s "$PATH" | tr : "\n" | grep -v "^/data/data/com.termux" | paste -sd: -)
export PATH
PROFILE
deb "export DEBIAN_FRONTEND=noninteractive; apt-get update -y && apt-get install -y curl git ca-certificates xz-utils procps"

step hermes "Hermes Agent (10-30 minutes on a phone)"
if deb "hermes --version >/dev/null 2>&1"; then
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
deb "hermes --version"

step plugin "Hermes Mobile plugin and supervisor"
curl -fsSL https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/phone/install.sh -o "$HOME/hm-install.sh"
HM_NO_APK=1 bash "$HOME/hm-install.sh"
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
say "DONE"
