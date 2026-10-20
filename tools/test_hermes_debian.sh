#!/usr/bin/env bash
# Checks phone/hermes-debian (the proot-distro / chroot-distro switch) with fake proot-distro, chroot-distro and su.
#   bash tools/test_hermes_debian.sh
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
export HOME="$t/home" PREFIX="$t/usr"
mkdir -p "$HOME/.hermes-mobile" "$PREFIX/tmp" "$t/bin"
fails=0
check() { if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1: got [$2], want [$3]"; fails=$((fails + 1)); fi; }

# Fakes: "login debian -- CMD..." runs CMD on this machine. The fake chroot-distro always exits 0, like chroot-distro 3.2
# does for a failed command when stdin is a terminal; su records what it was asked to run.
cat > "$t/bin/proot-distro" <<'EOF'
#!/usr/bin/env bash
[ "$1 $2 $3" = "login debian --" ] || { echo "bad args: $*" >&2; exit 99; }
shift 3; "$@"
EOF
cat > "$t/bin/chroot-distro" <<'EOF'
#!/usr/bin/env bash
case "$*" in "login -b /dev/__properties__ -b /dev/socket debian -- "*) ;; *) echo "bad args: $*" >&2; exit 99 ;; esac
shift 7; "$@"; exit 0
EOF
cat > "$t/bin/su" <<'EOF'
#!/usr/bin/env bash
echo "$*" > "$HOME/su-args"
EOF
chmod +x "$t/bin/"*
export PATH="$t/bin:$PATH"
hd="$here/phone/hermes-debian"

echo "proot-distro (no distro file)"
check "--which" "$(bash "$hd" --which)" proot
check "--rootfs" "$(bash "$hd" --rootfs)" "$PREFIX/var/lib/proot-distro/containers/debian/rootfs"
bash "$hd" sh -c 'exit 3'; check "exit code passed through" "$?" 3
echo hi > "$t/src.txt"
bash "$hd" --put "$t/src.txt" /root/.hermes/scripts/x.txt
check "--put copies into the rootfs" "$(cat "$PREFIX/var/lib/proot-distro/containers/debian/rootfs/root/.hermes/scripts/x.txt")" hi
bash "$hd" --exists /root/.hermes/scripts/x.txt; check "--exists finds it" "$?" 0
bash "$hd" --exists /root/nope; check "--exists misses" "$?" 1

echo "chroot-distro (distro file says chroot)"
echo chroot > "$HOME/.hermes-mobile/distro"
check "--which" "$(bash "$hd" --which)" chroot
bash "$hd" false; check "a failed command fails although chroot-distro says 0" "$?" 1
bash "$hd" sh -c 'exit 3'; check "its exit code is passed back" "$?" 3
bash "$hd" true; check "a good command succeeds" "$?" 0
check "no exit-code files left" "$(ls "$HOME/.hermes-mobile" | grep -c '^rc\.')" 0
# Here "Debian" is this machine, so DEST is a real path under $t.
bash "$hd" --put "$t/src.txt" "$t/dest/x.txt"
check "--put copies from inside Debian" "$(cat "$t/dest/x.txt")" hi
bash "$hd" --restart
check "--restart asks su, with a pattern that can't match su itself" "$(cat "$HOME/su-args")" \
  "-c pkill -9 -f '[h]ermes dashboard --host 127.0.0.1 --port 9119'"
bash "$hd" --bogus 2>/dev/null; check "unknown option refused" "$?" 2

[ "$fails" -eq 0 ] && echo "hermes-debian: OK" || { echo "hermes-debian: $fails failed"; exit 1; }
