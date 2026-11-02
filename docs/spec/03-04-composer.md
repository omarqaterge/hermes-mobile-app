### 3.4 Composer

The composer sits at the bottom of the chat (`web/src/components/Composer.tsx` `Composer`).

**Opens from:** always present on the chat screen. **Closes with:** n/a. **Source:** `web/src/components/Composer.tsx` `Composer`; helpers `drafts.ts`, `recent.ts`, `commands.ts`, `share.ts`, `notif-answer.ts`.

**Layout, top to bottom:**

| Element | Looks like | Tap | Long-press / swipe | States (empty, loading, error, disabled) |
|---|---|---|---|---|
| Queued chip | "⏳ Sends when Hermes is back: <text, cut at 80 characters>" with "(📎 N attached)" when files wait. Button ✕ (aria-label Don't send). | Don't send takes the message back: it is put in front of whatever is in the composer and the outbox is cleared. | none | Only while a message waits in the outbox (see "Offline outbox"). |
| Slash menu | Floating list above the composer: `/name`, a "skill" tag for skills, a one-line description. | Tap an item to insert `/name ` at the typed token (the text after the caret is kept). | Does not steal focus from the text box (`onMouseDown` is cancelled). | Shows "Loading commands…" until the catalog first arrives. Hidden when nothing matches. |
| Attachment row | Photo thumbnails (with ✕), chips for files "📎 name" (with ✕), a chip "Attaching…" with a spinner while uploads run, and a small clear button when more than one item is queued. | ✕ (aria-label "Remove <name>") takes one item back out. clear removes all. | none | Hidden when nothing is attached or uploading. |
| Live bar | Replaces the model row and hides the text box during Live mode: a coloured dot, "Live · Listening…" / "Hermes is thinking…" / "Hermes is speaking…" / "Mic muted", the words heard so far, or the hint "Pause for N s to send" ("Talk or tap Interrupt to cut in" while Hermes speaks, or "Tap Interrupt to talk" without barge-in); an Interrupt button while Hermes speaks, a mute button (aria-label Mute microphone / Unmute microphone) and End. | Interrupt stops the reading and listens at once (talking over Hermes does the same, 3.11). Mute toggles the microphone (replies are still read aloud). End stops Live mode. | none | Only while Live mode runs. Live mode itself is 3.11. |
| Model row | A chip with a sparkle icon, the model's short name (text after the last `/`, or "Choose a model"), and the reasoning level as text (`.model-chip-effort`; `EFFORT_SHORT` shortens medium to "med", minimal to "min" and none to "off"; any other level, such as low, high, xhigh or max, shows as its name). aria-label "Model: <name>, reasoning <level>. Change model" (without the level part when none is known). Beside it the "⚡ Full access" chip when a chat is in Full access. At the right end the context ring (`ContextRing`, `.ctx-ring`, 28 px tap target around an 18 px SVG circle `r = 7`): a track in `var(--dim)` and a fill in `var(--accent)` that is amber (`warn`) from 80 % and red (`full`) from 90 % (`ctxLevel`, `ringDash` in `ctxring.ts`). aria-label "Context 12% used. Show details". Shown whenever the chat's `ctx` is known (after the chat is opened or its first turn ends); a new chat has none. | Opens the Model sheet (3.5). The Full access chip turns Full access off. The ring opens the Context window sheet (`sheet: 'context'`). | none | Chip disabled while offline or a chat is opening. Hidden in Live mode and while the slash menu is open. |
| Add button (aria-label Add) | `+` at the left of the text box. | Opens the picker "Add": a row with the current model (taps open the Model sheet), then Camera ("Take a picture now"), Photo ("From your gallery"), File ("PDF, document, spreadsheet, text, code… (up to 20 MB)"), then "Stash draft" (only when the box has text) and "Stashed drafts (N)" (only when N > 0): see Stash below. | none | Disabled while offline or opening. |
| Commands button (aria-label Commands) | `/` | Puts a `/` at the caret (with a space before it when the previous character is not whitespace) and focuses the box, which opens the slash menu. If a slash token is already open it only focuses. | none | Disabled while offline or opening. |
| Text box | Multi-line field, grows with its content up to 180 px. Placeholder: "Message Hermes", "Steer the running task…" while a reply runs, "Opening your chat…" while a chat opens, or "Offline: type now, it sends when Hermes is back". | Typing. Enter inserts a new line. Ctrl+Enter or Cmd+Enter sends (hardware keyboard). | none | Never disabled: the user can always type. |
| Live conversation button (aria-label Live conversation) | Waveform icon. Tooltip: "Live: talk, pause N s to send, Hermes answers out loud". | Starts Live mode (3.11). | none | Shown when the text box is empty, no reply runs, dictation is off, and the phone app's voice input exists. Disabled while busy or offline. |
| Dictate button (aria-label Dictate) | Microphone icon. | Starts dictation (below). | none | Same conditions as the Live button. Disabled while busy or offline. |
| Stop dictation (aria-label Stop dictation) | Microphone with a stop square. | Stops listening. | none | Shown while listening. |
| Stop button (aria-label Stop) | Stop square. | Interrupts the running turn (`session.interrupt`). | none | Shown while a reply runs and the text box is empty. |
| Send button (aria-label Send) | Paper-plane icon. The label is "Steer" while a reply runs and "Send when back online" while offline. | Sends. | none | Disabled when the text is blank, a send is in flight, or a chat is opening. |

**Data:** `queue.ts` (`hm.queue.v1`), `drafts.ts` (`hm.drafts.v1`, legacy `hm.draft`), `stash.ts` (`hm.stash.v1`), `recent.ts` (`hm.recent.v1.<profile>`), `commands.ts` (`hm.cmds.v1.<profile>`), outbox (`hm.outbox.v1`); RPCs `prompt.submit`, `session.steer`, `session.interrupt`, `slash.exec`, `command.dispatch`, `commands.catalog`, `image.attach_bytes`, `image.attach`, `image.detach`, `file.attach`, `config.set`; dashboard `GET /api/skills`.
**Rules:** attaching and the camera use a plain `<input type="file">` (the Android shell supplies the picker and camera), so there is no custom file browser.

#### What the button on the right does

One slot, six faces, decided in this order:

1. Text box empty, no reply running, not listening, and the phone app has voice input: the Live conversation button and the Dictate button (side by side).
2. Listening: Stop dictation.
3. A reply is running and the box is empty: Stop.
4. A reply is running and the box (or the quotes) has content: two buttons. A small pill `Steer` (aria-label `Steer`) sends it into the running turn now, like Send used to while running. The round arrow with a clock badge (aria-label `Queue`) puts it in the queue (below). Queue is disabled, with the label `Queue (remove attachments first)`, while photos or files are attached (Hermes would attach them to whatever is sent next); with the label `Queue (full)` when the chat already has 10 queued messages; and while the text starts with `/` (slash commands are never queued; Steer runs them as before). Ctrl/Cmd+Enter in the box queues while a reply runs.
5. Otherwise: Send (label Send when back online while Hermes is not connected).

#### Sending

`send()`:

1. Ignores blank text unless there is at least one quote chip. The text sent is `withQuotes(quotes, text)` (`web/src/quote.ts`): each quote as a Markdown blockquote (`> ` before every line), a blank line between quotes, a blank line, then the typed text. A text starting with `/` is sent as it is and keeps the quotes.
2. If Hermes is not connected: queues that text in the outbox and clears the box and the quotes (below).
3. Otherwise clears the box and the quotes, calls `sendPrompt`, and on failure puts the text and the quotes back and shows an error toast.

`sendPrompt` (`gateway.ts`) in order:

1. Refuses while a chat is opening ("Still opening your chat — wait a moment").
2. Remembers the prompt for the empty-screen suggestions (`rememberPrompt`: 4 to 200 characters after collapsing whitespace, newest first, 20 kept per profile, no case-insensitive duplicates).
3. Gets the target chat; if there is none (or a model pick is still creating one) it waits for it or creates a new chat.
4. `/btw <question>` opens the By the way sheet (3.12) and sends nothing.
5. Any other text starting with `/` goes to `runSlash` (below).
6. If a reply is running: `session.steer` with the text, and a notice "Steer: <text>" is added. The running turn takes the new instruction; no new turn starts.
7. Otherwise a user item is added (with the queued photo thumbnails and file names), `running` is set, any pending model switch is awaited, and `prompt.submit` is called with `surface: 'mobile'`. File attachments go as their `@file:` references in front of the text; photos were already queued inside Hermes. If it fails, a "Send failed: <reason>" notice is added and the attachments reappear in the composer.

**Queue** (`send(undefined, 'queue')` in `Composer.tsx`, state in `web/src/queue.ts`): the text sent is built exactly as for Send (`withQuotes(quotes, text)`, so quotes travel with it); it is added to the open chat's queue (`enqueue`, `hm.queue.v1`), and the box and the quotes are cleared. Queued messages are shown at the end of the chat (3.2) and sent one by one when the chat's turn ends (2.2.1 step 8a). The queue lives in the page, not in Hermes: a queued message is sent only while the app shows that chat (closing the app, or opening another chat, keeps it and pauses it until Resume). It is a different thing from the offline outbox. The placeholder while a reply runs is "Queue or steer a follow-up…".

`runSlash`: shows the command as a user item, then:

- `/yolo [on|off]` toggles Full access (3.2).
- `/fast [on|off|status]` sets Hermes's fast mode for this chat with `config.set` key `fast` (value `toggle` when no argument), and a notice reports "Fast mode on for this chat" or "off". It is run this way because Hermes's slash worker process is slow to start on a phone.
- Everything else: `slash.exec`; if that fails (skills and routed commands), `command.dispatch`. The answer's type decides: `alias` runs the target command (up to 3 levels), `prefill` puts the message in the composer, `send` or `skill` submits the message as a prompt (`display_kind: 'skill'` for skills), anything else shows the output as a notice.

#### Slash autocomplete and skills

- **Trigger.** The menu opens while the text before the caret ends in `/<letters>` at the start of the text or after whitespace (a `/` in the middle of a word does not count). It follows the caret, so it works anywhere in a message.
- **Catalog.** `web/src/commands.ts`: names come from `commands.catalog`; skill descriptions from `GET /api/skills`, merged in when that slower call lands (a skill without one shows "Skill"). Held in memory and in `hm.cmds.v1.<profile>`, so it is instant. It is refreshed in the background when the app connects or the profile changes, and when a slash token opens, but not more often than every 10 minutes.
- **Which entries show.** All skills. A command only if the app can use it: not the ones the app already has buttons or screens for (`new`, `model`, `reasoning`, `stop`, `profile`, `title`, `memory`, `image`, `voice`, `pet`…), not those Hermes Desktop classes as terminal-only, messaging-only or hidden (`web/vendor/desktop-slash-registry.json`), and not those the catalog flags as desktop-only.
- **Order.** Prefix match on the typed name, case-insensitive. Commands before skills; shorter names first; at most 40 shown.
- **Picking.** Inserts `/name ` at the typed token and moves the caret after it. Nothing is sent.
- **Injected text.** Tapping a suggestion on the empty screen or "Use" on a skill or file (3.14) fills the composer through the `injected` prop: the text, a trailing space, caret at the end, box focused.

#### Drafts

`web/src/drafts.ts`. Each chat keeps its own unsent text in `hm.drafts.v1` (chat id → text); the empty new-chat screen has one per profile (`new:<profile>`). The text is saved on every change and restored when the chat is shown again. At most 100 drafts are kept (the oldest dropped first); an empty text deletes the entry. A one-time migration moves the old single `hm.draft` into the current profile's new-chat draft. When the empty screen turns into a real chat (the first attachment, a share, a model pick that replaces an empty chat), the text moves with it.

#### Stash

`web/src/stash.ts` (`stashes`, `pushStash`, `takeStash`, `clearStashes`, `STASH_MAX` = 20; list in `hm.stash.v1`), like `git stash` for the composer. Add → **Stash draft** (shown only when the box has text) saves the typed text with its chat and time at the front of the list, empties the box and toasts "Draft stashed". Only the text is stashed: quote chips (below) and attachments stay where they are. Add → **Stashed drafts (N)** (shown only when N > 0; its sub line is the newest stash's first 50 characters) opens a second picker "Stashed drafts", newest first: label = the first line (60 characters), sub = "<time ago> · <chat title or New chat>". Picking one puts its text in the box and removes it; when the box already had text, the two swap (the old text is stashed) and a toast says "Swapped with your stash". The last row, "Clear all stashed drafts", asks first (`confirmDialog`). The oldest of more than 20 is dropped.

#### Quotes

Words selected in a reply can be quoted into the next message.

- The selection bar (3.2, `QuoteBar`) adds the selection with `addQuote`. A chip `quote-chip` ("❝" and the first 60 characters) per quote shows above the text box, in the attachment row area, each with ✕ (aria-label `Remove quote`, `removeQuote`). At most 3 quotes (`QUOTES_MAX`): a 4th replaces the oldest. A quote is at most 2000 characters (`QUOTE_MAX`).
- With quotes and an empty box the placeholder is "Ask about the quote…" and the Send button is enabled (the Live and Dictate buttons give way to Send).
- Quotes belong to the chat they were taken from: switching chats clears them (`clearQuotes`). They are not kept across a reload.
- The quote state (`useQuotes`, `setQuotes` to put them back after a failed send) and the text helpers `withQuotes` / `splitQuote` live in `web/src/quote.ts`. `splitQuote` is the inverse of `withQuotes` and counts a line like `>x` (no space) as a quote line, as Markdown does.

#### Attachments and camera

- **Add → Camera** opens the phone's camera (`capture="environment"`), **Photo** the gallery (several allowed), **File** any file (several allowed). All three feed `attachFile`.
- **Photos** (type `image/*`) go to `image.attach_bytes` and are queued inside Hermes for the next prompt. The composer shows a thumbnail. Removing one calls `image.detach`, or the photo would still be sent.
- **Other files** go to `file.attach`, which stores them in the chat's workspace and returns an `@file:` reference. That reference is put in front of the message text when sent. The composer shows a chip.
- **Limit:** 20 MB per file (`MAX_ATTACH_MB`); larger ones fail with "<name>: too large (max 20 MB)".
- **No chat yet:** attaching on the empty screen creates the chat first.
- **Across reconnects:** attachments stay with the chat. After a resume that returns a new runtime, `carryAttachments` queues each photo again (a photo Hermes no longer has is dropped, with a toast "N attachment(s) couldn't be kept").
- **After sending** the attachments are cleared; a message that fails to send gets them back.

#### Dictation

The Dictate button calls the shell's `startListening` bridge method. The composer remembers the text before and after the caret and shows the phrase being recognised between them (partial results); a finished phrase is inserted at the caret. Dictation keeps listening until the user taps Stop dictation. If the user types or moves the caret meanwhile, the anchor moves there, so typed text is never overwritten; moving the caret by hand drops the half-recognised phrase (it comes back whole at the new spot). Errors toast for 8 s with a plain explanation (`voiceErrorText`: microphone not allowed, no speech recognition on the phone, needs internet or a language pack…). Speech recognition itself is Android's; see 3.11.

#### Offline outbox

- **Queueing.** Sending while Hermes is not connected keeps the text: `queueMessage` stores one message `{ chat, text, atts?, runtime? }` in the store (`queued`) and in `hm.outbox.v1`. A second message typed while one waits is joined to it with a blank line. The chip shows it. The send button is labelled "Send when back online".
- **Sending.** After the next successful connection, `flushOutbox` clears the outbox, opens the chat it was typed in (or starts a fresh one if it was typed on the empty screen while another chat is open), restores its attachments if the page reloaded meanwhile, sends it, and toasts "Sent the message you queued". If sending fails, the text is put back in the composer and a toast says "Couldn't send the queued message: <reason>".
- **From a notification.** A reply typed into a notification when the socket is dead takes the same path (`queueAndReconnect`: store, then reconnect).
- **Take it back.** The chip's ✕ (Don't send) returns the text to the composer.

#### Recent prompts

`web/src/recent.ts` keeps the last 20 distinct prompts per profile (`hm.recent.v1.<profile>`). Only the empty screen's suggestions read them.

#### Share to Hermes

`web/src/share.ts`. When the user shares text or files to the app from another Android app, the shell calls `window.hermesShared(count, text)`. The page closes screens and sheets, starts a new chat, puts the text in the composer (not sent), waits up to 60 s for the connection ("Hermes is offline: share the files again once it runs" if it never comes), then fetches the shared files one at a time (`sharedItem` bridge call, so a large PDF does not block the rest) and attaches each. A file that cannot be read gets a toast "<name>: <reason>". Nothing is ever sent by itself.

Launcher shortcuts call `window.hermesShortcut(kind)`: New chat, or `live` which also starts Live mode (toast "Live mode needs the phone app’s voice features" when voice is missing, "Hermes is offline" after 30 s).

---
