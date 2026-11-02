# Prompts for UI redesign concepts (ChatGPT image generation)

Ready-to-paste prompts for generating redesign concepts of Hermes Mobile with ChatGPT's image generation, for the
planned UI revamp ([status](../status/ui-revamp.md)). Each screen prompt lists every element that screen has today
(from [ui-inventory.md](ui-inventory.md)), so a concept doesn't silently drop a feature. The pictures are ideas to
choose from, not a spec: whatever is picked still gets built with the app's own components and CSS variables.

## How to use them

1. Open a new ChatGPT chat with image generation. Paste the **master prompt** first. Pick the concept you like (ask
   for more variants until one fits).
2. In the **same chat**, paste the screen prompts one at a time. Each starts with "Same visual style as the chosen
   concept", so the screens stay one family. If you start a new chat, paste the master prompt's "Style" paragraph in
   front of the screen prompt.
3. Ask for one or two phone screens per image. More than that and the small text turns to gibberish.

Ways to iterate (paste as a follow-up):

- "Give me 3 variants of this screen with different layouts, same style and colours."
- "Keep everything, but make it the Light theme." / "…the OLED black theme."
- "Same screen, but in the state where <a reply is running / Hermes is offline / the list is empty>."
- "Keep the layout; make the controls bigger and move <X> within thumb reach at the bottom."
- "Zoom in on <the composer / one tool card> as a close-up component sheet."
- "Show this on a tablet in landscape: chat list on the left, chat in the middle, canvas on the right."
- "Fix the text: every label must be readable English exactly as listed." (when the image garbles words)
- "List every element you dropped or merged compared to my list." (then ask it to add them back)

---

## Master prompt: the whole app

```text
Design a cohesive, modern redesign concept for "Hermes Mobile", an Android app. Show it as 4 portrait phone screens
side by side (9:19.5 aspect each) on a neutral background, realistic UI with readable English labels, no device
frames needed. Screens: (1) the chat with a running reply, (2) the chat list drawer, (3) a bottom sheet asking the user
to approve a command, (4) Settings.

What the app is: a chat front end for Hermes, an open-source AI agent that runs on the phone itself. Hermes can run
commands, edit files, browse, drive phone apps, schedule jobs and remember things. The app shows streaming replies
with visible "thinking", compact tool-call cards (terminal, file edit, web search…), approvals for risky actions,
many chats and several "bots" (profiles), a canvas for documents beside the chat, interactive cards inside replies,
read-aloud and a hands-free Live voice mode.

Style: calm, focused, a tool for a power user that still feels friendly. Dark theme first (near-black blue-grey
background, slightly lighter surfaces, thin borders), one warm gold accent used sparingly for the main action and
selected states, green / amber / red only for status. Rounded corners (about 14 px), bottom sheets with a grip bar,
small coloured icon chips in rows, system sans-serif type with monospace for code, paths and commands. Brand mark: a
caduceus ☤. No gradients-for-decoration, no glassmorphism clutter, no stock illustrations.

Constraints the design must respect:
- Phone first and one-handed: main actions at the bottom within thumb reach, status and navigation at the top,
  bottom sheets instead of centred dialogs, touch targets at least 44 px.
- Everything is custom-drawn (no native Android pickers or system dialogs) and must work in a Light theme and an
  OLED-black theme too, so use a small, consistent colour set.
- Information-dense content must stay readable at 360 px width: code blocks, diffs, tables, tool-call logs, long
  agent runs.
- Gestures: swipe right opens the chat list, swipe left opens the canvas, pull up at the end of the chat opens a
  "By the way" side question, swipe chat rows to archive or delete.

Chat screen elements: top bar with ☰ menu (unread dot), chat title, small coloured status dot, bot name under the
title, a canvas button, ⋮ menu. Messages: user bubbles on
the right; assistant replies full width with a collapsible "Thinking…" line, rich Markdown, a folded line "Ran 6
tools · 42s" with tool icons, a "3 files changed +40 −12" card, and actions Copy, Read aloud, Retry, Branch plus dim
stats "~41 tok/s · ctx 2%". Above the composer a status strip "Working… 0:42 · Tasks 2/5". Composer: a model chip
"Claude Sonnet · med", an "Auto" chip beside it (how much Hermes may do without asking) and a small context ring, then ＋, /, the text box "Queue or steer a follow-up…", and Steer +
Queue buttons (Stop when the box is empty).

Give it a distinctive but restrained identity. Then describe in 5 bullet points the design system you used (colours,
type scale, corner radius, spacing, icon style) so I can reuse it for the other screens.
```

---

## 1. Chat screen

```text
Same visual style as the chosen concept. One portrait phone screen (plus a second one for the empty state): the chat
screen of Hermes Mobile, an Android app for an AI agent that runs on the phone. Dark theme, readable English labels.

Screen A, a chat in progress, top to bottom:
- Top bar: ☰ (with a small unread dot), title "Fix the backup script" with a small branch icon, a green status dot,
  dim bot name "Hermes Agent" under the title, a 🔊 badge (this chat is read aloud), a canvas button with a dot (the chat has documents), ⋮.
- A thin gold divider "New since your last visit".
- User message bubble on the right with a quoted line above the text, a photo thumbnail and a 📎 file chip; small
  Copy and Edit icons under it; the send time shown.
- Assistant reply, full width: a collapsed "Thought process" line with a brain icon and chevron; Markdown text with
  a heading, a list, an inline code span, a code block with a header (language label, Wrap, Preview, Canvas, Copy,
  "Show all 48 lines"), a small table with sortable headers and "Copy table", a checklist with "2/3 done" bar;
  a "⚠" warning line; actions Copy, Read aloud, Retry, Branch; dim stats "~41 tok/s · 1m 23s · ctx 2% · 8k/200k".
- A folded tool run line: four tiny tool icons, "Ran 6 tools · 42s · 1 failed" (the failed part in red), chevron.
- One expanded tool card: ⌘ terminal icon, "terminal", the command "pytest -q", duration ✓, then Arguments, Output
  with "exit 0" and Copy. Another tool card collapsed with a red outline (risky command) and one with a spinner
  (running).
- A sub-agent card "⇶ Sub-agent · running" with goal and latest detail.
- A changed-files card "✎ 3 files changed +40 −12" with chevron.
- An info notice box and a red error notice "Send failed: …".
- Two queued follow-ups as dashed bubbles "Queued · 1 of 2" with Send now, Edit, Remove; "Queue paused · Resume".
- A thin scrubber rail on the right edge with ticks per user message and a gold thumb, a bubble "12 / 30 …".
- A round floating "↓" button to jump to the newest message.
- Strips above the composer: "Other chat: running tests (+1 more)" activity banner with spinner; status bar
  "Working… 0:42 · ~38 tok/s · ctx 62%", "🎯 Ship v2 · turn 3 of 20 · active", "☑ Tasks 2/5"; a compress hint
  "Context 84% full. Compress older turns so Hermes keeps up?" with Compress and ✕.
- A small read-aloud player: pause, −5 s, +5 s, slider, "0:12 / ~1:40", "1×", ✕.
- A background-app card: tiny live thumbnail, "Using Chrome", "Searching flights…", ›.
- Composer at the bottom (detailed in another prompt; keep it compact here).

Screen B, the empty new chat: ☤ logo, "Hermes", "Your agent, on your phone.", four suggestion buttons
("What's on my calendar today?", "Summarise my unread email", "/research · deep research skill", "What files are in my
Downloads?"), the composer with the model chip, and the top bar titled "Hermes".

Also show, as small callouts at the side: the connection banner state ("Hermes is offline · 24s · Check setup ·
Restart Hermes") and the find-in-chat bar ("Search in this chat", "3 / 12", ↑ ↓ ✕).
```

## 2. Composer

```text
Same visual style as the chosen concept. A component sheet (not a full screen): the message composer at the bottom
of Hermes Mobile's chat, shown in 6 stacked states, each full phone width, dark theme, readable labels. It must be
reachable with one thumb.

Every state has these parts, top to bottom (show only the ones that apply):
- Offline outbox chip: "⏳ Sends when Hermes is back: check the logs…" with ✕ "Don't send".
- Selection bar when text in a reply is selected: "Selected text", Quote, Explain.
- Slash-command list opening above the box while typing "/re": rows "/research" with a "skill" tag and a
  description, "/retry", "/reload".
- Quote chips "❝ the first words of the quote…" with ✕ (up to three).
- Attachments row: two photo thumbnails with ✕, a "📎 report.pdf" chip with ✕, an "Attaching…" chip with a spinner,
  a small "clear" button.
- Model row: a chip with a sparkle icon "Claude Sonnet 4 · med" (opens the model picker), an "Auto" chip
  in green ("Auto access"; red "⚡ Full access" in that mode), a small context ring (gold, amber at 80 %, red at 90 %).
- Input row: "＋" (Add), "/" (commands), the growing text box, and the right-hand button(s).

States:
1. Idle and empty: placeholder "Message Hermes"; right side shows a gold "Live conversation" waveform button and a
   microphone "Dictate" button.
2. Typing: text in the box, attachments row and a quote chip visible, right side a gold "Send" paper-plane button.
3. Reply running, empty box: placeholder "Queue or steer a follow-up…", right side a "Stop" square button.
4. Reply running with text typed: a "Steer" pill ("send into the running task now") and a round "Queue" button
   (arrow with a small clock badge, "send after the reply ends").
5. Dictating: live recognised words shown in the box, a "Stop dictation" button.
6. Offline: placeholder "Offline: type now, it sends when Hermes is back", Send labelled for later, outbox chip shown.

Next to it, the "Add" picker as a bottom sheet: model row "Model · medium reasoning: tap to change", 📷 Camera "Take
a picture now", 🖼 Photo "From your gallery", 📎 File "PDF, document, spreadsheet, text, code… (up to 20 MB)", Stash
draft "Put this text aside and clear the box", Stashed drafts (2).
```

## 3. Drawer and chat list

```text
Same visual style as the chosen concept. Two portrait phone screens of Hermes Mobile's chat list drawer, which slides
in from the left over the dimmed chat (and docks as a 320 px column on tablets). Dark theme, readable labels.

Screen A, the drawer:
- Head: a profile switch with an avatar letter "H", bot name "Hermes", dim "Main profile", ▾.
- A full-width gold "＋ New chat" button.
- Three tiles: ☤ Hermes, 🤖 Bots, ⚙ Settings.
- A search field "Search sessions…".
- 📌 Pinned group with two chats.
- Date groups Today, Yesterday, This week, Older.
- Chat rows: title (one with a small branch icon), dim line "5 min · 12 msgs", a ⋮ button on each row. One row is
  the open chat (highlighted); one has a pulsing "working" dot; one has an unread dot; one is pinned (📌).
- One row mid-swipe to the right revealing a blue "🗄 Archive" strip; another mid-swipe to the left revealing a red
  "🗑 Delete" strip.
- At the bottom: "Show older chats" and a collapsible "🗄 Archived (14)".

Screen B, the same drawer with: the profile list open (rows "c coder · gpt-5", "t tutor · claude", "＋ New bot /
manage bots…"), the search "backup" typed with an "In messages" group of results with highlighted words, and a row
being long-press dragged into the Pinned group (lifted with a shadow, a gap opening, "Drop here to pin").

Also show the row's ⋮ menu as a small bottom sheet: ✏️ Rename, 📌 Pin to top, 🗄 Archive, 🗑 Delete (red).
```

## 4. Approvals and questions

```text
Same visual style as the chosen concept. Four portrait phone screens of Hermes Mobile, each with a bottom sheet over
the dimmed chat. These sheets cannot be swiped away: the user must answer. Dark theme, readable labels, big
thumb-friendly buttons.

1. Approval: title "⚠ Approve terminal command?", a short description "Deletes build artefacts in ~/project", a
   monospace command block "rm -rf ~/project/build", then stacked full-width buttons: "Allow once" (gold, primary),
   "Allow this session", "Always allow", "Deny" (red). Make Deny easy to hit but clearly separate.
2. Question with choices: "❓ Hermes asks", the question "Which folder should I back up?", single-choice options
   with radio marks (one selected in gold), a box "Or type your own answer…", buttons Skip and Answer.
3. Several questions: "Question 2 of 4", a row of four dots (answered, current with a gold ring, empty, empty),
   multi-choice options with check marks, buttons Skip, Back, Next.
4. Password: "🔐 Password needed", the prompt "sudo needs your password to continue", a masked field, buttons Cancel
   and Send. Also a small variant for a one-time code: "🔢 Code needed" with a numeric field.

Next to them, show how the same approval looks as an Android notification with buttons Allow once, Allow session,
Deny.
```

## 5. Canvas

```text
Same visual style as the chosen concept. Hermes Mobile's canvas: documents, notes, web pages and code that Hermes or
the user writes beside a chat. Show three frames, dark theme, readable labels:

Frame 1, phone, the canvas slid over the chat:
- Header: a sideways-scrolling row of tabs with type icons and titles ("📝 Trip plan" active, "🌐 Budget page",
  "💻 backup.py"), a "＋" new-document button, "✕" close.
- Toolbar: a segmented "View | Edit", save state "Saved ✓" (or "2 min · Hermes"), "⛶" full screen, "⋮" menu.
  For a web page the segmented control reads "Run | Edit" and there is a "🚫 Offline / 🌐 Online" toggle.
- A banner "Hermes is rewriting this document… 12s" with a spinner.
- The rendered Markdown document.
- A selection bar for selected text: "Ask Hermes about the selection" with chips Rewrite, Shorter, Longer, Fix,
  Explain, Other….
- At the bottom an ask bar: "Ask Hermes to change “Trip plan”…" with a send button.

Frame 2, phone, Edit mode: Undo and Redo, then formatting buttons B, I, H, •, ☑, “, </>, 🔗, and a text editor;
plus a conflict banner "Hermes changed this document while you were editing." with "Use Hermes’s" and "Keep mine".

Frame 3, tablet landscape: chat on the left, the canvas as a right-hand column with a draggable divider in between
(with a grip), a hint "Full screen" when dragged far right.

Small extras at the side: the empty canvas ("🗒 Your canvas is empty — Ask Hermes to write something here, or start
your own." + "New document"); the "New document" sheet (📝 Notes / document, 🌐 Web page, 💻 Code, 📄 Plain text); the ⋮
document menu (✏️ Rename, 🕘 Version history, ⧉ Copy, ↗ Share…, ⬇ Save a copy to Downloads, 💾 Save to the original
file, 📂 Open a file from the phone…, 🗑 Close this document); the version history list with "Hermes" / "You" badges
and "Restore this version".
```

## 6. Settings

```text
Same visual style as the chosen concept. Three portrait phone screens of Hermes Mobile's Settings. Grouped sections
of rows; each row has a small coloured icon chip (emoji on a tinted rounded square), a title, a dim sub-line, an
optional value on the right and a chevron, or a toggle. Dark theme, readable labels.

Screen A, the main page (top bar "‹ Settings"), sections in this order:
- Appearance: 🎨 Appearance "Theme and text size" — value "Default".
- Voice: 🔊 Read every reply aloud (toggle) "In all chats"; 🗣 Voice "Engine, voice, speed and pitch".
- Hermes: ✨ Default models; 👤 Model providers "Sign-ins, API keys, your own server"; 🔑 API keys "Providers and
  tools"; ⚙️ Advanced settings "Every Hermes option".
- Permissions: ⚡ Auto for all chats — value "Auto access", with a footer note.
- Replies: 🧩 Dynamic UI (toggle) "Tables, charts and forms you can tap".
- Background apps: 📱 Allow banking, payment, password and 2FA apps (toggle).
- Connection: 📶 Status — "Connected"; ↻ Reconnect / start Hermes; ✓ Setup check.
- About: App version; ⬆️ Check for updates (state "A newer version is ready"); 📝 What's new; ⚕️ Hermes version;
  Last start-up.
- Danger zone: 🗑 Uninstall Hermes (red).

Screen B, Appearance and Voice sub-pages stacked: four theme swatch cards (Default, OLED black, Light, System —
System split diagonally black/white) with a ✓ on the selected one; text size sample sentence with a segmented control
90% · 100% · 110% · 120% · 135%. Then Voice: Speech engine and Voice pickers, Speed slider "1.00×", Pitch slider,
Speech recognition row, Live mode section with "Pause before sending" slider "2.0 s" and "Interrupt by talking"
toggle, Phone assistant section, ▶ Test voice, ↺ Reset voice settings.

Screen C, Model providers: bot pills "Sign-ins for: Hermes · coder · tutor", a search field, sections "Connected · 2",
"Popular", "All providers · 40", "Your own server" (＋ Add an OpenAI-compatible endpoint); provider rows with a filled
or hollow dot and a right value "API key" / "Sign in". Beside it a provider bottom sheet: Sign in row with a "Sign in"
button, API key section (saved key, paste field, Save, "Get a key ↗"), "More settings", and a gold "Choose a model"
button at the bottom.

All pickers are the app's own bottom sheets (never native Android pickers), toggles are custom pill switches.
```

## 7. Setup flow

```text
Same visual style as the chosen concept. Four portrait phone screens of "Set up Hermes", the first-run flow that
installs and connects everything. It must feel reassuring and clear for a non-expert, with one obvious next action
per screen. Dark theme, readable labels.

Common chrome on every step: "‹" back in the top bar, "Step 3 of 11" with a progress bar, "‹ Back" and "Next ›" at
the bottom, a compact list of finished steps ("✓ Helper apps installed").

1. "Get the helper apps": four rows Termux, Termux:API, Termux:Boot, Shizuku, each with a mark (✓ installed, spinner
   downloading "Downloading 42 %", ✕ "Not installed: tap Retry"), a short line about what it is, an Install/Retry
   button and a small "Or install it yourself: F-Droid page" link; a big "Install all" button ("Installing 2 of 4…")
   and "Allow installing apps".
2. "Start Shizuku": three sub-steps with marks — Turn on Developer options, Turn on Wireless debugging, Pair and
   start Shizuku — with buttons "About phone", "Developer options", "Open Shizuku" and "Shizuku is running:
   continue".
3. "Installing Hermes" (running): a bold hint "Keep Termux open and the screen on", a step list with marks and
   durations (Termux packages ✓ 1m, Access to the phone ✓, Android child-process limit ✓, Debian ✓ 4m, Hermes Agent ●
   running "most of the wait", Hermes Mobile plugin ·, Starting Hermes ·), "So far 7m · Total about 15m", an "Open
   Termux" button. Also show the "before" variant small: numbered instructions with "Copy the command" and "Open
   Termux".
4. "Connect Hermes to a model": explanation "Hermes runs on this phone, but it thinks with a model in the cloud",
   the provider list (Connected, Popular: Anthropic, OpenAI, Gemini, OpenRouter…), a gold "Pick a model" button
   (disabled "Connect a provider first" until one is set) and "Skip for now".

Beside them, the end page ("✓ All set" / "… Almost done" with remaining recommended items: Notifications, Run in the
background, Termux:Boot, Files access, Autostart, each with its button, and "Done") and the "Setup check" page (hero
"2 things to fix" with a big mark, rows with ✓ / ✕ / i marks, help text and fix buttons).
```

## 8. Live mode

```text
Same visual style as the chosen concept. Three portrait phone screens of Hermes Mobile's Live mode: a hands-free voice
conversation with the agent, used while walking or driving, so it must be glanceable and operable with one thumb.
Today Live mode is a bar that replaces the composer at the bottom of the chat; the chat stays visible above it.
Dark theme, readable labels.

Bar contents: a pulsing dot whose colour shows the phase, a phase line, a hint line, and controls.
1. Listening: green dot, "Live · Listening…", hint shows the words being recognised ("remind me to call the…"),
   controls: a microphone mute toggle and a red "End" button.
2. Thinking: gold dot, "Live · Hermes is thinking…", hint "Pause for 2 seconds to send", the latest tool card
   running in the chat above.
3. Speaking: blue dot, "Live · Hermes is speaking…", hint "Talk or tap Interrupt to cut in", an outlined gold
   "Interrupt" button, mic toggle, "End". Also show the muted variant: "Live · Mic muted", mic button red with a
   slash, hint "Replies are still read aloud".

Also show a fourth small frame: an approval arriving during Live mode (the approval sheet, with the hint that the
user can say "allow" or "deny"). Feel free to propose a richer full-screen Live view as an alternative (large
waveform, big round controls), but keep every control listed above.
```

## 9. By the way sheet

```text
Same visual style as the chosen concept. Two portrait phone screens of Hermes Mobile's "By the way" sheet: a quick
side question about the current chat that doesn't interrupt the running task. Dark theme, readable labels.

1. The gesture: the end of the chat being pulled up, with a pill "Release for a side question" fading in and turning
   gold when pulled far enough (160 px), the list stretching slightly.
2. The open sheet (about 70 % of the screen) over the dimmed chat: a grip bar, title "By the way", a dim hint "Ask
   about this chat without interrupting it. Hermes sees the conversation so far.", a short thread of question
   bubbles on the right and Markdown answers below them (one answer still loading with a spinner, one error in red
   "No answer came back."), and at the bottom an input "Ask a quick question…" with a gold send button. Behind the
   sheet the main chat keeps running (a status strip "Working… 1:12" visible at the top edge).
```

## 10. Hermes hub and its pages (optional)

```text
Same visual style as the chosen concept. Three portrait phone screens of Hermes Mobile's hub, where the agent's own
data lives. Dark theme, readable labels.

1. The hub ("‹ Hermes"): six cards with a coloured icon chip, a title, a live one-line summary and a chevron:
   ✦ Skills "12 enabled of 40"; 🧠 Memory "8 notes · 64% full · 3 about you" with a thin meter; ⏱ Scheduled jobs
   "2 active · next 9:00"; 📁 Files "Browse, open and upload on the phone"; 🗂 Projects "3 projects"; 🖼 Canvas gallery
   "14 documents · 3 categories".
2. Scheduled jobs: job cards with a name, an "active" or "paused" tag, a monospace schedule "0 9 * * *", "Next: 9:00
   · Last: 8:00 (ok)", a prompt preview, and buttons ▶ Run now, Pause, Runs, Edit, Delete; a ＋ in the top bar.
3. Files: root pills Phone, Downloads, Photos, Documents, Hermes, Home; breadcrumbs; rows with type icons (📁 🖼 📄 🎞
   📦), names, sizes and dates; ⤒ Upload and ＋ New folder; plus a preview sheet with Delete, Open with…, Open in
   canvas and a gold Ask Hermes.

Optional fourth: the Canvas gallery as a grid of cards (type icon, title, snippet, "💬 Trip chat · 2 d") with a
search field and type filter pills.
```
