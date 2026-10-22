# Spike: a ready-made Debian + Hermes download

Question (owner decision 4): should a new install download a prebuilt Debian with Hermes already in it, instead of
installing Debian and running Hermes's installer on the phone? How much faster is it, how much harder to maintain, and
does it change anything for the agent?

Everything below was measured on 2026-10-21 on Android 15 emulators (arm64, 4 cores, on an Apple Silicon Mac that was
also running other emulators) with the installer on the `integrate/install` branch (Hermes pinned to
`b8a8be18`, `libatomic1`, phantom-process step). No real phone was used. An emulator on Apple Silicon runs close to
native speed, so a mid-range phone is likely slower at both the normal install (CPU-bound) and the restore
(storage-bound); that ratio is a guess, not measured.

## Short answer

| | Normal install | With the image |
|---|---|---|
| Debian + Hermes steps (emulator, fast network) | **1074 s (17.9 min)** | **~130 s restore + download + 14 s** |
| Download needed for those steps | not measured exactly (see below) | **863 MB** (zstd -19) |
| Same at 50 Mbit/s | ~18 min or more | **~4.5 min** (138 s download + ~130 s restore) |
| Same at 10 Mbit/s | ~18 min or more | **~13.5 min** (690 s download + ~130 s restore) |
| Whole install, Termux typed line → DONE | 1421 s (23.7 min) | 661 s (11.0 min), incl. a 193 s download at ~45 Mbit/s |
| Browser tools work after install | **no** (see "Browser" below) | yes, if the image carries Chromium's libraries |
| Hermes the agent sees | pin `b8a8be18` + patches 0001-0003 | identical (same commit, same patch diff, same tools) |

So: on a decent connection the image saves about 13 of 24 minutes and removes the most fragile part of the install
(Hermes's installer under proot). On a slow connection the gain shrinks to a few minutes, because both routes are
then limited by how much they download. For the agent nothing changes. The cost is one CI job per pin bump, a packer
script, a second install path in `bootstrap.sh`, and testing both paths.

## 1. Normal install, per step (wiped emulator)

Computer route (`tools/setup-phone.sh` with the tarball of this branch), times from the `HMSETUP` logcat stamps.

| Step | Normal install | Install with image (restore run) |
|---|---|---|
| packages (Termux apt) | 42 s | 160 s ¹ |
| access (files, Termux:API, Shizuku) | 26 s | 44 s |
| android (child-process limit) | 5 s | 9 s |
| **image**: download 1.09 GB | — | 193 s ² |
| **image**: `proot-distro restore` | — | 151 s (zstd level 3) / **116 s** (zstd -19) |
| debian (rootfs + apt line) | 152 s | 6 s |
| hermes (Hermes's installer) | **922 s** ³ | 8 s (finds Hermes, skips) |
| plugin (`install.sh`: plugin, patches, supervisor) | 241 s ⁴ | 70 s |
| start (dashboard answers) | 33 s | 13 s |
| **Total** | **1421 s** | **661 s** |

¹ Same work as the normal run; the Mac was busier (other emulators + compression jobs). Not an effect of the image.
² The emulator's link to the Mac's HTTP server ran at ~45-60 Mbit/s, i.e. a realistic home connection.
³ Includes a failed first attempt (209 s) and the existing proot retry (`uv`'s Python on PATH): this happens on every
proot install. The browser download failed quickly (see "Browser"), so this number has no browser in it.
⁴ Includes ~95 s waiting for Shizuku's "allow Termux" dialog that nobody tapped (emulator artefact).

### Browser tools (`--skip-browser` cost)

- Browser tools as such: `hermes pm install agent-browser` = **24 s** on the emulator (188 MB Chromium zip + agent-browser,
  604 MB unpacked), plus **20 s** / **+218 MB** for the system libraries Chromium needs (below). At 10 Mbit/s the zip alone is
  ~150 s; at 50 Mbit/s ~30 s. In the image they add roughly 200 MB compressed.
- The separate wiped `--skip-browser` run: see "Appendix: --skip-browser run".

**Found while measuring: a fresh install today has no working browser, on either route.**
1. The pinned Hermes downloads linux-arm64 Chromium from
   `cdn.playwright.dev/dbazure/download/playwright/builds/chromium/1208/chromium-linux-arm64.zip`, which redirects to
   `playwright.download.prss.microsoft.com`; that name does not resolve (NXDOMAIN, also from the Mac). The same file
   (same sha256 `70b46205…`) is served at `cdn.playwright.dev/builds/chromium/1208/chromium-linux-arm64.zip`. Hermes
   `main` has the same URL code. Hermes reports `⚠ optional agent-browser was not installed` and the install still says DONE.
2. Even when Chromium is there, it cannot start: Debian lacks 21 shared libraries (`libglib-2.0`, `libnss3`, `libatk*`,
   `libcups2`, `libgbm1`, `libpango`, `libcairo2`, `libasound2`, X libs). Neither `bootstrap.sh` nor Hermes's installer
   installs them. With
   `apt-get install --no-install-recommends libglib2.0-0t64 libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64
   libatspi2.0-0t64 libcups2t64 libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1
   libpango-1.0-0 libcairo2 libasound2t64`, `agent-browser open https://example.com` returned "Example Domain" under proot
   on the emulator.

The owner keeps the browser in the install, so the normal installer needs both fixes whether or not an image is built
(it stays the fallback). Not checked on the owner's phone (no phone in this phase).

## 2. The image

Two images were made and both restored on a wiped emulator:

| Image | How | tar | zstd (proot-distro default, level 3) | zstd -19 --long=27 | xz -9 | xz -6 |
|---|---|---|---|---|---|---|
| on-device | `proot-distro backup debian` after a normal install + browser, Hermes stopped, scrubbed | 3.47 GB | 1,093,777,494 B (148 s on the emulator) | 840,442,513 B | 854,583,896 B | 935,133,908 B |
| off-device ("CI") | `debian:trixie` arm64 container, pin's installer `--commit`, browser, patches, scrubbed, packed into proot-distro's layout | 3.26 GB | — | **863,057,796 B** | — | — |

- xz is not worth it: -9 is slightly larger than zstd -19 and much slower to unpack on a phone. Use zstd -19 --long=27
  (Termux's Python 3.14 reads zstd; `--long=27` stays within the default decoder window).
- Download time = size / link speed: 863 MB is **690 s at 10 Mbit/s, 138 s at 50 Mbit/s**; 1.09 GB is 875 s / 175 s.
- Under GitHub's 2 GB release-asset limit with room to spare. Where the bytes are (container build): Chromium 602 MB,
  `hermes-agent/node_modules` 389 MB, Hermes's venv 368 MB, ffmpeg 329 MB, `hermes-agent/.git` 295 MB, Python 260 MB,
  Node 223 MB, Debian `/usr` 294 MB. `node_modules` (if only needed to build the web UI) and a shallower `.git` are
  the obvious cuts; not tested.

### What must not ship (checked on a real install, no model key set)

Removed before packing: `~/.hermes/.env` (on a fresh install it equals `.env.example`, no secrets, but it is per-user),
`install_id` (a per-install id: shipping it would give every user the same one), `state.db*`, `shared-state.db`,
`spawn-ledger.json`, `sessions/`, `logs/`, `memories/`, `cron/`, `pairing/`, `backups/`, `audio_cache/`, `image_cache/`,
`cache/` (65 MB uv cache), `state/`, `*.lock`, `/root/.npm` (101 MB cache), `/root/.cache`, `/var/lib/apt/lists`, `/tmp`.
There was no `auth.json`, `~/.ssh` or shell history. The Termux key (`~/.hermes-mobile/key`) lives outside the rootfs.
The emulator-only `/etc/profile.d/zz-emulator-test.sh` must also go. A CI build never sees a user's data, so the list
is mostly about per-install ids and caches.

## 3. Restore: is the restored Hermes the same?

Same probe on the normal install and on both restored images:

| Check | Normal install | Restored (on-device image) | Restored (CI image) |
|---|---|---|---|
| Hermes HEAD | `b8a8be18…` | same | same |
| Our patches (`git diff` sha256) | `dc05e0bf…` | same | same |
| `hermes-patches.sh status` | 0001-0003 applied | applied | applied (install.sh: "already in") |
| plugin hermes-mobile enabled | yes | yes | yes |
| tools (node, python, uv, ffmpeg, ripgrep, chromium, agent-browser) | same list | same | same |
| Python / OpenSSL in Hermes's venv | 3.14.7 / 3.5.8 | same | same |
| dashboard `127.0.0.1:9119` | 200 | 200 | 200 |
| app connected (app uid holds a TCP socket to :9119) | yes | yes | yes |
| browser (`agent-browser open example.com`) | after deps: ✓ | — | after deps: ✓ |
| `hermes --version` | `vgit.b8a8be1` | `vgit.b8a8be1` | `v0.21.5+4582.gb8a8be1` |

- `install_id` is recreated at first start; `.env` is recreated by `hermes config set` (checked).
- Only difference: the version string. The CI build reports the tagged version (= `web/vendor/hermes-shared/.hermes-version`);
  the on-phone install reports `vgit.b8a8be1` (its clone apparently lacks tags). Cosmetic; not investigated further.
- With the image, `bootstrap.sh`'s own steps already do the right thing: `debian` skips the rootfs install,
  `hermes` sees `install-stamp.json` and skips, `install.sh` re-applies (finds) the patches and installs the plugin.

**For the agent nothing changes**: same Hermes commit, same patches, same tools, same config defaults. It is an
install-time change only. What would change at runtime is only what the image adds on purpose (e.g. Chromium's libraries).

## 4. chroot-distro (rooted phones)

On the rooted emulator, `chroot-distro install --name hmimg <file>` (chroot-distro 3.2.0) accepted the same
proot-distro backup archive (`debian/manifest.json` + `debian/rootfs/…`) in 29 s. Inside (as real root): Hermes
`v0.21.5+4582.gb8a8be1`, HEAD `b8a8be18`, patches applied, dashboard HTTP 200 after ~12 s. The test image had Chromium,
ffmpeg and `node_modules` left out because that emulator had only 2.7 GB free; the full image was not tried there.
`chroot-distro restore` also reads this layout. One archive serves both routes.

## 5. Building it off the phone

**Yes, feasible.** Done here in an arm64 `debian:trixie` container (OrbStack on Apple Silicon, native arm64), which is
what a GitHub `ubuntu-24.04-arm` runner provides (free for public repos):
1. `apt-get install curl git ca-certificates xz-utils procps libatomic1` (+ Chromium's libraries), write bootstrap's
   `zz-no-termux-path.sh`.
2. The pin's own `scripts/install.sh --non-interactive --commit <pin>`: 404 s (no proot retry needed in a container),
   browser 137 s, total job 660 s.
3. Copy `hermes/patches` + `phone/hermes-patches.sh`, `apply`.
4. Scrub (list above), `docker export`, repack into proot-distro's backup layout (≈30-line Python), `zstd -19 --long=27`.

Paths inside the container are the same as under proot (`/root/.hermes/...`), so the venv and launchers work unchanged.
Things the packer must do, found the hard way: write `etc/resolv.conf` and `etc/hosts` (docker leaves them empty;
`proot-distro install` would write them, `restore` does not); drop `.dockerenv`; rewrite member names without leaving
the PAX `path` header behind (a non-ASCII ca-certificates name otherwise made `restore` refuse the archive as "more than
one container"). proot-distro's backup format (current, Python version in Termux): `<name>/manifest.json` +
`<name>/rootfs/...`, owners stripped to 0, proot's link2symlink files resolved to plain files; restore also accepts
the older `installed-rootfs/<name>` layout. `proot-distro install <url-or-file>` takes a plain rootfs tarball too.

## 6. Maintenance cost

- **CI job per pin bump**: one workflow (build in the container, pack, zstd, upload as a release asset with its sha256),
  ~11-15 min per run. `bootstrap.sh` gets `HERMES_IMAGE_URL` + sha256 next to `HERMES_COMMIT`; extend
  `tools/test_bootstrap_pin.sh` so the image name must contain the pin and a hash of `hermes/patches`, or the two drift.
- **Staleness**: the image freezes Debian's packages at build time. Running `apt-get upgrade` in the `debian` step (or
  rebuilding monthly) keeps security updates coming; Hermes itself only moves with the pin anyway.
- **Secrets**: low risk when built in CI (no user data ever there); the scrub list still matters for per-install ids and
  caches, and a check that fails the job if any of those paths exist in the archive.
- **Fallback stays**: the normal install must keep working for when the download fails, the sha256 doesn't match, the
  phone runs an older proot-distro that can't read the layout, or the phone isn't arm64 (the setup script already
  refuses non-arm64). So both paths have to be tested on every installer change: two emulator runs instead of one.
- **Size limit**: 0.86 GB now vs GitHub's 2 GB per asset; fine unless Hermes grows a lot.
- **Upgrades after install**: the image is a normal git checkout of Hermes, so `hermes update` should behave as on a normal
  install (not tested).

## 7. Recommendation

1. **First, independent of the image**: fix the browser in the normal installer (Chromium's libraries in bootstrap's
   Debian apt line, and the dead Chromium URL: patch or upstream report). Today the owner's "keep the browser" decision
   doesn't hold for new installs.
2. **Then the image is worth it if install time matters to the owner**: ~13 minutes saved on a 50 Mbit/s connection
   (24 → ~11 min total on the emulator), fewer things that can break on the phone (Hermes's installer under proot,
   npm/uv/CDN downloads), identical Hermes for the agent, and rooted phones can use the same file. On slow
   connections (≤10 Mbit/s) the gain is small, so keep the normal install as the automatic fallback and don't promise a
   big speed-up.
3. Build it only off-device (CI, arm64 container), zstd -19, one release asset per pin, never from a used phone.
   Existing users never download it.

Not measured / open: a real phone (restore speed on phone storage, download on mobile data), the exact number of bytes
a normal install downloads, `hermes update` from a restored image, the full image under chroot-distro on a real rooted
phone, and image size cuts (`node_modules`, shallow `.git`).

## Appendix: --skip-browser run

Not finished: the separate wiped `--skip-browser` run was stopped partway (the measuring session ended). It is not
needed for the decision: in the full run the browser download failed within seconds, so the 922 s Hermes step above is
already a no-browser number, and the browser's own cost was measured directly (`hermes pm install agent-browser` 24 s,
Chromium's libraries 20 s, ~800 MB on disk, ~200 MB more in the compressed image).
