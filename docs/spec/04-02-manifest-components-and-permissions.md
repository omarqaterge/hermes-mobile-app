### 4.2 Manifest: components and permissions

**Application.** `android:allowBackup="false"`, theme `HermesTheme`, label `Hermes`, network security config as above.

**Components.**

| Component | Exported | What it is |
|---|---|---|
| `.MainActivity` | yes | `launchMode="singleTask"`, `windowSoftInputMode="adjustResize"`, handles `orientation`, `screenSize`, `screenLayout`, `keyboardHidden`, `keyboard`, `uiMode`, `density` itself (no restart on rotate or dark-mode change; `onConfigurationChanged` tells the page to re-resolve the System theme). Intent filters: `MAIN`/`LAUNCHER`; `ASSIST` and `VOICE_COMMAND` with `DEFAULT` (phone assistant, 4.6); `SEND` and `SEND_MULTIPLE` for `*/*` (Share to Hermes: text, links, photos, PDFs, any file). Meta-data `android.app.shortcuts` points at `res/xml/shortcuts.xml`. |
| `.HermesService` | no | `foregroundServiceType="specialUse"` with the property `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` = "Pinned status of the on-device Hermes agent and delivery of its notifications". |
| `.CameraProvider` | no | Authority `com.omarqaterge.hermesmobile.camera`, `grantUriPermissions="true"`. |
| `.ShizukuProvider` | yes | Authority `com.omarqaterge.hermesmobile.shizuku`, `multiprocess="false"`, protected by the permission `INTERACT_ACROSS_USERS_FULL` so only the system or the shell (Shizuku's server) can call it. |
| `.WakeReceiver` | no | Cron alarm. |
| `.StartReceiver` | yes | Termux keeper restarts the service. |
| `.BootReceiver` | no | `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`. |

**`<queries>`** (package visibility for Android 11+): `com.termux`, `com.termux.api`, `moe.shizuku.privileged.api`, `com.termux.boot`, the twelve phone-maker system apps that `Autostart` knows (`com.miui.securitycenter`, `com.hihonor.systemmanager`, `com.huawei.systemmanager`, `com.coloros.safecenter`, `com.oppo.safe`, `com.oneplus.security`, `com.vivo.permissionmanager`, `com.iqoo.secure`, `com.asus.mobilemanager`, `com.meizu.safe`, `com.letv.android.letvsafe`, `com.transsion.phonemaster`), the intents `TTS_SERVICE` and `RecognitionService` (to bind the system speech services), and `PROCESS_TEXT` with `text/plain` (so the text-selection menu can list other apps' Speak and Translate).

**Permissions.** 16 are named in the manifest as `android.permission.*`; two more are other-package permissions.

| Permission | Kind | Why the app needs it |
|---|---|---|
| `INTERNET` | normal | Loopback sockets to Hermes (`127.0.0.1:9119`), the GitHub update check and APK download (`UpdateNotice`, `MainActivity.startUpdate`), the helper-app downloads from F-Droid and GitHub. |
| `POST_NOTIFICATIONS` | runtime (Android 13+) | Every notification. Asked at start by `MainActivity.requestRuntimePermissions`; also fixable from the Setup check (`setupFix` `notifications`). |
| `VIBRATE` | normal | Declared. The code never calls `Vibrator` and does not turn on channel vibration; the bridge `haptic` uses `performHapticFeedback`, which needs no permission. |
| `FOREGROUND_SERVICE` | normal | `HermesService` runs in the foreground (`startForeground`). |
| `FOREGROUND_SERVICE_SPECIAL_USE` | normal (Android 14+) | The service type `specialUse` that `HermesService` declares. |
| `RECEIVE_BOOT_COMPLETED` | normal | `BootReceiver` starts the service after a reboot. |
| `POST_PROMOTED_NOTIFICATIONS` | normal (Android 16) | Lets the status notification be promoted to a Live Update (status-bar chip, the "island" on some phones). Without it the notification is still posted as a normal ongoing one. |
| `REQUEST_DELETE_PACKAGES` | normal | Android's uninstall prompt for the helper apps and this app (`Uninstall.uninstallApp`, `ACTION_DELETE`). |
| `RECORD_AUDIO` | runtime | Dictation and Live mode (`Voice.startListening`). Asked on first use; denial reports `mic-denied` to the page. |
| `WAKE_LOCK` | normal | `HermesService.updateWake` holds a partial wake lock (`hermes:working`) only while Hermes works, an approval waits, or a cron job is due. |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | normal | The Setup check's "let it run in the background" prompt (`setupFix` `battery-app`). |
| `USE_EXACT_ALARM` | normal (Android 13+) | The exact alarm that wakes the phone for a due cron job (`scheduleWake` uses `setExactAndAllowWhileIdle` when `canScheduleExactAlarms()` is true, otherwise `setAndAllowWhileIdle`). |
| `REQUEST_INSTALL_PACKAGES` | special app access | Hands the downloaded release APK and the helper apps to the system installer (`PackageInstaller` sessions). The user confirms each install; `setupFix` `install-permission` opens the "install unknown apps" page for this app. |
| `WRITE_SECURE_SETTINGS` | development, never asked for | Only granted by the installer (adb, or Shizuku's shell `pm grant`). Lets `ShizukuKeeper` turn Wireless debugging (`adb_wifi_enabled`) on and off. |
| `ACCESS_NETWORK_STATE` | normal | `ShizukuKeeper`: is the phone on Wi-Fi, and one `NetworkCallback` while waiting for Wi-Fi. |
| `INTERACT_ACROSS_USERS_FULL` | not requested | Appears only as the `android:permission` of `ShizukuProvider`. It is a permission no ordinary app holds, which keeps other apps from calling the provider. |

Other-package permissions:

- `com.termux.permission.RUN_COMMAND`: starts commands in Termux (`startHermesNow`, the key share, the probe, `Uninstall.run`, the Shizuku keeper). Termux must also have `allow-external-apps=true`. Asked at start together with `POST_NOTIFICATIONS`.
- `moe.shizuku.manager.permission.API_V23`: only listed, never asked for. Shizuku's server calls the providers of apps that list it, which is how `ShizukuProvider` learns Shizuku is running.

**Version checks.** Every call above API 26 is behind a `Build.VERSION.SDK_INT` check; `tools/api-check.sh` (7.2) proves it in CI. Checked on an Android 8.0 emulator: the app starts and its service runs. The page itself needs a WebView that runs ES2022 (`web/vite.config.ts` target): an old, never-updated Android System WebView (for example Chrome 58 on a stock Android 8 image) can't run it, and `web/index.html` then shows "Hermes Mobile can't start" with the WebView version and asks to update Android System WebView or Chrome (only when the app hasn't started after 8 s and the WebView is older than Chrome 100; `main.tsx` sets `window.__hmRan` once it has).
