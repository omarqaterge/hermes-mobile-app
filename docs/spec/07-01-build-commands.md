### 7.1 Build commands

| Step | Command | What it does |
|---|---|---|
| Web UI | `cd web && npm run build` | Runs `tsc --noEmit`, then `vite build`. Output is one self-contained `web/dist/index.html` (`vite-plugin-singlefile`; Mermaid, OpenUI, and KaTeX with highlight.js are built as separate bundles and embedded as inert text, started on first use by `web/src/lazy.ts`; `lazyBundle` inlines the fonts a `?inline` stylesheet uses and keeps only KaTeX's woff2 fonts). |
| APK | `cd android && VERSION_NAME=0.8.62 VERSION_CODE=862 ./build.sh` | Builds the app without Gradle (see below). Always pass both versions. |
| Install | `adb install -r android/build/hermes-mobile.apk`, then `adb shell am start -n com.omarqaterge.hermesmobile/.MainActivity` | `adb install` kills the app; starting the activity starts the service again. |

**`web/package.json` scripts** (package `hermes-mobile-web`, `"type": "module"`):

| Script | Runs | Use |
|---|---|---|
| `dev` | `vite --host 127.0.0.1` | Vite dev server, loopback only. |
| `build` | `tsc --noEmit && vite build` | Typecheck, then the single-file build. CI and `android/build.sh` depend on it. |
| `typecheck` | `tsc --noEmit` | Types only. |
| `test` | `vitest run` | The unit tests in `web/src/*.test.ts(x)` (39 files; `happy-dom` is the test DOM). `gateway-events.test.ts` feeds event sequences shaped like the pinned Hermes's (a whole turn with reasoning, a tool call and a streamed reply; tool placeholders and replays; errors; events of other chats) through the real client's event hub, with no socket, and checks the chat items `gateway.ts` makes of them. |
| `gen:openui` | `OPENUI_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 UPDATE_OPENUI=1 vitest run src/openui-lib.test.ts` | Regenerates the OpenUI prompt/library snapshot after the OpenUI packages are bumped. The two env vars stop OpenUI's script from sending telemetry. |

Runtime dependencies are pinned or caret-ranged in `web/package.json`: React 19, `zustand` (state), `react-markdown` with `remark-gfm`, `remark-math`, `rehype-katex`, `rehype-highlight`, `rehype-raw`, `rehype-sanitize`, `mermaid`, `katex`, `zod`, and the three `@openuidev/*` packages (card renderer).

**`android/build.sh`** (a build step; Android internals are in section 4). Environment: `ANDROID_HOME` (default is a Homebrew path), `JAVA_HOME` (default JDK 17), `VERSION_NAME` (default `0.1.0`), `VERSION_CODE` (default `1`), `KEYSTORE` (default `~/.android/hermes-mobile.keystore`, created with `keytool` if missing; CI passes the release key). Steps, in order:
1. Build the web UI with `npx vite build`, or with `HM_SKIP_WEB_BUILD=1` use the `web/dist/index.html` already there (it stops when there is none; the release workflow builds it in a job without the signing key); copy `web/dist/index.html` to `android/assets/www/index.html`; copy `phone/uninstall.sh` to `android/assets/phone/uninstall.sh` (Settings → Danger zone → Uninstall Hermes runs it in Termux, so it ships inside the APK).
2. `aapt2 compile` the resources, then `aapt2 link` the manifest with `--min-sdk-version 26`, `--target-sdk-version 35`, the version name and code. Compile target is Android 16 (`android-36.jar`) because Live Update APIs live there; build-tools 35.0.0.
3. `javac` (source/target 11) all of `src` plus the generated `R.java`, then `d8 --min-api 26` into `classes.dex`, zipped into the APK.
4. `zipalign -p 4`, `apksigner sign`, `apksigner verify`. Output: `android/build/hermes-mobile.apk`.
Test-build switch: `HM_DEVTOOLS=1` compiles and links a second resource dir (`build/res-devtools/values/devtools.xml`) with the string `hm_devtools` = `1`, prints `TEST BUILD: WebView remote debugging is on` to stderr and appends `+devtools` to `VERSION_NAME` (for example `0.8.66-test+devtools`). `isNewer` ignores the suffix. The script refuses (exit 1) when `HM_DEVTOOLS` and `KEYSTORE` are both set, before checking the SDK. Both test switches may be set together. See 2.3 for why and how to drive such a build (`docs/manual-tests.md`).
Emulator-only switch: when `HM_TEST_BOOTSTRAP_URL` is set, a string resource `hm_test_bootstrap` is added so the setup flow's installer command fetches that URL instead of `main`'s `bootstrap.sh`; `MainActivity` accepts only `http://10.0.2.2:<port>/…`. Never set for a release.
