### 6.3 Install routes

All routes end with the same result: Termux, Termux:API, Termux:Boot and Shizuku installed; Debian with the pinned Hermes and the plugin; `hermes-services` running; the app installed with its permissions. Android 8 (API 26) or newer, arm64, about 6 GB free, no root needed. Every route runs the same `phone/bootstrap.sh`.

#### Computer route (`tools/setup-phone.sh`, `tools/setup-phone.ps1`)

For macOS/Linux (`.sh`) and Windows PowerShell (`.ps1`, same steps). It drives the phone over `adb` and types into Termux with `adb shell input text`. Environment: `HM_PROVIDER`, `HM_MODEL`, `HM_KEY_NAME`, `HM_KEY` (set a model without questions), `HM_SKIP_MODEL=1` (leave the model to the app), `HM_DISTRO=chroot`, `HM_WORK` (work folder, default `~/.hermes-mobile-setup`), `-s <serial>` or `ANDROID_SERIAL` (`HM_SERIAL` in the `.ps1`) to pick a device. It prints Xiaomi-specific hints (Install via USB, USB debugging (Security settings)) where those settings are needed.

1. **1/9 adb**: uses `adb` from the path, or downloads Google's platform-tools.
2. **2/9 phone**: waits for one authorized device; checks arm64, API 26+, free space (6 GB, 2 GB when Termux is already installed).
3. **3/9 Termux**: installs Termux (must be 0.118 or newer if present), Termux:Boot, Termux:API from F-Droid (version from F-Droid's API `suggestedVersionCode`) and Shizuku 13.6.0 from GitHub; opens Termux:Boot once.
4. **4/9 Android settings**: screen stays on, Termux exempt from background limits, Shizuku exempt, files permission for Termux, starts Shizuku over adb, grants Shizuku `WRITE_SECURE_SETTINGS`, and on API 31+ lifts the phantom-process limit.
5. **5/9 Termux ready**: opens Termux and types a probe line until it appears in the log.
6. **6/9 install**: types `curl -fsSL .../phone/bootstrap.sh -o hm.sh && [HM_DISTRO=chroot ]HM_NO_APK=1 bash hm.sh` and follows `HMSETUP` lines from `adb logcat` until `DONE`; on `FAIL` it saves a Termux screenshot and stops (2-hour limit).
7. **7/9 model**: types `bash hm.sh model ...` with the key, then `history -c && clear`. Key characters are checked first.
8. **8/9 app**: downloads and installs the latest release APK, grants `com.termux.permission.RUN_COMMAND`, `POST_NOTIFICATIONS`, `WRITE_SECURE_SETTINGS`, whitelists the app, starts it.
9. **9/9 check**: forwards a port and looks for the dashboard.

#### Agent route (`AGENT_INSTALL.md`)

A prompt-sized instruction file for the user's own coding agent (Claude Code, Codex, Cursor...). The human plugs the phone in and gives the agent one line: read the raw `AGENT_INSTALL.md` and follow it. The file's fast path runs `tools/setup-phone.sh`/`.ps1` in the background and reads its log; if that fails on a step, the file gives the manual steps for the same nine stages (get adb, connect, install the four helper apps, prepare Android, start Termux and type the installer, follow `hmsetup` log lines, choose the model, install the app, check). Rules in the file: tell the user what each step does, ask before uninstalling anything or changing an existing Termux, never repeat or store an API key, keep the phone unlocked with Termux in front while typing, never handle a subscription login (the user signs in inside the app). It also holds a failure table (signal 9, "bootstrap Python lookup failed", Illegal instruction on the emulator, dashboard not answering).

#### App-first route (phone only, Android 11+)

The user installs only the APK; the app walks them through the rest (`docs/install.md`, "On the phone, no computer"). Design record: `docs/app-setup-design.md`.

1. The app installs Termux, Termux:API, Termux:Boot (F-Droid) and Shizuku (GitHub) one by one with Android's package installer (after the "Install unknown apps" toggle), checking each file's package name and signer first.
2. The user starts Shizuku (Developer options, Wireless debugging, Shizuku's pairing notification, Start). The app cannot start Shizuku itself before Hermes exists.
3. The app copies a command to the clipboard (`setupCommand` bridge method): `curl -fsSL .../phone/bootstrap.sh -o hm.sh && HM_APP_TOKEN=<token> bash hm.sh`. A fresh random token per copy. The user opens Termux and pastes it (Termux has no "type this" intent). `HM_NO_APK` is not set, `HM_APP_TOKEN` is.
4. `bootstrap.sh` posts every line to `POST /setup` on the app's `HermesService`, which accepts only lines of a fixed shape carrying the current token and shows them in the setup flow (4.7, "App-first installer progress"). `DONE` clears the token.
5. A fixed probe command run through Termux's RUN_COMMAND (`MainActivity` `PROBE_SCRIPT`: `services=yes`, `installed=yes`, `dash=<http code>`) tells the app whether the install finished and whether the dashboard answers. The marker `~/.hermes-mobile/installed` is written at `DONE`.
6. Because `HM_APP_TOKEN` is set the script does not download the APK (the app is already installed). The model is connected inside the app ("Connect Hermes to a model").

Without the app's help the user can paste `curl -fsSL .../phone/bootstrap.sh -o hm.sh && bash hm.sh` into Termux; at the end the script opens Android's installer for the APK.

#### Ready-made image

An optional speed-up for **new** proot installs on arm64 phones. `tools/build-image.sh` builds a Debian 13 image with the pinned Hermes already installed (using the same commands as `bootstrap.sh`, read out of it so they cannot drift), the browser tools and the patches, scrubbed (`tools/pack_image.py`) and packed as proot-distro backup format with `zstd`. `.github/workflows/image.yml` (manual, run it after moving the pin) publishes it plus a `.sha256` file to the release `hermes-image-<first 12 of the pin>` (a prerelease, never "latest"). `bootstrap.sh` `image_restore` downloads it (about 900 MB), checks the sha256, runs `proot-distro restore`, and the Debian and Hermes install steps are skipped. Any failure falls back to the normal install. It is not used with chroot-distro. The image's patches are reverted after the restore; `install.sh` applies the current set, so a patch change does not need a new image.

#### Rooted phones: chroot-distro

Set `HM_DISTRO=chroot` in front of the install command (`bootstrap.sh`, or the computer scripts, which pass it through). `bootstrap.sh` then installs `chroot-distro` with pip, checks that Termux can get root (`su -c id`; the user taps Grant in the root manager), and installs Debian 13 with `chroot-distro install --name debian debian:trixie` (an existing container named `debian` is used as is). Debian runs at native speed instead of under proot. The choice is stored in `~/.hermes-mobile/distro` and used by `install.sh`, `hermes-debian`, `hermes-services`, `uninstall.sh` and the app, so later runs behave the same. The image restore is not used. Shizuku is still needed for the screen and other apps. Moving an existing proot install over is not automatic. The cost: Hermes then runs as the phone's real root user.
