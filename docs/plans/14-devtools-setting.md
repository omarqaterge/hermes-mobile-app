# 14: "Remote debugging" developer setting (with safeguards)

Read [README.md](README.md) first. Build [13](13-devtools-test-build.md) first. This plan adds security-sensitive Java:
also run `tools/java-check.sh` and, when the SDK is available, `tools/api-check.sh`. It needs a real-phone check
(the screen-lock prompt on Xiaomi/HyperOS and other makers) before it ships.

## Goal

The installed app (including the official release) can turn on WebView remote debugging for a short time, for
debugging a problem that only shows on the user's own install. Turning it on must be impossible for anything except the
person holding the phone.

## Threats this design answers

1. **Script in the page.** Anything running in the page (a sanitiser bug, a bad OpenUI card, a compromised dependency)
   holds the bridge key. → The page can't turn it on: there is **no bridge method that enables it**.
2. **Hermes driving the phone.** Hermes can operate apps (background app, Shizuku) and could tap a switch. → Turning
   on requires the **phone's screen-lock credential** (PIN/pattern/password or biometric), which nothing can type for
   you.
3. **Forgetting it on.** → It **turns off after 60 minutes**, on every app process start, and from a **notification**
   that stays while it's on.
4. **Ordinary users.** → The row only appears while **Android Developer options are on**.

## What exists today

- `MainActivity` creates the WebView in `onCreate`; plan 13 added `devtoolsBuild()` and a startup call for test
  builds. `Bridge` (inner class) holds the `@JavascriptInterface` methods; each takes the per-page key first
  (`web/src/secure-bridge.ts` lists them).
- Notifications: `HermesService` creates its channels in one place (search `createNotificationChannel`); SPEC 4.3 lists
  every channel and notification.
- Settings → About (`web/src/components/Settings.tsx`) shows version info; the warning strip from plan 13 exists.

## Design

**Android side (all decisions are native):**
1. New class `DevTools` (static state, process memory only, so a process restart turns it off by itself):
   - `static long until` (ms, 0 = off). `isOn()`: `until > SystemClock.elapsedRealtime()`.
   - `available(Context)`: `Settings.Global.getInt(cr, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1`
     **and** `KeyguardManager.isDeviceSecure()` (API 23, fine for min 26).
   - `apply(Activity)`: `WebView.setWebContentsDebuggingEnabled(isOn() || devtoolsBuild)`; schedule turn-off with a
     `Handler` at `until`; post or cancel the notification.
   - `turnOff(Context)`: `until = 0`, apply, cancel the notification. Also called when Developer options are found off.
2. **Enable flow** (`MainActivity`): the page may only *ask to open* the native confirmation:
   - Bridge method `openRemoteDebugging(key)`: shows a native `AlertDialog` (not the web dialog): title
     "Turn on remote debugging?", text explaining that a connected computer can read and control Hermes Mobile for
     60 minutes, buttons Cancel / Continue. Returns nothing.
   - Continue → `KeyguardManager.createConfirmDeviceCredentialIntent(title, description)` → `startActivityForResult`.
     (Deprecated from API 29 but works through current Android and needs no new dependency. If you prefer
     `BiometricPrompt` with `DEVICE_CREDENTIAL` on API 30+, guard it with `Build.VERSION.SDK_INT >= 30` and keep the
     keyguard path below.) If `isDeviceSecure()` is false: a native message "Set a screen lock first" and stop.
   - `onActivityResult` with `RESULT_OK` → `until = elapsedRealtime() + 60 min`, `apply`. Anything else: nothing.
3. **Read-only state for the page:** bridge method `remoteDebuggingState(key)` → JSON
   `{ "available": bool, "on": bool, "minutesLeft": int }`. No method turns it **on**; a bridge method
   `turnOffRemoteDebugging(key)` is allowed (turning off is always safe).
4. **Notification** while on: a new low-importance channel `devtools` ("Remote debugging"), ongoing, text
   "Remote debugging is on · turns off at HH:MM", action **Turn off** (a `PendingIntent` to `HermesService` or a small
   receiver that calls `DevTools.turnOff`). Needs `POST_NOTIFICATIONS` like the other notifications (already asked).
5. `onResume`: re-check `available`; if Developer options were turned off, `turnOff`.

**Page side:**
6. Settings → About: when `remoteDebuggingState().available`, a row **Remote debugging** with the sub line
   "Off" or "On · N min left". Tap when off → `openRemoteDebugging()`; tap when on → `turnOffRemoteDebugging()`.
   Refresh the row on `visibilitychange` (back from the credential screen) and once a minute **only while the row is
   on screen and on** (bounded).
7. The plan-13 warning strip also shows while `on` is true: "Remote debugging is on · N min left".

## Implementation notes

- Add the two read/turn-off methods and `openRemoteDebugging` to `Bridge`, each checking the key first like the others,
  and list all three in `web/src/secure-bridge.ts`. Add their typings to `web/src/bridge.ts`.
- Every API newer than 26 needs an `SDK_INT` check (`api-check.sh`). `isDeviceSecure` is 23, `setWebContentsDebuggingEnabled` 19.
- Keep `DevTools` free of the page: it must work even if the page is broken.
- Turning off: verify on a phone whether an already-attached DevTools session is cut when
  `setWebContentsDebuggingEnabled(false)` is called. If it isn't, recreate the WebView or tell the user in the
  notification text; record what you found in `docs/manual-tests.md`.

## Tests

- **Unit:** the page's row logic (pure function from the state JSON to the row's label and action).
- **E2E:** the fake `nativeShell` in `tools/web-e2e/test.cjs` gets `remoteDebuggingState`, `openRemoteDebugging`
  (records the call) and `turnOffRemoteDebugging`. Checks: the row is absent when `available` is false; shows "Off" and
  calls `openRemoteDebugging` when tapped; shows "On · 42 min left" and calls `turnOffRemoteDebugging`; the warning strip
  shows while on; there is no bridge method whose name suggests enabling without the native flow (a check that
  `secure-bridge.ts` has no `enableRemoteDebugging`-like name).
- **Java:** `java-check.sh`, `api-check.sh`.
- **Manual (real phone, required before release), add to `docs/manual-tests.md`:**
  1. Developer options off → no row.
  2. On, no screen lock → "Set a screen lock first".
  3. With a lock: Continue → the phone's own lock screen; wrong PIN / back → stays off; right PIN → on, notification
     shows, `chrome://inspect` on a computer lists the page.
  4. Notification **Turn off** → off; `chrome://inspect` no longer connects.
  5. Force-stop the app → reopens off.
  6. Wait 60 minutes (or temporarily build with 2 minutes) → off by itself, notification gone.
  7. Developer options turned off while on → off at the next resume.

## Spec and changelog

- `docs/SPEC.md`: 2.3 (the threat list and the safeguards), 3.15 Settings → About row, 4.3 (channel `devtools` and the
  notification), 4.5 (the three bridge methods, and that none enables), 4.1 (`DevTools` class), 4.2 if any manifest
  change.
- `CHANGELOG.md`: user-facing line, saying it is for developers and turns itself off.

## Out of scope

Turning it on from a notification, from Hermes, or remotely; durations other than 60 minutes; remote debugging of the
canvas iframes separately (they're part of the same WebView).
