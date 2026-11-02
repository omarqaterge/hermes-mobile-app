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
  routes `alert()` to an app toast and turns taps on `http(s)` and `mailto` links, and `window.open` calls with
  such an address, into a message to the page (`#` and `javascript:` links are left to the frame; other links are
  stopped). The page accepts only `http(s)` and `mailto` addresses of up to 2,000 characters (`frameLink`) and opens
  them with `openExternal`. It opens right away only when the message follows a real tap in the frame (the page has
  transient user activation, `navigator.userActivation`, and the frame has focus), at most one link per 5 s; otherwise (a page posting on its
  own) it asks "Open link?" first. The Android shell also blocks every navigation of a sub-frame.
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

**Opt-in usage stats (`web/src/stats.ts`, Aptabase).** Off by default. Without an app key in the build (`__STATS_KEY__`, empty in every build until the owner sets one) `statsAvailable()` is false: nothing is offered, nothing listens, nothing is sent. With a key, nothing is sent until the user says yes on the card (3.18) or in Settings → About (3.15). The page has no Content Security Policy of its own (only canvas frames do, `htmlframe.ts`), and `network_security_config.xml` allows any TLS host, so the HTTPS request needs no rule change; Aptabase's events route answers cross-origin requests from any origin with the `App-Key` header.

- **What the request body holds**, one short list in code (`STATS_EVENTS`): the events `app_start`, `screen_open` (with `screen`, one of the fixed screen names) and `heard_from` (with `source`, one of the fixed choices). `track` drops a name, property or value that isn't on the list. Every event also has `timestamp`, `sessionId` (the random install ID, `hm.statsId`: 16 random bytes, not derived from the device, also what makes Aptabase's "sessions" count installs), and `systemProps`: `osName` (`Android`), `osVersion`, `appVersion`, `isDebug`, `sdkVersion`.
- **Never in the body:** chat contents, prompts, tool output, file names, model keys, account names, phone numbers, the phone's locale or its model.
- **What the receiving side gets anyway.** Like every request from the page, it carries the sender's IP address and the WebView's `User-Agent` header, which on Android names the phone model and the page can't change it (`fetch` and `XMLHttpRequest` ignore a `User-Agent` they set). Aptabase's privacy policy says both are only processed in memory and never stored. Its published server code derives and stores from them a country code, a region and a one-day pseudonymous user ID (a keyed hash with a salt rotated daily). No IP-derived data is stored by this project; the card says what Aptabase keeps.
- **Off** (`setStatsChoice(false)`): drops what is waiting, aborts a running request and forgets the install ID; a later yes makes a new one.
- **Bounds:** events wait in memory and go in one batch (at most `MAX_BATCH`), 30 s after the first (`FLUSH_AFTER_MS`) or when the app goes to the background (`keepalive`). One one-shot timer at a time and none while hidden; a request gives up after 10 s (`TIMEOUT_MS`); a failed event is tried once more after 5 minutes (`MAX_TRIES`, `RETRY_AFTER_MS`), a rejected one never; at most `MAX_PER_LAUNCH` events per launch; nothing queued is kept on disk. Failures are silent.

**Dashboard token scrape.**
- Hermes's dashboard puts its session token into its HTML page as `window.__HERMES_SESSION_TOKEN__ = "…"` and
  mints a new one on every start. Everything that talks to the dashboard scrapes it from `http://127.0.0.1:9119/`
  with the same pattern: `MainActivity.token` (cached; refreshed on a new connect and after a 401/403),
  `HermesService.dashboardToken` (for notification answers and Stop), the plugin's `/approve` and `/stop` routes
  (their own WebSocket), and `web/devserver.py` (desktop development).
- REST calls carry it in `X-Hermes-Session-Token` (added by the shell). The WebSocket URL carries it as `?token=`,
  which is how Hermes's gateway accepts a WebSocket; the URL is built fresh for each connect and never stored.
- The background host's token stays in Java (`X-HM-Token` header, never in a URL, never sent to the page).
