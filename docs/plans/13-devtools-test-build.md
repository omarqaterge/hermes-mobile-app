# 13: Test builds with WebView remote debugging

Read [README.md](README.md) first. This plan touches Java: also run `tools/java-check.sh` (JDK 21+). `tools/api-check.sh`
needs the Android SDK; if you don't have it, say so in your report (CI runs it).

## Goal

`HM_DEVTOOLS=1 android/build.sh` builds an app whose page can be inspected and driven from a computer over adb
(Chrome DevTools, Playwright `connectOverCDP`). Normal and release builds are unchanged and can never have it. A test
build says so on screen all the time.

Why only in test builds: with remote debugging on, anything that can reach adb on the phone can read the page (token,
chats) and call every native bridge method. On these phones Termux is paired with Wireless debugging (the Shizuku
keeper, SPEC 4.7), so adb is reachable from the phone itself. See SPEC 2.3.

## What exists today

- `android/build.sh` already has a test-only switch: `HM_TEST_BOOTSTRAP_URL` writes a string resource
  `hm_test_bootstrap` into `build/res-test/values/test.xml`, compiled and linked only when the variable is set, and
  prints `TEST BUILD: …` to stderr. `MainActivity.bootstrapUrl()` reads it with
  `getResources().getIdentifier("hm_test_bootstrap", "string", getPackageName())`; release builds have no such
  resource. Copy this pattern.
- `MainActivity.onCreate` creates the WebView (`web = new WebView(this)`).
- The page reads the app version through the existing bridge method `appVersion` (`web/src/bridge.ts`), which returns
  the APK's `versionName`. `web/src/update.ts` `isNewer` compares versions by dotted numbers with `parseInt`, so a
  suffix like `0.8.66+devtools` still compares as `0.8.66`.
- Releases: `.github/workflows/release.yml` builds with `KEYSTORE=… android/build.sh`.

## Design

1. **Build switch.** When `HM_DEVTOOLS=1`:
   - `build.sh` writes `<string name="hm_devtools" translatable="false">1</string>` into its own resource dir
     (`build/res-devtools/values/devtools.xml`), compiles and links it like the bootstrap one (both switches may be set
     together), prints `TEST BUILD: WebView remote debugging is on` to stderr, and appends `+devtools` to
     `VERSION_NAME` (e.g. `0.8.66-test+devtools`).
   - `build.sh` refuses (exit 1, clear message) when `HM_DEVTOOLS` is set together with `KEYSTORE` (the release key
     path CI uses), so a release can't be built with it by mistake.
2. **App.** `MainActivity` gets `boolean devtoolsBuild()` (same identifier lookup; true only when the resource exists
   and equals `"1"`). In `onCreate`, before `new WebView(this)`: `if (devtoolsBuild()) WebView.setWebContentsDebuggingEnabled(true);`
   (API 19: no version check needed; min is 26). Nothing else changes; no new bridge method.
3. **On-screen warning.** The page shows a thin, always-visible strip at the top of the app (above the header, also
   over full screens): `Test build: remote debugging is on`, in the warning colour (CSS variables only). Shown when
   `appVersion()` ends with `+devtools`. It can't be dismissed. Put the check in a pure exported function
   `isDevtoolsBuild(version: string): boolean` (in `web/src/bridge.ts` or a tiny module) so it can be unit-tested.
4. **Release guard in CI.** In `release.yml`, after "Build the APK", add a step that fails when the APK contains the
   flag: `unzip -p android/build/hermes-mobile.apk resources.arsc | grep -aq hm_devtools && { echo "release APK has hm_devtools"; exit 1; } || true`.
   Also run the same check in `ci.yml` if CI builds an APK there (look; if it doesn't, the release check is enough).
5. **Docs.**
   - `docs/SPEC.md`: 2.3 security model (why remote debugging is off, the test-build exception and its guard), the build
     section (the `HM_DEVTOOLS` variable next to `HM_TEST_BOOTSTRAP_URL`), 4.1/4.5 where `MainActivity` is described,
     and the warning strip in 3.1/3.2.
   - `README.md` "Build the app yourself": one short paragraph on `HM_DEVTOOLS=1` for testing, with the warning not to
     use such a build day to day.
   - `docs/manual-tests.md`: a "Driving a test build from a computer" section:
     1. `adb shell pidof com.omarqaterge.hermesmobile` → PID.
     2. `adb shell cat /proc/net/unix | grep webview_devtools_remote` → the socket name
        (`webview_devtools_remote_<PID>`).
     3. `adb forward tcp:9222 localabstract:webview_devtools_remote_<PID>`.
     4. Chrome: `chrome://inspect` shows the page; or Playwright:
        `const b = await chromium.connectOverCDP('http://127.0.0.1:9222'); const page = b.contexts()[0].pages()[0]`.
     5. `adb forward --remove tcp:9222` when done.

## Tests

- **Unit:** `isDevtoolsBuild('0.8.66+devtools')` true; `'0.8.66'`, `'web-dev'`, `''` false; `isNewer('0.8.67', '0.8.66+devtools')`
  true and `isNewer('0.8.66', '0.8.66+devtools')` false (add to the existing update tests).
- **E2E:** the fake native shell in `tools/web-e2e/test.cjs` returns `appVersion` `'test'`. Add a short separate page
  whose init script makes `appVersion` return `'0.8.66+devtools'` (copy how other checks build a page with a modified
  `nativeShell`), and check the strip with text `Test build: remote debugging is on` is visible; on the normal page it
  is absent.
- **Java:** `tools/java-check.sh` passes. `tools/api-check.sh` if the SDK is available.
- **build.sh guard:** a tiny shell test (`tools/test_devtools_guard.sh`, run it in your report; add it to CI next to the
  other `tools/test_*.sh` if they run there) that runs `KEYSTORE=/nonexistent HM_DEVTOOLS=1 android/build.sh` and
  expects exit 1 with the refusal message **before** any SDK check. Put the guard at the very top of `build.sh` so the
  test needs no SDK.
- Not testable here: the real WebView socket on a phone. Say so; `docs/manual-tests.md` has the steps.

## Out of scope

Turning debugging on in an installed release (that is plan 14), a debug-signed variant, Gradle.
