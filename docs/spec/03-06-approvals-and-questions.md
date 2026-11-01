### 3.6 Approvals and questions

When Hermes needs the user, it sends a request to the page. `gateway.ts` accepts the methods in `SERVER_REQUESTS` (`approval`, `clarify`, `secret`, `sudo`, `otp`, and `connection.request`) and puts them in `store.requests`. `App` draws the first one as a `RequestSheet`; the next appears when it is answered. Requests are not dismissed by tapping outside (the backdrop has no handler) and the sheet registers no Back handler, so an accidental tap does not leave the agent waiting. Android Back is not routed to it (it would act on the layers behind it). The one exception is a batch of questions on its second question or later: `Clarify` registers a Back handler then (`useBackHandler`), and Back steps to the previous question.

#### Request sheet
**Opens from:** a request from Hermes for the open session or any session this page is attached to. **Closes with:** answering, skipping or cancelling; or Hermes cancelling the request (`request.cancel`, for example when it was answered from a notification or timed out). **Source:** `web/src/components/RequestSheet.tsx` `RequestSheet`.

**Approval layout (method `approval`):**

| Element | Looks like | Tap | Long-press / swipe | States (empty, loading, error, disabled) |
|---|---|---|---|---|
| Title | "⚠ Approve <tool name>?" (the tool name or "command"). | | | |
| Description | Text explaining why approval is needed (links are tappable). Duplicate warnings are merged: Hermes joins warnings with "; " and its security scan may repeat one finding, so `tidyApprovalText` shows each once, with "(×N)". | | The text scrolls; the buttons stay on screen. | Hidden if none. |
| Command | The command in a monospace block. | | Scrolls. | Hidden if none. |
| Buttons | One per choice: Allow once (primary), Allow this session, Always allow, Deny (red). | Answers with that choice (`{ choice }`) and closes the sheet. Over the lock screen (`lockView()`), every button but Deny toasts "Unlock the phone to allow this" and asks for the unlock screen instead (`answerRequest` returns false; the sheet stays). | none | The choices are the ones Hermes sends. If it sends none: Allow once, Allow this session (unless `allow_session` is false), Always allow (only if `allow_permanent` is set), Deny. |

**Question layout (method `clarify`):** title "❓ Hermes asks". One block per question: the question text, then either choices (radio-style `○`/`●` for single choice, checkbox-style `☐`/`☑` for multi-select) and a text field "Or type your own answer…", or just a field "Your answer…". Buttons Skip (answers with an empty string) and Answer (disabled until every question has an answer; multi-select answers are joined by new lines). A batch of questions is answered as `{ answers: { <qid>: <text> } }`, a single plain question as `{ answer }`.

**Several questions (a `clarify` request whose `questions` list has more than one):** the sheet shows one question at a time. Under the title is a header `Question {i} of {n}` and a row of `n` small dots (`.clarify-dot`; filled `.done` when that question has an answer, ringed `.on` for the current one). Each dot is a button with aria-label `Go to question {k}` (for example `Go to question 2`) that jumps to that question. Only the current question is drawn. Picking a choice in a single-choice question (not multi-select) records it and, after `ADVANCE_MS` (300 ms, in `clarify.ts`), moves to the next unanswered question after it, or to the next one if all are answered (`nextStep` in `clarify.ts`, a pure function); a tap on another choice during the pause restarts the timer, typing in the text field never advances, and the last question never advances. Each choice tap and each move calls `haptic()`. Buttons: Skip (on every step, answers with an empty string), Back (not on the first question) and Next (all but the last; always enabled, so a question can be skipped and come back to), and on the last question Answer (enabled when every question has an answer; sends `{ answers }` as above). Android Back goes to the previous question when not on the first; on the first it does what it did before (not routed to the sheet). One question looks and works as described above, with no header, dots or Back/Next.

**Password, secret and code layout (methods `sudo`, `secret`, `otp`, and also `connection.request`, which uses the same sheet):** title "🔐 Password needed" (`sudo`), "🔑 <variable name>" (`secret`), or "🔢 Code needed" (others). The prompt text, then a field (hidden characters; `otp` shows plain digits with a numeric keyboard). Buttons Cancel (rejects the request with "cancelled by user") and Send (disabled while empty; answers `{ value }`).

**Data:** `answerRequest` / `rejectRequest` in `gateway.ts` answer through the request's own `respond` / `fail`, remove it from `store.requests` and cancel its notification (`cancelNotification` bridge call, id `req-<id>`). Event `request.cancel` removes it too.
**Rules:** "Always allow" is offered only when Hermes allows it; the Always entries live in Hermes's allowlist, not in the app.

#### Approvals while the app is closed or in the background

The page is not the only place an approval shows up. The plugin's `pre_approval_request` hook also sends an `approval` event to the Android service (and sets the chip's status to "Waiting for your approval"); the service shows Allow once, Allow session and Deny on the chip and, when the app is not on screen, on a Needs you popup. A button press reaches the plugin's `POST /approve`, which answers that exact request (no request id, no answer), and the page's sheet closes through `request.cancel`. The full sequence is flow 2.2.2; the notification side is in 4.3. Password, secret and code requests are not sent by the plugin: the page posts its own "Hermes needs your input" notification when one arrives while the app is in the background.

Live mode also hears approvals (`liveBridge.onApproval`) so it can ask by voice.

#### Questions answered from a notification

`web/src/notif-answer.ts` `answerFromNotification`, reached through `window.hermesAnswer(kind, session, text)`. The service hands over a text typed into a notification's reply field.

- **kind `ask`:** finds the pending `clarify` request: the one for that chat; failing that, if exactly one clarify is pending, that one (the plugin may know the chat by another id). Only a single question (plain, or a one-item batch) can be answered this way; a real batch needs the app. The text is the answer. Returns `'y'`.
- **kind `reply`:** sends the text to that chat as a new message. If the socket is dead (timers freeze while the app sleeps), the message goes through the outbox and a reconnect (`queueAndReconnect`); otherwise it resumes the chat when another is open and calls `sendPrompt`. Errors toast.
- It returns `'n'` when the text is blank, Hermes is not connected, or there is no matching request. The service then opens the app with the text prefilled in the composer (`hermesOpenSession(id, draft)`).

#### Auto mode and approvals

With the header Auto button on Auto access or Full access (3.2), Hermes does not ask for most commands, so the sheet appears rarely: Auto access still stops on Hermes's dangerous list (the plugin blocks them, so no approval is possible); Full access stops on nothing but the catastrophic list. With Auto off, every command Hermes flags raises the sheet.

---

#### Source map for sections 3.1 to 3.6

The files behind sections 3.1 to 3.6, and what each one is for (the core files are in 2.6):

| File | Purpose |
|---|---|
| `remotedebug.ts` | Settings → About → Remote debugging, as pure functions plus a hook: `parseRemoteDebug` (the shell's JSON → `{available, on, minutesLeft}`, anything odd = not available), `remoteDebugRow` (null when unavailable; "Off" opens, "On · N min left" turns off), `remoteDebugStrip`, and `useRemoteDebug` (reads on mount, visibility, focus and the `hm-devtools` event; a one-minute timer only while on and visible). Unit tests: `remotedebug.test.ts`. |
| `App.tsx` `DevtoolsStrip` | Also shows `Remote debugging is on · N min left` while the setting is on. Test builds: when `isDevtoolsBuild(appVersion())` (`bridge.ts`: the version ends with `+devtools`) it draws `.devtools-strip`, a fixed 18 px strip at the top reading `Test build: remote debugging is on` (warning colours from CSS variables, `z-index` 100 so it shows over full screens too, not tappable, can't be dismissed), plus `.devtools-spacer` so the header is not covered. Normal builds draw nothing. |
| `main.tsx` | Page entry. Imports `secure-bridge` first (it takes the native bridge key), then `share.ts` and `notif-answer.ts` (they register the `window.hermes*` globals), applies the saved theme, calls `openFirstRun`, and renders `App`. |
| `App.tsx` | Root: `Header`, banners, `Chat`, `FindBar`, the layer stack, `window.hermesBack`, `hermesResume`, `hermesPause`, `hermesOpenSession`. |
| `Title.tsx` | Chat titles; a branched chat is stored as "⎇ <title>" (Hermes keeps only plain text) and drawn with a branch icon (`BranchIcon`); `plainTitle` and `keepBranch` keep the mark when renaming. |
| `AutoAccess.tsx` | `AutoButton` (header) and `DefaultAccessRow` (Settings). |
| `ChatItems.tsx` | `ItemView`, `ToolCard`, `ToolRunHead`, user and assistant messages, sub-agent card, message actions. |
| `Markdown.tsx` | Markdown renderer, code blocks, Mermaid, task lists, tables, link handling, sanitiser. |
| `Media.tsx` | `Media`, `Lightbox`, `FileChip`, audio player. |
| `Diff.tsx` | `DiffView`, `looksLikeDiff`, `stripAnsi`. |
| `filekind.ts` | What the Files screen shows for a file: `previewKind` (document type and code language, image, player, or none). |
| `chatopen.ts` | The extra work each feature does when a chat opens. `onChatOpen(name, run)` adds a step (the same name again replaces it; returns a remover), `runChatOpen({chat, kind})` runs them all in order after `newSession` (`kind: 'new'`) or `resumeSession` (`'resume'`) has put the chat on screen (a step that throws is logged and skipped), `chatOpenSteps` lists their names. Each step sits next to its feature's code in `gateway.ts`: `access` (default or remembered access mode), `context-fill` (resume only: the context fill under the last reply) and `goal` (`loadGoal`). A new feature adds its own step instead of editing the middle of `newSession`/`resumeSession`, so parallel branches don't change the same lines. |
| `changes.ts` | Files a turn changed: `turnChanges`, `diffCounts`, `shortPath`, `EDIT_TOOLS`, `MAX_DIFF`. |
| `Changes.tsx` | `TurnChangesCard`: the changed files card at the end of a turn (3.3). |
| `Composer.tsx` | The composer. |
| `QuoteBar.tsx` | `QuoteBar`: the Quote / Explain bar over the composer while a reply's text is selected. |
| `quote.ts` | Quote helpers and state: `withQuotes`, `splitQuote`, `useQuotes`, `addQuote`, `removeQuote`, `clearQuotes`, `setQuotes`, `QUOTE_MAX`, `QUOTES_MAX`. |
| `Sheets.tsx` | Model, Commands, Chat menu, Draft menu, Chat details, Backend status, File checkpoints sheets. |
| `RequestSheet.tsx` | Approval, question and password sheets. |
| `Spinner.tsx` | `Spinner`. Every spinner turns on one shared 8 Hz timer instead of a CSS animation, which would redraw the WebView every frame while Hermes works. The timer runs only while a spinner is mounted. |
| `text.ts` | Pure text helpers: `mediaKind`, `prepare`, `formatOutput`, `memoryDiff`, `plainText`, `parseCsv`, `chatLinks`, `tidyApprovalText`, `linkParts`, `phoneAppLabel`, `formatDuration`, `backgroundLuminance`. |
| `fold.ts` | Folding of tool-call runs. |
| `jump.ts` | Message search jump, in-chat search, word highlighting. |
| `drafts.ts` | Unsent text per chat. |
| `stash.ts` | Drafts put aside from the composer: `stashes`, `pushStash`, `takeStash`, `clearStashes`, `STASH_MAX`. |
| `queue.ts` | Follow-ups queued while Hermes works: `queuedFor`, `enqueue`, `editQueued`, `removeQueued`, `takeFirst`, `restoreFirst`, `clearQueue`, `isPaused`, `setPaused`, `useQueue`, `QUEUE_MAX`; the pause is kept in memory only. |
| `Queued.tsx` | `QueuedRows`: the dashed queued bubbles, Queue paused and Resume. |
| `ctxring.ts` | Context ring logic: `ringDash` (stroke dash for a percent, clamped 0..100), `ctxLevel` (`ok`, `warn` from 80, `full` from 90), `fmtCost`. |
| `scrub.ts` | Chat scrubber logic: `userMarks` (one `Mark` per user message), `nearestMark`, `readLine` and `railPosition` (where the screen is between your messages, for the thumb), `SCRUB_MIN`. |
| `Scrubber.tsx` | `Scrubber`: the rail, ticks, thumb and picked-message bubble (3.2); `paintRail` moves the thumb. |
| `recent.ts` | Recent prompts. |
| `commands.ts` | Slash-command and skill catalog for autocomplete. |
| `favs.ts` | Starred models. |
| `sidepanel.ts` | Wide screens: hide or dock the chat list column (`hm.sideHidden.v1`, `html[data-side]`). |
| `splitview.ts` | Wide screens: the canvas column's width, the divider drag with its snaps, the pull from the right edge, and the shell's edge claim (`DOCK`, `hm.canvasSplit.v1`, `html[data-split]`, `html.resizing`; 3.7). |
| `custommodels.ts` | Model ids typed into a model picker (Hermes Desktop's "Custom model"): candidate check, remembered ids per provider. |
| `activity.ts` | Polling of `GET /activity` for the activity banner. |
| `tasks.ts` | Tick state of Markdown task lists. |
| `unread.ts` | Unread chats and "time ago". |
| `visit.ts` | Last time each chat was on screen (`lastVisit`, `markVisit`) and the first message newer than that (`firstUnseen`), for the "New since your last visit" divider; leaving and coming back with the same chat open (`noteAway`, `noteBack`, `isAway`, `lastBack`, `onBack`, `newWhileAway`, `BACK_GRACE_MS`). |
| `checkpoints.ts` | Client for the plugin's checkpoint routes and the labels the File checkpoints sheet shows. |
| `export.ts` | A chat as Markdown for Share chat. |
| `share.ts` | Share-to-Hermes and launcher shortcuts. |
| `notif-answer.ts` | Answers typed into notifications. |
| `backstack.ts` | The Back-button layer stack. |
| `swipe.ts` | Swipe right for the drawer, swipe left for the canvas. |
