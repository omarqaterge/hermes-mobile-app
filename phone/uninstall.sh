#!/data/data/com.termux/files/usr/bin/bash
# Removes what the Hermes Mobile installers (bootstrap.sh, install.sh, phone-access.sh, hermes-services) put on the phone,
# from inside TERMUX: stops Hermes, optionally saves a backup to Downloads first, undoes the phone setting the installer
# changed (Android's child-process limit, through Shizuku when it runs), removes Debian (with Hermes, its chats and keys)
# and the installer's files in Termux. It does NOT uninstall any app: the Hermes Mobile app does that afterwards (Android
# asks once per app), Termux last but one. Run by the app (Settings → Uninstall Hermes, through Termux's RUN_COMMAND), or
# by hand:  bash uninstall.sh [--backup [--keys]]
#   --backup          first save chats, memory, skills and settings to Download/hermes-backup-<date>.tar.gz; if that
#                     fails NOTHING is removed (exit 3)
#   --keys            include API keys (.env) and sign-ins (auth.json) in the backup (left out by default: other apps
#                     with file access can read Downloads)
#   --settings JSON   the app's own settings, saved in the backup as hermes-mobile-settings.json
# Safe to run again: what is already gone is skipped. It only deletes the paths listed below, only inside Termux's home and
# prefix, and refuses to run when those look wrong. Every line it prints starts with "HMUNINSTALL ":
#   STEP <step> <text> · OK <step> [text] · SKIP <step> <why> · FAIL <step> <why> · RM <path> · BACKUP <file> · DONE
# Exit: 0 done (SKIPs allowed) · 3 stopped before removing anything · 1 something could not be removed (see FAIL) · 2 usage
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
DOWNLOADS="${HM_DOWNLOADS:-/storage/emulated/0/Download}"

say() {
  echo "HMUNINSTALL $*"
  [ -x /system/bin/log ] && /system/bin/log -t hmuninstall "HMUNINSTALL $*" 2>/dev/null
  return 0
}

backup=0 keys=0 settings=""
while [ $# -gt 0 ]; do
  case "$1" in
    --backup) backup=1 ;;
    --keys) keys=1 ;;
    --settings) [ $# -ge 2 ] || { say "FAIL usage --settings needs a value"; exit 2; }; settings=$2; shift ;;
    *) say "FAIL usage unknown option $1"; exit 2 ;;
  esac
  shift
done

# ── where we may delete: Termux's home and prefix, nothing else ──
real() { (cd -P -- "$1" 2>/dev/null && pwd -P); }
H=$(real "$HOME") P=$(real "$PREFIX")
deep() { case "$1" in /?*/?*) return 0 ;; *) return 1 ;; esac; }   # at least two levels below /
if [ -z "$H" ] || [ -z "$P" ] || ! deep "$H" || ! deep "$P" || [ "$H" = "$P" ]; then
  say "FAIL safety HOME ($HOME) or PREFIX ($PREFIX) does not look like Termux's; nothing was removed"; exit 3
fi
case "$P/" in "$H"/*) say "FAIL safety PREFIX is inside HOME; nothing was removed"; exit 3 ;; esac
case "$H/" in "$P"/*) say "FAIL safety HOME is inside PREFIX; nothing was removed"; exit 3 ;; esac
inside() {  # PATH: its folder (symlinks resolved) is HOME, PREFIX or below them
  local d; d=$(real "$(dirname -- "$1")") || return 1
  case "$d/" in "$H"/* | "$P"/*) return 0 ;; esac
  return 1
}
show() { local s=${1/#$HOME/\~}; echo "${s/#$PREFIX/\$PREFIX}"; }
failed=0
rmp() {  # remove one path (a symlink itself, never what it points to)
  [ -e "$1" ] || [ -L "$1" ] || return 0
  if ! inside "$1"; then say "FAIL files refused $(show "$1"): outside Termux's home and prefix"; failed=1; return 1; fi
  if rm -rf -- "$1" 2>/dev/null || { chmod -R u+rwX -- "$1" 2>/dev/null; rm -rf -- "$1" 2>/dev/null; }; then
    say "RM $(show "$1")"
  else
    say "FAIL files could not remove $(show "$1")"; failed=1
  fi
}
rmdir_empty() { [ -d "$1" ] && ! [ -L "$1" ] && inside "$1" && rmdir -- "$1" 2>/dev/null && say "RM $(show "$1")"; return 0; }
has() { command -v "$1" >/dev/null 2>&1; }
limit() { local s=$1; shift; if has timeout; then timeout "$s" "$@"; else "$@"; fi; }

D=$(cat "$HOME/.hermes-mobile/distro" 2>/dev/null)
[ "$D" = chroot ] || D=proot
PROOT_C="$PREFIX/var/lib/proot-distro/containers/debian"
CHROOT_C="$PREFIX/var/lib/chroot-distro/containers/debian"
DEB="$HOME/bin/hermes-debian"

# ── 1. stop Hermes: the hermes-services loops (exact PIDs from their pid files) and what they started ──
say "STEP stop Stopping Hermes"
kill_tree() {  # PID: stop it (so a loop can't start its command again), its children, then it
  local c
  kill -STOP "$1" 2>/dev/null
  for c in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$c"; done
  kill -9 "$1" 2>/dev/null
}
stopped=0
for n in dashboard memory-sync cron-ticker app-keeper bot-keeper; do
  f="$HOME/logs/$n.pid"
  [ -f "$f" ] || continue
  pid=$(tr -cd 0-9 < "$f")
  # only when that PID is still the supervisor's loop (a PID can be reused after a reboot)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && ps -o args= -p "$pid" 2>/dev/null | grep -q hermes-services; then
    kill_tree "$pid"; stopped=$((stopped + 1))
  fi
done
# The dashboard by its exact command line (as hermes-debian --restart does), and any proot process still running in
# Hermes's Debian (its command line holds that Debian's own folder).
if [ "$D" = chroot ]; then
  [ -x "$DEB" ] && "$DEB" --restart </dev/null >/dev/null 2>&1
else
  for pid in $(pgrep -f 'hermes dashboard --host 127.0.0.1 --port 9119' 2>/dev/null) $(pgrep -f "$PROOT_C/rootfs" 2>/dev/null); do
    [ "$pid" = $$ ] || kill -9 "$pid" 2>/dev/null
  done
fi
say "OK stop $stopped supervisor loop(s) stopped"

# ── 2. backup (optional). Any problem: stop here, nothing is removed ──
# hm_backup SRC OUT KEYS SETTINGS: tar.gz of Hermes's folder without its program files, caches and logs (and without
# keys/sign-ins unless KEYS=1), plus the app's settings. Self-contained: under chroot-distro it runs inside Debian.
hm_backup() {
  local src=$1 out=$2 keys=$3 extra=$4 list e n p
  local bulk=" hermes-agent installs tools node vendor cache audio_cache image_cache checkpoints state-snapshots logs lsp bin desktop desktop-plugins .backups backups .curator_backups .plugin-backup-repo hermes-mobile-patches sandboxes "
  [ -d "$src" ] || { echo "no Hermes folder at $src" >&2; return 2; }
  list="$out.list"
  : > "$list" || return 2
  walk() {  # DIR: the entries worth keeping, one find per entry
    for e in "$1"/* "$1"/.[!.]* "$1"/..?*; do
      [ -e "$e" ] || [ -L "$e" ] || continue
      n=${e##*/}
      case "$bulk" in *" $n "*) continue ;; esac
      case "$n" in *.bak | *.lock | *.sock | *.pid | *.log) continue ;; esac
      if [ "$1" = . ] && [ "$n" = profiles ] && [ -d "$e" ]; then
        for p in ./profiles/*; do [ -d "$p" ] && ! [ -L "$p" ] && walk "$p"; done
        continue
      fi
      if [ "$keys" = 1 ]; then
        find "$e" \( -name __pycache__ -o -name node_modules \) -prune -o \( -type f -o -type l \) -print
      else
        find "$e" \( -name __pycache__ -o -name node_modules -o -name .env -o -name '.env.*' -o -name auth.json -o -name auth.lock \
          -o -name '*token*.json' -o -name '*client_secret*.json' -o -name '*.pem' \) -prune -o \( -type f -o -type l \) -print
      fi
    done
  }
  (cd "$src" && walk .) >> "$list" || { rm -f "$list"; return 2; }
  rm -f "$out.tar"
  (cd "$src" && tar -cf "$out.tar" -T "$list") || { rm -f "$list" "$out.tar"; return 2; }
  rm -f "$list"
  if [ -n "$extra" ] && [ -f "$extra" ]; then
    (cd "$(dirname "$extra")" && tar -rf "$out.tar" "$(basename "$extra")") || { rm -f "$out.tar"; return 2; }
  fi
  gzip -c "$out.tar" > "$out" || { rm -f "$out.tar" "$out"; return 2; }
  rm -f "$out.tar"
  chmod 644 "$out" 2>/dev/null
  tar -tzf "$out" >/dev/null || { rm -f "$out"; return 2; }
}
if [ "$backup" = 1 ]; then
  say "STEP backup Saving a backup to Downloads"
  stamp=$(date +%Y%m%d-%H%M%S)
  name="hermes-backup-$stamp.tar.gz"
  work="$HOME/.hermes-mobile-backup.$$"   # Debian sees Termux's home at the same path (proot and chroot)
  rm -rf "$work"; mkdir -p "$work" || { say "FAIL backup can't write in Termux's home; nothing was removed"; exit 3; }
  extra=""
  if [ -n "$settings" ]; then extra="$work/hermes-mobile-settings.json"; printf '%s\n' "$settings" > "$extra"; fi
  ok=1
  if [ "$D" = chroot ]; then
    if [ -x "$DEB" ]; then
      "$DEB" bash -c "$(declare -f hm_backup); hm_backup \"\$@\"" hm /root/.hermes "$work/$name" "$keys" "$extra" </dev/null || ok=0
    else ok=0; fi
  else
    if [ -d "$PROOT_C/rootfs/root/.hermes" ]; then
      hm_backup "$PROOT_C/rootfs/root/.hermes" "$work/$name" "$keys" "$extra" || ok=0
    else ok=0; fi
  fi
  if [ "$ok" = 1 ]; then
    if ! { mkdir -p "$DOWNLOADS" 2>/dev/null && cp "$work/$name" "$DOWNLOADS/.$name.part" 2>/dev/null \
           && mv -f "$DOWNLOADS/.$name.part" "$DOWNLOADS/$name"; }; then
      rm -f "$DOWNLOADS/.$name.part" 2>/dev/null
      rm -rf "$work"
      say "FAIL backup can't write to Downloads (does Termux have access to files?); nothing was removed"; exit 3
    fi
  fi
  rm -rf "$work"
  if [ "$ok" != 1 ]; then say "FAIL backup couldn't read Hermes's data in Debian; nothing was removed"; exit 3; fi
  say "BACKUP $DOWNLOADS/$name"
  say "OK backup $name ($(du -k "$DOWNLOADS/$name" 2>/dev/null | cut -f1) KB)"
fi

# ── 3. the phone setting the installer changed: Android's child-process limit (needs Shizuku's shell) ──
say "STEP android Undoing the phone settings the installer changed"
RISH="$HOME/bin/rish"
sid=""
[ -x "$RISH" ] && sid=$(limit 20 "$RISH" -c id </dev/null 2>/dev/null)
if [ "${sid#*uid=2000}" != "$sid" ]; then
  # The reverse of bootstrap.sh / tools/setup-phone.sh: Android's own defaults again.
  "$RISH" -c 'device_config delete activity_manager max_phantom_processes; device_config set_sync_disabled_for_tests none; settings delete global settings_enable_monitor_phantom_procs' </dev/null >/dev/null 2>&1
  say "OK android child-process limit back to Android's default"
else
  say "SKIP android Shizuku isn't running, so the child-process limit stays lifted (harmless; Android 14+: Developer options → Disable child process restrictions → off)"
fi

# ── 4. Debian, with Hermes, its chats, memory, skills and keys ──
say "STEP debian Removing Debian and Hermes"
if [ "$D" = chroot ]; then
  # Never deleted by hand: a chroot can still have the phone's folders mounted inside. chroot-distro unmounts first.
  if has chroot-distro; then
    chroot-distro kill debian </dev/null >/dev/null 2>&1
    chroot-distro remove debian </dev/null >/dev/null 2>&1
  fi
  if [ -e "$CHROOT_C" ]; then
    say "FAIL debian chroot-distro couldn't remove Debian: restart the phone, then run 'chroot-distro remove debian' in Termux"; failed=1; debian_left=1
  else
    say "OK debian removed (chroot-distro)"
  fi
else
  if [ -e "$PROOT_C" ] || [ -L "$PROOT_C" ]; then
    has proot-distro && proot-distro remove debian </dev/null >/dev/null 2>&1
    # a half-installed or half-restored Debian has no manifest, which `remove` doesn't know: bootstrap.sh does the same
    [ -e "$PROOT_C" ] || [ -L "$PROOT_C" ] && rmp "$PROOT_C"
    if [ -e "$PROOT_C" ]; then debian_left=1; else say "OK debian removed"; fi
  else
    say "SKIP debian not installed"
  fi
  for f in "$PREFIX"/var/lib/proot-distro/dlcache/debian-*; do rmp "$f"; done   # proot-distro's download of it
fi

# ── 5. the installer's files in Termux ──
say "STEP files Removing the installer's files in Termux"
rmp "$HOME/.hermes-mobile"
for f in hermes-services hermes-debian hm-shizuku rish rish_shizuku.dex; do rmp "$HOME/bin/$f"; done
rmdir_empty "$HOME/bin"
rmp "$HOME/.termux/boot/10-hermes"
rmdir_empty "$HOME/.termux/boot"
for n in dashboard memory-sync cron-ticker app-keeper bot-keeper; do rmp "$HOME/logs/$n.pid"; rmp "$HOME/logs/$n.log"; done
rmdir_empty "$HOME/logs"
for f in hermes-mobile.apk hm.sh hm-install.sh hm-phone-access.sh hm-debian-image.tar.zst; do rmp "$HOME/$f"; done
rmp "$HOME/.cache/hermes-open"
# install.sh's clone, only when it is this project's
if grep -qs 'omarqaterge/hermes-mobile-app' "$HOME/hermes-mobile/.git/config"; then rmp "$HOME/hermes-mobile"; fi
[ "$failed" = 0 ] && say "OK files"

# ── 6. last: Termux stops taking commands from other apps (install.sh turned that on for Hermes Mobile) ──
# Skipped after a failure, so the app can run this script again.
say "STEP termux Turning off commands from other apps in Termux"
props="$HOME/.termux/termux.properties"
if [ "$failed" = 0 ] && [ -z "${debian_left:-}" ]; then
  if grep -qxE 'allow-external-apps = true' "$props" 2>/dev/null && inside "$props"; then
    grep -vxE 'allow-external-apps = true' "$props" > "$props.hm-tmp"; mv -f "$props.hm-tmp" "$props"
    has termux-reload-settings && termux-reload-settings >/dev/null 2>&1
    say "OK termux allow-external-apps removed from ~/.termux/termux.properties"
  else
    say "SKIP termux already off"
  fi
else
  say "SKIP termux kept on so the app can run this again"
fi

if [ "$failed" != 0 ] || [ -n "${debian_left:-}" ]; then
  [ -n "${debian_left:-}" ] && [ "$D" != chroot ] && say "FAIL debian couldn't remove Debian"
  exit 1
fi
say "DONE"
exit 0
