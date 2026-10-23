#!/bin/bash
# Runs phone/uninstall.sh against a fake Termux (HOME + PREFIX in a temp folder) with fake proot-distro, chroot-distro,
# rish, su and termux-reload-settings, and proves: it deletes exactly the installer's paths and nothing else (a full
# before/after file list), it is safe to run again, a failed backup removes nothing, the backup leaves keys out unless
# asked, it stops the supervisor loops by their exact PIDs (and not a process that only reuses a pid file), it refuses
# a HOME/PREFIX that isn't Termux-like, it never deletes a chroot Debian by hand, and partial states (no Debian, no
# Shizuku, no proot-distro) still finish. Usage: tools/test_uninstall.sh   (no phone needed)
set -u
cd "$(dirname "$0")/.."
SCRIPT="$PWD/phone/uninstall.sh"
DEBWRAP="$PWD/phone/hermes-debian"
fails=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; fails=$((fails + 1)); }
check() { if eval "$1"; then pass "$2"; else fail "$2"; fi; }
bash -n "$SCRIPT" && pass "bash -n phone/uninstall.sh" || fail "bash -n phone/uninstall.sh"

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/hm-uninstall-test.XXXXXX")
ROOT=$(cd -P "$ROOT" && pwd -P)
trap 'kill $(cat "$ROOT"/*.bgpid 2>/dev/null) 2>/dev/null; chmod -R u+rwX "$ROOT" 2>/dev/null; rm -rf "$ROOT"' EXIT

# fake tools (logs go to $T/calls)
mkbin() {
  local b="$1/fakebin"; mkdir -p "$b"
  cat > "$b/proot-distro" <<'EOF'
#!/bin/bash
echo "proot-distro $*" >> "$T/calls"
[ "$1 $2" = "remove debian" ] && [ -z "${FAKE_PD_FAIL:-}" ] && rm -rf "$PREFIX/var/lib/proot-distro/containers/debian"
exit 0
EOF
  cat > "$b/chroot-distro" <<'EOF'
#!/bin/bash
echo "chroot-distro $*" >> "$T/calls"
case "$1" in
  kill) exit 0 ;;
  remove) [ -z "${FAKE_CD_FAIL:-}" ] && rm -rf "$PREFIX/var/lib/chroot-distro/containers/debian"; exit 0 ;;
  login)
    shift; while [ $# -gt 0 ] && [ "$1" != -- ]; do shift; done; shift
    a=(); for x in "$@"; do [ "$x" = /root/.hermes ] && x="$PREFIX/var/lib/chroot-distro/containers/debian/rootfs/root/.hermes"; a+=("$x"); done
    exec "${a[@]}" ;;
esac
EOF
  cat > "$b/rish" <<'EOF'
#!/bin/bash
[ -n "${FAKE_SHIZUKU_OFF:-}" ] && { echo "Server is not running" >&2; exit 1; }
[ "$2" = id ] && { echo "uid=2000(shell) gid=2000(shell)"; exit 0; }
echo "rish $2" >> "$T/calls"
EOF
  printf '#!/bin/bash\necho "termux-reload-settings" >> "$T/calls"\n' > "$b/termux-reload-settings"
  printf '#!/bin/bash\necho "su $*" >> "$T/calls"\n' > "$b/su"
  chmod +x "$b"/*
}

# a fake Termux with everything the installers create, plus the user's own files next to them
mktree() {
  local T=$1 H=$1/home P=$1/usr R
  mkdir -p "$H/.hermes-mobile" "$H/bin" "$H/.termux/boot" "$H/logs" "$H/hermes-mobile/.git" "$H/projects" "$H/.cache/other" \
    "$P/bin" "$P/var/lib/proot-distro/dlcache" "$P/var/lib/proot-distro/containers/ubuntu/rootfs/etc" "$T/sdcard/Download" "$T/outside/dir"
  echo proot > "$H/.hermes-mobile/distro"; echo k > "$H/.hermes-mobile/key"; : > "$H/.hermes-mobile/installed"; : > "$H/.hermes-mobile/todo"
  for f in hermes-services hermes-debian rish rish_shizuku.dex; do echo x > "$H/bin/$f"; done
  sed "1s|.*|#!/bin/bash|" "$DEBWRAP" > "$H/bin/hermes-debian"; chmod +x "$H/bin/hermes-debian"   # Termux's bash path → the Mac's
  cp "$T/fakebin/rish" "$H/bin/rish"; chmod +x "$H/bin/rish"
  echo mine > "$H/bin/mytool"
  printf 'extra-keys = [[ESC]]\nallow-external-apps = true\n' > "$H/.termux/termux.properties"
  printf '#!/data/data/com.termux/files/usr/bin/bash\n~/bin/hermes-services\n' > "$H/.termux/boot/10-hermes"
  echo mine > "$H/.termux/boot/20-mine"
  for f in dashboard.pid dashboard.log cron-ticker.log app-keeper.log; do echo 1 > "$H/logs/$f"; done
  echo mine > "$H/logs/mine.log"
  printf '[remote "origin"]\n\turl = https://github.com/omarqaterge/hermes-mobile-app.git\n' > "$H/hermes-mobile/.git/config"
  echo x > "$H/hm.sh"; echo x > "$H/hermes-mobile.apk"; echo mine > "$H/notes.txt"; echo mine > "$H/projects/a.py"
  echo mine > "$H/.cache/other/c"
  echo precious > "$T/outside/dir/precious"
  ln -s "$T/outside/dir" "$H/.cache/hermes-open"           # a symlink out of Termux: only the link may go
  echo x > "$P/var/lib/proot-distro/dlcache/debian-trixie.tar.xz"; echo mine > "$P/var/lib/proot-distro/dlcache/ubuntu.tar.xz"
  echo mine > "$P/var/lib/proot-distro/containers/ubuntu/rootfs/etc/os-release"
  R="$P/var/lib/proot-distro/containers/debian/rootfs/root/.hermes"
  mkhermes "$R"
}
mkhermes() {
  local R=$1
  mkdir -p "$R/hermes-agent/x" "$R/installs/v" "$R/logs" "$R/skills/x/bin" "$R/profiles/p1/skills/s/bin" "$R/profiles/p1/hermes-agent" "$R/mobile/canvas" "$R/memories"
  echo db > "$R/state.db"; echo wal > "$R/state.db-wal"; echo cfg > "$R/config.yaml"; echo KEY=1 > "$R/.env"; echo '{}' > "$R/auth.json"
  echo t > "$R/google_token.json"; echo old > "$R/state.db.bak"; echo big > "$R/hermes-agent/x/big"; echo v > "$R/installs/v/py"
  echo l > "$R/logs/agent.log"; echo s > "$R/skills/x/bin/run.sh"; echo m > "$R/memories/MEMORY.md"; echo c > "$R/mobile/canvas/a.json"
  echo db > "$R/profiles/p1/state.db"; echo KEY=2 > "$R/profiles/p1/.env"; echo '{}' > "$R/profiles/p1/auth.json"
  echo s > "$R/profiles/p1/skills/s/bin/tool.sh"; echo c > "$R/profiles/p1/hermes-agent/code"
}
snap() { (cd "$1" && find . -path ./calls -prune -o -path ./fakebin -prune -o -name '*.bgpid' -prune -o -print | sort); }
run() {  # T [args...] → $out, $rc
  local T=$1; shift
  out=$(cd / && env -i PATH="$T/fakebin:/usr/bin:/bin:/usr/sbin:/sbin" T="$T" HOME="$T/home" PREFIX="$T/usr" \
    HM_DOWNLOADS="$T/sdcard/Download" ${FAKE_ENV:-} bash "$SCRIPT" "$@" 2>&1); rc=$?
}

# ── 1. full run: exactly the installer's paths go; the user's files, other distros and outside files stay ──
T="$ROOT/t1"; mkdir -p "$T"; mkbin "$T"; mktree "$T"
# the supervisor's loops (a process whose command line holds hermes-services) and a stranger in a stale pid file
mkdir -p "$T/sup"; printf '( while true; do sleep 1000; done ) &\necho $! > "$HOME/logs/dashboard.pid"\n' > "$T/sup/hermes-services"
HOME="$T/home" bash "$T/sup/hermes-services"; loop=$(cat "$T/home/logs/dashboard.pid"); echo "$loop" > "$ROOT/loop.bgpid"
sleep 1001 & stranger=$!; disown; echo "$stranger" > "$ROOT/stranger.bgpid"; echo "$stranger" > "$T/home/logs/cron-ticker.pid"
sleep 0.3; child=$(pgrep -P "$loop" | head -1)
before=$(snap "$T")
run "$T"
after=$(snap "$T")
check '[ $rc = 0 ]' "full run exits 0 (rc=$rc)"
check 'echo "$out" | grep -qx "HMUNINSTALL DONE"' "full run ends with DONE"
removed=$(comm -23 <(echo "$before") <(echo "$after") | grep -vE '^./usr/var/lib/proot-distro/containers/debian/.+' | grep -vE '^./home/(\.hermes-mobile|hermes-mobile)/.+')
expected='./home/.cache/hermes-open
./home/.hermes-mobile
./home/.termux/boot/10-hermes
./home/bin/hermes-debian
./home/bin/hermes-services
./home/bin/rish
./home/bin/rish_shizuku.dex
./home/hermes-mobile
./home/hermes-mobile.apk
./home/hm.sh
./home/logs/app-keeper.log
./home/logs/cron-ticker.log
./home/logs/cron-ticker.pid
./home/logs/dashboard.log
./home/logs/dashboard.pid
./usr/var/lib/proot-distro/containers/debian
./usr/var/lib/proot-distro/dlcache/debian-trixie.tar.xz'
check '[ "$removed" = "$expected" ]' "removed exactly the installer's paths"
[ "$removed" = "$expected" ] || diff <(echo "$expected") <(echo "$removed")
check '[ -z "$(comm -13 <(echo "$before") <(echo "$after"))" ]' "created nothing new"
check '[ "$(cat "$ROOT/t1/outside/dir/precious")" = precious ]' "a symlink out of Termux: only the link removed"
check '[ "$(cat "$T/home/.termux/termux.properties")" = "extra-keys = [[ESC]]" ]' "termux.properties: only allow-external-apps removed"
check 'grep -q "^proot-distro remove debian" "$T/calls"' "Debian removed with proot-distro remove debian"
check 'grep -q "^rish device_config delete activity_manager max_phantom_processes; device_config set_sync_disabled_for_tests none; settings delete global settings_enable_monitor_phantom_procs" "$T/calls"' "child-process limit restored through rish"
check 'grep -q "^termux-reload-settings" "$T/calls"' "Termux settings reloaded"
check '! kill -0 $loop 2>/dev/null' "supervisor loop stopped by its PID"
check '[ -n "$child" ] && ! kill -0 $child 2>/dev/null' "and the command it ran"
check 'kill -0 $stranger 2>/dev/null' "a process that only reuses a pid file is left alone"
check 'echo "$out" | grep -q "^HMUNINSTALL RM ~/bin/hermes-services$"' "progress lines name paths as ~/…"

# ── 2. again: nothing left to do, nothing changes ──
run "$T"; again=$(snap "$T")
check '[ $rc = 0 ] && echo "$out" | grep -qx "HMUNINSTALL DONE"' "second run exits 0 with DONE"
check '! echo "$out" | grep -q "HMUNINSTALL RM "' "second run removes nothing"
check '[ "$again" = "$after" ]' "second run changes nothing"
check 'echo "$out" | grep -q "SKIP debian not installed"' "second run: Debian missing is a SKIP"

# ── 3. backup: chats, memory, skills, settings; no program files, logs or keys ──
T="$ROOT/t3"; mkdir -p "$T"; mkbin "$T"; mktree "$T"
run "$T" --backup --settings '{"hm.theme":"oled"}'
bk=$(ls "$T/sdcard/Download"/hermes-backup-*.tar.gz 2>/dev/null | head -1)
check '[ $rc = 0 ] && [ -s "$bk" ]' "backup written to Downloads (rc=$rc)"
check 'echo "$out" | grep -q "^HMUNINSTALL BACKUP $T/sdcard/Download/hermes-backup-"' "BACKUP line names the file"
list=$(tar -tzf "$bk" 2>/dev/null | sed 's#^\./##' | sort)
for f in state.db state.db-wal config.yaml memories/MEMORY.md mobile/canvas/a.json skills/x/bin/run.sh profiles/p1/state.db profiles/p1/skills/s/bin/tool.sh hermes-mobile-settings.json; do
  check 'echo "$list" | grep -qx "$f"' "backup has $f"
done
for f in .env auth.json google_token.json profiles/p1/.env profiles/p1/auth.json state.db.bak logs/agent.log hermes-agent/x/big installs/v/py profiles/p1/hermes-agent/code; do
  check '! echo "$list" | grep -qx "$f"' "backup leaves out $f"
done
check '[ "$(tar -xzOf "$bk" ./hermes-mobile-settings.json 2>/dev/null || tar -xzOf "$bk" hermes-mobile-settings.json)" = "{\"hm.theme\":\"oled\"}" ]' "app settings saved as given"
check '[ ! -e "$T/usr/var/lib/proot-distro/containers/debian" ]' "after the backup Debian is removed"
check '[ -z "$(ls -A "$T/home" | grep hermes-mobile-backup)" ]' "backup work folder cleaned up"

# --keys: keys and sign-ins included
T="$ROOT/t4"; mkdir -p "$T"; mkbin "$T"; mktree "$T"
run "$T" --backup --keys
bk=$(ls "$T/sdcard/Download"/hermes-backup-*.tar.gz 2>/dev/null | head -1)
list=$(tar -tzf "$bk" 2>/dev/null | sed 's#^\./##' | sort)
for f in .env auth.json profiles/p1/.env profiles/p1/auth.json google_token.json; do check 'echo "$list" | grep -qx "$f"' "--keys: backup has $f"; done
check '! echo "$list" | grep -qx hermes-mobile-settings.json' "no --settings: no settings file"

# ── 4. backup fails (Downloads not writable): stop, remove NOTHING ──
T="$ROOT/t5"; mkdir -p "$T"; mkbin "$T"; mktree "$T"; chmod 500 "$T/sdcard/Download"
before=$(snap "$T"); run "$T" --backup; after=$(snap "$T"); chmod 700 "$T/sdcard/Download"
check '[ $rc = 3 ]' "failed backup exits 3 (rc=$rc)"
check 'echo "$out" | grep -q "^HMUNINSTALL FAIL backup .*nothing was removed"' "failed backup says nothing was removed"
check '[ "$before" = "$after" ]' "failed backup: every file still there"
check '! grep -q "rish device_config" "$T/calls" 2>/dev/null' "failed backup: phone settings untouched"
# no Debian at all and --backup: also stops (nothing to back up is an error, not an empty backup)
T="$ROOT/t5b"; mkdir -p "$T"; mkbin "$T"; mktree "$T"; rm -rf "$T/usr/var/lib/proot-distro/containers/debian"
run "$T" --backup
check '[ $rc = 3 ] && [ -z "$(ls "$T/sdcard/Download")" ]' "backup without Debian: exit 3, no file"

# ── 5. refuses a HOME/PREFIX that isn't Termux-like ──
T="$ROOT/t6"; mkdir -p "$T"; mkbin "$T"; mktree "$T"; before=$(snap "$T")
out=$(env -i PATH="$T/fakebin:/usr/bin:/bin" T="$T" HOME=/ PREFIX="$T/usr" bash "$SCRIPT" 2>&1); rc=$?
check '[ $rc = 3 ] && echo "$out" | grep -q "FAIL safety"' "HOME=/ refused (rc=$rc)"
out=$(env -i PATH="$T/fakebin:/usr/bin:/bin" T="$T" HOME="$T/home" PREFIX="$T/home/usr" bash "$SCRIPT" 2>&1); rc=$?
check '[ $rc = 3 ]' "PREFIX inside HOME refused (rc=$rc)"
out=$(env -i PATH="$T/fakebin:/usr/bin:/bin" T="$T" HOME="$T/home" PREFIX="$T/usr" bash "$SCRIPT" --bogus 2>&1); rc=$?
check '[ $rc = 2 ]' "unknown option refused (rc=$rc)"
check '[ "$before" = "$(snap "$T")" ]' "refusals removed nothing"

# ── 6. partial states: Shizuku off, no proot-distro, no Debian → still DONE ──
T="$ROOT/t7"; mkdir -p "$T"; mkbin "$T"; mktree "$T"; rm -f "$T/fakebin/proot-distro"
FAKE_ENV="FAKE_SHIZUKU_OFF=1" run "$T"
check '[ $rc = 0 ] && echo "$out" | grep -qx "HMUNINSTALL DONE"' "Shizuku off + no proot-distro: DONE (rc=$rc)"
check 'echo "$out" | grep -q "^HMUNINSTALL SKIP android Shizuku"' "Shizuku off is a SKIP"
check '[ ! -e "$T/usr/var/lib/proot-distro/containers/debian" ]' "no proot-distro: Debian folder removed directly"
check '[ -e "$T/usr/var/lib/proot-distro/containers/ubuntu/rootfs/etc/os-release" ]' "another distro stays"
T="$ROOT/t8"; mkdir -p "$T"; mkbin "$T"; mkdir -p "$T/home" "$T/usr"   # Termux with nothing of ours
before=$(snap "$T"); run "$T"
check '[ $rc = 0 ] && [ "$before" = "$(snap "$T")" ]' "nothing installed: DONE, nothing touched (rc=$rc)"

# ── 7. chroot-distro: removed by chroot-distro only (never rm -rf: mounts), backup made inside Debian ──
T="$ROOT/t9"; mkdir -p "$T"; mkbin "$T"; mktree "$T"; echo chroot > "$T/home/.hermes-mobile/distro"
rm -rf "$T/usr/var/lib/proot-distro/containers/debian"; mkhermes "$T/usr/var/lib/chroot-distro/containers/debian/rootfs/root/.hermes"
run "$T" --backup
bk=$(ls "$T/sdcard/Download"/hermes-backup-*.tar.gz 2>/dev/null | head -1)
check '[ $rc = 0 ] && [ -s "$bk" ]' "chroot: backup through Debian, DONE (rc=$rc)"
check 'tar -tzf "$bk" | grep -q "state.db$" && ! tar -tzf "$bk" | grep -q "/.env$"' "chroot: backup has the chats, no keys"
check 'grep -q "^chroot-distro kill debian" "$T/calls" && grep -q "^chroot-distro remove debian" "$T/calls"' "chroot: kill, then remove debian"
check 'grep -q "^su -c pkill -9 -f" "$T/calls"' "chroot: dashboard stopped as root (hermes-debian --restart)"
T="$ROOT/t10"; mkdir -p "$T"; mkbin "$T"; mktree "$T"; echo chroot > "$T/home/.hermes-mobile/distro"
rm -rf "$T/usr/var/lib/proot-distro/containers/debian"; mkhermes "$T/usr/var/lib/chroot-distro/containers/debian/rootfs/root/.hermes"
FAKE_ENV="FAKE_CD_FAIL=1" run "$T"
check '[ $rc = 1 ] && echo "$out" | grep -q "^HMUNINSTALL FAIL debian chroot-distro"' "chroot remove fails: exit 1 with FAIL (rc=$rc)"
check '[ -f "$T/usr/var/lib/chroot-distro/containers/debian/rootfs/root/.hermes/state.db" ]' "chroot remove fails: Debian NOT deleted by hand"
check 'grep -qx "allow-external-apps = true" "$T/home/.termux/termux.properties"' "after a failure Termux still takes the app's commands (re-run possible)"
check '! echo "$out" | grep -qx "HMUNINSTALL DONE"' "no DONE after a failure"

echo
if [ "$fails" = 0 ]; then echo "test_uninstall: PASSED"; else echo "test_uninstall: $fails FAILED"; exit 1; fi
