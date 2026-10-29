#!/data/data/com.termux/files/usr/bin/bash
# Hermes's access to the phone, no root needed: files (/sdcard), the termux-* commands (Termux:API) inside Debian, and
# Shizuku's rish shell (screen, taps, apps, logs). Run in TERMUX by install.sh, so also by bootstrap.sh and by the app's
# "Copy installer". Safe to run again. Never fails the install: what is still missing goes to ~/.hermes-mobile/todo, one
# line each, and the installers print it at the end (the app's Setup check shows the same).
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
ROOTFS="$PREFIX/var/lib/proot-distro/containers/debian/rootfs"
SHIZUKU_APK="https://github.com/RikkaApps/Shizuku/releases/download/v13.6.0/shizuku-v13.6.0.r1086.2650830c-release.apk"
# The "phone:" hints also go to the app's setup flow when the app's installer command set HM_APP_TOKEN (same as
# bootstrap.sh's say(); 2 s timeout, never fails).
say() {
  echo "    $*"; /system/bin/log -t hmsetup "HMSETUP $*" 2>/dev/null || true
  if [ -n "${HM_APP_TOKEN:-}" ]; then
    local l="$*"; l=${l//\\/\\\\}; l=${l//\"/\\\"}
    printf '{"token":"%s","line":"%s"}' "$HM_APP_TOKEN" "$l" | curl -s -m 2 -o /dev/null -X POST -H 'Content-Type: application/json' \
      --data-binary @- http://127.0.0.1:9121/setup 2>/dev/null || true
  fi
}
mkdir -p "$HOME/.hermes-mobile" "$HOME/bin"
TODO="$HOME/.hermes-mobile/todo"
: > "$TODO"
todo() { echo "$*" >> "$TODO"; }

need=()
command -v termux-battery-status >/dev/null || need+=(termux-api)
command -v unzip >/dev/null || need+=(unzip)
command -v adb >/dev/null || need+=(android-tools)   # Termux's own adb: Shizuku starts again by itself (hm-shizuku)
# An older install's package index can point at files the mirror no longer has (404): refresh it once and retry.
pkg_add() { apt-get -y -o Dpkg::Options::=--force-confold install "$@" </dev/null >/dev/null 2>&1; }
[ ${#need[@]} -eq 0 ] || pkg_add "${need[@]}" || { apt-get update </dev/null >/dev/null 2>&1; pkg_add "${need[@]}"; } || true

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
if [ "$("$HOME/bin/hermes-debian" --which 2>/dev/null)" = chroot ]; then
  # chroot-distro: Debian's files belong to root, so link from inside Debian (it sees Termux's folders).
  "$HOME/bin/hermes-debian" sh -c 'mkdir -p /usr/local/bin && for f in "$@"; do ln -sf "$f" /usr/local/bin/; done' sh "$PREFIX"/bin/termux-*
elif [ -d "$ROOTFS/usr/local/bin" ]; then
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
# rish gets </dev/null: `timeout` runs it in its own process group, and rish reading the terminal then stops it (SIGTTIN)
# until the timeout kills it, i.e. Shizuku looks off when it isn't.
# The first call makes Shizuku ask whether Termux may use it (rish waits for the answer). A Shizuku app frozen in the
# background can miss the first request ("Request timeout"), so try a few times.
ok=""
if [ -x "$HOME/bin/rish" ]; then
  say "phone: if Shizuku asks whether Termux may use it, tap Allow all the time"
  for _ in 1 2 3; do
    timeout 60 "$HOME/bin/rish" -c id </dev/null 2>/dev/null | grep -q 'uid=2000' && { ok=1; break; }
    sleep 3
  done
fi
if [ -n "$ok" ]; then
  # Lets Shizuku start itself after a reboot (Android 13+, without root, once it was started via Wireless debugging).
  "$HOME/bin/rish" -c 'pm grant moe.shizuku.privileged.api android.permission.WRITE_SECURE_SETTINGS' </dev/null >/dev/null 2>&1
  # Take Shizuku off Android's battery limits (it would be stopped in the background and Hermes would lose the screen).
  # Same list the computer route fills; the shell user may do it. Never fails the installer.
  "$HOME/bin/rish" -c 'dumpsys deviceidle whitelist +moe.shizuku.privileged.api' </dev/null >/dev/null 2>&1 || true
  # Lets Hermes Mobile turn Wireless debugging on when Shizuku is down, so Shizuku starts again by itself. An app
  # version that doesn't ask for this permission yet just refuses the grant.
  "$HOME/bin/rish" -c 'pm grant com.omarqaterge.hermesmobile android.permission.WRITE_SECURE_SETTINGS' </dev/null >/dev/null 2>&1 || true
  # Shizuku remembers "Termux may use Shizuku" properly only when Allow was tapped while rish was still waiting. A late
  # tap saves the entry without Termux's package name, and Shizuku drops such an entry at its next start (it asks again).
  cfg=$("$HOME/bin/rish" -c 'cat /data/user_de/0/com.android.shell/shizuku.json' </dev/null 2>/dev/null || true)
  if printf '%s' "$cfg" | grep -q "\"uid\":$(id -u),\"flags\":[0-9]*,\"packages\":\[\]"; then
    todo "Shizuku will ask once more whether Termux may use it after its next restart: tap Allow all the time right away then"
  fi
  # Pairing Termux's own adb with Wireless debugging (Android 11+, lets Shizuku start again by itself) is done by the
  # user, once, in Hermes Mobile after the install (Setup -> "Shizuku starts by itself"). The installer never opens or
  # taps the screen, and prints no TODO for it (re-running the installer can't pair).
else
  todo "Shizuku: start it and tap Allow when it asks whether Termux may use it (no root: Start via Wireless debugging, pair once; rooted: Start; not installed: https://shizuku.rikka.app/download/), then run the installer again"
fi

if [ -s "$TODO" ]; then say "phone: $(wc -l < "$TODO") thing(s) still to do (listed at the end)"; else say "phone: files, Termux:API and Shizuku ok"; fi
exit 0
