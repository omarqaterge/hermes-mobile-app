### 2.3 Security model

The WebView page can do a lot (call Hermes, run things in Termux through the shell, read phone files). The rules
below keep that power with the app's own page and away from content it shows.

**Bridge handshake key and the `METHODS` wrapper.**
- Android injects the `HermesAndroid` object into every frame of the WebView, including the sandboxed iframes
  that show untrusted HTML (canvas pages). So every `@JavascriptInterface` method in `MainActivity.Bridge` takes a
  secret key as its first argument and starts with `if (!ok(key)) return …`.
- On every page load `onPageStarted` calls `newBridgeKey()`: 24 random bytes (hex) for the bridge key and another
  24 for the media key; `keyTaken` is reset.
- `handshake()` (synchronized) hands the key to the first caller after a page load, and an empty string to every
  later caller.
- `secure-bridge.ts` is the first import of `main.tsx`, so the app's own script is that first caller. It calls
  `handshake()`, then replaces `window.HermesAndroid` with a wrapper that has exactly the names in its `METHODS`
  list (52 names; full table in 4.5), each adding the key. A frame that only sees the raw object can't make a
  single call. `ok(key)` compares in constant time (`MessageDigest.isEqual`).
- A new bridge method must take the key first, check it, and be added to `METHODS`.

**WebView remote debugging is off, except in test builds.** With remote debugging on, anything that can reach `adb` on the phone can read the page (token, chats) and call every bridge method, and on these phones Termux is paired with Wireless debugging (4.7), so `adb` is reachable from the phone itself. So `MainActivity` never calls `WebView.setWebContentsDebuggingEnabled(true)`, with one exception: a test build made with `HM_DEVTOOLS=1 android/build.sh` (7.1). That adds the string resource `hm_devtools` (value `1`); `MainActivity.devtoolsBuild()` reads it with `getIdentifier` and, only when it is `1`, turns debugging on before the `WebView` is created. The same build ends its version name with `+devtools`, and the page shows a warning strip (3.2). Guards: `build.sh` exits 1 when `HM_DEVTOOLS` is set together with `KEYSTORE` (the release key), as its very first step and before any SDK check (`tools/test_devtools_guard.sh` tests this); `release.yml` fails the release when `resources.arsc` of the built APK contains `hm_devtools`. No bridge method was added.

**Remote debugging as a setting (Settings → About → Remote debugging).** The installed app, release included, can turn WebView remote debugging on for a short time, to debug a problem that only shows on the user's own install. Threats and answers:

1. *Script in the page* (a sanitiser bug, a bad card, a bad dependency holds the bridge key). **No bridge method turns it on.** The page may only call `openRemoteDebugging` (asks the shell to show its own confirmation), `remoteDebuggingState` (read-only JSON `{available, on, minutesLeft}`) and `turnOffRemoteDebugging` (turning off is always safe). All three take the per-page key first and are in `secure-bridge.ts`; `tools/web-e2e/checks/12-app-shell.cjs` checks that no name there suggests enabling.
2. *Hermes driving the phone* (background app, Shizuku could tap a switch). Turning on needs the phone's screen-lock credential, which nothing can type for you: `Bridge.openRemoteDebugging` runs `MainActivity.askRemoteDebugging`, a **native** `AlertDialog` ("Turn on remote debugging?", Cancel / Continue; shown only while the app is on screen, one at a time); Continue runs `KeyguardManager.createConfirmDeviceCredentialIntent` through `startActivityForResult` (request code `REQ_DEVTOOLS`). Only `onActivityResult` with `RESULT_OK` for that request, and only if the app itself launched it (`devtoolsPending`), calls `DevTools.turnOn`, which checks Developer options and the screen lock again. With no screen lock (`isDeviceSecure()` false) a toast says "Set a screen lock first" and it stays off.
3. *Forgetting it on.* The state is one static field in `DevTools` (process memory only), so a process restart turns it off (`DevTools.recheck` runs in `MainActivity.onCreate` and `HermesService.onCreate` and drops a notification a dead process left; when it is off and was never on in this process it doesn't touch WebView, so the service's start at boot doesn't load WebView). It ends after 60 minutes (`DURATION_MS`; one bounded `Handler` callback, also re-checked in `MainActivity.onResume`, because a sleeping phone delays the callback), and from the ongoing notification `Remote debugging` (4.3) with a Turn off action.
4. *Ordinary users.* The row (and `available`) exist only while Android Developer options are on (`Settings.Global.DEVELOPMENT_SETTINGS_ENABLED`); `onResume` turns it off if they were turned off.

A test build (`devtoolsBuild()`) keeps debugging on whatever this setting does: `DevTools.apply` enables it when `isOn() || testBuild`. The notification's Turn off action is a `PendingIntent.getService` with an explicit intent (action `ACTION_OFF`, `DevTools.ACTION_OFF`) to `HermesService`, which is `exported="false"`, so no receiver was added and the manifest did not change. No new permission. Whether an already attached DevTools session is cut when it is turned off is recorded in `docs/manual-tests.md`.

**`safeRequest` / `safeLink`.**
- `safeRequest(method, path)`: the only REST calls the shell makes for the page (`httpAsync`, `streamGet`) are
  `GET`, `POST`, `PUT`, `DELETE` or `PATCH` on a path that starts with `/api/`, is at most 4,096 characters and has
  no control characters or spaces (no header injection). Anything else answers 400 "blocked request". The shell
  adds the dashboard token itself; the page never holds it for REST.
- `safeLink(uri)`: links handed to other apps (`openExternal`, and main-frame navigations in
  `shouldOverrideUrlLoading`) must be `http`, `https`, `mailto` or `tel`; `intent:`, `file:`, `content:`,
  `market:` and the rest are dropped. Sub-frame navigations never leave the app (`!req.isForMainFrame()` → blocked),
  and the page itself only navigates within `file:`.
- Other input checks in the bridge: `openFile` takes only absolute paths without `..` or NUL and passes them as
  arguments, never as script text; chat ids from the page match `[A-Za-z0-9_.:-]*` and are at most 200 characters;
  `setUnseen` keeps at most 500 rows; `setReadAloud` takes valid JSON up to 200,000 characters; `shareText` up to
  400,000 characters; `ttsControl` only `play|pause|toggle|rew|ff|stop`; `installHelperApp` only the four helper
  apps; `uninstallApp` only its fixed list.
- WebView settings: JavaScript and DOM storage on; file access only for the app page itself
  (`setAllowFileAccessFromFileURLs(false)`, `setAllowUniversalAccessFromFileURLs(false)`,
  `setAllowContentAccess(false)`). Cleartext traffic only to `127.0.0.1` and `localhost`.

**Sandboxed canvas iframes.**
- HTML documents (canvas, gallery) run in `<iframe sandbox="allow-scripts allow-forms allow-modals"
  referrerPolicy="no-referrer" srcDoc>` (`web/src/components/HtmlFrame.tsx` `HtmlFrame`, srcDoc built by `frameDoc` in `web/src/htmlframe.ts`; also used for the inline chat preview). No `allow-same-origin`, so the frame has no
  access to the app page, its storage or its cookies.
- A guard script is injected first (right after the doctype): it deletes `window.HermesAndroid`, reports errors,
  routes `alert()` to an app toast and turns link clicks into a message to the page. The page asks "Open link?"
  before opening an `http(s)` link (the frame could post the message without a tap).
- Unless the document's Online switch is on, a CSP blocks all network (`default-src 'none'`, inline script/style
  only, images and media from `data:`/`blob:`, `form-action 'none'`, `base-uri 'none'`).
- The real isolation is the bridge key: the raw bridge object is visible inside frames even after the guard, but
  useless without the key.

**rehype-sanitize (chat messages).** Markdown from the model may contain raw HTML; `Markdown.tsx` renders it
through `rehype-raw` and then `rehype-sanitize` with an extended schema: a list of safe extra tags, inline SVG with
presentation attributes only (no `script`, `foreignObject`, `use`, `image`, `a`, `style`, animation), `style` on
any element but filtered by `rehypeSafeStyle` to looks-only properties, and the extra link protocol `hermes-chat`.
Links open through `openExternal` (so `safeLink`). OpenUI cards (3.9) are rendered by their own library in the
page; their actions can only call read-only tools through `POST /openui/call`, and their links pass
`safeHttpUrl` (http/https only).

**Event key `~/.hermes-mobile/key`.**
- `HermesService.ensureKey` makes a 24-byte random key once and keeps it in the app's prefs (`hermes` →
  `event_key`).
- Once per service run, and only after Termux has accepted a command, `shareKeyWithTermux` writes it to Termux's
  `~/.hermes-mobile/key` with `umask 077` (a `RUN_COMMAND` running `sh -c`). `shareKeyAgain` repeats this when
  Termux first accepts a command (first good probe, installer DONE).
- Every sender reads that file: the plugin (`_key`, re-read when its mtime changes), `cron_ticker.py`,
  `hm-shizuku`. Each `POST /event` carries it in `X-Hermes-Mobile-Key`. The listener binds to `127.0.0.1` only,
  compares in constant time, allows at most 40 header lines of ≤ 2,048 characters and a body of ≤ 256 KiB, and
  answers 204 or 403. The cron poke on 9122 sends the same key.
- `POST /setup` uses its own one-time token instead (made when the app copies the installer command, body
  ≤ 1 KiB; `SetupLines`, 4.1).

**Dashboard token scrape.**
- Hermes's dashboard puts its session token into its HTML page as `window.__HERMES_SESSION_TOKEN__ = "…"` and
  mints a new one on every start. Everything that talks to the dashboard scrapes it from `http://127.0.0.1:9119/`
  with the same pattern: `MainActivity.token` (cached; refreshed on a new connect and after a 401/403),
  `HermesService.dashboardToken` (for notification answers and Stop), the plugin's `/approve` and `/stop` routes
  (their own WebSocket), and `web/devserver.py` (desktop development).
- REST calls carry it in `X-Hermes-Session-Token` (added by the shell). The WebSocket URL carries it as `?token=`,
  which is how Hermes's gateway accepts a WebSocket; the URL is built fresh for each connect and never stored.
- The background host's token stays in Java (`X-HM-Token` header, never in a URL, never sent to the page).
