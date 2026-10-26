#!/data/data/com.termux/files/usr/bin/bash
# One-step phone setup. Run it in TERMUX (not inside Debian):
#   curl -fsSL https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/phone/install.sh | bash
# or, from a clone:  bash ~/hermes-mobile/phone/install.sh
# It lets the app start Hermes, installs the Hermes Mobile plugin into Debian and the supervisor script into ~/bin, gives
# Hermes access to the phone (phone/phone-access.sh: files, Termux:API, Shizuku; no root needed), then downloads the app
# and opens Android's installer. Safe to run again (it just refreshes everything).
set -e
REPO="https://github.com/omarqaterge/hermes-mobile-app"
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
die() { echo "ERROR: $*" >&2; exit 1; }

# Debian runs under proot-distro (no root needed) or, on a rooted phone, chroot-distro. HM_DISTRO=chroot picks chroot-distro;
# without it a chroot-distro Debian is used only when there is no proot-distro one. Remembered in ~/.hermes-mobile/distro.
mkdir -p "$HOME/.hermes-mobile"
HM_DISTRO=${HM_DISTRO:-$(cat "$HOME/.hermes-mobile/distro" 2>/dev/null || true)}  # "|| true": set -e
if [ -z "$HM_DISTRO" ] && [ ! -d "$PREFIX/var/lib/proot-distro/containers/debian/rootfs" ] && command -v chroot-distro >/dev/null; then
  HM_DISTRO=chroot
fi
[ "$HM_DISTRO" = chroot ] || HM_DISTRO=proot
echo "$HM_DISTRO" > "$HOME/.hermes-mobile/distro"

# Run from a clone, or (piped through curl) clone/update ~/hermes-mobile first.
here=""
[ -f "${BASH_SOURCE[0]:-}" ] && here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -z "$here" ] || [ ! -d "$here/hermes-plugin/hermes-mobile" ]; then
  echo "0/5 Getting Hermes Mobile into ~/hermes-mobile"
  command -v git >/dev/null || pkg install -y git
  if [ -d "$HOME/hermes-mobile/.git" ]; then git -C "$HOME/hermes-mobile" pull -q --ff-only
  else git clone -q --depth 1 "$REPO.git" "$HOME/hermes-mobile"; fi
  here="$HOME/hermes-mobile"
fi

echo "1/5 Letting the app start Hermes (allow-external-apps)"
mkdir -p "$HOME/.termux"
grep -qE '^[[:space:]]*allow-external-apps[[:space:]]*=[[:space:]]*true' "$HOME/.termux/termux.properties" 2>/dev/null \
  || echo "allow-external-apps = true" >> "$HOME/.termux/termux.properties"
command -v termux-reload-settings >/dev/null && termux-reload-settings || true

echo "2/5 Installing the supervisor scripts (~/bin/hermes-services, ~/bin/hermes-debian, ~/bin/hm-shizuku)"
mkdir -p "$HOME/bin"
cp "$here/phone/hermes-services" "$HOME/bin/hermes-services"
cp "$here/phone/hermes-debian" "$HOME/bin/hermes-debian"
# hm-shizuku: lets Shizuku start again by itself after a restart (Termux's own adb; phone-access.sh pairs it).
cp "$here/phone/hm-shizuku" "$HOME/bin/hm-shizuku"
chmod +x "$HOME/bin/hermes-services" "$HOME/bin/hermes-debian" "$HOME/bin/hm-shizuku"
DEB="$HOME/bin/hermes-debian"
if [ "$HM_DISTRO" = chroot ]; then
  "$DEB" true || die "Debian is not installed with chroot-distro yet (or Termux has no root). Run: chroot-distro install --name debian debian:trixie"
else
  [ -d "$PREFIX/var/lib/proot-distro/containers/debian/rootfs/root" ] \
    || die "Debian is not installed in Termux yet. Run: pkg install -y proot-distro && proot-distro install debian"
fi
"$DEB" --exists /root/.hermes || die "Hermes is not set up in Debian yet. Install Hermes Agent and run 'hermes setup' first (see the README)."

echo "3/5 Installing the Hermes Mobile plugin"
find "$here/hermes-plugin/hermes-mobile" -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
"$DEB" --put "$here/hermes-plugin/hermes-mobile" /root/.hermes/plugins/hermes-mobile
"$DEB" --put "$here/phone/cron_ticker.py" /root/.hermes/scripts/cron_ticker.py
# Every Hermes profile has its own plugins folder. Link ours into each one, so a profile (also one made the active
# profile with `hermes profile use`, which `hermes` and the dashboard then run in) loads the same, current plugin.
# Replaces an old copy there: it would never be updated.
"$DEB" sh -c 'for p in /root/.hermes/profiles/*/; do [ -d "$p" ] || continue; mkdir -p "${p}plugins"
  rm -rf "${p}plugins/hermes-mobile" && ln -s /root/.hermes/plugins/hermes-mobile "${p}plugins/hermes-mobile"; done' \
  || echo "    Could not add the plugin to every Hermes profile."

# Our fixes to Hermes itself (hermes/README.md). One that no longer fits this Hermes is skipped, never half-applied.
echo "    Applying the Hermes Mobile fixes to Hermes (hermes/patches)"
"$DEB" --put "$here/hermes/patches" /root/.hermes/hermes-mobile-patches
"$DEB" --put "$here/phone/hermes-patches.sh" /root/.hermes/scripts/hermes-patches.sh
"$DEB" bash -lc 'bash /root/.hermes/scripts/hermes-patches.sh apply /root/.hermes/hermes-mobile-patches' \
  || echo "    Some fixes did not fit this Hermes version and were skipped; Hermes runs unchanged there."

# Before the restart below: only a Hermes started after Termux got the files permission sees /sdcard.
echo "    Giving Hermes access to the phone: files, Termux:API, Shizuku (no root needed)"
bash "$here/phone/phone-access.sh"
show_todo() {
  [ -s "$HOME/.hermes-mobile/todo" ] || return 0
  echo; echo "Hermes can't reach all of the phone yet. Still to do:"
  sed 's/^/  - /' "$HOME/.hermes-mobile/todo"
}

echo "4/5 Enabling the plugin in Hermes"
enable_in() {  # $1 = "" (the profile `hermes` runs in) or "-p default"
  "$DEB" bash -lc "PATH=\"\$HOME/.local/bin:\$PATH\" hermes $1 plugins enable hermes-mobile" && return 0
  echo "Could not enable it automatically. Run inside Debian:  hermes $1 plugins enable hermes-mobile" | tr -s ' '
}
enable_in ""
# After `hermes profile use <name>` the command above went to that profile; the app starts in the main one.
active=$("$DEB" sh -c 'cat /root/.hermes/active_profile 2>/dev/null' </dev/null || true)
if [ -n "$active" ] && [ "$active" != default ]; then
  echo "    Hermes's active profile is \"$active\": enabling the plugin for the main profile too"
  enable_in "-p default"
fi
# A running Hermes still has the old plugin and Hermes files loaded: restart its dashboard (exact PIDs; the
# hermes-services loop starts it again). Nothing runs yet on a first install.
echo "    Restarting Hermes (if it runs) so the changes load"
"$DEB" --restart

# Hermes' google-workspace skill (Gmail/Calendar/Drive) is often run with Debian's system python3, which lacks these.
echo "    Adding the Google client libraries for Hermes' Google skill (optional)"
"$DEB" bash -lc 'apt-get install -y python3-googleapi python3-google-auth-oauthlib python3-google-auth-httplib2' >/dev/null 2>&1 \
  || echo "    Skipped (not needed unless you use Hermes with Google Calendar/Gmail)."

if [ -n "${HM_NO_APK:-}" ]; then echo "Done (app download skipped: HM_NO_APK is set)."; exit 0; fi   # bootstrap.sh lists the to-dos itself
show_todo
echo "5/5 Downloading the app"
apk="$HOME/hermes-mobile.apk"
if curl -fsL -o "$apk" "$REPO/releases/latest/download/hermes-mobile.apk"; then
  echo
  echo "Done. Android's installer opens now: tap Install (allow Termux to install apps if it asks)."
  echo "If nothing opens, run:  termux-open $apk"
  termux-open "$apk" 2>/dev/null || true
else
  rm -f "$apk"
  echo
  echo "Done with the phone side, but no ready-made app was found to download."
  echo "Build it on a computer instead: see 'Build the app yourself' in the README."
fi
echo "Then open Hermes Mobile and allow the permissions it asks for."
