# What's new

User-facing changes, newest first. Each release section collects what shipped since the previous tag.

## Unreleased

- **Another chat can use the phone again.** After one chat used a phone app, other chats were told "another chat is using it" (or to wait 2 minutes) until the app timed out. Now a chat whose turn is over, or that has been silent for about 2 minutes, lets go and the next chat takes over; a leftover background host holding the port is stopped and restarted instead of failing.
- **The app card goes away when Hermes is done.** If Hermes finished a turn (or was stopped, or failed) without closing the app it was using in the background, the "Using <app>" card with Take over / Stop stayed on screen for a couple of minutes. It now closes the app and removes the card when the turn ends.
- **Chats keep their place in the drawer.** Sending a message, getting a reply or a background run no longer moves a chat to the top. New chats appear on top; the list is ordered (and grouped by day) by when each chat was created. **Sort by recent** now sorts once, by latest activity, instead of switching live re-sorting on.
- **Install step times.** The in-app install view shows how long each step took ("1:42"), the running step counting up live, and the total. Times come from the phone's clock in the installer, so they stay right if you close the app mid-install.
- **Auto button in the header.** One tap sets how much Hermes may do in this chat without asking: Off (asks before
  risky commands), **Auto access** (runs everything without asking, but the commands on Hermes's own dangerous-command
  list are blocked and Hermes tells you what it wanted to run; patterns you already allowed "always" still run), or
  **Full access** (/yolo: nothing is asked; a warning comes first). Hermes's catastrophic list (wiping the disk, shutting
  down) stays blocked in every mode. The setting is per chat and comes back when you reopen the chat. The composer's
  "YOLO" chip is now "Full access".
- **See the app Hermes is using from the status chip.** While Hermes works in an app on the hidden screen, the chip's
  expanded card shows a small picture of that screen, refreshed after each step. The lock screen shows the card without
  the picture.
- **Canvas gallery fixes.** The search box starts empty each time you open the gallery (it kept your last search).
  Copies saved in the old Library without a chat say "Saved copy" instead of "Chat deleted". In a preview without the
  Open canvas / Go to chat buttons, the ⋮ menu sits on the same line as the details instead of alone on its own row.
- **Cards, charts and forms in replies.** Hermes can answer with interactive UI right in the chat (OpenUI): tables,
  charts, metric cards, tabs, steps, buttons and follow-ups you tap to answer, and forms that send your answers back in
  one message. Cards can also show live data: a web search, your chats, or a file on the phone, read when the card
  is drawn (read-only; anything that changes something goes through the chat as usual). Hermes decides when a card
  helps; turn it off in Settings → Replies (new chats). Documents and things you ask Hermes to build still open on
  the canvas.

## v0.8.46 (2026-10-22)

Install changes were tested on wiped Android 15 emulators, not yet on a brand-new real phone.

- **Install only Hermes Mobile, it sets up the rest.** On a phone without Termux, the app downloads and installs Termux,
  Termux:API, Termux:Boot and Shizuku (Android asks you to tap Install for each), helps you start Shizuku, asks for the
  Termux permission, copies the installer command for you to paste in Termux, and shows the install's progress step by
  step; when it's done it goes on to connecting a model. Emulator: about 10 minutes from paste to the model step.
- **Faster installs with a ready-made Debian + Hermes.** When one is published for the app's Hermes version, a new install
  downloads it (about 900 MB, checked by its sha256) instead of building Debian and Hermes on the phone; any problem falls
  back to the normal install by itself. Existing installs never download it. Emulator: 10 minutes instead of about 24. None is published yet, so for
  now every install takes the normal route.
- A busy GitHub no longer breaks the Hermes step of the install (the download is retried instead of running an empty script).
- New installs get exactly the Hermes build the app is tested against (the same one `hermes/patches` are made for) instead of whatever
  Hermes's installer serves that day; an existing Hermes is never reinstalled or changed. Tested on a wiped Android 15 emulator
  (Hermes v0.21.5+4582, browser tools included, dashboard answering).
- The phone-only install lifts Android's child-process limit through Shizuku before the long Hermes install (so Termux isn't stopped
  with "signal 9"), when Shizuku is running and Termux is allowed. Without Shizuku it says what to switch on instead. Fixed: Shizuku looked
  "off" whenever the installer ran from Termux's own terminal (a hang that only happened with a terminal attached).
- The phone-only install now opens Android's installer for the app by itself at the end (download kept as the fallback). Opening it and
  installing the app were checked on the emulator.
- New installs get a working web browser for Hermes: the installer adds the system libraries Chromium needs (it couldn't start
  without them) and tries the browser download once more when Hermes's own installer couldn't fetch it (checked on the
  emulator: Hermes's browser opened a page).
- Installing from a computer no longer tells you to change a developer option the computer already set, and the Shizuku
  to-do says to tap Allow (Shizuku was running, Termux just wasn't allowed yet) instead of "install it".
- First-run setup is one flow that works out what is already set up and picks up at the first missing step: no model, a missing
  plugin, Hermes not running (on a first run), then the recommended items (notifications, battery, Termux:API, Shizuku, files) once
  as "Almost done". A phone where everything already works (installed from a computer) goes straight to the chat. It re-checks
  when you come back to the app, and moves on by itself when a step turns ✓. A set-up phone (the test phone, installed from a
  computer) opens straight to the chat.
- On Xiaomi, Redmi and POCO phones, Setup check (and the flow) reminds you to turn on Autostart for Termux and Hermes Mobile, with
  buttons to each app's settings (Android can't say whether it is on, so it is a tip, never a ✓ or ✗).
- **Canvas gallery** (Hermes hub, replaces the Library): every canvas document from every chat and profile shows up on its
  own, nothing to save. Chips group them by type (HTML, Markdown, Code, …) and a search box finds one by its title or
  text. Tap one to preview it (web pages run, offline), then **Open canvas** to continue it on its own chat's canvas, or
  **Go to chat**. Rename, copy, share or delete from its ⋮ menu. Items saved to the old Library are still listed.
- **Hermes can use an app in the background** (new `phone_app` tool): it opens the app on a hidden screen and reads,
  taps and types in it while you keep using your phone (Android 14+, needs Shizuku). It asks once per app per chat
  (`/yolo` skips that). The status chip says **Using <app>** with the current step; the chat shows a card above the
  message box with a live thumbnail; tap it for a bigger live view with **Take over** (moves the app to your screen) and
  **Stop**. Banking, payment, password and 2FA apps are refused unless you allow them in Settings → Background apps.
  Tested on one phone (Android 16) and an Android 15 emulator; other phone makers not yet.
- If Android or a cleaner app force-stops Hermes Mobile, Termux now brings its notification service back on stock Android too.

## v0.8.41 (2026-10-20)

- Rooted phones can run Debian with chroot-distro instead of proot-distro (`HM_DISTRO=chroot`, see the README's "Rooted or not"). The
  installer sets it up and a new Termux helper, `~/bin/hermes-debian`, runs commands in whichever Debian is installed. Tested on a
  rooted Android 15 emulator (install, dashboard, app connection, a question with its buttons on the chip); not yet on a real
  rooted phone. The app's Restart, Claude sign-in and open-file buttons use the helper too.
- Hermes's work in the background is always shown for what it is: the memory-and-skills review after a reply shows as
  "Learning" (with its steps) and clears when it ends, however late it starts (in a chat with a photo it showed as
  "Thinking…" for about 3 minutes), and a /btw side question shows as "Answering a side question" without touching
  the status of a reply that is still running.

## v0.8.40 (2026-10-20)

- **Approval buttons are always reachable**: a very long warning no longer pushes Allow/Deny off the screen (the text
  scrolls, the buttons stay), and a security warning Hermes repeats many times shows once with a count (×20; not yet
  seen on a real phone).
- Leaving the app with an approval or a question still unanswered puts its buttons on the status chip (before, the chip
  only had them when the request arrived while the app was closed).

## v0.8.39 (2026-10-16)

Everything since v0.8.9.

### Notifications and the status chip
- **Tap the status chip to see the progress**: the chat's name, what Hermes is doing right now, the task it is on,
  "2 of 5 tasks" with a bar of one segment per task (when Hermes keeps a task list; otherwise the number of steps),
  how long the turn has been running, and any other chat that is busy. A **Stop** button ends the turn.
- The Done chip shows the start of the reply, the number of steps and how long it took.
- A sticky green **Done** chip lists the chats that finished while the app was closed ("✅ 3 chats finished", one tap to clear).
  It goes away by itself once you open the app on that chat.
- **App-icon badge** with the number of unseen chats (works on Xiaomi/HyperOS launchers).
- **Read-aloud player** in the notification shade: pause, back 10 s, forward 10 s, stop; media keys work too.
  The reply being read keeps playing when you leave the app.
- Approvals answered from a notification apply only to the request they show.

### Chat
- **Library**: keep canvas documents in categories; Hermes can save into it on request.
- **Photo viewer**: pinch and double-tap zoom, save to Pictures/Hermes, share, open with another app.
- **Edit and Retry keep your photos and files**: they are sent again with the edited message.
- **Links work everywhere**: in your messages, tool cards, thinking, sheets and the canvas; they open in your default app.
- **Favourite models**: star a model in the model picker and it shows in a Favourites section at the top.
- **/yolo** and **/fast** switch instantly for the current chat (YOLO chip above the composer).
- A photo attached in a new chat before Hermes restarted is no longer lost: the chat is made again with the same
  model and the photo, instead of the message failing with "session not found".
- Photos and files you attached survive a dropped connection, and go along with a message queued while offline.
- **File checkpoints**: see every folder a chat changed, the diff per file, and restore a folder or a single file (undoable).
- Canvas: "Saved ✓" turns back into "<when> · You/Hermes".

### Voice / Live mode
- Approvals in Live mode are a short spoken question ("Hermes needs your permission. Allow or deny?"), answered by voice (tested in the browser, not yet with a voice on a phone).
- Leaving the app closes the microphone but lets Hermes finish reading.

### Models and setup
- **Subscription sign-ins** and a first-run "connect a model" screen.
- The model picker renews an expired Claude login so new models show up (not yet seen with a really expired login).
- **One-tap app update** from Settings → About (downloads the latest release and opens the installer). It shows the latest release's number and says so when you already have a newer build.
- **Hermes can use the phone** out of the box (files, Termux:API, Shizuku, no root), with a Setup check that fixes what's missing.

### Faster and lighter
- **Faster start-up**: opening the app after the phone has been idle no longer waits seconds for the chat (a Hermes fix
  shipped with the app: skill scans 1.8 s → 0.5 s; the app asks for less at start-up).
- Coming back to the app no longer drops the connection or repeats the last turn.
- The "reviewing" banner after a reply shows right away (it could lag up to 3 s).
- Battery: no permanent wake lock, far fewer background polls; the phone reaches deep sleep.
- Fixes to Hermes itself ship with the app (e.g. a message lost after switching models).
