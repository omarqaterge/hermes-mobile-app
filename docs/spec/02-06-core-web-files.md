### 2.6 Core web files

These files carry the plumbing every screen uses. Screens are in 3.

- `main.tsx` — entry point; imports `secure-bridge.ts` first, then applies the theme, opens the first-run flow on a
  fresh install and renders `App` (3.1).
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
  `profile=` unless `profile: false` or the path has one, parses JSON, throws `ApiError` ("Hermes unreachable: …"
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
- `chatcache.ts` — last-seen items of recent chats (`rememberChat`, `cachedChat`, `forgetChat`, `saveChatToDisk`)
  (2.2.5).
- `boot.ts` — start-up timing marks (`bootMark`, `lastBoot`, `bootSummary`) in `hm.boot.v1`; the shell logs its own
  stages to logcat tag `hmboot`.
- `lazy.ts` — `runLazy(id, global)`: big optional bundles (Mermaid as `hm-mermaid`, OpenUI as `hm-openui`, KaTeX and
  highlight.js as `hm-rich`) ship in `index.html` as inert `<script type="text/hm-lazy">` text (`vite.config.ts`
  `lazyBundle`) and are run once, on first use; a failed load can be retried.
- `rich.ts` — math and code colours on demand. `rich-entry.ts` (built as `hm-rich`, about 0.8 MB: `rehype-katex`,
  `rehype-highlight`, highlight.js's `github-dark` palette and KaTeX's CSS with its woff2 fonts inlined) sets
  `window.__hmRich`. `needsRich(text)` says whether a message has math or a code block (`$`, `\(`, `\[`, a fence, an
  indented block, `<pre>`); `loadRich` runs the bundle once, adds its CSS as `<style id="hm-rich-css">` after the
  page's own and tells the subscribers (`subscribeRich`, `richApi`, which `Markdown` reads with
  `useSyncExternalStore`). Before that, a formula shows as its TeX in inline code and code blocks have no colours;
  every message re-renders once it is loaded.
- `health.ts` — the header dot and status sheet data: `checkHealth` (ping `gateway.ping` with 8 s timeout, plus
  `GET /api/status` without `profile=`), `startHealthPolling` (2.5), `dotState`: `wait` while connecting, `err`
  when not open, `warn` when the status call failed, the dashboard or storage component isn't ok/unknown, or disk
  or memory pressure is critical, else `ok`. Messaging-platform health is ignored on purpose.

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
| `profiles.list` | `gateway.ts` `loadProfiles` | Profiles for the drawer's switcher; sent last after connect (slow). |
| `projects.create` | `components/Screens.tsx` `ProjectsScreen` | New project with one folder, made active. |
| `projects.delete` | `components/Screens.tsx` `ProjectsScreen` | Delete a project. |
| `projects.list` | `components/Screens.tsx` `ProjectsScreen`, hub summary | List projects (and the count on the hub). |
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
