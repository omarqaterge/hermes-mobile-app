# What's new

User-facing changes, newest first. Each release section collects what shipped since the previous tag.

## Unreleased

- **The status sheet shows whether Shizuku is running and Hermes can use it.** Tap the dot under the chat title: a Shizuku row says Running, Not running, Not installed or what to fix, and tapping it opens Shizuku or the Setup check. (Browser-tested; not yet tried on a real phone.)
- **Setup check has a step to let Shizuku run in the background, and the computer install sets it for you.** Without it Android can stop Shizuku and Hermes loses the screen. The phone installer also does it through Shizuku. (Web-tested and shell-script syntax-checked; not yet tried on a real phone.)
- **Shizuku is now a required setup step (no more Skip).** The step says Hermes needs it; a "Shizuku is running: continue" button is only for a Shizuku that was started before the app opened, and Setup check still verifies it afterwards. On Android 10 and older the step explains how to start Shizuku from a computer and links Shizuku's guide. (Web-tested; not yet tried on a real phone.)
- Hermes Mobile tells you when Shizuku stops, and the notice goes away once Shizuku runs again (not yet tried on a real phone).
- **Pull up past the last message to open a side question (/btw) about the chat.** The list stretches like a rubber band; about 110 px of pull shows “Release for a side question”. A lighter pull springs back. (Browser-tested; not yet tried on a real phone.)
- **The canvas opens as a panel from the right:** tap the canvas button or swipe left on the chat; swipe right on its top bar, tap ✕ or press Back to close it. Fill-the-screen stays; wide screens keep it beside the chat. (Browser-tested; not yet tried on a real phone.)

## v0.8.57 (2026-10-24)

Tested on one phone (Android 16) and Android 15 emulators; not yet on other phone makers. The installer fix for an interrupted install was not re-run on an emulator.

- **Choose the default Auto mode for all chats.** Settings → Permissions → Auto for all chats: Off, Auto access or Full access (Full asks for confirmation first). Every chat without its own choice starts in it; a chat you set with its Auto button, including Off, keeps your choice. (Browser-tested; not yet tried on a real phone.)
- **No more Termux error popups during setup.** Before the installer had run, every return to the app made Termux show "RunCommandService requires allow-external-apps". The app no longer sends Termux anything until Termux has accepted a command once (installer finished, or Hermes answering). Reinstalled the app on a phone that already has Hermes? **Hermes already installed? Check** on the installer step finds it and setup moves on.
- **Running the installer again after it was interrupted works.** (Not re-run on an emulator.) If Termux was killed or the phone restarted while Hermes was being installed, the next run stopped at once ("exists and is not a Hermes git checkout"). The installer now moves the half-installed folder aside and installs fresh.
## v0.8.56 (2026-10-24)

Tested on one phone (Android 16) and Android 15 emulators; not yet on other phone makers.

- **Setup check no longer flashes "Hermes can't reach Termux:API".** A Termux:API app that was asleep missed the first check and the row turned red for one round; the check now tries twice.
- **Read-aloud says "card shown in the app" for a card.** When a reply with a card was read aloud while the app was closed, the voice said "card" in brackets (or "code omitted"); it now says the card is shown in the app, like the in-app player. (Not yet heard on a real phone.)
- **Tapping the Done chip always clears it.** If the chat it named had been deleted, or there were several, the chip stayed after you tapped it. Now a tap opens the app and clears the whole chip.
- **Reading-aloud card shows real progress.** The player in the notification shade, lock screen and the status island used to sit at 0:00. It now shows the position and an estimated length, moves while the app is closed, and its bar can be dragged to seek. (Tested on an Android 15 emulator; not yet seen on a real phone.)
- **5-second back and forward** replace previous/next on that card, and the in-app player has the same two buttons, a flash of -5 s / +5 s when you press, and a time label (0:12 / ~1:40). The jump is 5 seconds of speech at the reading speed measured so far, so the total is an estimate (marked ~).
- **The Autostart step looks for the right page.** It used to open each app's App info, which on newer phones (e.g. Xiaomi HyperOS) has no Autostart switch. It now tries the phone maker's own Autostart list where the phone has one (several makers' pages are known, App info with where-to-look text otherwise), says what you'll see there, has a **Done** button that is remembered, and no longer shows on phones without such a switch (Pixel and other stock Android, Samsung).
- **Install all no longer gets stuck after the first app.** If you left the app while Android installed one helper app, the next app's Install prompt was blocked and setup waited forever. Coming back to Hermes Mobile now opens that prompt, an app that did get installed is ticked, and an app whose prompt was closed or that didn't install gets a Retry button, with the next app named below the list. (Tested on an Android 15 emulator; not yet seen on a real phone.)
- **Uninstall Hermes.** Settings → Danger zone → Uninstall Hermes removes Hermes with its chats and data, Debian, the installer's files and its phone setting, then walks you through removing Termux:API, Termux:Boot, Shizuku, Termux and Hermes Mobile (Android asks for each; removing Termux closes the app, and opened again it continues where it was). It offers a backup to Downloads first (keys and sign-ins left out unless you turn them on). README → Uninstall has the same steps by hand. (Tested end to end on an Android 15 emulator; on a real phone only the screen was opened, nothing was removed.)
- **Claude signs in inside the app, and the app shows it worked.** Settings → Model providers → Anthropic (and the first-run model step) now sign in to Claude Pro / Max in the app: open claude.ai, approve, paste the code back. Termux is still there as **Use Termux instead**. A Claude login made with `hermes auth add anthropic` (Termux) used to stay "not signed in" in the app; it now shows as signed in, and coming back from Termux says whether it worked. (The sign-in page, a wrong code and Cancel were tested on a real phone; a full new sign-in has not been done yet.)
- **Every model provider Hermes supports.** The model step of setup and Settings → **Model providers** list all of them (read from Hermes itself, so new ones appear by themselves): Anthropic, OpenAI, Google Gemini, OpenRouter, xAI, DeepSeek, Mistral and Groq first, then the rest A–Z, with search. Each one shows whether it is connected and offers **Paste API key** and/or **Sign in** (ChatGPT, Grok, Nous, MiniMax in the app; Claude Pro / Max in the app), then a model picker with only that provider's models. Mistral, Groq, Ollama and your own OpenAI-compatible server are added by address.

## v0.8.52 (2026-10-23)

Tested on one phone (Android 16) and Android 15 emulators; not yet on other phone makers.

- **Another chat can use the phone again.** After one chat used a phone app, other chats were told "another chat is using it" (or to wait 2 minutes) until the app timed out. Now a chat whose turn is over, or that has been silent for about 2 minutes, lets go and the next chat takes over; a leftover background host holding the port is stopped and restarted instead of failing.
- **The app card goes away when Hermes is done.** If Hermes finished a turn (or was stopped, or failed) without closing the app it was using in the background, the "Using <app>" card with Take over / Stop stayed on screen for a couple of minutes. It now closes the app and removes the card when the turn ends.
- **Chats keep their place in the drawer.** Sending a message, getting a reply or a background run no longer moves a chat to the top. New chats appear on top; the list is ordered (and grouped by day) by when each chat was created. **Sort by recent** now sorts once, by latest activity, instead of switching live re-sorting on.
- **Install step times.** The in-app install view shows how long each step took ("1:42"), the running step counting up live, and the total. Times come from the phone's clock in the installer, so they stay right if you close the app mid-install.
- **Setup explains itself.** The Wireless debugging step now says why it is needed (Shizuku starts itself through it, no computer or root). Each helper app in setup has a link to its official page (F-Droid or Shizuku's GitHub releases) if you prefer to install it yourself, with a note that the Termux apps must all come from F-Droid.
- **Setup notices when Shizuku is running.** On the Start Shizuku step a green “Shizuku is running” check appears by itself and the setup moves on; the Continue button stays for phones where it can't tell.
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
  the canvas. Reopening a chat with a live card uses the data it already fetched, and its Refresh button always fetches
  again.

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
