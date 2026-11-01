### 4.7 Shizuku keeper, Autostart, Uninstall, UpdateNotice, BgHost and the rest

#### Shizuku keeper (`ShizukuKeeper`, `KeeperPlan`, `ShizukuProvider`)

What it is for: Shizuku gives Hermes the phone-wide shell (the `rish` command) and does not survive a reboot. The keeper restarts it with no root and no computer. Nothing polls.

How Shizuku's state is known: Shizuku's server calls `ShizukuProvider.call("sendBinder")` when it starts, and again when this app's process starts while it runs. The provider keeps the binder and pings it (`running()`); it registers a death recipient. When the binder dies, `HermesService.shizukuDown` runs; when a binder arrives, `shizukuUp` runs.

Steps of one run (`ShizukuKeeper.down`, entered from `onDown`; every constant is in `KeeperPlan`):

1. Entry points: the binder died, or 90 s (real time, see 2.2.9) after the service started Shizuku is installed but not running (a reboot does not start Shizuku, so no binder ever comes; the notice title is then "Shizuku isn’t running" instead of "Shizuku stopped").
2. Stop if Shizuku is running or a run is already under way.
3. `KeeperPlan.blocker` returns the first failing precondition, in this order: `not-installed`, `uninstalling` (an Uninstall was started), `installing` (the app-first installer runs), `old-android` (below Android 11), `no-permission` (`WRITE_SECURE_SETTINGS` not granted), `no-termux` (Termux has not accepted a command yet), `unpaired` (Termux's own adb is not paired with Wireless debugging). The reason is stored as the "last" result. For `old-android`, `no-permission`, `no-termux` and `unpaired` the `Phone access` notice is shown (`KeeperPlan.userMustAct`); for `not-installed`, `uninstalling` and `installing` nothing is shown. The later outcomes `no-wifi`, `untrusted-network`, `failed` and `too-many` also show the notice.
4. Rate limit: at most 5 runs per hour (`MAX_RUNS_PER_HOUR`); more gives `too-many` and the notice "It stopped again right after each start. Tap to open Shizuku and start it."
5. Wi-Fi: if the phone is not on Wi-Fi the result is `no-wifi` ("Not on Wi-Fi. It starts again by itself once the phone is on Wi-Fi.") and one `NetworkCallback` waits for the first Wi-Fi network (it does not need internet). When Wi-Fi comes, the notice is removed and the attempts start after 3 s.
6. Up to 3 attempts, at 0 s, +30 s and +90 s after the previous attempt (so at 0, 30 and 120 s). Each attempt: stop if Shizuku is up; check Wi-Fi again; set the result `starting`; if `adb_wifi_enabled` is not 1, remember that we turned it on (`shizuku_wd_ours`) and set it to 1 (a refused write gives `no-permission` and the notice).
7. After 2 s read it back. If it is not 1, Android is asking the user "Allow wireless debugging on this network?" and the app cannot answer: result `untrusted-network` ("Allow wireless debugging on this network (tick Always allow), then Shizuku starts by itself next time."), the attempts stop, and a `ContentObserver` waits up to 2 min; if the user allows it, one last try goes on at once.
8. Port discovery: `NsdManager` looks for `_adb-tls-connect._tcp` for at most 10 s, resolves each service, keeps only those whose host is one of this phone's own addresses (another phone on the same Wi-Fi advertises the same type), and tries each port on `127.0.0.1` (500 ms) because the service manager may still list the port of an earlier session. The first open port wins. No port: the script scans for it.
9. `startInTermux(port)`: a `RUN_COMMAND` in the background that runs `[ -x ~/bin/hm-shizuku ] && exec ~/bin/hm-shizuku start [PORT]` (only a number is added to a fixed command). Not sent after an uninstall, before Termux accepted a command, or without the `RUN_COMMAND` permission.
10. Termux's `hm-shizuku` connects its own paired adb, runs Shizuku's starter and posts the `shizuku-auto` event; the result word and `paired` are stored (a result must be a lowercase word of at most 24 characters, else it is stored as `failed`).
11. When the new binder arrives (`up`): stop everything, remove the notice, store `ok`, and, if the keeper turned Wireless debugging on, turn it off again 10 s later (`WD_OFF_MS`).
12. If Shizuku is still not running 60 s after the last attempt: result `failed` ("Hermes couldn’t start it by itself. Tap to open Shizuku and start it."), notice, and Wireless debugging goes back off if it was ours.

The result words (`setupState.shizukuAuto.last`) are therefore: the blockers, `no-wifi`, `untrusted-network`, `starting`, `ok`, `failed`, `too-many`, `no-port`, and any word Termux reports. The notice (id 9, channel `Phone access`) opens the Shizuku app, or this app for `no-permission`, `no-termux` and `unpaired` ("Shizuku isn’t set up to start by itself. Open Hermes Mobile → Setup check → Start pairing."). Pairing itself is a user tap: Setup check → `setupFix` `shizuku-pair` (below). The generic message when a reason has no special text is "Hermes can’t see or use the screen until you start Shizuku again."

#### Start pairing (`AdbPairing`)

Termux's own adb must be paired with Wireless debugging once (Android 11+) before the keeper can restart Shizuku. The user does it himself; nothing taps the screen for him and Settings opens only after his tap.

1. Setup → "Shizuku starts by itself" → Start pairing calls `setupFix` `shizuku-pair` → `AdbPairing.begin`. If the app's notifications (or the `Pairing` channel) are off, a toast says "Allow notifications for Hermes Mobile first: the pairing code is typed into one" and the app's notification settings open; nothing else happens.
2. Otherwise it posts "Pair Termux: enter the code" (its own notification group, so it is not folded into the app's other notifications) ("In Wireless debugging tap Pair device with pairing code, then type the 6-digit code here.") on the `Pairing` channel with an Enter code action (RemoteInput "6-digit code", an explicit mutable `PendingIntent` to `HermesService` with `ACTION_CODE`), starts one `NsdManager` discovery for `_adb-tls-pairing._tcp` and opens Settings (`openWirelessDebugging`): first the public Quick Settings tile preferences intent for Settings' Wireless debugging tile (the Wireless debugging page on AOSP), then Developer options (asking Settings to highlight the Wireless debugging row with `:settings:fragment_args_key` `toggle_adb_wireless`; the Android 15 emulator opened the page without highlighting it), then Settings itself. Developer options off: a toast "Turn on Developer options first (tap Build number 7 times)" and About phone opens instead (Settings closes its Developer options pages at once while they are off), with no notification and no discovery. The logcat tag `HermesPair` says which one opened.
3. The pairing service exists only while Settings' "Pair device with pairing code" dialog is open. Each found service is resolved one at a time, kept only if its host is one of this phone's addresses, and its port counts only if it answers on `127.0.0.1` (300 ms; the service list can still hold a closed dialog's port). The latest open port wins.
4. The user pulls down the shade and types the code. `KeeperPlan.parsePairReply` takes the 6 digits (spaces allowed) and an optional port typed with it ("123456 37123", or an `ip:port` pasted). No code: "That wasn’t a 6-digit code". If the known port no longer answers, the services seen so far are resolved once more (a reopened dialog keeps its service name, so discovery does not report it again; one pass, at most 5 s). Still no open port: "Pairing screen not found", which also explains how to type the port.
5. `KeeperPlan.pairScript` builds `[ -x ~/bin/hm-shizuku ] && exec ~/bin/hm-shizuku pair PORT CODE` (only two validated numbers are added) and `ShizukuKeeper.runInTermux` sends it (same rules as the keeper: not after an uninstall, not before Termux accepted a command, not without `RUN_COMMAND`; then "Termux can’t be asked yet"). The notification says "Pairing…".
6. The script's `shizuku-auto` event with `cmd` `pair` (`KeeperPlan.pairResult`): success → "Termux is paired" ("Shizuku now starts by itself after a restart, on Wi-Fi."; auto-cancels after 15 s) and discovery stops; failure → "Pairing didn’t work" with the script's detail (at most 120 characters) and the field again, and discovery starts again. Either way an open Setup screen re-reads `setupState` (`MainActivity.setupChanged`). No event within 40 s (`ANSWER_MS`): "No answer from Termux".

Battery: discovery and the notification end 10 minutes after the tap (`WINDOW_MS`, one `Handler.postDelayed`), plus one 40 s timeout per typed code (`ANSWER_MS`), the 5 s cap of the one re-resolve pass and a single 500 ms resolve retry. No loop, no wake lock.

#### Autostart table (`Autostart`)

Stock Android has no "may start by itself" switch and no API to read or open one (the battery "Unrestricted" setting is enough there). Some makers add their own page in their own system app. `Autostart.VENDORS` is the one place that knows them. `Autostart.vendor(MANUFACTURER, BRAND)` lower-cases both, splits them into words and matches whole words, so `TECNO MOBILE LIMITED` is `tecno` but `Fairphone` and `Google` match nothing.

| Maker words | Name shown | Where to look (user text) | Pages tried, in order |
|---|---|---|---|
| xiaomi, redmi, poco, blackshark (MIUI / HyperOS) | Autostart | Settings → Apps → Background autostart (older phones: Security app → Permissions → Autostart) | `com.miui.securitycenter` `AutoStartManagementActivity` (list); action `miui.intent.action.OP_AUTO_START` in that package (list); the system `APPLICATION_SETTINGS` page (settings) |
| huawei, honor | App launch | Settings → Apps → App launch: switch off Manage automatically, then allow Auto-launch | `com.hihonor.systemmanager` `StartupNormalAppListActivity`; `com.huawei.systemmanager` `StartupNormalAppListActivity`, `StartupAppControlActivity`, `ProtectActivity` (all lists) |
| oppo, realme, oneplus | Auto launch | App info → Battery usage → Allow auto launch (or Settings → Apps → Auto launch) | `com.coloros.safecenter` (two `StartupAppListActivity` classes), `com.oppo.safe` `StartupAppListActivity`, `com.oneplus.security` `ChainLaunchAppListActivity` (lists) |
| vivo, iqoo | Autostart | Settings → Apps → Autostart (or i Manager → App manager → Autostart) | `com.vivo.permissionmanager` `BgStartUpManagerActivity`, `com.iqoo.secure` `BgStartUpManager`, `AddWhiteListActivity` (lists) |
| asus | Auto-start | Mobile Manager → Auto-start manager | `com.asus.mobilemanager` `AutoStartActivity`, `FunctionActivity` (lists) |
| meizu | Auto-start | Security app → Permissions → Auto-start | action `com.meizu.safe.security.SHOW_APPSEC` in `com.meizu.safe` (a per-app page) |
| letv, leeco, lemobile | Autoboot | Security app → Autoboot | `com.letv.android.letvsafe` `AutobootManageActivity` (list) |
| tecno, infinix, itel | Auto-start | Phone Master → App management → Auto-start | `com.transsion.phonemaster` `AutoStartActivity` (list) |

Page kinds: `list` is one list of all apps; `app` is one app's page and gets the package as the extras `packageName` and `package_name`; `settings` is a Settings page to look in.

Generic fallback, in `MainActivity`:

- A phone whose maker is not in the table (Pixel/AOSP, Samsung, Motorola…): `setupState.autostart` is `""` and the Setup flow hides the Autostart step. The battery step is enough there.
- A listed maker: `canOpen(page)` asks the package manager whether the activity resolves, is exported, and needs no permission the app lacks. A `settings` page with no package always counts as there. `autostartPage` returns the first page that passes; its kind goes to the page as `autostart`. If none passes, the value is `info`.
- `openAutostart(pkg)` (setupFix `autostart` for this app, `autostart-termux` for Termux) starts the first page that opens (a page that is listed but refuses, for example with a `SecurityException`, is skipped); if none opens, or the maker is unlisted, it opens that package's App info page (`ACTION_APPLICATION_DETAILS_SETTINGS`).
- The maker's `name` and `where` strings are sent to the page so it can say, in the phone's own words, which switch to turn on.

#### Uninstall (`Uninstall`)

Settings → Danger zone → Uninstall Hermes calls bridge `uninstallStart(backup, keys, settings)`.

1. `Uninstall.run` refuses with `busy` (a run is under way and less than 20 min old), `no-termux`, `no-permission`, or `error: …`.
2. It reads `assets/phone/uninstall.sh` and sends it to Termux's `bash` with `RUN_COMMAND` (background, with a result `PendingIntent`). Arguments are fixed flags only: `hm-uninstall`, and with a backup `--backup`, `--keys` (include secrets), `--settings <JSON>` (the app's settings object, at most 64,000 characters, rejected if it is not a JSON object). The settings are one argv entry, never code.
3. Before sending, the `hermes` preference `uninstall_started` is set, so from then on `startHermesNow`, `shareKeyWithTermux` and the Shizuku keeper do nothing.
4. Termux's answer (`done`) is stored as `uninstall_result` (`exit`, `stdout` last 24,000 characters, `stderr` last 4,000, `err`, `errmsg`). Exit 0 or 1 means something was removed (`uninstall_removed`); otherwise (exit 3, or Termux refused) `uninstall_started` returns to its earlier value. The page is told through `window.hermesUninstallDone()`. A run that never answers counts as lost after 20 min (`LOST_MS`).
5. `uninstallState` returns `{started, running, removed, result}`. `uninstallApp(which)` then opens Android's own uninstall prompt (`ACTION_DELETE`) for `termux-api`, `termux-boot`, `shizuku`, `termux` or `self`.

#### App-first installer progress (`SetupLines`)

The Setup flow copies an installer command with a one-time token (bridge `setupCommand`). `phone/bootstrap.sh` posts each progress line to `POST /setup` on port 9121 with that token. `SetupLines` keeps only the current token (constant-time compare), only lines of a known shape (`STEP <name> [text]`, `TODO <text>`, `FAIL <name> [text]`, `DONE`, `phone: <text>`, `android: <text>`; no control characters), at most 50 lines, and a timestamp per line (the installer's own clock if within a day of now). `STEP` sets the current step; `FAIL` records the step and keeps the token so running the command again keeps reporting; `DONE` ends the token. The service pushes each line to the page (`hermesSetupLine`) and shows the step in the status card ("Setting up: …", "Setup stopped: open Hermes Mobile", "Ready"). On `DONE` it also marks Termux as accepting commands and re-shares the event key. The token is also saved in the preferences (`setup_token`) so a service restart in the middle of an install keeps it. While an install runs (`installing()`), automatic Hermes starts and the keeper stay quiet.

#### UpdateNotice

Once per release, a notification tells the user a newer version exists. `HermesService` calls `UpdateNotice.check` 120 s after start and then every 12 h (`CHECK_MS`, a handler timer that does not wake the CPU). The check runs on a thread, at most one request per 12 h (`update_notice` preferences `checked`): `GET https://api.github.com/repos/omarqaterge/hermes-mobile-app/releases/latest`. If the tag is newer (dotted numbers compared piece by piece, the same rule as `web/src/releasenotes.ts`), the release has an `.apk` asset, and this version has not been announced yet (`notified`), it posts "Hermes Mobile <version> is available — Tap to download and install it." on `App updates` (id 10). If the installed version is current or newer, an existing notice is cancelled. Tapping opens the app with `updateUrl`, which `MainActivity` verifies and downloads (see bridge `installUpdate`). Offline or rate-limited checks just try again later.

#### BgHost (the background app)

`BgHost` is the engine behind the `phone_app` tool. It is not part of the app process. The plugin starts it as the shell user through Shizuku's `rish`: `HM_TOKEN=… CLASSPATH=<the app's APK> app_process / com.omarqaterge.hermesmobile.bg.BgHost <port>` (default port 9131). It uses no app classes, resources or `Context` (it builds a system `Context` that reports the package `com.android.shell`).

- It needs Android 14 (it exits with `needs Android 14+` below), and a token of at least 16 characters in `HM_TOKEN`.
- It owns one hidden virtual display, `hermes-bg`, 720 × 1600 at 320 dpi, created on first `open`, with flags that keep focus and the keyboard on the real screen (`STEAL_TOP_FOCUS_DISABLED`, own focus, IME policy local). It releases the display on every exit path.
- It listens on `127.0.0.1` only. Every request needs the header `X-HM-Token` (constant-time compare; 403 otherwise). The command set is fixed, no shell passthrough, request body at most 1 MB.
- It exits after 120 s without a request (`IDLE_MS`) or 30 min in total (`MAX_MS`). At start it closes the pipes inherited from `rish` so the starter command can return.
- Endpoints: `GET /frame?w=` (JPEG, quality 70, width 120–720; 204 if no frame yet); `POST /status`, `/apps` (launchable apps `{pkg, label}`), `/open {pkg}`, `/capture {tree, image, max_w}`, `/tap {n}` or `{x, y}`, `/set_text {n, text}`, `/type {text}`, `/key {name}` (back, enter, del, tab, search, menu, up, down, left, right, space), `/scroll {direction, n}`, `/hand_over`, `/close`.
- `open` takes a package name (`[A-Za-z0-9_.]+`), refuses a package the user has open on the real screen right now, launches it on the hidden display, waits up to 10 s for readable content, and, if another package ended up on top (usually the phone's app lock or a sign-in screen), releases the display and reports that. The accessibility tree (through `UiAutomation`) lists at most 300 visible elements, numbered `n`, with text, description, id, class, click/edit/scroll/checked/focused flags and the centre point. Taps prefer the element's click action, else a touch event at its centre. If the app closes itself, calls answer "the app closed itself … open it again".
- `/hand_over` moves the app's tasks to the real display (display 0) and quits; `/close` quits. The Android side reaches these through `MainActivity.bgRequest` (bridge `bgAction`), and the picture through `bgFrameAsync` and the working chip.

#### CameraProvider

Authority `com.omarqaterge.hermesmobile.camera`, not exported; other apps get access only through a one-off URI grant. It serves two kinds of file and nothing else: `cache/camera/photo-<digits>.jpg` (the camera app writes a full-size photo there; `MainActivity.takePhoto` first deletes older photos) and `cache/share/share-<digits>.<jpg|jpeg|png|webp|gif>` (a copy of a lightbox image for sharing). `query` returns the file name and size; `getType` returns the image MIME type; insert, update and delete do nothing. The Composer's Camera button reaches it through the `WebView` file chooser: `onShowFileChooser` calls `takePhoto` when the page asks for capture, and falls back to the normal picker if there is no camera app.

#### ShizukuProvider and `BinderContainer`

See the Shizuku keeper above. The provider has no data: `query`, `insert`, `update`, `delete` and `getType` return nothing. Its only job is `call("sendBinder")`, which reads the `BinderContainer` extra `moe.shizuku.privileged.api.intent.extra.BINDER`, keeps the binder, links a death recipient and reports up or down. Because the provider is protected by `INTERACT_ACROSS_USERS_FULL`, only the system or the shell can call it.

#### Receivers

- `BootReceiver` (`BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`): `HermesService.start`. On phones with an Autostart switch it must be on for this to run after a reboot (4.7 Autostart).
- `StartReceiver` (exported, no filter, no data): `HermesService.start`. Termux's app keeper sends an explicit broadcast to it to bring the service back.
- `WakeReceiver` (not exported): the cron alarm. If the service is up it calls `wakeForCron`; if not, it starts the service with `ACTION_WAKE`, which does the same. The alarm manager keeps the CPU awake until `onReceive` returns, and by then the service holds its own wake lock.

#### MainActivity: other things it does

- **Start-up.** `onCreate` logs timing marks to logcat tag `hmboot` (create, page started, page finished, load URL, token), sets the window and `WebView` background to the last colour the page chose (preferences `hm`/`bg`, default `#0E1115`) so launch does not flash, pads the root for system bars, cutout and keyboard (edge-to-edge), creates the channels, starts the service, handles the intent (`updateUrl`, `clearDone`, `session`, `draft`, share, shortcut), asks for `POST_NOTIFICATIONS` and `RUN_COMMAND`, calls `startHermes()`, then loads `file:///android_asset/www/index.html`. `WebView` settings: JavaScript and DOM storage on, file access on (the page is a local file) but file-from-file and universal access off, content access off, media playback without a gesture, text zoom 100 %. The renderer keeps the app's priority while hidden so a notification answer finds a live page.
- **Resume and pause.** `onResume` sets `visible`, marks the last shown chat seen, restarts the service if it is not running, removes `approval:` pop-ups, calls `hermesResume`, retries a waiting installer prompt, opens a waiting update prompt, re-checks setup (`hermesSetupChanged`) and pushes the background-app state. `onPause` clears `visible` and the open chat, stops the microphone and calls `hermesPause`.
- **Open a chat.** A notification, the Done chip or the `last_chat` shortcut puts `session` (and maybe `draft`) in the intent; once the page is ready, `window.hermesOpenSession(id, draft)` runs. The id is stripped to `[A-Za-z0-9_.:-]`.
- **Share to Hermes.** `ACTION_SEND` / `SEND_MULTIPLE` text and up to 10 file URIs are kept; once the page is ready, `window.hermesShared(count, text)` runs and the page reads each file with `sharedItem`. The text is cut at 100,000 characters and prefixed with the subject when the text does not already contain it. The intent action is reset to `MAIN` so a re-created activity does not share again.
- **Dashboard access.** `rawHttp` is a small HTTP/1.1 client to `127.0.0.1:9119` (3 s connect, 120 s read) that adds `X-Hermes-Session-Token`. The token is read from the dashboard page's `__HERMES_SESSION_TOKEN__` script; the page cannot do that itself (no CORS), which is why the bridge exists.
- **Sign-in in Termux**, **helper-app install**, **in-app update**: see the bridge rows `signInTermux`, `installHelperApp`, `installUpdate`.
