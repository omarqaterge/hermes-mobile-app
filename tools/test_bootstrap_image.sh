#!/usr/bin/env bash
# The ready-made image path of phone/bootstrap.sh, with a fake curl / proot-distro / uname / df (no network, no phone):
# its image block and Debian step are cut out of bootstrap.sh and run against each case. Also the image packer's scrub.
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
BOOT="$here/phone/bootstrap.sh"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fails=0

# The block under test: from the image marker to the end of the Debian step's if/else.
awk '/^# --- ready-made image/ {on=1} on {print} on && /^step debian / {d=1} d && /^fi$/ {exit}' "$BOOT" > "$work/block.sh"
grep -q '^image_restore()' "$work/block.sh" && grep -q 'proot-distro install debian' "$work/block.sh" \
  || { echo "FAIL: image block / Debian step not found in bootstrap.sh"; exit 1; }
pin=$(sed -n 's/^HERMES_COMMIT=\([0-9a-f]\{40\}\).*/\1/p' "$BOOT")
base=$(sed -n 's/^HERMES_IMAGE_BASE=\(.*\)$/\1/p' "$BOOT")
mb=$(sed -n 's/^HERMES_IMAGE_MB=\([0-9]*\)$/\1/p' "$BOOT")
[ -n "$pin" ] && [ -n "$base" ] && [ -n "$mb" ] || { echo "FAIL: HERMES_COMMIT / HERMES_IMAGE_BASE / HERMES_IMAGE_MB missing"; exit 1; }
name="hermes-debian-${pin:0:12}-arm64.tar.zst"
# the name the build script gives the image must be the one bootstrap.sh looks for
[ "$(bash "$here/tools/build-image.sh" --name)" = "$name" ] || { echo "FAIL: build-image.sh --name != bootstrap's image name"; exit 1; }

mkdir -p "$work/bin"
# fake curl: URL -> file under $SERVE (by its path after the host); missing = HTTP 404 (exit 22). Every URL is logged.
cat > "$work/bin/curl" <<'SH'
#!/usr/bin/env bash
out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2 ;; --retry|--retry-delay) shift 2 ;; -*) shift ;; *) url=$1; shift ;; esac; done
echo "$url" >> "$CALLS/curl"
f="$SERVE/${url#*://*/}"
[ -f "$f" ] || { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }
if [ -n "$out" ]; then cp "$f" "$out"; else cat "$f"; fi
SH
# fake proot-distro: restore = a rootfs with Hermes's install stamp (or FAKE_RESTORE=fail), install = the normal path
cat > "$work/bin/proot-distro" <<'SH'
#!/usr/bin/env bash
echo "$*" >> "$CALLS/proot-distro"
c="$PREFIX/var/lib/proot-distro/containers/debian"
case "$1" in
  restore) [ -f "$2" ] || exit 1
           if [ "${FAKE_RESTORE:-ok}" = fail ]; then mkdir -p "$c/rootfs/root"; exit 1; fi
           mkdir -p "$c/rootfs/root/.hermes/hermes-agent" && touch "$c/rootfs/root/.hermes/hermes-agent/install-stamp.json" ;;
  install) mkdir -p "$c/rootfs/root" && touch "$c/normal-install" ;;
  remove)  rm -rf "$c" ;;
  login)   exit 0 ;;
esac
SH
printf '#!/bin/sh\necho "${FAKE_ARCH:-aarch64}"\n' > "$work/bin/uname"
printf '#!/bin/sh\necho "Filesystem 1024-blocks Used Available Capacity Mounted"\necho "/dev/x 99999999 1 ${FAKE_FREE_KB:-20000000} 1%% /"\n' > "$work/bin/df"
command -v sha256sum >/dev/null || printf '#!/bin/sh\nexec shasum -a 256 "$@"\n' > "$work/bin/sha256sum"
chmod +x "$work/bin/"*

# run_case <label> [VAR=value ...]: a fresh Termux home; the image and its .sha256 served unless the case changes it
run_case() {
  local label=$1; shift
  local t="$work/$label"; mkdir -p "$t/home" "$t/prefix" "$t/serve" "$t/calls"
  local rel="${base#*://*/}/hermes-image-${pin:0:12}"
  mkdir -p "$t/serve/$rel"
  printf 'fake image %s\n' "$label" > "$t/serve/$rel/$name"
  (cd "$t/serve/$rel" && echo "$( (sha256sum "$name" 2>/dev/null || shasum -a 256 "$name") | cut -c1-64)  $name" > "$name.sha256")
  (
    export HOME="$t/home" PREFIX="$t/prefix" SERVE="$t/serve" CALLS="$t/calls" PATH="$work/bin:$PATH"
    unset HM_IMAGE HM_IMAGE_URL HM_IMAGE_MB
    for kv in "$@"; do export "${kv?}"; done
    [ -z "${PRE:-}" ] || eval "$PRE"
    cd "$t" && bash -c '
      set -eE -o pipefail
      HERMES_COMMIT='"$pin"' HERMES_IMAGE_BASE='"$base"' HERMES_IMAGE_MB='"$mb"'
      HM_DISTRO=${HM_DISTRO:-proot}
      ROOT="$PREFIX/var/lib/proot-distro/containers/debian/rootfs/root"
      say() { echo "== HMSETUP $*" | tee -a "$CALLS/say"; }
      step() { STEP=$1; shift; say "STEP $STEP $*"; }
      deb() { echo "$1" >> "$CALLS/deb"; }
      chroot-distro() { echo "$*" >> "$CALLS/chroot-distro"; [ "$1" != login ] || return 1; }
      . ./block.sh' > "$t/out" 2>&1 < /dev/null || echo "exit $?" >> "$t/out"
  ) || true
}
case_dir() { echo "$work/$1"; }
check() {  # check <label> <description> <shell test, run in the case dir>
  if (cd "$(case_dir "$1")" && eval "$3"); then echo "ok   $1: $2"; else echo "FAIL $1: $2"; sed 's/^/     | /' "$(case_dir "$1")/out"; fails=$((fails + 1)); fi
}
go() { local l=$1; shift; mkdir -p "$work/$l"; cp "$work/block.sh" "$work/$l/"; run_case "$l" "$@"; }
C=prefix/var/lib/proot-distro/containers/debian
img_url="$base/hermes-image-${pin:0:12}/$name"

go used
check used "image downloaded from the pin's release, restored, no normal install" \
  "grep -qx '$img_url.sha256' calls/curl && grep -qx '$img_url' calls/curl && grep -q '^restore ' calls/proot-distro && [ ! -e $C/normal-install ]"
check used "log says the image was used; image's patches reverted for install.sh; download removed" \
  "grep -q 'image: using the ready-made Debian' calls/say && grep -q 'hermes-patches.sh revert' calls/deb && [ ! -e home/hm-debian-image.tar.zst ]"

go missing PRE='rm -rf "$SERVE"/*'
check missing "no image for this pin (404) -> normal install, image itself never fetched" \
  "grep -q 'image: none for this Hermes' calls/say && [ \$(wc -l < calls/curl) = 1 ] && [ -e $C/normal-install ] && ! grep -q '^restore' calls/proot-distro"

go img404 PRE='rm -f "$SERVE"/*/*/*/*/*/*.zst'
check img404 "sha256 there but image 404 -> download failed, normal install" \
  "grep -q 'image: download failed' calls/say && [ -e $C/normal-install ] && [ ! -e home/hm-debian-image.tar.zst ]"

go badsum PRE='for f in "$SERVE"/*/*/*/*/*/*.sha256; do echo "$(printf %064d 0)  x" > "$f"; done'
check badsum "sha256 mismatch -> normal install, download deleted, nothing restored" \
  "grep -q 'image: sha256 does not match' calls/say && [ -e $C/normal-install ] && ! grep -q '^restore' calls/proot-distro && [ ! -e home/hm-debian-image.tar.zst ]"

go existing PRE='mkdir -p "$PREFIX/var/lib/proot-distro/containers/debian/rootfs/root"'
check existing "existing Debian -> no download, no install" \
  "[ ! -e calls/curl ] && [ ! -e calls/proot-distro ]"

go off HM_IMAGE=0
check off "HM_IMAGE=0 -> no download, normal install" \
  "[ ! -e calls/curl ] && grep -q 'image: HM_IMAGE=0' calls/say && [ -e $C/normal-install ]"

go restorefail FAKE_RESTORE=fail
check restorefail "restore fails -> half-made rootfs removed, normal install" \
  "grep -q 'image: unpacking failed' calls/say && grep -q '^remove debian' calls/proot-distro && [ -e $C/normal-install ]"

go lowspace FAKE_FREE_KB=1000000
check lowspace "too little free space -> no download, normal install" \
  "grep -q 'MB free, it needs' calls/say && [ \$(wc -l < calls/curl) = 1 ] && [ -e $C/normal-install ]"

go x86 FAKE_ARCH=x86_64
check x86 "not arm64 -> no download, normal install" \
  "[ ! -e calls/curl ] && grep -q 'only for arm64' calls/say && [ -e $C/normal-install ]"

go override HM_IMAGE_URL=http://10.0.2.2:8802/other.tar.zst PRE='cp "$SERVE"/*/*/*/*/*/*.zst "$SERVE/other.tar.zst"; n=$(ls "$SERVE"/*/*/*/*/*/*.zst); echo "$(cut -c1-64 "$n.sha256")  other.tar.zst" > "$SERVE/other.tar.zst.sha256"'
check override "HM_IMAGE_URL overrides the pinned URL (sha256 from URL.sha256)" \
  "grep -qx 'http://10.0.2.2:8802/other.tar.zst' calls/curl && grep -q 'image: using' calls/say"

go chroot HM_DISTRO=chroot
check chroot "chroot-distro -> image skipped (said so), normal chroot install" \
  "[ ! -e calls/curl ] && grep -q 'not used with chroot-distro' calls/say && grep -q '^install --name debian debian:trixie' calls/chroot-distro"

# The packer (tools/pack_image.py): a docker-export-like rootfs with secrets in it -> scrubbed, proot-distro layout, check OK;
# an archive that still holds a scrubbed path -> check fails.
pk="$work/pack"; mkdir -p "$pk/fs/root/.hermes/hermes-agent" "$pk/fs/root/.hermes/sessions" "$pk/fs/root/.local/bin" \
  "$pk/fs/etc/profile.d" "$pk/fs/root/.hermes/hermes-mobile-patches" "$pk/fs/root/.hermes/scripts" "$pk/fs/var/lib/apt/lists"
touch "$pk/fs/root/.hermes/hermes-agent/install-stamp.json" "$pk/fs/root/.local/bin/hermes" "$pk/fs/etc/profile.d/zz-no-termux-path.sh" \
  "$pk/fs/root/.hermes/scripts/hermes-patches.sh" "$pk/fs/root/.hermes/hermes-mobile-patches/0001.patch" "$pk/fs/etc/resolv.conf" \
  "$pk/fs/etc/hosts" "$pk/fs/.dockerenv" "$pk/fs/var/lib/apt/lists/x_Packages"
echo SECRET=1 > "$pk/fs/root/.hermes/.env"; echo id > "$pk/fs/root/.hermes/install_id"; echo s > "$pk/fs/root/.hermes/sessions/a.json"
echo '{}' > "$pk/manifest.json"
(cd "$pk/fs" && tar -cf - .) | python3 "$here/tools/pack_image.py" pack --manifest "$pk/manifest.json" > "$pk/img.tar" 2>/dev/null
if python3 "$here/tools/pack_image.py" check < "$pk/img.tar" > "$pk/check.txt" && ! tar -tf "$pk/img.tar" | grep -qE '\.env$|install_id|sessions|\.dockerenv|x_Packages' \
   && tar -xOf "$pk/img.tar" debian/rootfs/etc/resolv.conf | grep -q nameserver && tar -tf "$pk/img.tar" | grep -qx 'debian/manifest.json'; then
  echo "ok   pack: secrets scrubbed, resolv.conf written, proot-distro layout, check OK"
else echo "FAIL pack: $(cat "$pk/check.txt")"; fails=$((fails + 1)); fi
mkdir -p "$pk/bad/debian/rootfs/root/.hermes"; echo SECRET=1 > "$pk/bad/debian/rootfs/root/.hermes/.env"
if (cd "$pk/bad" && tar -cf - debian) | python3 "$here/tools/pack_image.py" check > "$pk/bad.txt"; then
  echo "FAIL pack check: passed an archive with .env in it"; fails=$((fails + 1))
else grep -q 'scrubbed path in the archive (root/.hermes/.env)' "$pk/bad.txt" && echo "ok   pack check: refuses an archive with root/.hermes/.env" \
  || { echo "FAIL pack check: $(cat "$pk/bad.txt")"; fails=$((fails + 1)); }; fi

[ "$fails" = 0 ] && echo "bootstrap image: OK" || { echo "bootstrap image: $fails FAILED"; exit 1; }
