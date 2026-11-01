## 4. Android shell

The Android shell is a Gradle-less APK (`android/build.sh`: `aapt2`, `javac`, `d8`, `zipalign`, `apksigner`). Package `com.omarqaterge.hermesmobile`. It has three jobs:

1. It hosts the web UI in a `WebView` (`MainActivity`) and gives that page the few things a web page cannot do (the bridge, 4.5).
2. It keeps a foreground service alive (`HermesService`) that receives events from the Hermes plugin on `127.0.0.1:9121` and turns them into notifications (4.3, 4.4).
3. It starts and watches the helper apps Hermes depends on: Termux (runs Hermes), Termux:API, Termux:Boot and Shizuku (4.7).

**Versions.** `android/build.sh` compiles against Android 16 (`android-36.jar`, because Live Update APIs live there), links with `--min-sdk-version 26` (Android 8.0) and `--target-sdk-version 35`, and runs `d8 --min-api 26`. The shell needs no root.

**Features that need a newer Android than 8.0.** The code guards some of these with `Build.VERSION.SDK_INT`; `tools/api-check.sh` (Android lint, run in CI) fails when a call above API 26 has no such check (see "Version checks" at the end of 4.2).

| Android | API | What needs it | Guard in code |
|---|---|---|---|
| 8.0 | 26 | Everything else: notification channels, `startForegroundService`, `canRequestPackageInstalls`, `WebView.setRendererPriorityPolicy` | none needed |
| 9 | 28 | Reading the signing certificate of other apps (`GET_SIGNING_CERTIFICATES`) for the helper-app signer check; the `FOREGROUND_SERVICE` permission | guarded (falls back to `GET_SIGNATURES`) |
| 8.1 | 27 | `Activity.setShowWhenLocked`/`setTurnScreenOn` for "Talk to Hermes on the lock screen" (`showOverLock`) | guarded (8.0 uses the window flags `FLAG_SHOW_WHEN_LOCKED`/`FLAG_TURN_SCREEN_ON`) |
| 10 | 29 | Phone assistant role (`RoleManager.ROLE_ASSISTANT`, bridge `isAssistant`); saving a picture to Pictures/Hermes (`MediaStore` `RELATIVE_PATH`/`IS_PENDING`) | guarded (`saveImageNow` returns false below 29: no Save, Share still works) |
| 11 | 30 | Wireless debugging (`adb_wifi_enabled`), so the Shizuku keeper (4.7) only runs from here (`KeeperPlan.blocker` returns `old-android` below 30); `WindowInsets.Type` and `getInsetsController()` used for edge-to-edge and bar icons in `MainActivity` | guarded (below 30 the old `getSystemWindowInset*` values and `SYSTEM_UI_FLAG_LIGHT_*` flags do the same) |
| 12 | 31 | `AlarmManager.canScheduleExactAlarms()` in `HermesService.scheduleWake`; `Notification.Action.Builder.setAuthenticationRequired` (`unlockFirst`: Allow and answer buttons ask for an unlock on the lock screen) | guarded (below 31 exact alarms need no permission; `openToUnlock` keeps a locked phone from acting from a notification) |
| 13 | 33 | `POST_NOTIFICATIONS` runtime permission (asked at start), `RECEIVER_NOT_EXPORTED` for the app's own receivers, the "sensitive" clipboard flag on the installer command, `USE_EXACT_ALARM` | guarded |
| 14 | 34 | The background app (`BgHost` refuses to run below 34 and prints `needs Android 14+`); the `specialUse` foreground-service type and its permission | `BgHost`: guarded (`@TargetApi(34)`, `main` exits below 34); service type: `startForeground` passes it from 34, older Android uses the plain call and the manifest's type |
| 16 | 36 | Live Updates: `Notification.ProgressStyle` (task segments, tracker icon) and `setShortCriticalText` (the status-bar chip text). `POST_PROMOTED_NOTIFICATIONS` is the permission for it | guarded: below 36 the chip is a normal ongoing notification with `BigTextStyle` and a progress bar |
