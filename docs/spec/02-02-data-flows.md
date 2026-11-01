### 2.2 Data flows

Each flow lists the steps in the order the code runs them. "Page" = the WebView page, "service" =
`HermesService`, "plugin" = the Hermes Mobile plugin inside Hermes.

#### 2.2.1 Send a message and stream the reply

1. The composer calls `sendPrompt(text)` in `gateway.ts` (3.4). Empty text does nothing. While a chat is still
   opening (`opening` set) it throws "Still opening your chat — wait a moment".
2. `rememberPrompt` stores the text in `hm.recent.v1.<profile>` (4–200 characters, newest 20).
3. `targetChat()` picks the chat: it first waits for a chat a model pick is creating (`pendingNew`), then uses
   `active`, else calls `newSession()` (`session.create` with `source: 'mobile'`; this is how a chat is made by
   its first message). `newSession` also applies the Auto default (`defaultAccess()`, see 2.2.1a).
4. `/btw …` opens the side-question sheet (`openBtw`, 3.12) and stops. Any other `/…` goes to `runSlash`:
   `/yolo` and `/fast` are handled with `config.set` (keys `yolo` and `fast`); everything else tries `slash.exec`,
   then `command.dispatch`, and follows its `type` (`exec`, `alias` up to depth 3, `send`, `skill`, `prefill`).
5. If the chat is running, the text steers the running turn (`session.steer`) and a "Steer: …" notice is added.
   A follow-up typed while the chat runs can also wait in the page's queue instead (`queue.ts`, 3.4): see step 8a.
6. Otherwise the page adds the user bubble at once (with photo previews, image paths, file names and their
   `@file:` refs), sets `running: true`, clears the attachments, waits for a model switch in flight
   (`switching`), and calls `prompt.submit` with `surface: 'mobile'`. Files travel as their `@file:` references in
   front of the text; photos were already queued inside Hermes by `image.attach_bytes`. The answer's
   `user_row_id` is stored on the bubble (needed for edit/retry/branch). On failure the attachments come back and a
   "Send failed: …" notice is added.
7. Hermes streams events on the WebSocket. `client.onEvent` in `gateway.ts` applies them to `active.items`:
   - `message.start` resets the speed counter; `thinking.delta` and `status.update` set the live status line.
   - `reasoning.delta` and `message.delta` are appended to the open reply in batches (`queueDelta` →
     `flushDeltas`, every 60 ms, every 150 ms once the reply is over 6,000 characters). Any other event flushes
     first, so order never changes.
   - `tool.generating` closes the open reply and adds a generating tool card; `tool.start` turns it into a
     running card (or adds one; a replayed start for a card already shown adds nothing); `tool.complete` fills in
     args, duration, summary, result text and inline diff; `tool.output_risk` flags a card. Canvas tool events
     also call `canvasWritingStarted`, `canvasCallStarted` and `canvasToolDone` (3.7).
   - `subagent.start|progress|thinking|tool|complete` keep one card per sub-agent; `todo.updated` sets the task
     list; `session.usage` and `session.info` update the chat (usage that carries `context_max` and `context_used` also updates `ctx` through `refreshCtx`, so the context ring moves during a long turn); `session.title` renames it.
   - `message.complete` drops leftover generating cards, puts the final text on the reply (`fullReply` keeps the
     streamed text unless the final one is longer and ends with it), adds an error notice on failure, hands the
     reply to Live mode or to auto read-aloud (only while the app is in front), sets `running: false`, and
     `finishTurnStats` writes "~N tok/s · 1m 23s · ctx N% · used/max" under the reply (the turn's duration, from 1 s on) and saves it in `hm.stats.v1`.
   - `review.summary`, `background.complete` and an unclaimed `btw.complete` become info notices.
   - Events of other chats only refresh the drawer (`session.title`, `message.complete` → `loadSessionsSoon`);
     `sessions.changed` refreshes it too. `notification.show` becomes a toast; `request.cancel` closes a request
     sheet that was answered elsewhere.
8a. The queue drains on turn end. `gateway.ts` watches the store (`subscribe`): when the open chat goes from running to
   not running and the turn was not stopped (`interrupt()`) and did not end with an error (`message.complete` with
   `error` or `failure_reason`), the queue is not paused, no approval or question is open (`requests`), Hermes is
   connected and no attachment is waiting, `drainQueue` takes the first queued message (`takeFirst`) and sends it
   with `sendPrompt`. Its reply ends the next turn, which sends the next one. After a Stop or an error the queue is
   paused instead, and so is a chat just opened. `drainQueue(chat, true)` (the Resume button) ignores the pause.
   If the send throws, the message goes back to the front and the queue is paused with an error toast.
8. A missed `message.complete` can't leave the spinner on: every 15 s, if the chat is running and no event came for
   45 s, `syncRunning` asks `session.resume`; when Hermes says it is no longer running, the stored transcript
   replaces the screen. The same check runs whenever the page becomes visible.
9. In parallel the plugin's hooks post `status` events to the service (throttled to one per second, a beat every
   15 s), which draws the status chip (4.3, 5.1).

#### 2.2.1a Access mode (Auto / Full) on new and resumed chats

- `setAccess(a, mode, remember)` runs through one promise queue (`accessQueue`), so mode changes never overlap.
- Auto: `PUT /api/plugins/hermes-mobile/auto` `{session, mode:'auto'}` first (the plugin's block list, 5),
  then `config.set yolo 1`. If yolo didn't turn on, the plugin entry is removed again.
- Full: `config.set yolo 1`, then the plugin entry is removed. Off: `config.set yolo 0`, entry removed.
- `remember=true` writes the chat's own choice into `hm.yolo.v1` (`true` = Full, `'auto'`, `false` = an explicit
  Off). The Settings default (`hm.defaultAccess.v1`) is applied with `remember=false`, so a chat that never had
  its own choice keeps following the default.
- Hermes forgets yolo when a chat is resumed, so the `access` chat-open step (`chatopen.ts`) re-applies
  `rememberedAccess(storedId)` after `resumeSession` (the chat's own entry, else the default); after `newSession` it
  applies the default.

#### 2.2.2 Approval while the app is closed

1. Hermes needs approval for a command. Two things happen at once:
   - The gateway sends a server→client request `approval` on the page's WebSocket. `client.onRequest` adds it to
     `requests` (the request sheet, 3.6). The page does not notify for `approval` or `clarify` itself; it only
     posts "Hermes needs your input" for masked prompts (`secret`, `sudo`, `otp`, `connection.request`) and only
     while in the background.
   - The plugin's `pre_approval_request` hook sends an `approval` event (urgent) to `127.0.0.1:9121/event` with
     the command, a cleaned-up description, `request_id`, the session key, the timeout and `allow_session`.
2. If the POST fails (the service isn't listening), the plugin falls back to `termux-notification` with an action
   that opens the app on that chat.
3. The service checks the key, stores the approval as `pendingApproval` with its deadline, puts the buttons on the
   status chip, and holds the CPU awake until the deadline + 5 s (`updateWake`). If the app is on screen
   (`MainActivity.visible`) it stops there: the in-app sheet is the way to answer. Otherwise it also posts a popup
   on the `needs_you` channel with Allow once, Allow session (when allowed) and Deny.
4. A button tap starts the service with `ACTION_APPROVE`. On a locked phone Allow once and Allow session never act
   from the notification: Android 12+ asks for the unlock before the button works (`unlockFirst`), and on Android
   8-11 `openToUnlock` opens the app on that chat instead, which brings up the unlock screen (see 4.3). Deny always
   goes through. `answerApproval` scrapes the dashboard token
   (`dashboardToken`) and POSTs `{session, key, choice, request_id, profile}` to
   `/api/plugins/hermes-mobile/approve` (retrying once with a fresh token on 401/403).
5. The plugin's `/approve` route refuses an answer without `request_id` (409), opens its own WebSocket to
   `127.0.0.1:9119/api/ws` and sends `approval.respond` for that request. Hermes runs the command or not.
6. The `post_approval_response` hook sends `clear` (`what: approval`); the service drops the popup and the chip's
   buttons. On the page, `request.cancel` closes the sheet if it was still there. If step 4 failed, the service
   posts "Couldn't send your answer" with the reason.
7. When the app comes back to the front, `MainActivity.onResume` cancels any approval popup still shown (the
   in-app sheet takes over).

#### 2.2.3 Reply notification (and answering it)

1. The turn ends. The plugin's `on_session_end` hook sends `reply` (title = the chat title, body = the reply with
   cards replaced by "[card]", `speak_text` = up to 20,000 characters, `platform`) and `flash` with `done: true`.
   A failed turn sends `error`; a cron turn sends `cron`; an interrupted turn sends nothing.
2. The service, for `flash` done: if the app is on screen nothing sticks; otherwise the chat goes into `unseen`
   (saved), the icon badge is updated and the chip shows the sticky Done state (4.3).
3. For `reply` (or `error`): if the app is on screen, nothing is posted. Otherwise a notification goes to the
   `replies` channel with a Reply action (`RemoteInput`) and the badge count; for `reply` the service also reads it
   aloud when read-aloud is on for that chat and the chat was made in the app (`readAloud`, 4.6).
4. Tapping the notification opens `MainActivity` with the extra `session`. `onCreate` or `onNewIntent` stores it as
   `pendingSession`; once the page has loaded, `openPendingSession` (the id filtered to `[A-Za-z0-9_.:-]`) calls
   `window.hermesOpenSession`, which runs `openSessionFromNotification` → `resumeSession`.
5. The page's store subscription calls `chatSeen(storedId)` whenever the chat on screen changes (also for a chat
   created by its first message), so the service drops that chat's Done chip, badge and reply notification.
6. Typing into Reply: the service's `answerFromNotification` hands the text to the page through
   `MainActivity.deliverAnswer`, which first un-freezes the hidden page for 30 s (`wakePage`) and calls
   `window.hermesAnswer('reply', session, text)` (`notif-answer.ts`). The page pings (`connectionAlive`); if the
   socket is dead it queues the text in the outbox and reconnects (`queueAndReconnect`), else it opens that chat
   if needed and calls `sendPrompt`. If the page isn't loaded or says no, the service posts "Couldn't send your
   answer"; tapping it opens the chat with the text in the composer (`draft` extra → `composerPrefill`).
7. A `clarify` question works the same way with kind `ask` (choices become quick replies, up to 5, each cut to 40
   characters).

#### 2.2.4 The app starts Hermes when it isn't running

1. `MainActivity.onCreate` calls `startHermes()`. It does nothing until Termux has accepted one of the app's
   commands once (`termuxOk`: a probe answered, the dashboard answered a token scrape, or the installer reported
   DONE; an app update from an older build counts as yes), nor while the installer runs, nor after Settings →
   Uninstall Hermes started (`Uninstall.started`), nor within 8 s of the last request, nor without the
   `com.termux.permission.RUN_COMMAND` permission.
2. `startHermesNow` sends Termux's `RunCommandService` the path `~/bin/hermes-services`, in the background.
   The script is idempotent: `run_loop` starts each loop only when its pid file's process is gone. A failure is
   kept as `startError` for the Setup check (3.18).
3. In parallel the page renders (`bootMark('painted')`) and calls `connect()` in `gateway.ts`. On a cold start it
   first fills the drawer from `hm.sessions.v1` (the last list).
4. `wsUrl()` in `bridge.ts` asks for a fresh token every connect: `getTokenAsync(id)` → a native thread runs
   `token(true)`, which GETs `http://127.0.0.1:9119/` (2.5 s connect, 4 s read) and reads
   `window.__HERMES_SESSION_TOKEN__` from the HTML; the answer comes back as `window.__hmToken(id, token)`. The
   page gives up after 15 s. A token is never cached across connects because Hermes mints a new one on each start.
5. No token: `conn` becomes `error` with "Hermes is not running yet" and `scheduleReconnect` retries. The delay is
   `min(15 s, 600 ms × 2^min(attempt, 5))`, so 0.6, 1.2, 2.4, 4.8, 9.6, then 15 s. The header detail says
   "Reconnecting…" for the first two tries and "Starting Hermes…" after that. The 2nd try and every 6th try call
   `startHermes()` again (the 8 s throttle still applies).
6. With a token the page opens `ws://127.0.0.1:9119/api/ws?token=…` and runs `afterConnect` (2.2.5).
7. Coming back to the app calls `window.hermesResume`, which reconnects at once (and asks Termux again) when the
   socket isn't open.
8. A fresh install that never reached Hermes opens the setup flow instead (`openFirstRun`, `watchFirstRun`: 3.18).

#### 2.2.5 Reconnect, outbox and chat cache

- **Liveness.** The client's own heartbeat is off. Every 15 s (`BEAT_MS`) `gateway.ts` checks the socket: a gap of
  more than 30 s between beats means the page was frozen, so the 45 s window starts again; otherwise 45 s
  (`DEADLINE_MS`) without any inbound frame drops the socket (`client.invalidate`), and each beat sends
  `gateway.ping`. When the page becomes visible, `checkSocket` pings (10 s) and replaces a dead socket at once.
- **Reconnect.** A closed or failed socket calls `scheduleReconnect` (2.2.4 step 5). `connect()` clears the warm
  list (Hermes reaps the old socket's runtimes itself).
- **After connecting** (`afterConnect`): `session.list` and the resume go first, alone. Everything else the app
  needs after a connect waits for `afterChatOpens()`, which resolves once the start-up chat is open (or there is
  none to open), or after 3 s at most: the default model (`GET /api/model/info` + `GET /api/config` for the
  reasoning level); `App`'s health poll (`startHealthPolling`, or a ping-only `checkHealth(false)` on a reconnect),
  activity poll, canvas sync and setup-flow check; and the composer's command list (`refreshCommands`:
  `commands.catalog`, `GET /api/skills`). On a phone (2026-11-01) these, sent at the same moment, made Hermes answer
  `session.list` and `session.resume` in about 1.2 s instead of 30–70 ms. `profiles.list` is sent 3 s later or
  right after the resume (it is slow), and a Hermes-version check after 5 s (`hermes-update.ts`). The resume:
  1. The chat to resume is the one on screen, else `hm.lastSession` (only when its profile matches).
  2. `resumeSession(id, {keepItemsIfSame: true, auto: true})`. If the socket replays events this chat missed
     (`client.sessionReplayBarrier`), the page waits for them first so they aren't applied twice. If the reloaded
     transcript adds nothing (`addsToScreen`), the items on screen are kept, with the open streaming reply.
  3. "Gone" errors (`not found`, `no such`, `unknown session`, `does not exist`): with no chat on screen,
     `hm.lastSession` is cleared. A chat on screen with nothing sent is a draft Hermes never stored: it is remade
     with the same folder, model, provider and reasoning level (`recreateDraft`), keeps its attachments
     (`carryAttachments`) and takes over its outbox message. Other errors retry once after 4 s.
  4. `flushOutbox()` runs last.
- **Outbox** (`hm.outbox.v1`, one message). While offline the composer calls `queueMessage(text)`: it stores
  `{chat, text}` (chat = the open or opening chat, `null` = a new chat) plus the attachments and their runtime id.
  ✕ on the chip calls `unqueueMessage`, which puts the text back. On connect, `flushOutbox` clears it, opens that
  chat (or a new draft), re-queues its photos when the page reloaded meanwhile, sends it and toasts "Sent the
  message you queued"; on failure the text goes back into the composer with "Couldn't send the queued message: …".
- **Chat cache** (`chatcache.ts`). Memory holds the last 8 chats (60 items each, half-streamed replies frozen).
  Opening a chat draws its cached copy as `preview` at once while `session.resume` is on its way; the resume's
  transcript always replaces it. When the page goes to the background, `saveChatToDisk` writes the open chat to
  `hm.chatcache.v1` (at most 1,500,000 characters; it halves the items until it fits, and drops the entry if even
  5 items don't). On a cold start `store.ts` sets `opening` = `hm.lastSession` and `preview` = that cached chat
  before any network call, so the last chat is on screen before Hermes answers. Deleting a chat forgets its cache.
- **Warm chats.** A chat you leave while it is idle stays live in Hermes (`WARM = 2` most recent); older ones get
  `session.close` 3 s later unless reopened. A chat that is still working is never closed by leaving it.
- **Navigation wins.** `newSession`, `startDraft` and a non-auto `resumeSession` bump `openSeq`; a slower resume
  that finds `openSeq` moved does not replace the chat the user went to (it goes warm instead).

#### 2.2.6 Canvas edit

1. The canvas belongs to the chat on screen. `canvas.ts` follows it through `syncSession` (subscribed to the main
   store; it uses `opening || active.storedId`), and loads the document list with
   `GET /api/plugins/hermes-mobile/canvas?session=…` (no `profile=`).
2. Typing calls `editDoc`; 0.8 s after the last key `flushSave` sends `PUT /api/plugins/hermes-mobile/canvas/doc`
   with `{session, id, content, base_rev}`. The state goes dirty → saving → saved (2 s) → idle.
3. A conflict answer (the document moved past `base_rev`) sets the `conflict` state; the panel offers take theirs
   (`takeTheirs`) or keep mine (`keepMine`, which reloads and saves again over it).
4. Switching chats with an unsaved edit saves it to the chat it belongs to first.
5. Hermes writes through its `canvas` tool; the `tool.complete` event calls `canvasToolDone`, which refreshes or
   opens the panel at once. While the panel is open and the page visible, the list is re-read every 6 s so a
   document changed elsewhere reloads (or is flagged when you have unsaved edits in it).
6. All canvas REST calls go through the bridge (`httpAsync`), never the WebSocket. Panel UI: 3.7; routes: 5.4;
   storage: 2.4.

#### 2.2.7 Media streaming (photos, video, audio from the phone)

1. `Media.tsx` asks the bridge once per page load for `mediaBase()`:
   `https://hm-media.invalid/m?k=<mediaKey>&p=`. A new `mediaKey` (24 random bytes) is made on every page load,
   together with the bridge key.
2. `<img>`, `<video>` and `<audio>` load `mediaBase + encodeURIComponent(path)`. The host `hm-media.invalid`
   never resolves; `MainActivity`'s `shouldInterceptRequest` catches it.
3. `MainActivity.media` checks `k` against `mediaKey` in constant time (403 otherwise), checks the path with
   `safeMediaPath` (absolute, no `..`, no NUL; 400 otherwise) and keeps a `Range` header only if it matches
   `bytes=\d*-\d*`.
4. `mediaGet` → `streamGet` sends `GET /api/plugins/hermes-mobile/media?path=…` to `127.0.0.1:9119` with
   `X-Hermes-Session-Token` and the `Range` header, retrying once with a fresh token on 401/403. The response
   headers are parsed by hand and the socket's body stream is handed straight to the WebView (`Content-Type`,
   `Content-Length`, `Content-Range`, `Accept-Ranges` kept, `Cache-Control: no-store`). A chunked body is
   de-chunked in memory first. Non-2xx answers become an empty response with that status.
5. The plugin's `/media` route serves the file with single-range support (206, or 416 when unsatisfiable), so
   video can seek and nothing goes through the bridge as base64.
6. Outside the app (desktop dev page) there is no `mediaBase`, so `Media.tsx` falls back to
   `GET /api/files/read` (a data URL, size-capped).
7. Save and Share in the image viewer reuse the same route (`mediaBytes`, up to 30 MB) or take base64 from the
   page, write to Pictures/Hermes or a share-cache file, and answer through `window.__hmImage(id, ok)`.

#### 2.2.8 Background app (Hermes uses an app on a hidden screen)

1. The plugin's `phone_app` tool (5.2) starts `BgHost` if it isn't running: through `~/bin/rish` it runs
   `app_process` as the shell user with a fresh token; `BgHost` listens on `127.0.0.1:9131` and drives a virtual
   display.
2. On each open and action the plugin sends a `bgapp` event to the service: `{state, session, pkg, label,
   action, port, token}`. The service keeps it as `HermesService.bgApp` (port 1024–65535, token ≤ 256 characters);
   `pageJson()` strips the port and token before anything reaches the page. A different chat or app drops the old
   thumbnail; 0.7 s after an event the service fetches a 512 px frame for the chip's picture.
3. `setBgApp` pushes the state to the page (`window.__hmBg`, also on every `onResume`); at start the page reads
   `bgState()`. `bgapp.ts` shows the card only in the chat that started it.
4. The card asks for frames with `bgFrameAsync(id, maxW)` (width clamped to 120–1080) at most every 500 ms.
   `MainActivity.bgRequest` GETs `/frame?w=…` from `BgHost` with `X-HM-Token` and answers with a JPEG data URL
   through `window.__hmBgFrame`.
5. Stop and Take over call `bgAction('stop' | 'take_over')`, which POSTs `/close` or `/hand_over` to `BgHost`;
   a 200 clears `bgApp`. The card also goes when the plugin sends `state: done` (the turn ended or the model
   closed the app) or after 130 s without an event (`BG_TTL_MS`). UI: 3.10.

#### 2.2.9 Shizuku keeper (Shizuku restarts by itself)

1. `ShizukuProvider` (an exported provider only the shell/system may call) receives Shizuku's binder whenever
   Shizuku's server starts or this app's process starts while it runs. It links to the binder's death.
2. When the binder dies, `HermesService.shizukuDown` → `ShizukuKeeper.onDown`. Also, 90 s after the service
   starts, a one-time check calls it when Shizuku is installed but no live binder arrived (after a reboot). That
   check is a one-shot, non-waking `AlarmManager` alarm on the real-time clock (`ShizukuKeeper.armCheck`,
   `KeeperPlan.CHECK_MS`), not a `Handler` delay: a Handler delay counts only CPU-awake time, so a phone left asleep
   after a reboot with Wi-Fi off showed the "Not on Wi-Fi" notice minutes late or not before the user looked. The
   alarm never wakes the phone; it runs as soon as the phone is awake 90 s after the start. `stop()` removes it.
3. The keeper acts only when nothing blocks it (`KeeperPlan.blocker`: Shizuku installed, no uninstall or install
   running, Android 11+, `WRITE_SECURE_SETTINGS` granted, Termux accepts commands, Termux's adb paired). It waits for Wi-Fi, turns
   Wireless debugging on, finds its connect port with `NsdManager` (at most 10 s), and asks Termux (`RUN_COMMAND`)
   to run `~/bin/hm-shizuku start <port>`. At most a few attempts per down event (0, 30, 120 s) and a cap per hour.
4. `hm-shizuku` connects Termux's own adb and runs Shizuku's starter, then POSTs a `shizuku-auto` event
   (`{paired, result, detail}`) to `127.0.0.1:9121/event` with the event key.
5. Once the binder is back, `ShizukuKeeper.onUp` stops, turns Wireless debugging off again if it turned it on, and
   clears the notice. When it can't (no Wi-Fi, not paired…), it says why in a notice on the `phone` channel.
   Details: 4.7.

#### 2.2.10 App update

1. Settings → About → check (`update.ts` `checkForUpdate`): one `fetch` of GitHub's
   `repos/omarqaterge/hermes-mobile-app/releases/latest`; newer = dotted-number compare with `appVersion()`. The
   service also checks every 12 h (`UpdateNotice`) and posts a notice whose tap opens the app with an `updateUrl`
   extra. When the release is newer, the page also reads `CHANGELOG.md` at its tag for What's new (3.15).
2. Update → `installUpdate(url)` → `MainActivity.startUpdate`. `updateUrlOk` accepts only
   `https://github.com/omarqaterge/hermes-mobile-app/releases/download/….apk` (no `..`).
3. Without "install unknown apps" permission the shell reports `permission` and opens that system page.
4. The download (`download`) follows at most 6 redirects, each https on `github.com` or `*.githubusercontent.com`,
   and stops above 150 MB. It writes `cache/update/hermes-mobile.apk`.
5. The APK must have this package name and a higher `versionCode` ("You already have this version." otherwise).
6. `commitInstall` opens a `PackageInstaller` session. Android's confirm screen is shown at once if the app is in
   front, else when it next comes to the front (`onResume` → `showUpdatePrompt`). Progress and errors reach the page
   as `window.hermesUpdate(state, pct, msg)`. Android itself refuses an APK signed with a different key. UI: 3.15.
