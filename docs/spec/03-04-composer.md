### 3.4 Composer

The composer sits at the bottom of the chat (`web/src/components/Composer.tsx` `Composer`).

**Opens from:** always present on the chat screen. **Closes with:** n/a. **Source:** `web/src/components/Composer.tsx` `Composer`; helpers `drafts.ts`, `recent.ts`, `commands.ts`, `share.ts`, `notif-answer.ts`.

**Layout, top to bottom:**

| Element | Looks like | Tap | Long-press / swipe | States (empty, loading, error, disabled) |
|---|---|---|---|---|
| Queued chip | "⏳ Sends when Hermux is back: <text, cut at 80 characters>" with "(📎 N attached)" when files wait. Button ✕ (aria-label Don't send). | Don't send takes the message back: it is put in front of whatever is in the composer and the outbox is cleared. | none | Only while a message waits in the outbox (see "Offline outbox"). |
| Slash menu | Floating list above the composer: `/name`, a "skill" tag for skills, a one-line description. | Tap an item to insert `/name ` at the typed token (the text after the caret is kept). | Does not steal focus from the text box (`onMouseDown` is cancelled). | Shows "Loading commands…" until the catalog first arrives. Hidden when nothing matches. |
| Attachment row | Photo thumbnails (with ✕), chips for files "📎 name" (with ✕), a chip "Attaching…" with a spinner while uploads run, and a small clear button when more than one item is queued. | ✕ (aria-label "Remove <name>") takes one item back out. clear removes all. | none | Hidden when nothing is attached or uploading. |
| Live bar | Replaces the tray (and its handle) and hides the text box during Live mode; while a reply runs the live status line (`StatusLine`) shows above it, as before the tray. The tray comes back as it was (open or closed) when Live mode ends. The bar: a coloured dot, "Live · Listening…" / "Hermux is thinking…" / "Hermux is speaking…" / "Mic muted", the words heard so far, or the hint "Pause for N s to send" ("Talk or tap Interrupt to cut in" while Hermes speaks, or "Tap Interrupt to talk" without barge-in); the Auto button (3.2) as an icon-only chip (`compact`: 🛡 green for Auto access, ⚡ red for Full access, same aria-label) when the chat is in one of them (`hideWhenOff`; hidden when off), an Interrupt button while Hermes speaks, a mute button (aria-label Mute microphone / Unmute microphone) and End. | Interrupt stops the reading and listens at once (talking over Hermes does the same, 3.11). Mute toggles the microphone (replies are still read aloud). End stops Live mode. | none | Only while Live mode runs. Live mode itself is 3.11. |
| Tray (`TrayBody` in `Tray.tsx`, state in `tray.ts`; see "Tray" below) | Directly above the text box: the live status line (`StatusLine`: spinner, the status text or "Working…", the elapsed time as `m:ss` from 3 s on, `~N tok/s`) while a reply runs, and under it the model row. Open or closed by the handle; closed, nothing in it is rendered. | See the rows inside it. | Its handle (below): tap, drag, keyboard. | Open on a new chat until its first message is sent; closed on a chat opened from the list; always open with Model bar "Always open" (3.15). |
| Model row (in the tray) | A chip with a sparkle icon, the model's short name (text after the last `/`, or "Choose a model"), and the reasoning level as text (`.model-chip-effort`; `EFFORT_SHORT` shortens medium to "med", minimal to "min" and none to "off"; any other level, such as low, high, xhigh or max, shows as its name). aria-label "Model: <name>, reasoning <level>. Change model" (without the level part when none is known). Right after it the Auto button (`AutoButton`, `.auto-btn`, 3.2): grey "Auto" = off, green "Auto" = Auto access, red "⚡ Full access" = Full access; it does not shrink, the model chip's name ellipsizes instead, so the row fits a 360 px phone. At the right end the context ring (`ContextRing`, `.ctx-ring`, 28 px tap target around an 18 px SVG circle `r = 7`): a track in `var(--dim)` and a fill in `var(--accent)` that is amber (`warn`) from 80 % and red (`full`) from 90 % (`ctxLevel`, `ringDash` in `ctxring.ts`). aria-label "Context 12% used. Show details". Always shown: while the chat's `ctx` is unknown (a new chat, or a reopened chat Hermes has no figures for yet) it is an empty ring labelled "Context not known yet. Show details". A reopened chat fills it at once from the last saved fill (`hm.ctx.v1`, 2.4), then from Hermes (`context-fill`, 3.6). The fill is shown only here, not as text under replies or in the working line. While no reply runs, the last reply's speed (`LastSpeed`, `.tray-speed`: the "N tok/s" of the line under the newest reply, dim) sits just before the ring. | Opens the Model sheet (3.5). The Auto button opens the Auto picker (3.2). The ring opens the Context window sheet (`sheet: 'context'`). | none | Model chip disabled while offline or a chat is opening; the Auto button while offline. Hidden in Live mode, while the slash menu is open and while the tray is closed. |
| Tray handle (`TrayHandle` in `Tray.tsx`; button, aria-label "Model and status, closed. Open" or "Model and status, open. Close", `aria-expanded`) | A short rounded bar (36 × 4 px, `.tray-pill`) on the top edge of the bar below the chat, inside a 44 px high, 96 px wide target that reaches 36 px up over the chat. Dim at rest; gold with a light that crosses it (`.tray-shine`) while a reply runs; amber and still while Hermux waits for you (a question or an approval); with no reply running and the context at 80 % or more, the ring's colour (amber from 80 %, red from 90 %). | Opens or closes the tray (Enter, Space and a screen reader's activation too). A tap where the target reaches over the chat and lands on one of a message's buttons goes to that button (`buttonUnder`). | Drag up opens, drag down closes; the tray follows the finger and settles with the shared spring, a short flick is enough; a drag that starts on it never scrolls the chat, never opens the drawer and never starts the pull-up for the side chat. | Shown only with Model bar "Tucked away" and outside Live mode. |
| Tray hint (`role="status"`, `.tray-hint`) | A small label above the handle: "Model and context are here". | n/a | Any touch takes it away. | Shown once ever: the first time the tray closes by itself (`hm.trayHint.v1`), for 4 s (`HINT_MS`). |
| Add button (aria-label Add) | `+` at the left of the text box. | Opens the picker "Add": a row with the current model (taps open the Model sheet), then Camera ("Take a picture now"), Photo ("From your gallery"), File ("PDF, document, spreadsheet, text, code… (up to 20 MB)"), then "Stash draft" (only when the box has text) and "Stashed drafts (N)" (only when N > 0): see Stash below. | none | Disabled while offline or opening. |
| Commands button (aria-label Commands) | `/` | Puts a `/` at the caret (with a space before it when the previous character is not whitespace) and focuses the box, which opens the slash menu. If a slash token is already open it only focuses. | none | Disabled while offline or opening. |
| Text box | Multi-line field, grows with its content up to 180 px (it fits its `scrollHeight`). Empty, it is one line whatever the placeholder's length and the font: the placeholder stays on one line and ends in "…" instead of wrapping (`.composer textarea:placeholder-shown` in `styles.css`), so a wider phone font cannot grow the box or the bar below the chat. Placeholder: "Message Hermux", "Queue or steer a follow-up…" while a reply runs, "Ask about the quote…" with quotes and an empty box, "Opening your chat…" while a chat opens, or "Offline: type now, it sends when Hermux is back". | Typing. Enter inserts a new line. Ctrl+Enter or Cmd+Enter sends (hardware keyboard). | none | Never disabled: the user can always type. |
| Live conversation button (aria-label Live conversation) | Waveform icon. Tooltip: "Live: talk, pause N s to send, Hermux answers out loud". | Starts Live mode (3.11). | none | Shown when the text box is empty, no reply runs, dictation is off, and the phone app's voice input exists. Disabled while busy or offline. |
| Dictate button (aria-label Dictate) | Microphone icon. | Starts dictation (below). | none | Same conditions as the Live button. Disabled while busy or offline. |
| Stop dictation (aria-label Stop dictation) | Microphone with a stop square. | Stops listening. | none | Shown while listening. |
| Stop button (aria-label Stop) | Stop square. | Interrupts the running turn (`session.interrupt`). | none | Shown while a reply runs and the text box is empty. |
| Send button (aria-label Send) | Paper-plane icon. The label is "Steer" while a reply runs and "Send when back online" while offline. | Sends. | none | Disabled when the text is blank, a send is in flight, or a chat is opening. |

**Data:** `queue.ts` (`hm.queue.v1`), `drafts.ts` (`hm.drafts.v1`, legacy `hm.draft`), `stash.ts` (`hm.stash.v1`), `recent.ts` (`hm.recent.v1.<profile>`), `commands.ts` (`hm.cmds.v1.<profile>`), outbox (`hm.outbox.v1`); RPCs `prompt.submit`, `session.steer`, `session.interrupt`, `slash.exec`, `command.dispatch`, `commands.catalog`, `image.attach_bytes`, `image.attach`, `image.detach`, `file.attach`, `config.set`; dashboard `GET /api/skills`.
**Rules:** attaching and the camera use a plain `<input type="file">` (the Android shell supplies the picker and camera), so there is no custom file browser.

#### Tray

`web/src/tray.ts` holds the tray's state and `web/src/components/Tray.tsx` draws it. The model row and the live status
line are information a person looks at now and then; on a small screen they took about 60 px while Hermux worked, so
they sit in a tray above the text box that can be closed (owner, 2026-11-16;
`docs/decisions/chat-height-belongs-to-content.md`).

- **When it is open.** A new chat (the empty new-chat screen) starts with the tray open, so the model can be seen and
  changed before the first message. Sending that first message closes it (`trayFirstSend`, called by `send()` when the
  composer's chat is the new-chat screen or a chat with no messages yet), as the message leaves the composer. A chat
  opened from the list starts closed (`trayForChat('listed')` when the composer's chat changes; `'new'` for the new-chat
  screen; `'carry'` when the new-chat screen becomes a real chat by its first message, an attachment or a model pick,
  so the tray stays as it is). The app reopening the last chat at start starts with it closed (`tray.ts` reads the store's `opening`), and a change that comes with another chat is taken at once, without movement (`takeTrayJump`). After that the person decides: opened or closed by hand (`setTrayOpen`), it stays so for
  as long as that chat is on screen, and later sends do not change it. A tray opened by hand on a new chat stays open
  across its first message.
- **The hint.** The first time ever that the tray closes by itself, "Model and context are here" shows above the handle
  (`useTray().hint`), and leaves after 4 s or at the first touch anywhere (`dismissTrayHint`). `hm.trayHint.v1` = `1`
  records that it was shown; it never shows again.
- **Model bar setting** (3.15): "Tucked away" (default) or "Always open" (`hm.modelBar`, `setModelBarMode`). Always open
  has no handle and is the layout from before the tray. `useTray()` gives `{ mode, open, hint }`; `trayState()` reads it.
- **Height.** Closed, the composer area is the input row plus a 10 px band for the handle's bar (`.composer-wrap.tray-closed`):
  69 px at 360 × 740 instead of 101, and the same while a reply runs (130 before), so the messages gain 33 px idle and
  61 px while working. Open, it is the layout from before, and while a reply runs 8 px shorter (the status line now sits
  inside the composer, 122 px). Text in the tray never wraps (a wider font cannot grow it).
- **Movement.** Opening lays the composer out at its final height at once and moves the tray's layer (`.tray-body`) up
  from behind the text box by `translate`, fading in, with the handle moving with it (`.tray-settle`, the shared
  `--motion-settle` spring); closing moves it back and removes it at the end, so the chat's size changes once per open or
  close. During a drag the layer and the handle follow the finger (inline `translate` and `opacity`, nothing laid out
  per frame; `.tray-moving` cuts the layer off at the text box) and settle on release: past 30 % of the tray's height, or
  after a flick faster than 0.3 px/ms, it goes the finger's way. With Animations Reduced or Off the tray does not follow
  the finger: a drag of 16 px or more (or a flick) opens or closes it, with a short fade (Reduced) or at once (Off).
  Nothing keeps a `translate` once settled (a transformed tray would become the frame of the Auto picker and the sheets
  that open from it).
- **The reader's place.** At the end of the chat the last message stays in view above the composer when the tray opens
  or closes (`onBarInsets`, 3.2); scrolled up, the text does not move.
- **Cost.** Closed, nothing in the tray is rendered, so nothing in it updates: no elapsed-time ticks (`useElapsed`
  runs only while the status line is on screen), no speed updates, no ring redraws; opening shows the current values at
  once. The handle's shimmer exists only while a reply runs, moves a strip of the theme's `--shine` (a white glint, softer in Light) by `translate` at the chat list shimmer's frame
  limit (48 steps in 2 s), stands still under Reduced and Off, while the app is away and while the handle is off screen
  (`pauseWhenHidden`).

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
3. Otherwise clears the box and the quotes, calls `sendPrompt` (which resolves `false` when `prompt.submit` itself failed, `true` otherwise), and on failure puts the text and the quotes back and shows an error toast.

`sendPrompt` (`gateway.ts`) in order:

1. Refuses while a chat is opening ("Still opening your chat — wait a moment").
2. Remembers the prompt for the empty-screen suggestions (`rememberPrompt`: 4 to 200 characters after collapsing whitespace, newest first, 20 kept per profile, no case-insensitive duplicates).
3. Gets the target chat; if there is none (or a model pick is still creating one) it waits for it or creates a new chat.
4. `/btw <question>` opens the By the way sheet (3.12) and sends nothing.
5. Any other text starting with `/` goes to `runSlash` (below).
6. If a reply is running: `session.steer` with the text, and a notice "Steer: <text>" is added. The running turn takes the new instruction; no new turn starts.
7. Otherwise a user item is added (with the queued photo thumbnails and file names), `running` is set, any pending model switch is awaited, and `prompt.submit` is called with `surface: 'mobile'`. File attachments go as their `@file:` references in front of the text; photos were already queued inside Hermes. If it fails, a "Send failed: <reason>" notice is added and the attachments reappear in the composer.

**Queue** (`send(undefined, 'queue')` in `Composer.tsx`, state in `web/src/queue.ts`): the text sent is built exactly as for Send (`withQuotes(quotes, text)`, so quotes travel with it); it is added to the open chat's queue (`enqueue`, `hm.queue.v1`), and the box and the quotes are cleared. Queued messages are shown at the end of the chat (3.2) and sent one by one when the chat's turn ends (2.2.1 step 8a). The queue lives in the page, not in Hermes: a queued message is sent only while the app shows that chat (closing the app, or opening another chat, keeps it and pauses it until Resume). It is a different thing from the offline outbox. The placeholder while a reply runs is "Queue or steer a follow-up…".

Over the lock screen (`sendPrompt`): a chat in Auto or Full access sends nothing until the phone is unlocked, and a slash command runs only when it shows something and changes nothing (`lockSafeCommand` in `slashwords.ts`, in a chat with access off): `/help`, `/status`, `/version`, `/whoami`, `/agents`, `/usage` and `/context` (also `all`) by their exact names, the bare ones with nothing after them, and `/kanban` when it only reads (`kanbanReadOnly`). Everything else asks for an unlock and stays in the box: `/approvals`, `/cron run` or `remove`, `/rollback`, `/kanban swarm`, a quick command (an `exec` one runs a shell command), an alias (`/v`, `/tasks` and `/ctx` too), a beginning Hermes would expand, `/btw`, any name the page doesn't know. Everything is judged before anything is sent, a new chat included (`lockWhy` in `sendPrompt`; with no chat open it judges the chat to be made, whose access is off there): the access, the command's name, and the profile's command catalog (`notBuiltIn` in `gateway.ts`, every time, for the open chat's session or, with none open, the page's `profile`). When the catalog lists a quick command ("User commands"), a plugin command or a skill of that name, Hermes might run that instead, so the command waits too. It fails closed: so it does when the catalog can't answer, when its answer isn't a well-formed catalog (no `categories` list of named rows, no `skills` object), and when it carries a non-empty `warning` (a quick command, plugin or skill loader failed, so a name may be missing from it; Hermes also puts its notice about skills named like a built-in there). A plugin command that has a built-in's name isn't listed there, so it isn't seen. `/yolo` goes only to turn access off (`off`, `0`, `false` or `no`, `yoloOff`); a bare `/yolo` or `/yolo on` waits. After the wait for the chat (`targetChat`) and the catalog, the same rules are checked again, since the phone can lock meanwhile, so `/btw` typed just before it locks isn't opened. Hermes's `prompt.submit` runs no slash command, so text that doesn't start with `/` only talks. Every way text reaches `sendPrompt` goes through this: the composer, Live mode's transcript, the queue; a reply from a notification doesn't reach it over the lock screen (`notif-answer.ts`).

The phone can lock while a command waits (the confirmation below, Hermes's answer), so `runSlash` looks again before each request: over the lock screen only a command `sendPrompt` let through goes on, as typed. An alias step, the `command.dispatch` fallback (where a quick command of the same name runs first) and an answer to send as a prompt (`send`, `skill`) or another alias are not followed; the page asks for an unlock and shows "Unlock the phone to run this command.".

`runSlash`: shows the command as a user item, then:

- `/yolo [on|off]` switches Full access (3.2): a bare `/yolo` goes to Full access from Off or Auto access, and from Full access back to the mode the chat was in before.
- `/fast [on|off|status]` sets Hermes's fast mode for this chat with `config.set` key `fast` (value `toggle` when no argument), and a notice reports "Fast mode on for this chat" or "off". It is run this way because Hermes's slash worker process is slow to start on a phone.
- **Commands that start an agent apart from the chat, or change a board** (`detachedWork` in `web/src/slashwords.ts`): `/bg` (and `/background`), `/cron add`, `create` and `edit`, every `/kanban` that doesn't only read (`kanbanReadOnly`: its help, `list`/`ls`, `show`, `stats`, `log`, `runs`, `attachments`, `assignees`, `context`, `notify-list`, `diagnostics`/`diag`, and `boards` bare, `list`, `ls`, `show`, `current`; the arguments are read as Hermes reads them, `hermesShlex` for its `shlex.split` and the `--board` option, a beginning of it, its value, and `--`, so `/kanban swarm`, `/kanban -- create`, `/kanban --board b -- dispatch`, `specify`, `decompose` and `comment` all count), `/blueprint <name> slot=value`, and `/suggestions accept`, `add` or `schedule` (an accepted suggestion becomes a scheduled job). Names are read as Hermes reads them: Python's separators (`hermesWords`), then the command Hermes's slash worker runs for the name (`hermesCommand`): an alias from Hermes's own table (`/bp` is `/blueprint`, `/suggest` is `/suggestions`), or a beginning it expands (the only name that starts that way, or the only shortest one: `/cr`, `/k`, `/bl`, `/sug`). The table is `web/vendor/hermes-commands.json`, written from the pinned Hermes's `COMMAND_REGISTRY` by `tools/hermes-commands.py`; a unit test fails when its commit isn't the pin. `/background`, which Hermes doesn't know, counts as `/bg` too. In a chat that has read phone data they are not sent, and a notice says why (`detachedRefusal`); the app asks its record each time, with nothing remembered (`chatReadState`), and when the record can't answer they are not sent either, with words that don't claim the chat has read. Everything else about these commands, and every other chat, is unchanged. This is the friendly half: the plugin is what blocks a background task's sends (5.1).
- **`/approvals off` and `/approvals smart`** (also by a beginning Hermes expands, `/ap` and longer, read with `hermesCommand`; `loosensApprovals`) let every chat of the bot run risky commands without asking, or let a model decide. Before one is sent the page asks with the Full access dialog (`confirmLooseApprovals` in `access-confirm.ts`), whose text says it holds for every chat of the bot until `/approvals manual`; Cancel sends nothing and a notice says "Approvals not changed.". When the phone locked while the dialog was up, Allow sends nothing either and the page asks for an unlock. Asked at every alias depth, so a quick command `command.dispatch` names is caught too; one Hermes's worker resolves itself is not seen by the page (the user wrote it into `config.yaml`). `/approvals manual` and a bare `/approvals` go as before.
- Everything else: `slash.exec`, which runs the command in Hermes's slash worker. The worker resolves a quick command that is an alias itself, so the page gets only its output and never sees the target (what such a command may do is decided in the plugin, 5.1). If `slash.exec` fails (skills and routed commands, or a failed worker), `command.dispatch`. Its answer's type decides: `alias` runs the target command (up to 3 levels), `prefill` puts the message in the composer, `send` or `skill` submits the message as a prompt (`display_kind: 'skill'` for skills), anything else shows the output as a notice.

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
- **Sending.** After the next successful connection, `flushOutbox` clears the outbox, opens the chat it was typed in (or starts a fresh one if it was typed on the empty screen while another chat is open), restores its attachments if the page reloaded meanwhile, sends it with `sendPrompt`, and toasts "Sent the message you queued" only when the send went out (`flushOutbox` is exported for tests). If `prompt.submit` fails, `sendPrompt` has already added the "Send failed" notice, so there is no "Sent" toast and the text is put back in the composer. If anything before the send throws, the text is put back in the composer and a toast says "Couldn't send the queued message: <reason>".
- **From a notification.** A reply typed into a notification when the socket is dead takes the same path (`queueAndReconnect`: store, then reconnect).
- **Take it back.** The chip's ✕ (Don't send) returns the text to the composer.

#### Recent prompts

`web/src/recent.ts` keeps the last 20 distinct prompts per profile (`hm.recent.v1.<profile>`). Only the empty screen's suggestions read them.

#### Share to Hermux

`web/src/share.ts`. When the user shares text or files to the app from another Android app, the shell calls `window.hermesShared(count, text)`. The page closes screens and sheets, starts a new chat, puts the text in the composer (not sent), waits up to 60 s for the connection ("Hermux is offline: share the files again once it runs" if it never comes), then fetches the shared files one at a time (`sharedItem` bridge call, so a large PDF does not block the rest) and attaches each. A file that cannot be read gets a toast "<name>: <reason>". Nothing is ever sent by itself.

Launcher shortcuts call `window.hermesShortcut(kind)`: New chat, or `live` which also starts Live mode (toast "Live mode needs the phone app’s voice features" when voice is missing, "Hermux is offline" after 30 s).

---
