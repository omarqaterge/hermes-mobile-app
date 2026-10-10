#!/data/data/com.termux/files/usr/bin/bash
# Hermes's access to the phone, no root needed: files (/sdcard), the termux-* commands (Termux:API) inside Debian, and
# Shizuku's rish shell (screen, taps, apps, logs). Run in TERMUX by install.sh, so also by bootstrap.sh and by the app's
# "Copy installer". Safe to run again. Never fails the install: what is still missing goes to ~/.hermes-mobile/todo, one
# line each, and the installers print it at the end (the app's Setup check shows the same).
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
ROOTFS="$PREFIX/var/lib/proot-distro/containers/debian/rootfs"
SHIZUKU_APK="https://github.com/RikkaApps/Shizuku/releases/download/v13.6.0/shizuku-v13.6.0.r1086.2650830c-release.apk"
say() { echo "    $*"; /system/bin/log -t hmsetup "HMSETUP $*" 2>/dev/null || true; }
mkdir -p "$HOME/.hermes-mobile" "$HOME/bin"
TODO="$HOME/.hermes-mobile/todo"
: > "$TODO"
todo() { echo "$*" >> "$TODO"; }

need=()
command -v termux-battery-status >/dev/null || need+=(termux-api)
command -v unzip >/dev/null || need+=(unzip)
[ ${#need[@]} -eq 0 ] || apt-get -y -o Dpkg::Options::=--force-confold install "${need[@]}" >/dev/null 2>&1 || true

# Files. Android asks once; the computer route grants it beforehand. Only a Hermes started after this sees /sdcard (the
# installers restart it).
storage_ok() { ls /storage/emulated/0/ >/dev/null 2>&1; }
if ! storage_ok; then
  say "phone: tap Allow on Android's prompt, so Hermes can read and save your files"
  echo y | termux-setup-storage >/dev/null 2>&1   # "y": it asks before rebuilding an existing ~/storage
  for _ in $(seq 1 60); do storage_ok && break; sleep 2; done
fi
storage_ok || todo "files: allow Termux to access files (Settings → Apps → Termux → Permissions), then run the installer again"

# termux-* commands (battery, location, clipboard, notifications, SMS…) inside Debian. Debian's PATH drops Termux's bin
# dirs (bootstrap.sh), so link just these into /usr/local/bin. Re-linked every run: new termux-api versions add commands.
if [ -d "$ROOTFS/usr/local/bin" ]; then
  for f in "$PREFIX"/bin/termux-*; do ln -sf "$f" "$ROOTFS/usr/local/bin/"; done
fi
timeout 20 termux-battery-status 2>/dev/null | grep -q percentage \
  || todo "Termux:API: install the Termux:API app from F-Droid (https://f-droid.org/packages/com.termux.api/)"

# Shizuku's rish: an adb-level shell for Hermes without root. Both files come from Shizuku's own release APK; "PKG" is the
# placeholder Shizuku fills in when you export them from its app.
if [ ! -s "$HOME/bin/rish_shizuku.dex" ] || ! grep -q '"com.termux"' "$HOME/bin/rish" 2>/dev/null; then
  tmp=$(mktemp -d)
  if curl -fsSL -o "$tmp/shizuku.apk" "$SHIZUKU_APK" && unzip -qo "$tmp/shizuku.apk" assets/rish assets/rish_shizuku.dex -d "$tmp"; then
    sed 's/"PKG"/"com.termux"/' "$tmp/assets/rish" > "$HOME/bin/rish" && chmod 700 "$HOME/bin/rish"
    # Android 14+ refuses a writable dex.
    rm -f "$HOME/bin/rish_shizuku.dex" && cp "$tmp/assets/rish_shizuku.dex" "$HOME/bin/" && chmod 400 "$HOME/bin/rish_shizuku.dex"
  fi
  rm -rf "$tmp"
fi
# The first call makes Shizuku ask whether Termux may use it (rish waits for the answer). A Shizuku app frozen in the
# background can miss the first request ("Request timeout"), so try a few times.
ok=""
if [ -x "$HOME/bin/rish" ]; then
  say "phone: if Shizuku asks whether Termux may use it, tap Allow all the time"
  for _ in 1 2 3; do
    timeout 60 "$HOME/bin/rish" -c id 2>/dev/null | grep -q 'uid=2000' && { ok=1; break; }
    sleep 3
  done
fi
if [ -n "$ok" ]; then
  # Lets Shizuku start itself after a reboot (Android 13+, without root, once it was started via Wireless debugging).
  "$HOME/bin/rish" -c 'pm grant moe.shizuku.privileged.api android.permission.WRITE_SECURE_SETTINGS' >/dev/null 2>&1
else
  todo "Shizuku: install it (https://shizuku.rikka.app/download/) and start it (no root: Start via Wireless debugging, pair once; rooted: Start), allow Termux when it asks, then run the installer again"
fi

if [ -s "$TODO" ]; then say "phone: $(wc -l < "$TODO") thing(s) still to do (listed at the end)"; else say "phone: files, Termux:API and Shizuku ok"; fi
exit 0
