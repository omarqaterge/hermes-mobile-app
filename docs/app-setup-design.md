# App-first setup: spike results and design (Stream C, step C1)

Status: **design for the owner's approval. No C2-C4 code is built.** Everything under "Evidence" was run on a wiped
Android 15 emulator (AVD `hmtest`, Google APIs arm64) with a throw-away spike build (0.8.43-c1) that was never committed.
A real phone (vendor ROMs, a real Wi-Fi network, a first-time user) can behave differently; those checks are listed at
the end.

Goal: a user installs only Hermes Mobile (the APK from GitHub) and the app walks them to a working chat. The new steps go
at the top of Stream B's one ordered list (`web/src/setupflow.ts` `setupSteps()` / `nextStep()`, drawn by `SetupFlow`),
so the same flow also covers a computer-route install, a manual install and a half-finished one: it always resumes at the
first thing that is missing. There is no second wizard.

## Answers in short

| C1 question | Answer (evidence below) |
|---|---|
| 1. Install Termux, Termux:API, Termux:Boot, Shizuku from the app | **Works** with the existing PackageInstaller session code. One "Install" tap per app; before the first one, Android's "Install unknown apps" toggle for Hermes Mobile once. |
| 2. Start the installer without RUN_COMMAND | **Copy + paste is the only path.** Termux refuses every RUN_COMMAND until `allow-external-apps = true`, which only the installer writes. Paste works with Termux's long-press menu. |
| 3. Progress channel | **Works:** a `curl` POST from `bootstrap.sh`'s `say()` reached HermesService on `127.0.0.1:9121` for every step of a fresh install (fresh Termux, Hermes Mobile in the background). |
| 4. Shizuku pairing | **Fully on the phone**, no computer: Developer options → Wireless debugging → Shizuku's own "Pairing" notification → Start. The app can deep-link Developer options and Shizuku, and can read whether Developer options and Wireless debugging are on; it cannot read whether Shizuku runs before Hermes exists. |
| 5. Installed-but-stopped vs never-installed | **A precise signal exists:** RUN_COMMAND with a result `PendingIntent`. Termux answers in ~30 ms with `err=2 "allow-external-apps"` (installer never got to its first step), or runs a fixed probe that says whether the install finished and whether the dashboard answers. No 60 s guess needed. It needs one new marker file written at `DONE` (mid-install looks like "stopped" otherwise). |

## Evidence (wiped `hmtest`, 2026-10-21)

Spike: a temporary `Spike.java` driven by `am start … --es spike <cmd>`, logging to `logcat -s hmspike`. Screens read with
`uiautomator dump`; screenshots kept outside the repo.

### 1. Installing the helper apps from the app

| What | Observed |
|---|---|
| Fresh app, `canRequestPackageInstalls()` | `false` |
| First session commit without that permission | Status `PENDING_USER_ACTION`; the confirm intent shows **"For your security, your phone currently isn't allowed to install unknown apps from this source. You can change this in Settings." [Cancel] [Settings]** |
| Tap Settings | "Install unknown apps" page for Hermes with the **"Allow from this source"** toggle |
| Turn the toggle on | The pending **"Termux:Boot — Do you want to install this app? [Cancel] [Install]"** dialog appears on top at once |
| Press Back there instead | Session ends with `status=3 INSTALL_FAILED_ABORTED: User rejected permissions` |
| With the permission, each app | One dialog: **"<App> — Do you want to install this app? [Cancel] [Install]"** → `status=0 INSTALL_SUCCEEDED` |
| No "Open with" chooser | The chooser seen with `termux-open` on the phone route does not appear on the session path |
| Times (emulator, Mac network) | Termux 114 MB: download 10.5 s, confirm → installed 6 s. Termux:API 4 MB 0.75 s. Termux:Boot 26 kB 0.04 s. Shizuku 2.6 MB 1.8 s (GitHub redirects to `release-assets.githubusercontent.com`) |
| Order | Termux:Boot installed before Termux worked (same signer, shared user id). The design still installs Termux first. |
| After install | All four `installer=com.omarqaterge.hermesmobile`, `FLAG_STOPPED=true` until first opened |
| Signers (SHA-256 of the cert) | Termux, Termux:API, Termux:Boot from F-Droid: `228fb2cfe90831c1499ec3ccaf61e96e8e1ce70766b9474672ce427334d41c42`. Shizuku v13.6.0 (GitHub): `268b5590e868fb08bae7e0ac413564cd1ff88f5ccff74af9dbd0dc918e30db30` |
| F-Droid API | `suggestedVersionCode`: Termux 1002 (0.118.3; the list also has 0.119 betas, so use `suggestedVersionCode`, not the newest), Termux:API 1002 (0.53.0), Termux:Boot 1000 (0.8.1). All `targetSdk 28` (Android 15 installs it; it refuses below 24). |
| RUN_COMMAND permission when Termux arrives after Hermes Mobile | Becomes requestable: `requestPermissions` shows **"Allow Hermes to execute arbitrary commands within Termux environment and access files?"** (Hermes Mobile was installed first). Before Termux exists the permission is undefined and isn't asked. |

### 2. Starting the installer

- RUN_COMMAND before `allow-external-apps` (also before Termux was ever opened): Termux returns
  `err=2, errmsg="RunCommandService requires allow-external-apps property to be set to true in ~/.termux/termux.properties file."`
  through the result PendingIntent, and **posts a "Termux Plugin Execution Command Error" notification each time**
  (5 stacked up on the emulator: the app's own `startHermes()` on launch/permission result plus the probes).
- No other way in: Termux has no "type this" intent; its share target only runs `~/bin/termux-url-opener` /
  `termux-file-editor`, which don't exist on a fresh install. So: copy the command, open Termux, long-press → Paste, Enter.
- Paste checked: the app's "Copy installer" → Termux → long-press shows **[Copy] [Paste] [More…]** → the whole command lands
  on the prompt (not run until Enter).
- Termux's first start: notification prompt, then the welcome text in a few seconds (bootstrap bundled, no network).

### 3. Progress channel

- Spike hook in the tarball's `bootstrap.sh` `say()` (not committed): `curl -s -m 2 -X POST … http://127.0.0.1:9121/setup`
  when `HM_APP_TOKEN` is set. Result: `post 403` for every line (STEP packages, access, android, debian, hermes, plugin,
  start, DONE…). 403 = HermesService answered (no key, as expected): **loopback from Termux reaches the service, and the
  service runs while the user is in Termux** (it is a foreground service started by the app).
- Lines printed by `phone-access.sh` ("phone: tap Allow …") did not post: that script has its own `say()`.

### 4. Shizuku without a computer (all on the emulator)

1. Developer options off: `Settings.Global development_settings_enabled` = null; `ACTION_APPLICATION_DEVELOPMENT_SETTINGS`
   resolves but opens nothing useful. `ACTION_DEVICE_INFO_SETTINGS` opens "About" with **Build number** at the bottom;
   7 taps → `development_settings_enabled=1` (readable by the app).
2. Shizuku home: "Shizuku is not running · Start via Wireless debugging · [Step-by-step guide] [Pairing] [Start]".
3. Pairing → "allow Shizuku to post notifications" → [Notification options] → back → the guide page with a
   **[Developer options]** button that opens Developer options.
4. Wireless debugging → "Allow wireless debugging on this network? [Always allow on this network] [Allow]" →
   `adb_wifi_enabled=1` (readable) → "Pair device with pairing code" shows a 6-digit code.
5. Shizuku's notification "Pairing service found" → **Enter pairing code** (inline reply) → "Pairing successful — You can
   start Shizuku service now."
6. Shizuku → Start → "Shizuku is running · Version 13.5, adb".
7. During the install: "Allow Termux to access Shizuku? [Allow all the time] [Deny]" opened 1 s after the access step's
   "phone: if Shizuku asks…" line (14:26:20). `phone-access.sh` gives up after ~25 s; on the emulator nobody tapped in time
   (another task was in front), so it recorded a TODO and the `android` step printed its "signal 9" fallback. On a phone the
   user is in Termux and sees it (NEEDS-PHONE). The same happened on `install.sh`'s second pass of the access step.
8. Termux's own prompts during the install, in order: "Let app always run in background?" (`termux-wake-lock`), files
   ("Allow Termux to access photos, videos, music, audio, and other files", showed only on `install.sh`'s pass: the first
   one was lost behind another task), Shizuku's. The progress view should repeat each `phone:` hint.

What the app can't do: start Shizuku, pair, or know whether Shizuku runs before Hermes exists (that needs Shizuku's client
library and binder; the plugin's `/phone-access` reports it once Hermes runs).

### 5. Installed-but-stopped vs never-installed

The RUN_COMMAND result PendingIntent (`com.termux.RUN_COMMAND_PENDING_INTENT`, result bundle `result` with `stdout`,
`stderr`, `exitCode`, `err`, `errmsg`) answers within ~30-200 ms:

| Probe answer | Means | Flow goes to |
|---|---|---|
| `SecurityException` (no RUN_COMMAND permission) | not allowed yet | "Allow Hermes Mobile to run Termux commands" |
| `err=2 allow-external-apps` | the installer never reached `install.sh` step 1 (never run, or stopped in its first minutes) | Run the installer |
| ran, no `installed=yes` | Termux allows us, but the install never finished (a half-finished run) | Run the installer (safe to run again); the progress view instead while a token is active |
| ran, `installed=yes`, `dash≠200` | installed but stopped | B's "Hermes is running" step (Start Hermes; the app's onResume `startHermes()` usually does it already) |
| ran, `dash=200` | running; the WebSocket will follow | B's steps continue |

Probe script (fixed in Java, never from the page): `test -x ~/bin/hermes-services && echo services=yes || echo services=no;
test -f ~/.hermes-mobile/installed && echo installed=yes; curl -s -m 2 -o /dev/null -w 'dash=%{http_code}' http://127.0.0.1:9119/`.

Measured with the spike's probe on the same emulator, through a full app-first install (bootstrap pasted into Termux,
14:23 → `HMSETUP DONE` 14:50, 27 min, Hermes step 12.5 min incl. the proot retry):

| When | Probe result |
|---|---|
| Termux installed, never opened | `err=2 allow-external-apps` (~30 ms) |
| Termux opened, installer not run | `err=2` (~170 ms) |
| Mid-install (plugin step, after `install.sh` 1/5-2/5) | `services=yes`, `dash=000` (took 7.6 s: Termux busy) — looks like "stopped" although the installer is still running |
| After `DONE` | `services=yes`, `dash=200` |
| `am force-stop com.termux`, then the app comes to the front | the app's existing `startHermes()` (onResume) restarts it; dashboard answered 32 s after the force-stop |

So "installed" needs a marker that only `DONE` writes: bootstrap writes `~/.hermes-mobile/installed` (C4), and the probe
reads it. While a setup token is active without `DONE`/`FAIL`, the flow shows the progress view and does not start Hermes.

Also found: after `DONE`, `~/.hermes-mobile/` had no `key` file. HermesService shares its event key once per service run,
and on an app-first install that single try happens before `allow-external-apps` (refused). The plugin then can't send
events (status chip, approvals) until the service restarts. C2: share the key again when the probe first runs OK and on
the `DONE` line.

## Design: the new rows in Stream B's flow

`StepId` gains `apps`, `install-ok`, `shizuku-start`, `installer`; they go before B's `termux` / `run` / `hermes` rows.
`termux` becomes part of `apps` (the row id stays for Setup check). Required = blocks `nextStep()`.

| # | Row (id) | Required | Done when (source) | The step's view |
|---|---|---|---|---|
| 1 | Get the apps (`apps`) | Termux: yes. Termux:API, Termux:Boot, Shizuku: see open question 1 | each package present (`setupState()`: `termux`, `termuxApi`, `termuxBoot`, `shizuku`, plus `termuxSigner`) | Four lines with a ✓ or an **Install** button, and **Install all** (one after another, one system dialog each, Termux first). Before the first install, if `canInstall` is false: "Allow Hermes Mobile to install apps" → the system toggle; the flow re-checks on return (B's `visibilitychange`) and only then commits a session (Back on the toggle page cancels a pending session). Download progress per app from the native callback. |
| 2 | Termux:Boot opened once (part of `apps`) | no | `termuxBootStopped == false` (`ApplicationInfo.FLAG_STOPPED`) | "Open Termux:Boot once" button (`setupFix('open-termux-boot')`); Android only delivers BOOT_COMPLETED to an app that was opened. |
| 3 | Start Shizuku (`shizuku-start`) | yes (needed; no Skip) | can't be known before Hermes exists → `info` with sub-checks: Developer options on (`devOptions`), Wireless debugging on (`wirelessDebugging`) | Three short steps with buttons: **Turn on Developer options** (About phone; "tap Build number 7 times"; Xiaomi: "OS version"), **Open Shizuku** (Pairing → its notification → Start), **Shizuku is running: continue** (a fallback for a Shizuku started before the app's first launch; the required `shizuku` row still checks it later). Android 10 and older (no Wireless debugging) get a note to start it from a computer and a guide link. Says why: it lets the installer stop Android from killing the install ("signal 9") and gives Hermes screen/app control. The installer's `android:` line later says whether it worked. |
| 4 | Allow Hermes Mobile to run Termux commands (`run`, exists) | yes once Termux is present | RUN_COMMAND granted | B's existing row, moved before the installer: the probe needs it. |
| 5 | Run the installer (`installer`) | yes | probe (above): `installed=yes` | **Copy the command** (native builds it with a fresh token and copies it), **Open Termux**, then "long-press → Paste → Enter. Stay in Termux and tap Allow on what it asks (notifications, battery, files, Shizuku: Allow all the time)." Once lines arrive, the view turns into the progress list below. |
| 6 | Installing (substate of `installer`) | — | `DONE` line, or probe `installed=yes` | Steps with ✓ / spinner (packages, access, android, debian, hermes, the longest step, plugin, start), the latest `phone:` hint in bold (e.g. "tap Allow…"), `TODO` lines listed, `FAIL <step>` → "The installer stopped at <step>. Open Termux to see why, then paste the same command again (finished steps are skipped)." with Copy + Open Termux. The service also puts the current step into its existing notification while the user is in Termux. |
| — | then B's rows | | | `hermes` (Start Hermes), `plugin`, `enabled`, `model`, recommended items, "All set". |

When the flow opens: on start-up, if `setupState()` says Termux is missing, the flow opens at once (no 15 s offline wait,
which B's `watchFirstRun()` uses for "Hermes not running"). An established setup is never interrupted (B's rule).

`setupSteps()` stays pure: it gets the native state plus a `probe` value (`'unknown' | 'denied' | 'not-allowed' |
'no-services' | 'stopped' | 'running'`) and the progress (`{ active, lines, done, fail }`). vitest cases (C3, red first):
no Termux → `apps`; apps present, probe `not-allowed` → `installer`; probe `stopped` → `hermes`; progress `active` →
`installer` with the progress view; a PC-installed user (all ok) → `nextStep` null, never shows the new rows.

## Native side (C2)

Bridge methods (each takes the page key first, `ok(key)`, and is added to `METHODS` in `web/src/secure-bridge.ts` with a
wrapper in `bridge.ts`):

| Method | Does |
|---|---|
| `installHelperApp(key, which)` | `which` ∈ {`termux`, `termux-api`, `termux-boot`, `shizuku`}, anything else is ignored. Fixed sources in Java: F-Droid API `https://f-droid.org/api/v1/packages/<pkg>` → `suggestedVersionCode` → `https://f-droid.org/repo/<pkg>_<code>.apk`; Shizuku = the fixed v13.6.0 URL also used by `setup-phone.sh`. Download (redirect host allowlist: `f-droid.org`; `github.com` + `*.githubusercontent.com`; https only; 150 MB cap; Termux is 114 MB) → `getPackageArchiveInfo(GET_SIGNING_CERTIFICATES)`: package name must equal the expected one and the signer SHA-256 must equal the pinned one (table above) → PackageInstaller session (`setAppPackageName`) → status to the page via `window.hermesSetupInstall(which, state, pct, msg)`. Refuses while `canRequestPackageInstalls()` is false (opens the toggle instead). One install at a time. |
| `setupState(key)` (exists) | adds `termuxBoot`, `termuxBootStopped`, `termuxSigner` (`fdroid` / `other` / `''`), `termuxVersion`, `canInstall`, `devOptions`, `wirelessDebugging`. `<queries>` gains `com.termux.boot`. |
| `setupFix(key, what)` (exists) | new fixed targets: `install-permission` (ACTION_MANAGE_UNKNOWN_APP_SOURCES for this app), `about-phone` (ACTION_DEVICE_INFO_SETTINGS), `dev-options` (ACTION_APPLICATION_DEVELOPMENT_SETTINGS), `open-termux-boot`. Existing `open-termux`, `open-shizuku`, `permissions` reused. |
| `probeTermux(key)` | RUN_COMMAND with the fixed probe script and a result PendingIntent (receiver `RECEIVER_NOT_EXPORTED`); answer to `window.hermesTermuxProbe(json)`. Called on flow open, on return to the foreground and on a tap, never on a timer; at most one in flight. |
| `setupCommand(key)` | makes a new token (24 random bytes, hex), stores it in the service (memory + prefs, so a service restart mid-install still accepts it), copies `curl -fsSL https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/phone/bootstrap.sh -o hm.sh && HM_APP_TOKEN=<token> bash hm.sh` to the clipboard, returns nothing (the page never sees or builds the command; `HM_DISTRO=chroot` stays a README option, see question 3). |
| `setupProgress(key)` | JSON `{ active, lines: [...], done, fail }` from the service, read on open/foreground; new lines are also pushed to `window.hermesSetupLine(line)` while the activity is alive (no polling). |

`HermesService` `/setup`:
- `handle()` today ignores the request path; it reads the request line and dispatches `POST /setup` separately, before the
  event-key check (the installer can't know the event key: Termux only gets it through RUN_COMMAND, which isn't allowed
  yet). Same size limits (headers, 256 kB cap; `/setup` bodies cut at 1 kB).
- Accepts `{"token": …, "line": …}` only when the token equals the current one (constant time), else 403.
- Line filter (strict, anything else dropped): `^(STEP [a-z-]{1,20}( [^\x00-\x1f]{0,120})?|TODO [^\x00-\x1f]{1,200}|FAIL [a-z-]{1,20}( [^\x00-\x1f]{0,200})?|DONE|phone: [^\x00-\x1f]{1,240}|android: [^\x00-\x1f]{1,120})$`.
  Keeps the last 50 lines. Lines are shown as text (React escapes); no line ever reaches an intent, a URL or a command.
- `DONE` clears the token (later posts get 403) and leaves the lines readable until the app is reopened. `FAIL` keeps the
  token so pasting the same command again keeps reporting.
- Updates the existing service notification text with the current step while a token is active (event-driven, no timer).

Bootstrap hook (C4): `say()` in `phone/bootstrap.sh` and in `phone/phone-access.sh` POSTs when `HM_APP_TOKEN` is set:
`curl -s -m 2 -o /dev/null -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:9121/setup` with
the JSON built by `printf` (quotes and backslashes escaped), `|| true`, never fails the install. Right before `say "DONE"`,
bootstrap writes `~/.hermes-mobile/installed` (the probe's "finished" marker; computer routes get it too, they run the
same bootstrap). The token never goes into
a file or the log line. The plan put only bootstrap's `say()` in C's ownership; `phone-access.sh`'s `say()` is a one-line
addition (deviation, needs the orchestrator's OK).

## Security notes

- Fixed install targets: the page passes a name from a 4-item list; URLs, package names and signer hashes are Java
  constants. A downloaded APK whose package name or signer differs is deleted, never committed.
- One-time token: random per "Copy the command", only lets a local process add filtered progress lines, cleared at `DONE`.
  It never leaves the phone except through the user's clipboard. Port 9121 stays bound to 127.0.0.1.
- The probe and the setup command are fixed strings in Java; the page cannot make Termux run anything new.
- Every new bridge method takes the page key and is listed in `secure-bridge.ts`.
- An existing Termux from somewhere else (GitHub build, old Play Store build): its signer differs from F-Droid's, and
  F-Droid's Termux:API/Termux:Boot would fail to install (shared user id). The `apps` step then installs nothing for the
  Termux family and says "Your Termux comes from <GitHub / elsewhere>: install Termux:API and Termux:Boot from the same
  place" (README link), and checks Termux ≥ 0.118 like `setup-phone.sh`.

## Battery

No new periodic loop, no wake lock in the app. The probe runs on open/foreground/tap only; progress is pushed by the
service when a line arrives; the token and line buffer exist only between "Copy the command" and `DONE` (or the next app
start after a `FAIL`). On the Termux side: one `curl` per `say()` line (about 30 per install, 2 s timeout). The installer's
own `termux-wake-lock` is unchanged (bounded by the script).

## What stays manual

1. Download and install Hermes Mobile itself (browser "install unknown apps" for the browser).
2. "Allow from this source" for Hermes Mobile, once.
3. One "Install" tap per helper app (4).
4. Opening Termux, Paste, Enter; Termux's own prompts during the install (notifications, "always run in background", files,
   "Allow Termux to access Shizuku").
5. Developer options (7 taps), Wireless debugging (Wi-Fi needed), Shizuku pairing via its notification, Start.
6. Opening Termux:Boot once (one button).
7. The model step (B's welcome).

## Fixes the spike found in today's code (for C2/C3, not done here)

- HermesService shares its event key with Termux once per service run; on an app-first install that try is refused
  (`allow-external-apps` not set yet), so the plugin has no key after `DONE`. Share again when the probe first runs OK and
  on the `DONE` line.

- On a fresh phone, `startHermes()` fires RUN_COMMAND on every launch and permission result; before the installer ran, each
  one adds a Termux error notification. Gate it on the probe (only when the probe said `stopped`/`running`).
- "Copy installer" copies the `install.sh` one-liner, which fails without Debian + Hermes; the `installer` step copies the
  bootstrap command instead (and `install.sh` stays for repairs from Setup check when Hermes exists).

## Open questions for the owner

1. Are Termux:API, Termux:Boot and Shizuku required in the `apps` step (the owner's rule: phone access is part of the
   install), or recommended with Skip (Hermes runs without them)? Decided (owner, 2026-10-24): all four are required,
   including Shizuku's *start* (step 3); there is no Skip.
2. Shizuku before the installer (recommended, prevents "signal 9") or after it (fewer steps before the user sees progress)?
   Before, not skippable.
3. Rooted phones: offer the `HM_DISTRO=chroot` command as a second "Copy" button in the installer step, or keep it a README
   option? Proposal: README only (one install path, root as an option).

## Phone tests for the test phase (not done; emulator only so far)

1. A brand-new phone, only Hermes Mobile installed → the flow installs the four apps (record each system screen, especially
   vendor installers: Xiaomi's "Install via USB"/security scan screens may differ) → Shizuku pairing on real Wi-Fi →
   paste → progress lines arrive while in Termux → DONE → model step → chat.
2. Back on the "Install unknown apps" toggle page: the pending install is cancelled; the flow shows Install again.
3. The Shizuku "Allow Termux" prompt appears while the user is in Termux and the install logs "android: child-process
   limit lifted (via Shizuku)".
4. Kill the dashboard (exact PID) → reopen → probe says `stopped` → Start Hermes works; force-stop Termux → same.
5. Owner's phone (PC-installed): the new rows never show; the probe isn't run unless the flow opens.
