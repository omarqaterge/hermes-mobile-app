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
  # Restart a running dashboard so nothing keeps the old key (exact PIDs; the hermes-services loop starts it again).
  pids=$(pgrep -f "hermes dashboard --host 127.0.0.1 --port 9119" || true)
  if [ -n "$pids" ]; then
    kill -9 $pids 2>/dev/null || true
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
apt-get -y -o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef install proot-distro git curl termux-api unzip

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

# Before the plugin step: that one restarts a running dashboard, and only a Hermes started after the storage permission
# was granted sees /sdcard.
step phone "Phone access for Hermes: files, Termux:API, Shizuku (no root needed)"
TODO=()
storage_ok() { ls /storage/emulated/0/ >/dev/null 2>&1; }
if ! storage_ok; then
  say "Tap Allow on Android's prompt: Hermes reads and saves your files through Termux"
  echo y | termux-setup-storage >/dev/null 2>&1 || true   # "y": it asks before rebuilding an existing ~/storage
  for _ in $(seq 1 60); do storage_ok && break; sleep 2; done
fi
storage_ok || TODO+=("files: allow Termux to access files (Settings → Apps → Termux → Permissions), then run bash hm.sh again")
# termux-* commands (battery, location, clipboard, notifications, SMS…) inside Debian. Debian's PATH drops Termux's bin
# dirs (above), so link just these into /usr/local/bin. Re-linked on every run: new termux-api versions add commands.
for f in "$PREFIX"/bin/termux-*; do ln -sf "$f" "$ROOT/../usr/local/bin/"; done
timeout 20 termux-battery-status 2>/dev/null | grep -q percentage \
  || TODO+=("Termux:API: install the Termux:API app from F-Droid (https://f-droid.org/packages/com.termux.api/)")
# Shizuku's rish: an adb-level shell (screen, taps, apps, logs) for Hermes without root. Both files come from Shizuku's
# own release APK; "PKG" is the placeholder Shizuku fills in when you export them from its app.
SHIZUKU_APK="https://github.com/RikkaApps/Shizuku/releases/download/v13.6.0/shizuku-v13.6.0.r1086.2650830c-release.apk"
if [ ! -s "$HOME/bin/rish_shizuku.dex" ] || ! grep -q '"com.termux"' "$HOME/bin/rish" 2>/dev/null; then
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/shizuku.apk" "$SHIZUKU_APK"
  unzip -qo "$tmp/shizuku.apk" assets/rish assets/rish_shizuku.dex -d "$tmp"
  mkdir -p "$HOME/bin"
  sed 's/"PKG"/"com.termux"/' "$tmp/assets/rish" > "$HOME/bin/rish" && chmod 700 "$HOME/bin/rish"
  rm -f "$HOME/bin/rish_shizuku.dex" && cp "$tmp/assets/rish_shizuku.dex" "$HOME/bin/" && chmod 400 "$HOME/bin/rish_shizuku.dex"  # Android 14+ refuses a writable dex
  rm -rf "$tmp"
fi
# The first call makes Shizuku ask whether Termux may use it. A Shizuku app frozen in the background can miss the first
# request ("Request timeout"), so try a few times.
shizuku_ok=""
for _ in 1 2 3; do
  timeout 60 "$HOME/bin/rish" -c id 2>/dev/null | grep -q 'uid=2000' && { shizuku_ok=1; break; }
  sleep 3
done
if [ -n "$shizuku_ok" ]; then
  # Lets Shizuku start itself after a reboot (Android 13+, without root, once it was started via Wireless debugging).
  "$HOME/bin/rish" -c 'pm grant moe.shizuku.privileged.api android.permission.WRITE_SECURE_SETTINGS' >/dev/null 2>&1 || true
else
  TODO+=("Shizuku: install it (https://shizuku.rikka.app/download/), start it (no root: Wireless debugging, pair once, Start; rooted: Start), allow Termux when it asks, then run bash hm.sh again")
fi

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
# Hermes works without these, but can't reach that part of the phone until they're done. The app's Setup check lists them too.
for t in "${TODO[@]}"; do say "TODO $t"; done
say "DONE"
