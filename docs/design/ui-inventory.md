# UI inventory

Every screen, region and element of the Hermux interface, in one place, for designing the planned UI revamp
([status](../status/ui-revamp.md)). It is the source for the image-generation prompts in
[chatgpt-ui-prompts.md](chatgpt-ui-prompts.md). The behaviour itself is specified in `docs/spec/03-*.md`; this file is
a designer's map of it (what is on screen, what it is for, which states it has), checked against
`web/src/components/` on 2026-11-02. When the two disagree, the spec and the code win.

Format: **Label or icon** · kind · job · states.

---

## 1. The app in one paragraph

Hermux is an Android chat app for Hermes Agent, an open-source AI agent that runs on the phone itself (inside
Termux and a Debian userland). The agent can run commands, read and write files, browse, use phone apps, schedule jobs
and remember things; the app is its front end: streaming replies with visible thinking and tool calls, approvals for
risky actions, many chats and several "bots" (profiles), skills, memory, scheduled jobs, files, projects, a canvas for
documents beside the chat, interactive cards inside replies, read-aloud and a hands-free Live voice mode, plus a
first-run setup flow that installs and connects everything. Only the model provider is off the phone.

## 2. Constraints for any redesign

- **Phone first, one hand.** Main actions within thumb reach at the bottom (composer, sheets); the top bar holds
  status and navigation. Bottom sheets rather than centred dialogs. Touch targets at least 44 px.
- **Every Android phone, Android 8.0 and up**, small and large screens, any maker. The UI is one web page in an
  Android WebView: no native widgets, no system dialogs, no native pickers (the owner rejected the system look; all
  controls are the app's own).
- **Wide screens** (tablets, unfolded foldables, landscape): from 700 px the canvas becomes a column beside the
  chat with a draggable divider; from 840 px the chat list docks as a 320 px left column that can be hidden.
- **Themes:** Default (dark), OLED black, Light, System (follows the phone). Every colour is a CSS variable, so any
  design must work in all three. Text size 90 % to 135 %.
- **Gestures carry a lot:** swipe right opens the chat list, swipe left opens the canvas, pull up past the last
  message opens the By the way side chat, swipe a chat row right to archive and left to delete, long-press and drag
  to reorder or pin. Android Back closes the top layer.
- **Battery and calm:** no decorative animation loops; the spinner ticks in steps on purpose. Haptic tick on taps.
- **Dense information:** tool calls, diffs, code, tables, formulas, diagrams and long agent runs must stay readable
  on a 360 px wide screen.
- **Rendered Markdown is sanitized**; interactive HTML lives in the canvas, except OpenUI cards inline in replies.

## 3. Visual language today

- Dark default: background `#0e1115`, surfaces `#161a20`, border `#272d37`, text `#e8e6e1`, dim text `#8b929c`.
- Accent: warm gold `#d9a441` (light theme `#b57a10`); user bubbles a dark gold-brown tint. Status colours green
  (ok), amber (warn), red (error). Icon-chip tones: gold, blue, green, purple, red, teal, gray.
- Light theme: white background, warm off-white surfaces `#f6f5f1`, near-black text.
- System font (Roboto on Android), monospace for code, paths, commands and keys. Radius 14 px; sheets 20 px top.
- Brand mark: ☤ (caduceus). Emoji are used as row and menu icons throughout.

## 4. Layout and navigation

One React page; no URLs. The chat is always mounted underneath; everything else is drawn on top of it.

| Layer | What | Opens from | Closes with |
|---|---|---|---|
| Chat | Header, banners, messages, composer | Start | never |
| Drawer | Chat list, bots, navigation | ☰, swipe right | backdrop, swipe left, Back, picking a chat |
| Full-screen pages | Hermux hub, Skills, Memory, Scheduled jobs, Files, Projects, Canvas gallery, Bots, Settings, Setup check, Set up Hermux | drawer tiles, hub cards, banners | ‹ Back, Android Back |
| Bottom sheets | Model, Chat menu, Draft menu, Chat details, Backend status, Context window, Goal, File checkpoints | header and composer controls | drag down, tap outside, Back |
| Request sheet | Approvals, questions, passwords | Hermux asks | only by answering |
| Canvas panel | Documents beside the chat | canvas button, swipe left | ✕, swipe right on its bar, Back |
| By the way sheet | Side question about the chat | pull up at the end, `/btw` | drag down, tap outside, Back |
| Picker sheets, dialogs | Choices, confirm, text prompt | many | Cancel, tap outside, Back |
| Lightbox, diagram viewer | Images, diagrams full screen | tap the image or diagram | ✕, tap outside, Back |
| Toasts | Short feedback below the header | anything | 3.5 s; at most three |

Paint order on the chat (top to bottom): test-build strip, header, connection banner, find bar, message list,
activity banner, status bar, compress hint, read-aloud player, background-app card, composer.

## 5. Shared building blocks

- **Screen top bar** · ‹ Back, centred title, optional icon actions on the right.
- **Section** · grouped card with an optional small heading and a footer note.
- **Row** · coloured icon chip (emoji on a tinted rounded square) + title + dim sub-line + optional value on the
  right + optional › · plain / tappable / disabled / danger (red).
- **Toggle** · 44×26 pill switch, gold knob when on. **ToggleRow** = a Row whose whole width flips it.
- **SelectRow + PickerSheet** · row showing the current choice; opens a sheet of options (icon chip, title, sub,
  ✓ on the selected one, gold tint).
- **SliderRow** · icon, title, bold value, the app's own slider below.
- **Segmented control** · rounded track, selected segment gold with dark text.
- **Pills / chips** · filter pills, example pills, tags (active, paused, free, Recommended, In use).
- **Bottom sheet** · grip bar, bold title, scrolling body, button row at the bottom. Tall (82 % of the screen) or
  short (menus).
- **Menu sheet** · list of emoji + text items, some with a dim sub-line; a red Delete last.
- **Dialog** · compact sheet: icon circle (? confirm, ✎ prompt, 🗑 red danger, custom), centred title and message,
  optional bullet list, optional text field, Cancel | confirm (gold, or solid red for danger; can stay disabled until
  the user types a name).
- **Toast** · small rounded bubble under the header: info (neutral), warn (amber), error (red).
- **Spinner** · 13 px ring with a gold segment, turning in steps.
- **Status line** · "Loading…", red error box, or dim empty-state sentence.
- **Notice box** · info / warn / error tinted box with Markdown inside.

## 6. Chat screen

### 6.1 Header
- **☰** · icon button · open the chat list (wide: show or hide the docked list) · small unread dot when another chat
  finished unseen.
- **Title** · button · open the Chat menu · chat title / "New chat" / "Hermux" on the empty screen; branch icon for a
  branched chat.
- **Status dot** · indicator button · open Backend status · green ok / amber warn / red offline / blinking amber
  connecting.
- **🔊 badge** · indicator · this chat is read aloud · shown or hidden.
- **Bot name** · dim text under the title (profile name, or "Hermux agent").
- **Canvas** · icon button · open this chat's canvas · dot when it has documents; pulsing while Hermux writes.
- **⋮ Chat options** · icon button · Chat menu (Draft menu on the empty screen).
- **Test-build strip** · amber strip above everything · only in debug builds or while remote debugging runs (with
  minutes left).

### 6.2 Banners and bars under the header
- **Connection banner** · strip · Hermux not connected · spinner + "Connecting to Hermux…" / "Hermux is offline" +
  seconds; **Check setup** button after 10 s; **Retry** turning into **Restart Hermux** after 20 s.
- **Find bar** · search field "Search in this chat", count "3 / 12" or "none", **↑** previous, **↓** next, **✕**
  close · matches highlighted in the list, the current one centred.

### 6.3 Message list
- **Opening skeleton** · four grey bubble shapes shimmering + "Opening your chat…" · or a read-only cached preview
  of the chat without actions.
- **Empty new-chat screen** · ☤ logo, "Hermux", "Your agent, on your phone." or "Profile: <bot>", up to four
  suggestion buttons (recent prompts, skills, built-in ideas) that fill the composer.
- **Earlier messages…** · row with spinner at the top while older messages load.
- **New Messages** · gold divider line.
- **↓ Scroll to the newest message** · round floating button · shown when away from the end.
- **User message** · right-aligned tinted bubble · text with links, quoted lines above it, photo thumbnails, 📎 file
  chips · tap shows the send time · actions under it: **Copy** (✓ flash), **Edit** (pencil; disabled while a reply
  runs). Edit mode: textarea, removable attachment chips, **Cancel**, **Send**.
- **Assistant reply** · full-width, no bubble:
  - **Thinking** head · "Thinking…" with spinner and a one-line peek while live, "Thought process" with a brain icon
    when done · expands to the full reasoning.
  - **Body** · rich Markdown with a blinking caret while streaming; "⚠ warning" line when the turn ended badly.
  - **Actions** · **Copy** (picker: Text only / With formatting), **Read aloud** / **Stop reading**, **Retry**,
    **Branch**, and dim stats "~41 tok/s · 1m 23s · ctx 2% · 8k/200k".
- **Tool card** · collapsed row: tool icon (⌘ terminal, ▶ code, 📄 read, ✎ write, 🔍 search, 🌐 web, 🧭 browser,
  ✦ skill, 🧠 memory, ☑ todo, ⇶ sub-agent, 👁 vision, 🎨 image, ✉ message, 📱 phone app, 🔧 other), tool name, one-line
  label, state mark (spinner / duration ✓ / ✕) · generating / running / done / error / risky (red outline) ·
  expanded: risk reason, Arguments, Summary, Diff, media, Output with exit code and **Copy**.
- **Folded tool run** · three or more tools in a row fold into one line: up to four icons, "Ran 6 tools · 42s" or
  "Running 6 tools…", "· 1 failed" in red, chevron.
- **Sub-agent card** · "⇶ Sub-agent" + status, goal, latest detail, summary when done.
- **Notice** · info / warn / error box (steer notes, command output, compress result, send failures).
- **Changed-files card** · "✎ 3 files changed +40 −12" · expands to file rows with their own counts (tap: diff
  sheet) and a **Checkpoints** button.
- **Inside Markdown** · code blocks with language label and **Wrap**, **Preview** (HTML/SVG inline frame with
  **Full screen**), **Canvas**, **Copy**, **Show all N lines**; diffs coloured; Mermaid diagrams (tap: viewer with
  − zoom % ＋, Fit, Copy, ✕); tables with sortable headers (⇅ ▲ ▼) and **Copy table**; task lists with real
  check boxes and a "N/M done" bar; formulas (tap to copy LaTeX); callouts tinted by kind; tap-to-copy inline code;
  chat links with a speech-bubble icon; footnotes; ==highlights==.
- **Media** · images (tap: lightbox with pinch zoom, ✕, **Save**, **Share**, **Open with…**), video with controls,
  audio player (play/pause, name, seek, time, 1× / 1.5× / 2×), 📎 file chips, failure chips.
- **OpenUI card** · interactive card inside a reply (tables, charts, tabs, carousel, steps, forms, buttons, date
  picker, follow-up buttons) in OpenUI's own look; "Loading card…"; "⚠ Part of this card couldn't be shown".
- **Queued follow-ups** · dashed right-aligned bubbles "Queued · 1 of 2" with **Send now**, **Edit**, **Remove**;
  "Queue paused" + **Resume**.
- **Scrubber** · thin rail on the right edge with one tick per user message and a gold thumb · drag or tap to jump;
  a bubble "12 / 30 + first words" while dragging · only on long chats.
- **Pull-up hint** · "Release for a side question" pill fading in while pulling up at the end; gold when armed.

### 6.4 Strips above the composer
- **Activity banner** · spinner + "<other chat>: <what Hermux does>" + "(+2 more)" · tap opens that chat.
- **Status bar** · spinner, status text or "Working…", elapsed m:ss, ~tok/s, ctx % · **🎯 Goal** line ("turn 3 of
  20 · active / paused") opening the Goal sheet · **☑ Tasks 2/5** expanding to the to-do list (✓ ◐ ✕ ○).
- **Compress hint** · "Context 84% full. Compress older turns so Hermux keeps up?" + **Compress** + **✕ Not now**.
- **Read-aloud player** · pause/resume, −5 s, +5 s, position slider, "0:12 / ~1:40", speed pill (0.75× to 2×),
  ✕ close.
- **Background-app card** · live thumbnail of the app Hermux is driving, "Using <app>", what it is doing, › · opens
  a viewer sheet with the live picture, caption, **Take over** and **Stop** (red).

## 7. Composer

- **Offline outbox chip** · "⏳ Sends when Hermux is back: <text>" + **✕ Don't send**.
- **Selection bar** · appears when text in a reply is selected: "Selected text", **Quote**, **Explain** · "Selection
  is too long to quote" disables them.
- **Slash menu** · list above the box while typing `/word`: "/name", `skill` tag, description; "Loading commands…".
- **Quote chips** · "❝ first words…" + ✕ (up to three).
- **Attachments row** · photo thumbnails and 📎 / 🖼 file chips, each with ✕; "Attaching…" with spinner; **clear**.
- **Model row** · **model chip** (sparkle, short model name, reasoning level such as "med") opening the Model sheet;
  **Auto** chip right after it (grey Off / green Auto access / red ⚡ Full access; opens a picker: ✋ Off,
  🛡 Auto access, ⚡ Full access, Full asks to confirm); **context ring** (18 px, gold / amber ≥80 % / red ≥90 %)
  opening Context window.
- **Input row**:
  - **＋ Add** · opens picker: model row, 📷 Camera, 🖼 Photo, 📎 File (up to 20 MB), Stash draft, Stashed drafts (N).
  - **/ Commands** · inserts "/" and opens the slash menu.
  - **Text box** · grows to 180 px · placeholders "Message Hermux", "Queue or steer a follow-up…" (reply running),
    "Opening your chat…", "Offline: type now, it sends when Hermux is back", "Ask about the quote…"; live dictation
    text shown in place.
  - **Right-hand buttons**, one set at a time: **Live conversation** (gold waveform) + **Dictate** (mic) when empty
    and idle · **Stop dictation** while listening · **Stop** (square) while a reply runs and the box is empty ·
    **Steer** pill + **Queue** (arrow with clock badge) while a reply runs and there is text · **Send** (paper plane;
    "Send when back online" offline).
- **Live mode bar** (replaces the model row and hides the input row) · pulsing dot (green listening, gold thinking,
  blue speaking), "Live · Listening…" / "Hermux is thinking…" / "Hermux is speaking…" / "Mic muted", a hint line
  (words being recognised, "Pause for 2 seconds to send", "Talk or tap Interrupt to cut in"), **Interrupt** (while
  speaking), **mic mute** toggle (red with slash when muted), **End** (red). Approvals can be answered by voice.

## 8. Chat sheets

- **Model** · reasoning pills (none … max), **Search models…**, Favourites, one group per provider (current first,
  "free" tag), rows with model + provider, ● on the current one, ☆/★ star, "Use “<typed id>”" group, hint "Missing a
  model? Type its exact name…", loading and error states.
- **Chat menu** (title = chat title) · 🔍 Search in chat, ✏️ Rename (inline field + Save), 🔊 Read every reply aloud
  (On/Off), 🗒 Canvas ("N documents"), 📤 Share chat ("As Markdown, to any app"), ⏪ File checkpoints, ↶ Undo last
  turn, ℹ️ Chat details, 🗑 Delete (red, confirm).
- **Draft menu** (empty new chat) · 🔊 Read every reply aloud, 🤖 Change model, note that the rest comes after the
  first message.
- **Chat details** · Title, Model, Provider, Profile, Working dir, Tokens in/out, Context %, Cost, Session id (tap to
  copy).
- **Context window** · bar (gold / amber / red), "N% used", "12,345 of 128,000 tokens", input/output, cost, cache
  hits, **Compress older turns** (busy, disabled while running), "Nothing to show yet.".
- **Backend status** · hero with big coloured dot and "Everything is working" / "Connecting…" / "Hermux is offline" /
  "Hermux is up, with problems", "Checked 5s ago · Hermux agent v…" · rows with dots: Connection (ping), Dashboard, Agents
  running, Memory (GB free, swap), Storage, Shizuku (tappable fix) · **Check again**, **Reconnect / start Hermux**,
  **Setup check**.
- **Goal** · Goal, Status, Turns "3 of 20", Outcome, Verification, Constraints, Boundaries, Stop when, Last verdict,
  Subgoals list · **Pause / Resume**, **Clear goal** (red).
- **File checkpoints** · list grouped by folder: "⏺ date · latest" + reason and files; "N older snapshots pruned";
  empty state · snapshot view: "‹ All checkpoints", per file a new / changed / deleted tag, name, +A −R, diff,
  **Restore file**; red **Restore these N files** with a confirm listing the outcome.
- **Diff sheet** · full path title, coloured diff.

## 9. Approvals and questions (request sheet)

Cannot be dismissed; one at a time; queue behind it.
- **Approval** · "⚠ Approve <tool or command>?", description, monospace command block · stacked buttons **Allow
  once** (gold), **Allow this session**, **Always allow** (when offered), **Deny** (red). On a locked phone allowing
  says "Unlock the phone to allow this".
- **Question** · "❓ Hermux asks", the question, choice buttons (○/● single, ☐/☑ multiple), "Or type your own
  answer…" box · **Skip**, **Answer** (disabled until answered).
- **Several questions** · "Question 2 of 4", row of dots (empty / answered / current ring), one question at a time,
  auto-advance after a single choice · **Skip**, **Back**, **Next**, **Answer** on the last.
- **Password / secret / code** · "🔐 Password needed" / "🔑 API_KEY_NAME" / "🔢 Code needed", prompt, masked field
  (numeric for codes) · **Cancel**, **Send**.
- The same approvals also appear as notification buttons outside the app.

## 10. Canvas panel

Documents, notes, web pages and code that belong to a chat, beside it.
- **Sizes** · phone: slides over the chat from the right · wide: column beside the chat with a draggable divider
  (hints "Full screen" past 85 %, "Close" under 20 %) and an edge pull tab · full screen: only the document and a
  ⤓ exit button.
- **Header** · tabs (type icon 📝 🌐 💻 📄 { } ▦ 🖼 ⛓ + title; active one highlighted; scrolls sideways), **＋ New
  document**, **✕ Close canvas**; swipe right on it to close (phone).
- **Toolbar** · **View | Edit** (HTML: **Run | Edit**), save state ("Saving…", "Unsaved", "Saved ✓", "Conflict",
  "2 min · Hermux|You"), **🚫 Offline / 🌐 Online** (HTML network), **⛶** full screen, **⋮** document menu.
- **Banners** · "Hermux is rewriting this document… 12s" with spinner · conflict: "Hermux changed this document while
  you were editing." **Use Hermux’s** / **Keep mine**.
- **Body states** · writing ("Hermux is writing “Title”…" + live text or shimmering lines + seconds) · "Loading the
  canvas…" · empty (🗒, "Your canvas is empty", "Ask Hermux to write something here, or start your own.", **New
  document**) · the document: Markdown, sandboxed HTML page (with "⚠ error" line), highlighted code, JSON, Mermaid,
  CSV table, SVG, plain text.
- **Editor** · ↶ Undo, ↷ Redo, then for Markdown B, I, H, •, ☑, “, </>, 🔗; text area (monospace for code); autosave.
- **Selection bar** · "Ask Hermux about the selection" + chips Rewrite, Shorter, Longer, Fix, Explain, Other….
- **Ask bar** · field "Ask Hermux to change “Title”…" + ➤ send.
- **Document menu** · ✏️ Rename, 🕘 Version history (N versions) · Share and save: ⧉ Copy, ↗ Share…, ⬇ Save a copy to
  Downloads, 💾 Save to the original file · 📂 Open a file from the phone…, 🗑 Close this document (red).
- **New document sheet** · 📝 Notes / document, 🌐 Web page, 💻 Code, 📄 Plain text, then a title prompt.
- **Version history** · rows with a Hermux / You badge, "Version 4 · current", age and note, expand to a diff and
  **Restore this version**.

## 11. By the way sheet

Side question about the current chat without interrupting it; 70 % high.
- Grip and title "By the way", hint "Ask about this chat without interrupting it. Hermux sees the conversation so
  far."
- Question bubbles (right) with Markdown answers, spinner while waiting, red error text.
- Input "Ask a quick question…" + ➤ send.
- Opened by pulling up 160 px past the last message (hint pill, haptic when armed) or `/btw`.

## 12. Drawer and chat list

- **Profile switch** · avatar letter, bot name, description, ▾ · opens the bot list (rows "a Name · model", current
  highlighted, "＋ New bot / manage bots…").
- **« Hide the chat list** · wide screens only.
- **＋ New chat** · full-width gold button.
- **Tiles** · ☤ Hermux, 🤖 Bots, ⚙ Settings.
- **Search sessions…** · filters titles; from two letters also searches inside messages ("In messages" group with
  highlighted snippets).
- **Groups** · 📌 Pinned (drop zone "Drop here to pin"), Today, Yesterday, This week, This month, Older (or "Chats" +
  **Sort by recent** after a manual reorder), **Show older chats**, **🗄 Archived (n)** collapsible.
- **Chat row** · working dot (spinner-like), unread dot, 📌, title (branch icon), dim "5 min · 12 msgs · source",
  **⋮** · open (highlighted), dragging (lifted), archived.
- **Row gestures** · swipe right reveals blue "🗄 Archive" (or Unarchive) · swipe left reveals red "🗑 Delete" (with
  confirm) · long-press and drag to reorder, into Pinned to pin, out to unpin.
- **Row menu** · ✏️ Rename, 📌 Pin to top / Unpin, 🗄 Archive / Unarchive, 🗑 Delete.
- States: "Loading sessions…", "No sessions yet", "Nothing archived. Swipe a chat right to archive it.".

## 13. Hermux hub and its pages

- **Hub** · six cards, each an icon chip + title + live one-line summary + ›: ✦ Skills ("12 enabled of 40"), 🧠 Memory
  ("8 notes · 64% full · 3 about you" + thin meter, red at 90 %), ⏱ Scheduled jobs ("2 active · next 9:00"), 📁 Files,
  🗂 Projects, 🖼 Canvas gallery · "Loading…" / "Couldn’t load".
- **Skills** · title "Skills · 12/40 on", search, **Enabled** filter pill, groups by category, rows (name,
  description, switch) · skill sheet: category · source · used N×, rendered skill text, **Close**, **Use in chat**.
- **Memory** · **Memory | About you** segmented control, usage meter "1,234 / 2,000 characters · 8 entries", entry
  cards (Phone:/Mac: style), footnote about syncing, ＋ · edit sheet: textarea, character count, **Delete**, **Save**.
- **Scheduled jobs** · job cards: name, active/paused tag, monospace schedule, "Next … · Last … (status)", prompt
  preview, buttons ▶ Run now, Pause/Resume, Runs, Edit, Delete · ＋ new-job sheet: Name, Schedule with example pills
  (every 30m, every 2h, 0 9 * * *, weekdays 8:00, tomorrow 9am), "What should Hermux do?", **Schedule** · Runs sheet
  and run output sheet.
- **Files** · root pills Phone, Downloads, Photos, Documents, Hermux, Home; breadcrumbs; ↰ ..; rows with type icon
  (📁 🖼 📄 🎞 📦), name, size and date; ⤒ Upload, ＋ New folder · preview sheet (image, media, table, code, Markdown,
  HTML, text) with **Delete**, **Open with…**, **Open in canvas**, **Ask Hermux**.
- **Projects** · project cards (📁 name, active tag, description, monospace folder) · new-project sheet (Name, Folder,
  Description) · project sheet: its chats, **Remove**, **New chat here**.
- **Canvas gallery** · search, type filter (All / Notes / Web pages / Code …), card grid (type icon, title, snippet,
  "💬 chat · 2 d"), empty "Nothing here yet…" · viewer sheet: info line, **Open canvas**, **Go to chat**, ⋮ (Rename,
  Copy, Share…, Delete), the document.

## 14. Bots

- List of bot cards: avatar letter, name, id, description or "Main profile", model · ＋ New bot.
- **New bot sheet** · Name (lower-case hint, red when invalid), **Start from** pills (Blank or an existing bot),
  "What is it for?", SOUL.md personality textarea, **Cancel**, **Create**.
- **Bot sheet** · description with Save, Profile / Model / Skills, menu: 💬 Chat with <bot>, 🧩 Default model, ✎
  Personality (SOUL.md), 🔑 API keys & settings, Aa Rename, 🗑 Delete bot (type the name to confirm).

## 15. Settings

Main page, in order (Section → rows):
1. **Appearance** · 🎨 Appearance (theme and text size).
2. **Voice** · 🔊 Read every reply aloud (toggle), 🗣 Voice ›.
3. **Hermux** · ✨ Default models, 👤 Model providers, 🔑 API keys, ⚙️ Advanced settings.
4. **Permissions** · ⚡ Auto for all chats (Off / Auto access / Full access).
5. **Replies** · 🧩 Dynamic UI (toggle).
6. **Background apps** · 📱 Allow banking, payment, password and 2FA apps (toggle).
7. **Connection** · 📶 Status (Connected / Connecting… / Offline), ↻ Reconnect / start Hermux, ✓ Setup check.
8. **About** · App version, ⬆️ Check for updates (checking / up to date / update available / downloading N % /
   installing), 📝 What's new, ⚕️ Hermux agent (warning when it differs), Last start-up, Remote debugging.
9. **Danger zone** · 🗑 Uninstall Hermux (red).

Sub-pages:
- **Appearance** · four theme swatch cards (Default, OLED black, Light, System) with mini previews and ✓; text size
  sample sentence + segmented 90 % · 100 % · 110 % · 120 % · 135 %.
- **Voice** · Read aloud toggle; Speech engine and Voice pickers; Speed and Pitch sliders; Dictation → Speech
  recognition; Live mode: Pause before sending slider, Interrupt by talking toggle; Phone assistant: Use Hermux as
  phone assistant, Talk to Hermux on the lock screen; ▶ Test voice, ↺ Reset voice settings.
- **Speech recognition** · Phone’s speech recognition row ("✓ In use"); on-device model cards (name, size, tags
  Recommended / In use / words while you speak / punctuation, 👍 good at, 👎 weaker at, download progress bar,
  test result, buttons Download, Cancel, Use, Test model, Try again, Delete); Your own model: 🤗 Add from Hugging
  Face, 📁 Add files from this phone.
- **Default models** · ✨ Set one model for all bots; one row per bot (model · provider) · model picker sheet like
  the chat's Model sheet, with a cost confirm for expensive models.
- **Model providers** · bot pills "Sign-ins for"; search; Connected · N, Popular, All providers, Your own server
  (＋ Add an OpenAI-compatible endpoint); provider rows with a filled or hollow dot and "API key / Sign in / Set up".
  Provider sheet: Sign in rows (Sign in / Copy command / Sign out), API key (saved key, paste field, Save, Get a key
  ↗), More settings, **Choose a model**. Sign-in sheets: numbered steps with a big copyable code and "Copy code and
  open …", or "Open claude.ai" + paste the code. Endpoint sheet: Name, Address, API key, **Find its models**, Default
  model, **Save**.
- **API keys** · bot pills "Keys for"; search; Only keys that are set (toggle); ＋ Add a custom key; groups by
  category; rows with a dot and the monospace variable name · key sheet: description, Get a key ↗, current redacted
  value, **Show**, replace field, Apply to all bots, **Remove**, **Save**.
- **Advanced settings** · bot pills "Settings for"; "Search 214 settings"; collapsible categories with counts;
  toggle rows and value rows (monospace keys) · option sheet: description, choices with ✓ / JSON textarea / field,
  Apply to all bots, **Cancel**, **Save**.
- **What's new sheet** · per version heading and notes, **Update to <v>**.

## 16. Setup check

- **Hero** · big circle mark ! / … / ✓ + "2 things to fix" / "Checking…" / "All set" + one line.
- **Check rows** · mark (✓ done, ✕ needs fixing, i tip, spinner) + title; rows that need fixing show help text and
  buttons (primary fix, alternative). Re-checks by itself every 4 s.

## 17. Set up Hermux (first-run flow)

Full-screen takeover, also on wide screens.
- **Chrome** · ‹ Back, "Step 3 of 11" + progress bar, ‹ Back / Next › buttons, list of finished steps "✓ …",
  loading "Checking what is already set up…".
- **Steps, in order** (required unless marked): get the helper apps (Termux, Termux:API, Termux:Boot, Shizuku) ·
  start Shizuku · allow Hermux to run commands in Termux · install Hermux (run the installer) · Hermux is
  running · the plugin is installed · the plugin is enabled for the bot · Hermux can see and use the screen
  (Shizuku) · Shizuku starts by itself (wireless pairing) · connect a model · recommended: notifications, run in the
  background (app, Termux, Shizuku), Termux:Boot opened once, files access, Termux:API, the maker's Autostart page.
- **Generic step card** · "✓ Done" when revisiting, title, "Checking…" spinner, help, buttons, "This page moves on by
  itself once it is fixed."
- **Helper apps page** · four app rows: mark (✓ / spinner / ✕), name, status line ("Downloading 42 %", "Tap Install
  on Android’s prompt", "Not installed: tap Retry."), per-row **Install / Retry**, "Or install it yourself" link ·
  **Install all** ("Installing 2 of 4…"), **Allow installing apps**; "Replace Termux?" danger dialog.
- **Start Shizuku page** · sub-steps with marks: Turn on Developer options, Turn on Wireless debugging, Pair and start
  Shizuku · buttons About phone / Developer options / Open Shizuku / "Shizuku is running: continue".
- **Installer page** · before: numbered instructions, **Copy the command**, **Open Termux**, "It takes about 15
  minutes…" · running: "Installing Hermux", latest hint, step list with marks and durations (Termux packages, Access
  to the phone, Android child-process limit, Debian, Hermux agent, Hermux plugin, Starting Hermux), "So far /
  Total", to-do list after install · failed: "The installer stopped" + retry instructions.
- **Connect a model page** · "Connect Hermux to a model", explanation, the provider list (as in Settings), **Pick a
  model** (disabled "Connect a provider first"), **Skip for now**.
- **End page** · ✓ "All set" or … "Almost done" + remaining recommended items with their buttons, **Done**.

## 18. Uninstall Hermux (sheet from Settings → Danger zone)

- **Review** · "Will be removed" list with ✕ marks (Hermux with chats, memory, skills, settings and keys; Debian; the
  installer's files; the phone setting it changed; each helper app), "Kept:" note, Backup section (💾 Save a backup
  to Downloads toggle, 🔑 Include API keys and sign-ins toggle), **Cancel**, solid red **Uninstall…** (type
  "uninstall" to confirm).
- **Running** · big spinner, "Removing the Hermux agent…", **Close**.
- **Failed / lost** · step list with ✓ / – / ✕ / · marks (Stop Hermux, Backup, Phone settings, Debian…, installer
  files, Termux access), error line, **Continue to the apps**, **Try again**.
- **Apps** · rows Termux:API, Termux:Boot, Shizuku, Termux, Hermux with installed / removed marks and
  **Uninstall <app>** buttons (the next one solid red), backup location note, **Close**.

## 19. Outside the page (for context, not redesigned here)

Android notifications (the pinned status chip, a Live Update on Android 16; approval buttons Allow once / Allow
session / Deny; reply to a question), launcher shortcuts (new chat, Live), the share sheet ("Share to Hermux"), and
Hermux as the phone assistant over the lock screen (talking only).
