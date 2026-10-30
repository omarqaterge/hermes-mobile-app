# What's new

User-facing changes, newest first. Each release section collects what shipped since the previous tag.

## Unreleased

- **Test builds with remote debugging.** `HM_DEVTOOLS=1 android/build.sh` makes a test build whose page can be inspected and driven from a computer over `adb`; it shows a "Test build: remote debugging is on" strip at all times. Normal and release builds are unchanged, and the build script and the release workflow both refuse or fail if a release would carry it. Browser tests and the build guard test only; the real WebView socket not yet tried on a phone.
- **More previews in Files.** Tapping a file in Files now shows CSV/TSV as a table, JSON pretty-printed, code
  highlighted, Mermaid files as diagrams, HTML pages running offline in the sandbox, and audio/video in a player
  (streamed, not read into the page). PDF, Office and other files say "No preview here" and keep Open with….
  Browser tests only; not yet on a real phone.
- **Stash a draft.** In the Add menu, "Stash draft" puts the text you are writing aside and empties the box;
  "Stashed drafts" lists what you put aside (from any chat) and tapping one puts it back, swapping with what is in the
  box. "Clear all stashed drafts" removes them; at most 20 are kept. Quotes and attachments stay where they are.
  Browser tests only; not yet on a real phone.
- **Several questions, one at a time.** When Hermes asks more than one question at once, the sheet shows
  `Question 2 of 3` with the current question and a row of dots; picking a choice in a single-choice question moves to
  the next one by itself after a moment. Back and Next move by hand (Android Back goes to the previous question), and
  the last question has Answer. A single question looks as before. Browser tests only; not yet on a real phone.
- **"New since your last visit" in a chat.** When a chat got messages while you were away (a long task finished, a
  scheduled job or a bot wrote to it), a thin line with that text sits before the first message you haven't seen, and
  the chat opens scrolled to it instead of to the very end. It goes away the next time you open the chat; a chat you
  never opened on this phone shows no line. Browser tests only; not yet on a real phone.
- **Things slide open and close.** Tool cards, the thought process, the task list and the changed-files card now slide
  open and shut instead of jumping, chevrons turn instead of swapping characters, and the button next to the box fades
  in when it changes between Send, Stop, Mic and Queue. The reasoning level on the model chip shows as small bars (the
  chip's label says it in words). Nothing moves when the phone's "Remove animations" setting is on. Browser tests
  only; not yet on a real phone.
- **A ring shows how full the chat's memory is.** At the right end of the model row above the box, a small ring fills
  with the chat's context use all the time (not only while Hermes works), turning amber from 80 % and red from 90 %.
  Tap it for the Context window sheet: tokens used of the maximum, cost and cache hits when Hermes reports them, and
  a Compress older turns button. The ring also moves during a long turn. Browser tests only; not yet on a real phone.
- **See how long Hermes has been working, and the chat's goal.** The status line above the box now shows the running
  turn's time (`1:23`) after three seconds, and it keeps counting from the real start when you reopen the chat. The
  finished reply's stats gain the total (`~41 tok/s · 1m 23s · ctx 12%`). When the chat has a goal (`/goal`), a line
  `🎯 Ship the login fix · turn 3 of 20 · active` sits under it; tap it for the goal's details with Pause/Resume and
  Clear goal. The clock ticks only while a turn runs and the screen is on. Browser tests only; not yet on a real phone.
- **See which files a turn changed.** When Hermes wrote or edited files, a card at the end of that turn says
  `✎ 3 files changed  +42 −7`. Tap it for the files, each with its own counts; tap a file to see its diff. A
  Checkpoints button opens the file checkpoints to undo. It also shows when the tool calls above it are folded.
  Browser tests only; not yet on a real phone.
- **Preview a web page or SVG right in the reply.** An `html` or `svg` code block of 3+ lines now has a Preview button
  (Code switches back). The page runs in the same offline sandbox as the canvas, starts 160 px high and grows to its
  own height (at most 60 % of the screen); a Full screen button below it opens it full size, and Back closes it. It is
  disabled while the reply is still arriving. Browser tests only; not yet on a real phone.
- **Jump between your messages in a long chat.** Once a chat has six or more of your messages and is several screens
  long, a thin rail appears on the right edge with one tick per message you sent. Drag along it: a bubble shows the
  message under your finger (`12 / 30` and its first words); let go and the chat scrolls there. A tap jumps too, and
  the tick of the message at the top of the screen is highlighted. Browser tests only; not yet on a real phone.
- **Queue a follow-up while Hermes works.** When a reply is running and you have typed something, the send button
  splits in two: Steer (as before, the words go into the running task now) and Queue. A queued message waits as a
  dashed bubble at the end of the chat (edit it, remove it, or send it now) and is sent by itself when the reply ends,
  then the next one. Stop or an error pauses the queue (Queue paused, Resume), and a chat you open starts paused.
  Up to 10 per chat, kept across restarts; sent only while the app shows that chat. Seen on a Xiaomi phone (Android
  16): Steer and Queue appear while a reply runs, and a queued message was sent by itself when the reply ended. Edit,
  remove, pause after Stop and keeping the queue across a restart were not yet tried on a phone.
- **Quote part of a reply.** Select words in one of Hermes's replies and a bar above the composer offers Quote or
  Explain. Quote puts the words as a chip above the text box (up to 3, ✕ removes one) and the next message starts with
  them as a quote; Explain sends the quote with "Explain this." at once. Your sent message shows the quote as a block.
  Seen on a Xiaomi phone (Android 16): the bar, Quote, Explain and the quote block work, Android's own selection menu
  doesn't cover the bar, and selecting text in your own message shows no bar.
- **Tablets: hide the chat list.** On wide screens (tablets, unfolded foldables, landscape) ☰ in the chat header now
  hides or shows the chat list on the left, and « at the top of the list hides it from any page; the app remembers it.
  Sheets opened from Settings and other pages (like Uninstall Hermes) now cover the whole width instead of sitting
  half under the list. Browser tests only; not yet on a real tablet.

## v0.8.66 (2026-10-29)

- **The installer no longer opens Settings or taps the screen.** It used to pair Termux with Wireless debugging by itself while asking you not to touch the phone; you now do that once in the app after the install (see the next line). Seen on the test phone (Android 16): the new pairing worked there. A fresh install with this installer was not yet run.
- **Pair Termux yourself, once, after the install.** The setup's "Shizuku starts by itself" step has a Start pairing button: Settings opens at Wireless debugging and Hermes Mobile shows a Pairing notification; tap Pair device with pairing code and type the code into that notification. Then Shizuku starts again by itself after a restart (Android 11+, on Wi-Fi). Seen on an Android 15 emulator and on the test phone (Android 16): paired, and Shizuku came back within seconds after being stopped. On that phone the notification shows no pop-up and sits further down the shade, so you may have to expand it to see Enter code. Not yet tried after a restart or on other phone makers.
- **Go back and forward in the setup.** Back and Next under the step counter (and Android's Back) show the steps you
  already finished; Next stops at the step you're on, since the required steps can't be skipped. Shizuku's "starts by
  itself" step now comes right after the install, before the model, with new text and a **Start pairing** button. Web tests
  only; not yet on a real phone.
- **The install time now says about 15 minutes** (README, install guide, app), measured on clean emulator installs.
- **Settings → Replies: the cards switch is now called "Dynamic UI".** Same switch, new name.
- **The model menu shows your real reasoning level in a new chat.** With a default of High set in Settings, the menu
  showed Medium until the first message, and picking a model reset the level to Medium. It now shows and keeps the
  default. Not yet seen on a real phone.
- **Use any model, not only the ones in the list.** Type a model's exact name in the model menu's search (in a chat
  or under Settings → Default models): "Use “<name>”" offers it with each connected provider. Once picked it stays in
  the menu under that provider (✕ forgets it). Like Hermes Desktop's "Custom model". Not yet seen on a real phone.
- **Adding a custom key explains where provider keys go.** A key added under Settings → API keys puts no models in the
  model menu; the sheet now says to connect the provider under Settings → Model providers (or add it as an
  OpenAI-compatible endpoint there when it isn't listed). Not yet seen on a real phone.


## v0.8.64 (2026-10-29)

Tested on an Android 8.0 emulator (start-up) and an Android 15 emulator; not yet seen on a real phone.

- **Android 8 to 10 no longer crash at start.** The app opened and closed at once on Android 8.0 to 10 (and the
  wake-up alarm needed Android 12); every newer call now has a version check, and CI fails when one is missing.
  Checked on an Android 8.0 emulator; not on Android 9/10 or a real older phone. Saving a picture needs Android 10
  (Share works on older phones).
- **A clear note instead of a blank screen when the phone's WebView is too old.** If Android System WebView was never
  updated (older than Chrome 100) and the app can't run, it now says so and asks you to update Android System WebView
  or Chrome.
- **The README lists what needs which Android version** (setup on the phone needs Android 11, background apps 14, the
  Live Update chip 16, and so on).


## v0.8.63 (2026-10-29)

Tested on an Android 15 emulator (real taps); not yet seen on a real phone.

- **Setup always has an "Install all" button for the helper apps.** It installs whatever is still missing, one app after another. If your Termux came from somewhere other than F-Droid (for example the Play Store), the setup used to stop after Shizuku with no button: Install all now offers to replace that Termux with F-Droid's (Android asks before uninstalling it), then installs the rest.

## v0.8.62 (2026-10-29)

Tested on an Android 15 emulator at a tablet's screen size; not yet seen on a real phone or tablet.

- **A fresh install opens the setup straight away, full screen.** Until Hermes has answered once (or setup was finished), the app now starts in the setup flow instead of an empty chat that keeps trying to reach a Hermes that isn't installed yet; before, with Termux already on the device, the setup only appeared after about 15 s on screen. On tablets and other wide screens it also covers the chat list. Reinstalling the app on a phone where Hermes already works shows the setup for a moment, then the chat (browser-tested only).

## v0.8.61 (2026-10-28)

Tested on an Android 15 emulator and one real phone (Android 16); not yet on other makers' phones, after a real phone restart, or with the Windows setup script.

- **Shizuku can start again by itself (Android 11+, no root, on Wi-Fi): the installer pairs Termux's own adb with Wireless debugging.** The phone installer adds Termux's `android-tools`, installs `~/bin/hm-shizuku` and, once Shizuku runs, pairs it: Settings → Wireless debugging opens for a few seconds, the pairing code is read from the screen, Settings closes again and Wireless debugging is switched back off if it was off (on a Wi-Fi Android doesn't know yet it answers *Allow wireless debugging on this network?* with Always allow). `hm-shizuku start` then starts Shizuku's server from Termux; the computer setup scripts and the phone installer give Hermes Mobile the permission to turn Wireless debugging on for this. If pairing fails, the installer lists "Shizuku can't start by itself yet: open Hermes Mobile → Setup check → Set up". Seen on an Android 15 emulator (pairing from scratch with a new adb key in 12-19 s, Shizuku's server restarted after being killed: 1.2 s with the port, 9 s with the port scan) and on one real phone (Android 16: paired in about 10 s); not yet on other makers' Settings, and the Windows script was not run.
- **Shizuku starts again by itself (Android 11+, no root).** When Shizuku stops, or isn’t running about 90 s after the phone starts, Hermes Mobile waits until the phone is on Wi-Fi, turns Wireless debugging on, finds its port and has Termux start Shizuku again (up to 3 tries in 2 minutes), then turns Wireless debugging back off if it had turned it on. The "Shizuku stopped" notice now only appears when this can’t work, and says why: not on Wi-Fi (it starts once Wi-Fi is back), allow wireless debugging on this network, not set up to start by itself (Setup check → Set up), or it couldn’t start. Needs the installer’s new one-time set-up. Seen on an Android 15 emulator (Shizuku killed: back in about 3 s; Wi-Fi off, then on: back about 10 s after Wi-Fi returned; after a restart where Shizuku’s own start failed: back about 100 s after boot); on one real phone (Android 16), Shizuku killed: back in about 4 s. Not yet seen after a real phone restart or on a Wi-Fi network that was never allowed.
- **Setup check and Backend status show whether Shizuku starts by itself (Android 11+).** A new required row, "Shizuku starts by itself", appears once Shizuku works with Hermes: ✓ when Termux is paired and the app may switch Wireless debugging; otherwise a "Set up" button (pairs Termux, needs Wi-Fi; if Android asks "Allow wireless debugging on this network?" tap Allow) or "Run the installer again". The status sheet's Shizuku row says "Restarts by itself" or "Start it by hand after a restart"; on Android 10 and older the Shizuku row now says it has to be started from a computer after each restart. Seen on one real phone (Android 16): the row showed ✓ after the installer's pairing.
- **The installer no longer fails with "No plugin named 'hermes-mobile'" when Hermes runs in another profile** (after `hermes profile use <name>`), which left Setup check's plugin row red ([#5](https://github.com/omarqaterge/hermes-mobile-app/issues/5)). It now puts the plugin in every Hermes profile and turns it on for the main profile too. Bots (profiles) you create in the app get the plugin as well, so their chats have the status chip, approvals and the canvas. Reproduced and checked on an Android 15 emulator; on one real phone only the profile-linking call was checked (its profiles were already linked); the installer itself was not run there.
- **Hermes Mobile now notifies you when a new version is out.** It checks GitHub at most every 12 hours while the app's background service runs (about 2 minutes after it starts, then every 12 h), and posts one "App updates" notification per release; tap it and the app downloads the new version and asks Android to install it (you confirm in the system dialog; the first time, Android sends you to allow installs from Hermes Mobile, then tap Update in Settings → About). The notice goes away once you install the version. You can turn it off in the app's notification settings (App updates). Seen on an Android 15 emulator (old build → notice → tap → install dialog → updated to 0.8.59); not yet seen on a real phone.

## v0.8.59 (2026-10-25)

Tested on one phone (Android 16) with real taps; the Android 10-and-older setup step, a fresh install and the Windows script were not tried on a device.

- **Shizuku is now a required setup step (no more Skip).** The step says Hermes needs it; a "Shizuku is running: continue" button is only for a Shizuku that was started before the app opened, and Setup check still verifies it afterwards. On Android 10 and older the step explains how to start Shizuku from a computer and links Shizuku's guide. (Browser-tested; the fresh-install flow was not run on a device.)
- **Setup check has a step to let Shizuku run in the background, and the computer install sets it for you.** Without it Android can stop Shizuku and Hermes loses the screen. The phone installer also tries it through Shizuku (not checked on a device).
- **Hermes Mobile tells you when Shizuku stops.** A "Shizuku stopped" notification appears within seconds; tap it to open Shizuku, and it goes away by itself once Shizuku runs again. After a restart of the phone, a "Shizuku isn't running" notice comes about 90 s after Hermes Mobile starts (the restart case is not yet seen on a real phone).
- **The status sheet shows whether Shizuku is running and Hermes can use it.** Tap the dot under the chat title: a Shizuku row says Running, Not running, Not installed or what to fix, and tapping it opens Shizuku or the Setup check.
- **The canvas opens as a panel from the right:** tap the canvas button or swipe left on the chat; swipe right on its top bar, tap ✕ or press Back to close it. Fill-the-screen stays; wide screens keep it beside the chat (wide screens browser-tested only).
- **Pull up past the last message to open a side question (/btw) about the chat.** The list stretches like a rubber band; about 110 px of pull shows "Release for a side question". A lighter pull springs back.
- **The Auto button on an empty new chat shows the default mode** the chat will start in, instead of Auto off.

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
