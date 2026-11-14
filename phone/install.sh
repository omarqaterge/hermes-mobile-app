#!/data/data/com.termux/files/usr/bin/bash
# One-step phone setup. Run it in TERMUX (not inside Debian):
#   curl -fsSL https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/phone/install.sh | bash
# or, from a clone:  bash ~/hermes-mobile/phone/install.sh
# It lets the app start Hermes, installs the Hermux plugin into Debian and the supervisor script into ~/bin, gives
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

# Run from a clone (used as it is), or (piped through curl, or bootstrap.sh's downloaded copy) put the latest release
# into ~/hermes-mobile first and run that release's own installer. The latest release, not main: the plugin and scripts
# installed here must match the app the phone downloads (the latest release, 5/5). main can be ahead of it, and a
# plugin from main once withheld the dashboard's token from the released app, which then never got online.
# HM_REF picks another branch or tag (HM_REF=main for a developer).
latest_release() {  # the tag of the latest release, from the address GitHub's releases/latest page redirects to
  curl -fsIL --retry 3 -o /dev/null -w '%{url_effective}' "$REPO/releases/latest" 2>/dev/null \
    | sed -n 's#^.*/releases/tag/\([A-Za-z0-9._-]*\)$#\1#p'
}
here=""
[ -f "${BASH_SOURCE[0]:-}" ] && here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -z "$here" ] || [ ! -d "$here/hermes-plugin/hermes-mobile" ]; then
  echo "0/5 Getting Hermux into ~/hermes-mobile"
  command -v git >/dev/null || pkg install -y git
  ref=${HM_REF:-$(latest_release)}
  [ -n "$ref" ] || die "Could not find Hermux's latest release on GitHub (no network?). Run this installer again."
  c="$HOME/hermes-mobile"
  if [ ! -d "$c/.git" ]; then
    [ ! -e "$c" ] || [ -z "$(ls -A "$c" 2>/dev/null)" ] || die "$c exists but is not a copy of Hermux: move it away, then run this installer again."
    git init -q "$c" && git -C "$c" remote add origin "$REPO.git" || die "Could not create $c (is there free space?)."
  fi
  git -C "$c" fetch -q --depth 1 origin "$ref" || die "Could not download Hermux $ref into $c (no network?). Run this installer again."
  new=$(git -C "$c" rev-parse "FETCH_HEAD^{commit}")  # a release tag is annotated: its commit, not the tag
  old=$(git -C "$c" rev-parse -q --verify HEAD 2>/dev/null || true)
  if [ "$old" != "$new" ]; then
    # Whatever was there (an older copy, one from before the history was rewritten, or one edited by hand) stays on
    # the branch hm-before-update, and uncommitted edits in git's stash: nothing is lost.
    if [ -n "$old" ]; then
      [ -z "$(git -C "$c" status --porcelain 2>/dev/null)" ] || git -C "$c" -c user.name=Hermux -c user.email=hermux@localhost.invalid stash push -q -u -m "before Hermux $ref" 2>/dev/null || true
      git -C "$c" branch -f hm-before-update HEAD 2>/dev/null || true
    fi
    git -C "$c" -c advice.detachedHead=false checkout -q -f --detach "$new" || die "Could not switch $c to Hermux $ref. Run this installer again."
  fi
  echo "   Hermux $ref"
  # That release's own installer: it knows its own files. It finds the plugin beside it, so it doesn't come back here.
  [ -f "$c/phone/install.sh" ] && [ -d "$c/hermes-plugin/hermes-mobile" ] || die "$c has no Hermux installer in it."
  exec bash "$c/phone/install.sh"
fi

echo "1/5 Letting the app start Hermux (allow-external-apps)"
mkdir -p "$HOME/.termux"
grep -qE '^[[:space:]]*allow-external-apps[[:space:]]*=[[:space:]]*true' "$HOME/.termux/termux.properties" 2>/dev/null \
  || echo "allow-external-apps = true" >> "$HOME/.termux/termux.properties"
command -v termux-reload-settings >/dev/null && termux-reload-settings || true

echo "2/5 Installing the supervisor scripts (~/bin/hermes-services, ~/bin/hermes-debian, ~/bin/hm-shizuku, ~/bin/hm-local)"
mkdir -p "$HOME/bin"
cp "$here/phone/hermes-services" "$HOME/bin/hermes-services"
rm -f "$HOME/.hermes-mobile/services.sha"  # this copy is the installer's: the app's plugin update may replace it (plugin-update.sh)
cp "$here/phone/hermes-debian" "$HOME/bin/hermes-debian"
# hm-shizuku: lets Shizuku start again by itself after a restart (Termux's own adb; phone-access.sh pairs it).
cp "$here/phone/hm-shizuku" "$HOME/bin/hm-shizuku"
# hm-local: verifies the local Hermux servers before anything is sent to them (local authentication).
cp "$here/phone/hm-local" "$HOME/bin/hm-local"
rm -f "$HOME/.hermes-mobile/scripts.sha"  # these copies are the installer's: the app's plugin update may replace them
chmod +x "$HOME/bin/hermes-services" "$HOME/bin/hermes-debian" "$HOME/bin/hm-shizuku" "$HOME/bin/hm-local"
DEB="$HOME/bin/hermes-debian"
if [ "$HM_DISTRO" = chroot ]; then
  "$DEB" true || die "Debian is not installed with chroot-distro yet (or Termux has no root). Run: chroot-distro install --name debian debian:trixie"
else
  [ -d "$PREFIX/var/lib/proot-distro/containers/debian/rootfs/root" ] \
    || die "Debian is not installed in Termux yet. Run: pkg install -y proot-distro && proot-distro install debian"
fi
"$DEB" --exists /root/.hermes || die "Hermux is not set up in Debian yet. Install Hermes Agent and run 'hermes setup' first (see the README)."

echo "3/5 Installing the Hermux plugin"
find "$here/hermes-plugin/hermes-mobile" -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
# The plugin folder as the app's own copy is built (android/build.sh): with the Termux scripts in phone-scripts/, so the
# app's plugin update sees the same files and brings the scripts along with every later app update. In Termux's home,
# which Debian sees at the same path (chroot-distro's --put copies from inside Debian).
stage="$HOME/.hermes-mobile/plugin-staging"
rm -rf "$stage"
# Without its Termux scripts the plugin would never bring them along later: stop here instead of installing half of it.
bash "$here/phone/plugin-update.sh" assemble "$here/hermes-plugin/hermes-mobile" "$here/phone" "$stage" \
  || { rm -rf "$stage"; die "Could not prepare the Hermux plugin with its Termux scripts in $stage (is there free space?). Run this installer again."; }
# Its version, so the app's own plugin update (phone/plugin-update.sh) knows this copy and never replaces a newer one.
bash "$here/phone/plugin-update.sh" stamp "$stage" \
  "$(bash "$here/phone/plugin-update.sh" source-stamp "$here")" install || true
put=0; "$DEB" --put "$stage" /root/.hermes/plugins/hermes-mobile && put=1
rm -rf "$stage"
[ "$put" = 1 ] || die "Could not copy the Hermux plugin into Debian."
# Every Hermes profile has its own plugins folder. Link ours into each one, so a profile (also one made the active
# profile with `hermes profile use`, which `hermes` and the dashboard then run in) loads the same, current plugin.
# Replaces an old copy there: it would never be updated.
"$DEB" sh -c 'for p in /root/.hermes/profiles/*/; do [ -d "$p" ] || continue; mkdir -p "${p}plugins"
  rm -rf "${p}plugins/hermes-mobile" && ln -s /root/.hermes/plugins/hermes-mobile "${p}plugins/hermes-mobile"; done' \
  || echo "    Could not add the plugin to every Hermux profile."

# Our fixes to Hermes itself (hermes/README.md). One that no longer fits this Hermes is skipped, never half-applied.
echo "    Applying the Hermux fixes to the agent (hermes/patches)"
"$DEB" --put "$here/hermes/patches" /root/.hermes/hermes-mobile-patches
"$DEB" --put "$here/phone/hermes-patches.sh" /root/.hermes/scripts/hermes-patches.sh
"$DEB" bash -lc 'bash /root/.hermes/scripts/hermes-patches.sh apply /root/.hermes/hermes-mobile-patches' \
  || echo "    Some fixes did not fit this agent version and were skipped; Hermux runs unchanged there."

# Before the restart below: only a Hermes started after Termux got the files permission sees /sdcard.
echo "    Giving Hermux access to the phone: files, Termux:API, Shizuku (no root needed)"
bash "$here/phone/phone-access.sh"
show_todo() {
  [ -s "$HOME/.hermes-mobile/todo" ] || return 0
  echo; echo "Hermux can't reach all of the phone yet. Still to do:"
  sed 's/^/  - /' "$HOME/.hermes-mobile/todo"
}

echo "4/5 Enabling the plugin in Hermux"
enable_in() {  # $1 = "" (the profile `hermes` runs in) or "-p default"
  "$DEB" bash -lc "PATH=\"\$HOME/.local/bin:\$PATH\" hermes $1 plugins enable hermes-mobile" && return 0
  echo "Could not enable it automatically. Run inside Debian:  hermes $1 plugins enable hermes-mobile" | tr -s ' '
}
enable_in ""
# After `hermes profile use <name>` the command above went to that profile; the app starts in the main one.
active=$("$DEB" sh -c 'cat /root/.hermes/active_profile 2>/dev/null' </dev/null || true)
if [ -n "$active" ] && [ "$active" != default ]; then
  echo "    Hermux's active profile is \"$active\": enabling the plugin for the main profile too"
  enable_in "-p default"
fi
# A running Hermes still has the old plugin and Hermes files loaded: restart its dashboard (exact PIDs; the
# hermes-services loop starts it again). Nothing runs yet on a first install.
echo "    Restarting Hermux (if it runs) so the changes load"
"$DEB" --restart

# Hermes' google-workspace skill (Gmail/Calendar/Drive) is often run with Debian's system python3, which lacks these.
echo "    Adding the Google client libraries for Hermux's Google skill (optional)"
"$DEB" bash -lc 'apt-get install -y python3-googleapi python3-google-auth-oauthlib python3-google-auth-httplib2' >/dev/null 2>&1 \
  || echo "    Skipped (not needed unless you use Hermux with Google Calendar/Gmail)."

if [ -n "${HM_NO_APK:-}" ]; then echo "Done (app download skipped: HM_NO_APK is set)."; exit 0; fi   # bootstrap.sh lists the to-dos itself
show_todo
echo "5/5 Downloading the app"
apk="$HOME/hermes-mobile.apk"
# hermux.apk, or the old name if the latest release doesn't have it yet.
if curl -fsL -o "$apk" "$REPO/releases/latest/download/hermux.apk" || curl -fsL -o "$apk" "$REPO/releases/latest/download/hermes-mobile.apk"; then
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
echo "Then open Hermux and allow the permissions it asks for."
