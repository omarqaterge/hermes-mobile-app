#!/usr/bin/env python3
"""Pack and check the ready-made Debian + Hermes image (used by tools/build-image.sh).

  pack --manifest FILE   docker export (a rootfs tar) on stdin -> proot-distro backup layout on stdout:
                         debian/manifest.json + debian/rootfs/..., scrubbed (SCRUB below), owners set to root.
  check                  the packed tar (uncompressed) on stdin; exits 1 when the archive is not one container named
                         'debian', a scrubbed path is in it, or a file the restore relies on is missing.

proot-distro restore (and chroot-distro install/restore) read this layout. Things found the hard way:
- docker leaves etc/resolv.conf and etc/hosts empty; `proot-distro install` writes them, `restore` does not.
- tarfile keeps a PAX 'path' header for non-ASCII names: renaming the member is not enough, the header must go too, or
  the member keeps its old name and restore refuses the archive ("more than one container").
"""
import argparse
import fnmatch
import io
import sys
import tarfile
import time

NAME = 'debian'
# Never in the image: per-user secrets and ids, Hermes state, logs, caches, shell history, emulator-only test files.
# Paths are relative to the rootfs; '*' matches inside one path segment only; a match also drops everything below it.
SCRUB = [
    '.dockerenv',
    'root/.hermes/.env', 'root/.hermes/auth.json', 'root/.hermes/install_id',
    'root/.hermes/state.db*', 'root/.hermes/shared-state.db*', 'root/.hermes/spawn-ledger.json', 'root/.hermes/*.lock',
    'root/.hermes/sessions', 'root/.hermes/logs', 'root/.hermes/memories', 'root/.hermes/cron', 'root/.hermes/pairing',
    'root/.hermes/backups', 'root/.hermes/audio_cache', 'root/.hermes/image_cache', 'root/.hermes/cache',
    'root/.hermes/state',
    'root/.npm', 'root/.cache', 'root/.ssh', 'root/.bash_history', 'root/.python_history', 'root/.lesshst',
    'root/.wget-hsts', 'root/.viminfo',
    'var/lib/apt/lists/*', 'var/cache/apt/*.bin', 'var/cache/apt/archives/*.deb',
    'tmp/*', 'var/tmp/*',
    'etc/profile.d/zz-emulator-test.sh',
]
KEEP = {'var/lib/apt/lists/partial'}  # apt wants it to exist
OVERRIDE = {
    'etc/resolv.conf': b'nameserver 8.8.8.8\nnameserver 8.8.4.4\n',
    'etc/hosts': b'127.0.0.1   localhost.localdomain localhost\n'
                 b'::1         localhost.localdomain localhost ip6-localhost ip6-loopback\n',
}
# What bootstrap.sh relies on after a restore (its hermes step skips the installer when these are there).
REQUIRED = [
    'root/.hermes/hermes-agent/install-stamp.json', 'root/.local/bin/hermes', 'etc/profile.d/zz-no-termux-path.sh',
    'root/.hermes/hermes-mobile-patches', 'root/.hermes/scripts/hermes-patches.sh', 'etc/resolv.conf', 'etc/hosts',
]


def scrubbed(rel):
    """The SCRUB pattern that drops this rootfs-relative path, or None."""
    if rel in KEEP:
        return None
    parts = rel.split('/')
    for pat in SCRUB:
        pp = pat.split('/')
        if len(parts) >= len(pp) and all(fnmatch.fnmatchcase(a, b) for a, b in zip(parts, pp)):
            return pat
    return None


def rel_name(name):
    if name.startswith('./'):
        name = name[2:]
    return name.lstrip('/').rstrip('/')


def add_bytes(out, name, data, mode=0o644):
    ti = tarfile.TarInfo(name)
    ti.size, ti.mode, ti.mtime = len(data), mode, int(time.time())
    out.addfile(ti, io.BytesIO(data))


def pack(manifest_path):
    src = tarfile.open(fileobj=sys.stdin.buffer, mode='r|')
    out = tarfile.open(fileobj=sys.stdout.buffer, mode='w|', format=tarfile.PAX_FORMAT)
    add_bytes(out, f'{NAME}/manifest.json', open(manifest_path, 'rb').read(), 0o600)
    d = tarfile.TarInfo(f'{NAME}/rootfs')
    d.type, d.mode = tarfile.DIRTYPE, 0o755
    out.addfile(d)
    n = dropped = 0
    for m in src:
        rel = rel_name(m.name)
        if not rel or rel in OVERRIDE:
            continue
        if scrubbed(rel):
            dropped += 1
            continue
        m.pax_headers.pop('path', None)
        m.pax_headers.pop('linkpath', None)
        m.name = f'{NAME}/rootfs/{rel}'
        if m.islnk():
            m.linkname = f'{NAME}/rootfs/{rel_name(m.linkname)}'
        m.uid = m.gid = 0
        m.uname = m.gname = 'root'
        out.addfile(m, src.extractfile(m) if m.isreg() else None)
        n += 1
    for k, v in OVERRIDE.items():
        add_bytes(out, f'{NAME}/rootfs/{k}', v)
    p = tarfile.TarInfo(f'{NAME}/rootfs/var/lib/apt/lists/partial')
    p.type, p.mode = tarfile.DIRTYPE, 0o700
    out.addfile(p)
    out.close()
    sys.stderr.write(f'pack: {n} members, {dropped} scrubbed\n')


def check():
    src = tarfile.open(fileobj=sys.stdin.buffer, mode='r|')
    bad, seen, n, size = [], set(), 0, 0
    prefix = f'{NAME}/rootfs/'
    for m in src:
        n += 1
        size += m.size
        name = m.name.rstrip('/')
        if name in (NAME, f'{NAME}/rootfs', f'{NAME}/manifest.json'):
            seen.add(name)
            continue
        if not name.startswith(prefix):
            bad.append(f'outside {prefix}: {name}')
            continue
        rel = name[len(prefix):]
        seen.add(rel)
        pat = scrubbed(rel)
        if pat:
            bad.append(f'scrubbed path in the archive ({pat}): {rel}')
        if rel in OVERRIDE and m.size == 0:
            bad.append(f'empty {rel}')
    for r in REQUIRED + [f'{NAME}/manifest.json']:
        if r not in seen:
            bad.append(f'missing: {r}')
    for b in bad[:50]:
        print('FAIL', b)
    if bad:
        print(f'check: FAILED ({len(bad)} problems in {n} members)')
        sys.exit(1)
    print(f'check: OK ({n} members, {size} bytes unpacked)')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('pack')
    p.add_argument('--manifest', required=True)
    sub.add_parser('check')
    a = ap.parse_args()
    pack(a.manifest) if a.cmd == 'pack' else check()
