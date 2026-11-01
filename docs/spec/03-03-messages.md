### 3.3 Messages

The chat view draws `store.active.items`, an array of `ChatItem` (`web/src/store.ts`). `ItemView` (`web/src/components/ChatItems.tsx`) draws one item. The kinds:

| Item kind | Made from | Drawn as |
|---|---|---|
| `user` | A sent prompt, or a stored user row. | Right-aligned bubble (below). |
| `assistant` | Streamed `message.delta` / `reasoning.delta`, or a stored assistant row. | Reasoning block, Markdown reply, actions (below). |
| `tool` | `tool.generating`, `tool.start`, `tool.complete`, or a stored tool row. | Tool card (below). |
| `subagent` | `subagent.*` events. | Sub-agent card (below). |
| `notice` | Stored system rows; steer, slash, review, background and compress results; send failures; model errors. | Coloured box with Markdown text. |

There is no separate item kind for approvals, images, files or errors. Approvals are a sheet (3.6). Images and files are parts of user messages (and of Markdown in replies). Errors are `notice` items with level `error`, or a tool card in the error state. Cards written by Hermes in a reply are Markdown code fences (3.9).

#### User message

`UserMsg`. A bubble with the text (web addresses are links, `Linked.tsx`). Leading lines that start with `>` (with or without the space after it) are drawn as quote blocks (`.msg-quote`: left border, dim text) above the rest, one block per quote (`splitQuote` in `web/src/quote.ts`); this also shows stored chats correctly after a reload. Edit still edits the full text, quotes included.

- **Attachments.** Photos sent from this phone show as thumbnails (tap: the Lightbox). Photos of a resumed chat show through `Media` from their path; if only a name is known, a chip "🖼 name". Files show as chips "📎 name".
- **Time.** Tapping the bubble (not a link, button, code, table, image, or selected text) toggles the send time under it: "14:05" for today, otherwise weekday, day, month and time.
- **Actions** (row under the bubble, drawn for every user message in the open chat, never in the read-only preview): Copy (copies the text) and Edit.
- **Edit** turns the bubble into an edit box: the text in a textarea that grows with its content, the attached files and photos as chips with ✕ (aria-label "Remove <name>") so they can be dropped from the edit, and Cancel / Send. Send is disabled while a reply runs or the text is empty. It calls `resendFrom` (below).

#### Assistant reply

`AssistantMsg`.

- **Reasoning block** (`Reasoning`): hidden when there is no reasoning text. While the reply streams without text yet it reads "Thinking…" with a spinner and shows the last 160 characters as a peek; once finished it reads "Thought process" with a brain icon. Tap to expand the full reasoning (links work).
- **Text** (`Markdown`, see below), with a blinking caret while streaming. While streaming, Markdown skips language detection for unlabelled code blocks (it waits for the finished reply).
- **Warning line** "⚠ <warning>" when the turn ended with a warning.
- **Actions** (only when the reply is finished and is the last text segment of its turn; `hasActions` in `App.tsx`): Copy, Read aloud, Retry, Branch, and the turn stats.
  - **Copy** opens the picker "Copy reply": "Text only" (plain words, no formatting marks, via `plainText`) or "With formatting" (rendered HTML, with buttons, widgets and classes removed, copied through the `copyRich` bridge call so it pastes as headings, lists and tables into Docs, Gmail, Notes; if the message has no rendered HTML the raw Markdown text is copied).
  - **Read aloud** speaks the reply (`toggleSpeak`); while it is read the button reads "Stop reading". Voice behaviour is 3.11.
  - **Retry** (`retryTurn`): finds the user message the reply belongs to and calls `resendFrom` with its text. Disabled while a reply runs.
  - **Branch** (`branchAt`): calls `session.branch` with a message count so the new chat holds everything up to the end of this turn, renames it "⎇ <original title>" (a later branch of the same chat becomes "⎇ <title> 2", and so on, because Hermes wants unique titles), opens it, and toasts "Branched: <title>". Disabled while a reply runs.
  - **Stats** text such as `~41 tok/s · 1m 23s · ctx 2% · 8k/200k`: tokens per second (from the provider's `avg_tps`, else estimated from the stream, else from the turn's wall time) the turn's duration (`fmtDuration` in `text.ts`, shown when the turn took at least 1 s) and the context fill. Saved per turn in `hm.stats.v1` (2000 entries), so it returns when the chat is reopened.
- **Time.** Tapping the reply (not on a link or control) shows its time, like a user bubble (not while streaming).

Actions are not drawn on earlier segments of a turn (a reply split by tool calls), on streaming replies, or in a preview.

#### Retry, edit and undo: what they do on Hermes's side

`resendFrom(itemId, text, images, files)` in `web/src/gateway.ts`:

1. Refuses while a reply runs ("Wait for the current reply to finish").
2. Finds the user message's durable row id (`userRowId`: the item's `rowId`, else read from `session.history` by position from the end).
3. Replaces the view from that message onward with the new user message and starts "running".
4. Re-queues the message's photos with `image.attach` (Hermes queued them for the original turn only). Files travel as their `@file:` references in front of the text.
5. Calls `prompt.submit` with `truncate_before_row_id` and `confirm_truncate`. Editing the very first message also sets `confirm_empty_truncate`.
6. If Hermes says the row is "no longer in session history" and it was the last turn (a failed last turn is stored but never entered the live history), it sends the text as a normal prompt. Otherwise it fails with "That message isn't in this chat's history any more. Start a new chat to begin again".
7. On any failure it takes the photos back out of Hermes's queue (`image.detach`), reloads the chat from Hermes (`resumeSession`) and toasts "Send failed: <reason>".

**Undo last turn** (chat menu, 3.5) calls `session.undo`, reloads the chat and toasts "Last turn undone". It is disabled while a reply runs.

#### Tool card

`ToolCard`. One card per tool call, collapsed by default.

- **Header (tap to expand):** an icon for the tool (`TOOL_ICONS`: ⌘ terminal, ▶ execute_code, 📄 read_file, ✎ write_file and patch, 🔍 search_files, 🌐 web_search and web_extract, 🧭 browser_navigate, ✦ skills, 🧠 memory, ☑ todo, ⇶ delegate_task, ? clarify, 👁 vision_analyze, 🎨 image_generate, ✉ send_message, 📱 phone_app, 🔧 anything else), the tool name, a label, and a state mark.
- **Label:** the tool's own context line, else for `phone_app` a plain sentence ("Using Keep", "Tapping in Keep", `phoneAppLabel` in `text.ts`), else the first of `command`, `path`, `query`, `url`, `name`, `goal` from the arguments.
- **State mark:** spinner while `generating` or `running`; the duration (`850ms`, `3.2s`, `1m 5s`) or ✓ when done; ✕ on error.
- **Risk:** a tool flagged by Hermes (`tool.output_risk`) gets a red outline and, expanded, a "⚠ <reason>" note.
- **Opening and closing:** the body is wrapped in `Collapse` (`ui.tsx`), so it slides open and closed in 180 ms (see Motion in 3.20). After a tap that closes it, the body stays mounted until the animation ends.
- **Expanded body**, in order: Arguments (JSON; the noisy file body and replaced strings are left out when a diff is shown), Summary, Diff (Hermes's inline diff, or a diff built from the `memory` tool's arguments, or a diff found in the result), any image / video / audio path or URL found in the output (drawn with `Media`), Output (readable part of a JSON result, with `exit N` and error in the caption, a Copy button, cut at 20,000 characters).
- **Stored output.** A tool card restored from history has no result text. When opened, the card fetches it from the plugin (`GET /tool-result?id=<tool call id>`), shows "Loading output…", caches it, and says "No output recorded" if there is none. Cards with a locally made id are not fetched.
- **Folding.** `web/src/fold.ts` `toolRuns` finds runs of at least three tool cards with only tool cards and reasoning-only replies between them. A closed run is one line (`ToolRunHead`): up to four tool icons, "Ran 7 tools · 42s" (or "Running 4 tools…"), " · N failed" when some failed, the list of tool names, a spinner while one runs, and a chevron. Tap toggles the run (keyed by its first item's id). A run still working keeps its last card visible. Every item keeps its own element in the list, folded ones as empty placeholders, so message search can find them by position.

#### Sub-agent card

`SubagentView`: "⇶ Sub-agent" and its status (`running`, `done`…), the goal, the latest detail while it is not done, and the summary when finished. Created and updated by the `subagent.*` events.

#### Notice

A box (`notice-info`, `notice-warn`, `notice-error`) with Markdown text. Where notices come from:

- **Info:** system rows of a stored chat; "Steer: <text>" after steering a running turn; results of slash commands (output of `slash.exec`, `/fast` status, `/yolo` result); "Context compressed: 80 → 21 messages"; Hermes's background review summary (`review.summary`); a finished background or side task whose result is not shown elsewhere.
- **Warn:** the `/yolo` on message, a command result that carries a warning.
- **Error:** "Send failed: <reason>"; a turn that ended with an error or failure reason (`message.complete`); a failed slash command ("/name: <reason>"); "/yolo: <reason>", "/fast: <reason>".

#### Markdown inside replies

`web/src/components/Markdown.tsx` `Markdown` renders replies and notices with `react-markdown`: GitHub-flavoured Markdown, math (KaTeX; `$…$`, `$$…$$`, `\(…\)`, `\[…\]`), syntax highlighting, raw HTML, and Obsidian-style extras. Before parsing, `prepare` (`web/src/text.ts`) rewrites a few things outside code: `MEDIA:<path>` lines become images or file links, `[[Note|alias]]` becomes plain text, `==text==` becomes a highlight, a leading `---` YAML block shows as a yaml code block, math fences and `\colorbox` are repaired, and blank lines inside balanced HTML blocks are removed so the block stays whole. `chatLinks` turns a bare session id (`20261029_101500_ab12cd`) into a link that opens that chat.

Rendering rules:

- **Safety.** Raw HTML goes through `rehype-sanitize` with an allow-list. Scripts, event handlers and unknown tags never get through. Inline SVG is allowed with presentation attributes only (no script, `foreignObject`, `use`, image or style elements). Inline `style` is cut down to looks (colour, spacing, borders, type); anything that positions, overlays, hides, or loads a URL is removed. A card with a background and no text colour gets a readable text colour chosen from the background's brightness.
- **Code blocks** (`CodeBlock`): a bar with the language (or "code"), then buttons Wrap (toggle line wrapping), Canvas (for blocks of 3+ lines: creates a canvas document of the right type, `html`, `svg`, `markdown`, `json`, `csv` or `code`, and toasts "Opened in the canvas"), and Copy ("Copied" for 1.2 s). Blocks over 26 lines are collapsed with a button "Show all N lines" / "Show less". An `html` or `svg` block of 3+ lines also gets **Preview** (before Canvas; label **Code** while the preview shows; disabled while the reply is still streaming, read from `StreamingCtx` so blocks aren't rebuilt per stream batch). Preview replaces the code with the page in a sandboxed `HtmlFrame` (class `inline-frame`, always offline, see 3.7 "HTML runs in a sandbox"): it starts 160 px high and grows to the page's height, at most 60 % of the window height, then scrolls inside. `svg` shows as an `<img>` with a `data:image/svg+xml` source (no scripts). Below the frame a **Full screen** button (aria-label `Open preview full screen`) opens `HtmlViewer` (class `html-viewer`, `role="dialog"`, aria-label `HTML preview`, so swipe and pull gestures skip it; also `.inline-frame` is in their `SKIP` lists): the same offline page filling the screen, closed with ✕ (aria-label `Close preview`) or Android Back. "Show all" is hidden while previewing. A block tagged `diff` or `patch`, or an untagged block that looks like a unified diff, is drawn as a diff (below) without Wrap and Canvas.
- **Diagrams.** A `mermaid` block is drawn as SVG once Mermaid loads (about 250 ms after the text stops changing, theme follows light/dark, strict security level). Tap it (aria-label Open diagram full screen) to open the viewer: buttons Zoom out and Zoom in (steps of 1.35, range 50 % to 600 %), Fit, Copy (the source; toast "Diagram source copied"), and Close; pinch zooms, drag pans, Back closes. A diagram that cannot be drawn stays visible as code with the caption "mermaid (not rendered)".
- **Cards.** A block tagged `openui-lang` (or `openui`) is drawn by `OpenUIBlock` as an interactive card (3.9). If the card cannot be drawn, the source shows with the caption "openui-lang (not shown)". Card buttons can send messages only in chat replies (`interactive`), not in canvas, files or the By the way sheet.
- **Task lists.** `- [ ]` items get tap targets. The tick state is the user's: stored on the phone (`web/src/tasks.ts`, `hm.tasks.v1`, keyed by a hash of the message plus the box position, newest 300 messages kept) and it wins over the `[x]` the model wrote. Tapping the item's text ticks it too. The top-level list shows a bar and "N/M done".
- **Tables.** Tap a column heading to sort (numbers sort as numbers; tap again to reverse; a third tap restores the original order). Copy table copies a Markdown table.
- **Inline code and formulas.** Tap inline code to copy it (toast "Copied"); tap a formula to copy its LaTeX (toast "LaTeX copied"). Inline code that is only a web address opens it. Selecting text suppresses these taps.
- **Links.** Web links open with the phone's default handler (`openExternal` bridge call). `hermes-chat:<id>` links (and bare session ids) open that chat with a chat icon. `#footnote` links scroll inside the message. Links to local paths (`/`, `~/`, `file:`) become a file chip or inline media.
- **Images.** Markdown images are drawn with `Media`.
- **Callouts.** `> [!note] Title` blockquotes become titled boxes; `-` or `+` after the type makes them collapsible (`+` starts open).

#### Media

`web/src/components/Media.tsx`. `Media` draws what a path or URL points to, by extension (`mediaKind` in `text.ts`: image, video, audio, or file).

- **Where the bytes come from.** `http(s)`, `data:` and `blob:` URLs are used as they are. A path on the phone is streamed in the phone app from the plugin's `GET /media` through the shell, with byte ranges so video can seek (`mediaBase` bridge call). Outside the app (desktop test browser) it is read through `GET /api/files/read` as a `data:` URL, up to 25 MB ("too large to show inline" beyond that). `~/` paths map to `/root/`.
- **Image:** lazy-loaded; tap opens the Lightbox. The Lightbox is full screen: pinch to zoom (1× to 6×), drag to pan when zoomed, double-tap to jump between 1× and 2.5×, buttons Save (to Pictures/Hermes; toast "Saved to Pictures/Hermes" or "Couldn't save the image"), Share, Open with…, and Close (✕). Tapping the dark area closes it at 1×. Back closes it. Outside the phone app, Save downloads the file and Share says "Sharing works in the phone app".
- **Video:** the browser's own controls.
- **Audio:** the app's own player: play/pause, a seek slider (aria-label Seek), elapsed and total time, and a speed button (aria-label Playback speed) that cycles 1×, 1.5×, 2×.
- **File chip:** `📎 name`; tap opens the file with the phone's default app (`openFile`; outside the app a toast says "Open works in the phone app").
- **Failures:** a file that cannot load becomes a chip with the reason in brackets. While loading it reads "Loading image…" (or video / audio).

#### Diff view

`web/src/components/Diff.tsx` `DiffView` draws a unified diff in a monospace block: green added lines, red removed lines, blue `@@` hunk headers, bold file-header lines (`diff --git`, `index`, `---`, `+++`, `a/… → b/…`), yellow lines starting with `!`, and dim meta lines (`┊…`, `\ No newline`). ANSI colour codes from Hermes's terminal diffs are stripped, the "┊ review diff" marker line is dropped, and output over 20,000 characters ends with "… (truncated)". `looksLikeDiff` decides whether plain text is a diff (a hunk or git header plus changed lines). The same view is used in tool cards, Markdown code blocks and the File checkpoints sheet.

#### Changed files card

`TurnChangesCard` (`web/src/components/Changes.tsx`, logic in `web/src/changes.ts`). When a turn (a user message and everything up to the next one) wrote files, a card follows its last item: "✎ 3 files changed" with the total `+A −B` (`.diffstat-add` green, `.diffstat-del` red) and a chevron. Only `write_file` and `patch` tools (`EDIT_TOOLS`) that ended `done` count; failed ones, other tools and tools without `args.path` are ignored. The last turn gets no card while the reply is still running.

- **Tap the card head:** opens or closes the list: one `.turn-changes-row` per file (`shortPath`: `~/projects/site/a.txt`, long paths become `~/…/dir/name.ext`) with its own `+N −M`, then a **Checkpoints** button that opens the File checkpoints sheet (`sheet: 'rollback'`). A file edited several times is one row with the counts added up and the diffs joined in order (`diffCounts` counts `+`/`-` lines and skips `+++`/`---` headers; each file keeps at most `MAX_DIFF` = 200,000 characters of diff, then "… (truncated)").
- **Tap a file row:** a sheet titled with the full path showing `DiffView` of its diffs, or "No diff recorded for this edit". Back closes it.
- **Without a recorded diff** (older stored chats): `write_file` counts the lines of `args.content` as added and the row says "new or rewritten"; `patch` counts `old_string` lines as removed and `new_string` lines as added.
- **In the list:** the card shares one child element of `.chat` (`div.turn-end`, or the `tool-run-wrap` of a folded run) with the item it follows, so search, jump and the scrubber still find items by child index; it stays visible when the run is folded. Not part of exports or read-aloud.

#### Streaming

Events from Hermes (`client.onEvent` in `gateway.ts`) reach the chat for the open chat only:

- `message.start`: the turn starts; `running` is set and `turnStart` is set if the send didn't already (Hermes may send several per turn).
- `session.control.update`: the chat's goal changed (`control.goal`); the goal line follows it.
- `thinking.delta` / `status.update`: the status-bar text.
- `reasoning.delta`, `message.delta`: appended to the open assistant item in batches (every 60 ms, every 150 ms once the reply is over 6000 characters), not per token, because every change reparses Markdown. Any other event flushes the batch first, so order never changes.
- `tool.generating`, `tool.start`, `tool.complete`: the tool card appears when the call starts being written, becomes `running` at `tool.start`, `done` at `tool.complete`. A tool that streams under a generic name takes its real name at start. A replayed start for a card that already exists adds no second card. Starting a tool closes the open assistant segment, so text after tools is a new segment.
- `todo.updated`, `session.usage` (also refreshes `ctx` without an RPC when the usage has `context_max` and `context_used`), `session.info`, `session.title`.
- `message.complete`: tool cards still "generating" are dropped; errors become a notice; the final text fills a reply whose stream missed some (`fullReply`); the turn stats are computed (`finishTurnStats`, given the turn's seconds read before `turnStart` is cleared); `running` ends. Live mode and automatic read-aloud (Settings or chat menu, when the app is on screen) speak the reply here.
- `review.summary`, `btw.complete`, `background.complete`: notices.
- A silent connection is checked: every 15 s `gateway.ping`; after 45 s without any event during a turn the page asks `session.resume` whether the turn is still running and loads the stored transcript if it finished meanwhile.

#### Loading a stored chat

`hydrate` (`store.ts`) turns Hermes's stored rows into items: user rows (with `@file:` and `@image:` references split off into attachment chips, and Hermes's "--- Attached Context ---" block dropped), assistant rows (text and reasoning), tool rows (with the stored inline diff), and system rows as info notices. Hidden rows are skipped, and a row id or tool call id seen twice is skipped (a resume of a chat that is still answering repeats its tail).

---
