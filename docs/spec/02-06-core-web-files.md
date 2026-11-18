### 2.6 Core web files

These files carry the plumbing every screen uses. Screens are in 3.

- `main.tsx` — entry point; imports `secure-bridge.ts` first, then the styles (`styles.css`, then `glass.css` and
  `motion.css`), applies the theme and the look (`applyLook`), opens the first-run flow on a fresh install and renders
  `App` (3.1).
- `glass.css` — the glass material (`docs/decisions/glass-and-motion.md`): its tokens per theme (`--glass-filter`,
  `--glass-tint`, `--glass-sheen`, `--glass-highlight`, `--glass-edge`, `--glass-edge-hi`, `--glass-edge-lo`,
  `--glass-shadow`, `--glass-bar-shadow`, `--glass-dim`, `--glass-accent`, `--glass-err`, `--glass-group`,
  `--glass-field`, `--scrim`, with `--glass-blur` the blur radius), the `.glass` class and the surfaces that carry it
  (bars, sheets, dialogs, toasts, the slash menu, the scrubber's label), the solid fallback (`html[data-glass='off']`
  and WebViews without `backdrop-filter`), and the chat screen's layout under its bars (3.2, Bars). Details in 3.20,
  Glass.
- `motion.css` — the motion system: springs (`--spring-settle`, `--spring-bounce`, `--spring-gentle`), the fade curve
  (`--ease-fade`), lengths (`--motion-quick`, `--motion-base`, `--motion-settle`, `--motion-bounce`,
  `--motion-stagger`), how far things travel (`--motion-move`), the three levels and what moves (3.20, Motion).
- `motion.ts` — the look's two settings and the motion helpers: `MotionLevel`, `defaultMotion`,
  `motionChoice`, `defaultGlass`, `glassChoice`, `motionLevel`, `glassOn`, `applyLook`, `setMotionLevel`, `setGlass`,
  the hooks `useMotionLevel` and `useGlass`, `lessMotion` (true when movement should be left out), `stagger` (a row's
  arrival delay), and `setAppAway` / `pauseWhenHidden`, which stop CSS animations while the app is away or an element
  is off screen (2.5). Tests in `motion.test.ts`.
- `barinsets.ts` — the heights of the chat screen's two bars: `watchBars` measures them with a `ResizeObserver` and
  writes `--bar-top` / `--bar-bottom` on `.stage`; `barInsets()` gives them to the scroll code and `onBarInsets` tells
  a listener when they change (3.2, Bars). The `Insets` type is `{ top, bottom }`.
- `library.ts` — which part of the Library page shows (`LibraryPart`: `canvases`, `files`, `projects`), remembered in `hm.libraryPart` (`savedPart`, `savePart`), and `openLibrary(part?)`, which opens the page (3.14).
- `panelvalues.ts` — the short values on the side panel's rows (3.13): `refreshPanelValues` reads the jobs and skills lists when the panel opens (docked: at start and when the app returns), at most once a minute per bot (`PANEL_VALUES_TTL_MS`), with no timer; `usePanelValues` gives them to the panel; `scheduledValue` and `nextLabel` turn the jobs list into "next 07:00", "next Mon 09:00", "None yet" or "Paused". Tests in `panelvalues.test.ts`.
- `Library.tsx` (in `components/`) — the Library page (3.14).
- `panel.css` — the side panel's look (3.13): the glass sheet over the chat, its inside, the docked column on wide screens and the chat stepping back behind it.
- `menu.css` — the menus' look (3.20 `MenuSheet` and its parts; the chat menu 3.5, a chat row's menu 3.13): header, quick-action tiles, groups and rows, the solid form over the side panel, the rows of `PickerSheet`, and Chat details' long values.
- `settings.css` — the Settings main page (3.15): one line per row (title, line and value cut with an ellipsis, so a narrow screen or a wider font never wraps them) and the attention cards (`.attn-card`: solid, a gold or red border, `--text` and `--glass-dim` text, a 44 px button, the shared row arrival).
- `needsyou.ts` — Which chats wait for the person's answer (`needsOf`, `openNeeds`, `useListedNeeds`): the chat list's Needs you group, the header button and the banner (3.13).
- `chatactions.ts` — Pin, Archive and Delete for a chat (`pinChat`, `archiveChat`, `deleteChat`), shared by the chat menu and the chat list (3.5, 3.13).
- `ChatMenu.tsx` (in `components/`) — the chat menu, the new-chat menu and their shared header (3.5).
- `tray.ts` — the composer's tray (3.4 Tray): `useTray` / `trayState` (`TrayState`: `mode`, `open`, `hint`), `trayForChat`, `trayFirstSend`, `takeTrayJump` (true once after a change that came with another chat, so the tray takes it without moving), `setTrayOpen`, `dismissTrayHint`, `modelBarMode` / `setModelBarMode` (`ModelBarMode`, `hm.modelBar`), `HINT_MS`, the one-time hint key `hm.trayHint.v1`, and `resetTrayForTests`. Tests in `tray.test.ts`.
- `Tray.tsx` (in `components/`) — the tray's pieces: `TrayBody` (the body above the text box and its movement), `TrayHandle` (the handle and the hint, in the bottom bar), `StatusLine` (the live status line, with `useElapsed`) and `LastSpeed` (the last reply's speed beside the ring) (3.4 Tray).
- `videoembed.ts` — which addresses play inside the chat and each one's player address; `VideoEmbed.tsx` (in `components/`) draws the card and the player (3.3, Video player).
- `stats.ts` — opt-in usage stats (spec 2.3): `startStats` runs once from `main.tsx`, after the first render; with no app key it does nothing.
- `report.ts` — Report a problem (spec 3.21): what a report holds (`reportDetails`), the log scrubber (`scrubLog`), the filled-in GitHub new-issue link (`fallbackUrl`) and sending through the relay (`sendReport`).
- `Report.tsx` (in `components/`) — the Report a problem sheet, its Settings row and the link error states show (spec 3.21).
- `DiagRows.tsx` (in `components/`) — Settings → Access & privacy's switch and delete button for the diagnostic log (3.21).
- `DynamicUI.tsx` (in `components/`) — Settings → Behaviour → Replies: the Dynamic UI switch (`useDynamicUI` reads and writes the plugin's `/openui`; `DynamicUIRow` is the row), moved from the main page (3.15).
- `applog.ts` — what the page itself adds to the diagnostic log: `startAppLog` runs once from `main.tsx`; the shape of page errors and error toasts, never their words. `openChatText` gives the scrubber the open chat's text.
- `diaglog.ts` — the page's side of the diagnostic log: `logEvent` checks every part of an event (`checkedFields`) and hands it to the shell, or keeps it in memory in a plain browser; `stackFrames`, `noteConn`, `noteRpc` and `routeName` say what is taken from an error, a connection, a gateway call and a dashboard path. It sends nothing.
- `diagnostics.ts` — what Report a problem may include (`collectDiagnostics`, `diagnosticsText`) and the Settings switch and delete button (`diagnosticsEnabled`, `setDiagnosticsEnabled`, `clearDiagnostics`, `flushDiagToPlugin`).
- `secure-bridge.ts` — takes the bridge key with `handshake()` and replaces `window.HermesAndroid` with the keyed
  wrapper over `METHODS` (2.3).
- `bridge.ts` — typed wrappers over the native bridge with browser fallbacks: `baseUrl`, `wsUrl` (fresh token per
  connect, `getTokenAsync` with a 15 s limit, `/__token` on the dev server), `startHermes`, `notify` /
  `cancelNotification`, `appInBackground`, `openExternal`, `copyText` / `copyRich`, `haptic`, native image
  save/share (`nativeImage`, `window.__hmImage`), setup facts and fixes (`setupState`, `setupFix`,
  `installHelperApp`, `probeTermux`, `copySetupCommand`, `setupProgress`, `onSetupEvent` fed by
  `window.hermesSetupInstall`, `hermesTermuxProbe`, `hermesSetupLine`, `hermesSetupChanged`), `signInTermux`,
  `installUpdate`, `appVersion`, `openFile`, `sharedItem`, `setLastChat`, `chatSeen`, `setUnseen`, `shareText`
  (≤ 400,000 characters), `bgState`, `bgFrameAsync`, `bgAction`, `remoteDebuggingState`, `openRemoteDebugging`, `turnOffRemoteDebugging` (`remotedebug.ts`, 2.3). In a plain browser the dev values come from
  `sessionStorage` (`hm.devBase`, `hm.devToken`), never the URL.
- `api.ts` — `api(method, path, body, {profile})` for dashboard REST. In the app it goes through the bridge
  (`httpAsync` → `window.__hmHttp(id, status, body)`); in a browser through the dev server's `/__api` proxy. It adds
  `profile=` unless `profile: false` or the path has one, parses JSON, throws `ApiError` ("Hermux unreachable: …"
  for status 0, the server's `detail` or "HTTP n" for ≥ 400). Also `qs` and `refreshLogins`
  (`POST /refresh-logins`, never throws).
- `gateway.ts` — the WebSocket client (`JsonRpcGatewayClient`, 120 s request timeout, own heartbeat off) and
  everything about chats: connect/reconnect/liveness, `rpc`, sessions and profiles, open/new/delete/rename/
  archive/branch, send/steer/slash commands, attachments, model and reasoning, access modes, server requests,
  streaming events → chat items, edit/retry, turn stats, compress (2.2.1–2.2.5).
- `store.ts` — the app state (`AppState`) with `getState`, `setState`, `subscribe`, `useStore`, `updateActive`,
  `toast` (one copy per text, at most 3 on screen, 3.5 s), the `ChatItem` kinds (`user`, `assistant`, `tool`,
  `notice`, `subagent`), the `Screen` and `Sheet` types, `hydrate` (stored transcript → items, skipping hidden rows
  and rows a resume repeats), `splitAttachments` (`@file:` / `@image:` back into chips), `addsToScreen` and
  `closeScreen`. The initial state reads `hm.profile`, `hm.textScale`, `hm.lastSession`, `hm.outbox.v1` and the
  cached chat.
- `chatview.ts` — which chat the screen shows, worked out in one place from the store's `opening`, `preview` and
  `active` (3.2, "While a chat opens"): `viewKind` (`ChatViewKind`), `viewSettled`, `screenChat`, `shownItems`,
  `shownKey`, `shownTitle`. Pure functions of the state, used as `useStore` selectors.
- `turn.ts` — one turn of the open chat as an explicit state machine (idle → sent → streaming → idle); `gateway.ts`
  changes `running`, `status`, `turnStart`, `tps` and `openAssistantId` only through its steps. `turnSent` (the page
  sent a prompt: the clock starts, the last turn's status text and speed are cleared), `turnStarted` (Hermes's
  `message.start`: keeps the send's start time) and `turnOver` (back to idle: nothing of the live readout stays)
  return the fields to set (`TurnFields`). `TurnEnd` names how a turn ended: `done`, `failed` (`message.complete` with
  an error), `stopped` (Stop) or `not-sent` (`prompt.submit` failed); `noteTurnEnd` records an ending that is not
  `done`, `takeTurnEnd` reads it once when the turn ends, and `queueGoesOn` says whether the queue sends its next
  message (only after `done`). In `gateway.ts`, `endTurn` applies `turnOver` to the chat whose turn it was and to no
  other.
- `approval-lock.ts` — Confirm approvals with fingerprint (3.6): `approvalLockAvailable`, `approvalLockState`, `approvalNeedsConfirm`, `confirmAllow` (bridge `confirmApproval`, answered through `window.hermesApprovalConfirm`), `confirmAlways` (bridge `confirmIdentity`, for a setting that asks on every change), `setApprovalLock`, `forgetApprovalConfirm`.
- `chatcache.ts` — last-seen items of recent chats (`rememberChat`, `cachedChat`, `forgetChat`, `saveChatToDisk`)
  (2.2.5).
- `boot.ts` — start-up timing marks (`bootMark`, `lastBoot`, `bootSummary`; `onBootMark` tells listeners about each new mark and `useBootSummary` is the live line for Settings) in `hm.boot.v1`; the shell logs its own
  stages to logcat tag `hmboot`.
- `lazy.ts` — `runLazy(id, global)`: big optional bundles (Mermaid as `hm-mermaid`, OpenUI as `hm-openui`, KaTeX and
  highlight.js as `hm-rich`) ship in `index.html` as inert `<script type="text/hm-lazy">` text (`vite.config.ts`
  `lazyBundle`) and are run once, on first use; a failed load can be retried.
- `mdsplit.ts` — `splitStream`: cuts a streaming reply's Markdown into parts at the start of top-level blocks, so only
  the last part is read again on each update (3.3, "A reply that arrives in pieces"). `REMARK` is the list of Markdown
  extensions the splitter and `Markdown` share; `MIN_PART` the shortest finished part.
- `rich.ts` — math and code colours on demand. `rich-entry.ts` (built as `hm-rich`, about 0.8 MB: `rehype-katex`,
  `rehype-highlight`, highlight.js's `github-dark` palette and KaTeX's CSS with its woff2 fonts inlined) sets
  `window.__hmRich`. `needsRich(text)` says whether a message has math or a code block (`$`, `\(`, `\[`, a fence, an
  indented block, `<pre>`); `loadRich` runs the bundle once, adds its CSS as `<style id="hm-rich-css">` after the
  page's own and tells the subscribers (`subscribeRich`, `richApi`, which `Markdown` reads with
  `useSyncExternalStore`). Before that, a formula shows as its TeX in inline code and code blocks have no colours;
  every message re-renders once it is loaded. The bundle hands out `rehype-highlight` through `highlightOnce`, which
  builds its 37 language definitions once per setting: the plugin itself builds them each time it joins a processor,
  and `react-markdown` makes a processor for every drawing of every message.
- `player.ts` — the read-aloud player's decisions as pure functions (phases, stale `tts-done`, pace, position, pause/resume place); `voice.ts` calls them and keeps the bridge, timers and store (see 3.11).
- `health.ts` — the header dot and status sheet data: `checkHealth` (ping `gateway.ping` with 8 s timeout, plus
  `GET /api/status` without `profile=`), `startHealthPolling` (2.5; returns false when it was already running, so `App` asks for only a ping on a reconnect and the full status is sent once at start-up), `dotState`: `wait` while connecting, `err`
  when not open, `warn` when the status call failed, the dashboard or storage component isn't ok/unknown, or disk
  or memory pressure is critical, else `ok`. Messaging-platform health is ignored on purpose.
- `conn.ts` — the gateway connection's decisions as pure functions (states idle, connecting, open, waiting to retry;
  the table is in its header); `gateway.ts` keeps the timers and side effects. `BEAT_MS` (15 s liveness beat),
  `DEADLINE_MS` (45 s of silence drops the socket), `BACKOFF_BASE_MS` (600 ms) and `BACKOFF_CAP_MS` (15 s) are the
  constants. `retryDelayMs` gives the wait before a retry (0 when Hermes was seen answering, else the doubling
  backoff), `retryBanner` the header text ("Reconnecting…" for tries 1 and 2, "Starting Hermux…" after),
  `retryHermesSteps` whether the try asks the shell to watch for Hermes (try 1) or start it (try 2 and every 6th), and
  `beatDecision` (type `BeatDecision`) what one beat does: `ping`, `fresh-window` (the page was frozen) or `dead`.
- `agentbuild.ts` — "is this chat's agent ready?" per live chat (states unknown, building, ready, switching; the table
  and the two past bugs are in its header). `createAgentBuilds` makes the bookkeeping (its timer can be injected for
  tests); `gateway.ts` holds one as `agents` and keeps the RPCs. `BUILD_CAP_MS` (20 s) is how long a pick waits for
  `session.info`, `READY_CAP` (200) how many announced runtimes are remembered. The `AgentBuilds` operations:
  `trackBuild` starts waiting for a runtime's agent after a create or resume (not when it is already ready, which is
  how a warm resume does not wait), `markBuilt` records that the agent was announced (the `session.info` event, or
  the cap; safe before `trackBuild`), `whenBuilt` is what `setModel` awaits before `config.set`, `whenSwitched` is
  what `sendPrompt` awaits so a model picked a moment ago applies (a failed switch does not block it), `runSwitch`
  runs one switch after any earlier switch of the same chat has settled (failed or not), so picks reach Hermes in order, and records it in flight until it settles, and `buildState` (type `BuildState`) names the state.

#### Gateway RPCs (all calls the page makes)

All go through `rpc` in `gateway.ts`, which adds `profile`. "Used by" = file and function.

| Method | Used by | What for |
|---|---|---|
| `command.dispatch` | `gateway.ts` `runSlash` | Fallback when `slash.exec` refuses a command (skills and other routed commands); its `type` says exec, alias, send, skill or prefill. |
| `commands.catalog` | `commands.ts` `fetchCatalog`; `components/Sheets.tsx` `CommandsSheet` | The slash-command and skill list for autocomplete (cached in `hm.cmds.v1`) and the commands sheet. |
| `config.set` | `gateway.ts` `yoloRpc`, `runSlash` (`/fast`), `setModel`, `setReasoning` | Per-chat settings: `yolo` `'1'`/`'0'`, `fast` (on/off/toggle/status), `model` as `<model> --provider <p> --session` (sent after the agent build finished), `reasoning`. |
| `file.attach` | `gateway.ts` `attachFile` | Copies a non-image file (data URL, ≤ 20 MB) into the chat's workspace; returns its `@file:` reference. |
| `gateway.ping` | `gateway.ts` liveness beat, `checkSocket`, `connectionAlive`; `health.ts` `checkHealth` | Is the socket alive; round-trip time for the status sheet. |
| `image.attach` | `gateway.ts` `carryAttachments`, `resendFrom` | Re-queues a photo Hermes already has (by path) on a new runtime or for an edited turn. |
| `image.attach_bytes` | `gateway.ts` `attachFile` | Queues a new photo (base64, ≤ 20 MB) for the next message. |
| `image.detach` | `gateway.ts` `detachAttachment`, `resendFrom` | Takes a queued photo back out of Hermes's queue. |
| `model.options` | `components/Sheets.tsx` `ModelSheet`; `components/SignIn.tsx` `afterSignIn` | Model list per provider; first the cached list, then `refresh: true` after `refreshLogins`. |
| `profiles.list` | `gateway.ts` `loadProfiles` | Bots for the side panel's bot sheet and bar; sent last after connect (slow). |
| `projects.create` | `components/Screens.tsx` `ProjectsScreen` | New project with one folder, made active. |
| `projects.delete` | `components/Screens.tsx` `ProjectsScreen` | Delete a project. |
| `projects.list` | `components/Screens.tsx` `ProjectsScreen` | List projects (the Library's Projects part). |
| `projects.project_sessions` | `components/Screens.tsx` `ProjectsScreen` | Chats of one project. |
| `projects.set_active` | `components/Screens.tsx` `ProjectsScreen` | Make a project active before starting a chat in it. |
| `prompt.btw` | `btw.ts` | A side question on a snapshot of the chat; the answer comes as `btw.complete` (180 s limit). |
| `prompt.submit` | `gateway.ts` `sendPrompt`, `runSlash`, `resendFrom` | Send a turn (`surface: 'mobile'`); for skills with `display_kind`/`title_preview`; for edit/retry with `truncate_before_row_id`, `confirm_truncate`, `confirm_empty_truncate`. |
| `session.branch` | `gateway.ts` `branchAt` | Fork the chat up to a turn (`count`); renamed "⎇ <title>" (numbered when taken). |
| `session.close` | `gateway.ts` `closeLater`, `closeActiveIfIdle`, `deleteSession`, `setModel` | Close a runtime: warm-chat eviction, profile switch, before delete, an empty chat replaced for a model pick. |
| `session.compress` | `gateway.ts` `compressChat` | Summarise older turns (300 s timeout); adds "Context compressed: a → b messages". |
| `session.context_breakdown` | `gateway.ts` `refreshCtx` | Context fill when the provider reports none. |
| `session.create` | `gateway.ts` `newSession` | New chat: `source: 'mobile'`, optional `cwd` + `cwd_explicit`, `model`, `provider`, `reasoning_effort`. |
| `session.delete` | `gateway.ts` `deleteSession` | Delete a stored chat (after closing its live runtimes). |
| `session.history` | `gateway.ts` `userRowId` | Stored rows, to find a user message's row id for edit/retry/stats. |
| `session.control` | `gateway.ts` `goalAction` | Goal sheet buttons: `goal.pause`, `goal.resume`, `goal.clear`; the goal is re-read afterwards. |
| `session.control.read` | `gateway.ts` `loadGoal` | After a chat is created or opened, from the `goal` chat-open step (not awaited, errors ignored): the chat's goal for the goal line. |
| `session.interrupt` | `gateway.ts` `interrupt` | Stop the running turn. |
| `session.list` | `gateway.ts` `loadSessions`, `loadArchived` | Drawer list (limit 80, +100 per Show more); archived = `include_hidden` list minus the normal list (limit 200 each). |
| `session.resume` | `gateway.ts` `resumeSession`, `syncRunning` | Open a stored chat (60 s timeout; `inflight` adds a live turn); check whether a turn is still running (20 s). |
| `session.set_hidden` | `gateway.ts` `setArchived` | Archive / unarchive (Hermes's hidden flag, as Desktop). |
| `session.steer` | `gateway.ts` `sendPrompt` | A message sent while a turn runs steers it. |
| `session.title` | `gateway.ts` `renameSession` | Rename the open chat (any chat: `PATCH /api/sessions/{id}` in `renameStored`). |
| `session.undo` | `gateway.ts` `undoLast` | Undo the last turn, then reload the chat. |
| `setup.runtime_check` | `components/Setup.tsx` `modelConnected` | Can Hermes serve a model (same resolver as a new chat). |
| `setup.status` | `components/Setup.tsx` `modelConnected` (fallback); `components/Connect.tsx` `WelcomeBody` | Is a provider configured. |
| `slash.exec` | `gateway.ts` `runSlash` | Run a slash command; output becomes a notice. |

Server → page requests handled: `approval`, `clarify`, `secret`, `sudo`, `otp`, `connection.request`
(`SERVER_REQUESTS`); answered with `answerRequest` (`req.respond`) or `rejectRequest` (error -32000 "cancelled by
user"). UI: 3.6.
