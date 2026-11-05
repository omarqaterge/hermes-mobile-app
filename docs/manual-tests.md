# Manual tests

Checks that need a person, a voice, extra hardware or another computer, so they can't be run over adb.
Tick an item off (or note what went wrong) once it's done; the status per feature is in `improvements.md`.

## Voice (Live mode)

- [ ] **Approval by voice (#33).** Start Live mode in a test chat and say "run chmod 777 /tmp/x".
      Expected: Hermux asks "Hermux needs your permission. Allow or deny?" (short, not the whole command);
      saying "allow" runs it, "deny" refuses it. Say something unclear twice: the approval sheet appears instead.
- [ ] **Live mode in the background.** While Hermux is speaking in Live mode, press Home.
      Expected: it keeps speaking to the end; Live mode is off when you come back to the app.
- [ ] **Interrupt by talking.** In a quiet room, ask Live mode for a long story. Expected: Hermux is not cut off by its
      own voice; saying "what about tomorrow" over it stops it and sends that after the pause; saying just "stop"
      stops it and sends nothing. Repeat with the on-device model and with the phone's recogniser (Settings → Voice →
      Speech recognition). With barge-in off (Settings → Voice → Live mode), talking over Hermux does nothing.

## Read-aloud controls

- [ ] **Lock screen.** Tap Read aloud on a long reply, lock the phone.
      Expected: the player is on the lock screen; Pause/Play, back 10 s and forward 10 s work.
- [ ] **Headset.** Same, with Bluetooth or wired headphones: the play/pause button pauses and resumes; next/previous
      (double/triple press) jump 10 s forward/back.
- [ ] **Paused card swiped away.** Pause the reading from the notification, swipe the card away.
      Expected: the reading stops; the app shows no player any more.
- [ ] **Assistant from the lock screen / headset.** With Hermux as the digital assistant app (long-press power while
      unlocked already works), lock the phone and long-press power; also press a headset's voice-assistant button.
      Expected: Hermux opens in Live mode (after unlocking, if the phone asks).

## Setup on other machines

- [ ] **Windows.** Run `tools/setup-phone.ps1` on a Windows PC with a phone connected over USB debugging.
      Expected: it completes; the app's Setup check shows files, Termux:API and Shizuku green.
- [ ] **A brand-new real phone.** Run `tools/setup-phone.sh` against a freshly reset (or never-used) Android phone.
      Expected: same as above, and a first message gets a reply. (The emulator run can't check vendor battery
      restrictions or a real Shizuku start.)
- [ ] **Setup flow at the Shizuku step.** On a phone where Hermux is installed but Shizuku isn't started, open the
      setup flow at "Hermux can see and use the screen (Shizuku)", tap Open Shizuku, start it, come back.
      Expected: Shizuku asks whether Termux may use it (tap Allow all the time); within a few seconds the page moves
      on by itself, without leaving the app again.

## Needs a release tag

- [ ] **In-app update.** After the next `v*` release: Settings → Check for updates offers it; Download and install
      work and the app reopens on the new version.

## Driving a test build from a computer

Needs a build made with `HM_DEVTOOLS=1 android/build.sh` installed on the phone (it shows the "Test build: remote debugging is on" strip), the phone connected with `adb`, and the app open.

1. `adb shell pidof com.omarqaterge.hermesmobile` gives the PID.
2. `adb shell cat /proc/net/unix | grep webview_devtools_remote` shows the socket name, `webview_devtools_remote_<PID>`.
3. `adb forward tcp:9222 localabstract:webview_devtools_remote_<PID>`.
4. In Chrome open `chrome://inspect`: the page is listed. Or with Playwright: `const b = await chromium.connectOverCDP('http://127.0.0.1:9222'); const page = b.contexts()[0].pages()[0]`.
5. `adb forward --remove tcp:9222` when done.

Also check: the strip stays visible over Settings and other full screens, and a normal (non-`HM_DEVTOOLS`) build has no `webview_devtools_remote` socket.

Seen on a Xiaomi phone, Android 16 (build `0.8.66-test+devtools` at d866ed3): the strip shows under the status bar and the socket is listed; a build of the same branch without `HM_DEVTOOLS` had no socket. Playwright attached and drove a whole test session. Still to check: the strip over full screens.

## Remote debugging setting (Settings → About), needs a release-style build (not `HM_DEVTOOLS`)

Tried on a Xiaomi phone, Android 16 (HyperOS), normal build 0.8.66-test (commit a9d6741), and on an Android 15 emulator (Pixel 6 image, arm64). Emulator images are debuggable, so there every WebView opens a `webview_devtools_remote` socket by itself: check the row, strip and notification there, not the socket.

- [x] 1. Android Developer options off: Settings → About has no "Remote debugging" row.
- [x] 2. Developer options on, no screen lock set: tap the row, Continue. Expected: "Set a screen lock first", stays Off.
- [x] 3. With a screen lock: Continue opens the phone's own lock screen. A wrong PIN or Back leaves it Off. The right PIN turns it on: the row says "On · 60 min left", the strip shows, the notification "Remote debugging" is there, and `chrome://inspect` on a computer (after `adb forward` as above) lists the page.
      Seen: Back on the lock screen leaves it Off; after unlocking, the row, strip, notification and socket appeared and Playwright attached.
- [x] 4. The notification's Turn off button: it goes off, the notification and strip go, and `chrome://inspect` no longer connects.
      Seen: an attached Playwright session was cut at once ("Target page, context or browser has been closed"), so nothing more is needed. Tapping the row while on also turns it off.
- [x] 5. Force-stop the app: it reopens with remote debugging Off and no notification.
- [x] 6. Wait 60 minutes (or build with a 2-minute `DURATION_MS`): it turns itself off and the notification goes. Also try with the screen off for the whole time.
      Seen with the screen off for the whole hour: off when the phone was woken. While the phone dozed the socket came and went with the WebView, so whether it went off exactly at 60 minutes or only on waking can't be told; the `Handler` timer can run late in doze (2.3). Open: a doze-proof alarm (`AlarmManager.setAndAllowWhileIdle`) would close that gap.
- [x] 7. Developer options turned off while it is on: it is off at the next time the app is opened.

## Rare situations

- [ ] **Expired login renewed from the model picker.** When a provider login expires, open the model picker on
      that provider. Expected: it renews the login (or asks to) and the next message works.
- [ ] **Older chats (#7).** Once there are more than 80 chats: "Show older chats" appears at the bottom of the
      drawer and loads the next ones.
- [ ] **Compress (#17).** In a long chat whose context is at least 80% full, tap the Compress suggestion.
      Expected: a notice like "Context compressed: N → M messages" and the chat continues normally.

## Background apps (phone_app)

- [ ] **While you use the phone.** Watch a video, then by voice or from a chat ask Hermux to do something in an app
      (e.g. add a Keep note). Expected: the video keeps playing, no keyboard pops up, the chip says "Using <app>",
      the task gets done.
- [ ] **Locked phone.** Same with the screen locked (it worked in a test with the screen off; a real task not yet).
- [ ] **App lock.** An app behind the phone's app lock (HyperOS, Samsung, OnePlus/ColorOS… each has one) is refused
      with "another app opened instead … app lock": decide whether to take it out of the lock for Hermux.
- [ ] **Other phone makers.** Tested on a Xiaomi (Android 16) and an AOSP emulator (Android 15) only. On a Samsung,
      Pixel, OnePlus or Motorola with Android 14+: open an app, tap, type, Take over. Android 11-13: Settings →
      Background apps should say "Needs Android 14 or newer".
- [x] **Chip opens the viewer (#63).** Ask Hermux to use `phone_app` in Calculator for a few steps, press Home, pull
      down the shade while the chip says "Using Calculator" and tap the card's body (not Stop). Expected: the expanded
      card shows a picture of the app; the tap opens Hermux on that chat with the live viewer (Take over / Stop).
      Seen on an Android 16 phone, build 0.8.72-plugintest (2026-11-02): both as expected. An earlier report of the tap
      opening Calculator with no picture came from a run where Calculator was started on the real screen with
      `am start` (no hidden display was created), and the logged taps landed on other apps' notifications, never
      Hermux's (by design, spec 3.10). A later report of the chat opening without the viewer (0.8.73-test): the log has
      that tap 354 ms before the hidden display went away, because the turn was ending; the same steps at "2 steps" and
      at "9 steps" after 80 s in the background opened the viewer each time. Also try: the composer focused before Home,
      then the tap. Expected: no keyboard under the viewer.
- [ ] **A banking app with the Settings toggle on** (opens; FLAG_SECURE screens may show black in the live view).
- [ ] **Faster steps.** Ask for something with several taps (a new note with a title). Expected: the steps run without a
      fixed pause between them, Hermux points at buttons by their text, and no keyboard shows in the live view.
- [ ] **Straight to a screen.** "Share 'milk, eggs' to Keep" or "open this link in YouTube". Expected: one approval for
      that app, then the app's share or link screen in the background.
- [ ] **A switch.** "Turn on Do not disturb" (in Settings). Expected: `toggle` changes it once and says it is on; asking
      again changes nothing.

## Features from docs/plans (01–12)

Tried on a Xiaomi phone, Android 16 (HyperOS): 01 with build `0.8.66-test` (commit 970883a), 02–12 with the test
build `0.8.66-test+devtools` (commit d866ed3), driven from a computer with Playwright.

- [x] **01 Quote part of a reply.** Bar, Quote chip, sending with the quote, Explain, no bar in your own bubble.
      Android's selection menu floats above the bar without covering it.
- [x] **02 Queue.** Queue, sending by itself, edit, remove, Stop → Queue paused → Resume, kept after a force-stop,
      Steer.
- [x] **03 Scrubber.** Rail with one tick per message, drag bubble, jump and flash, no drawer/canvas from a swipe on
      the rail, no rail in short chats.
- [x] **04 HTML preview.** Preview disabled while streaming, inline page works, Full screen and Back, SVG preview.
- [x] **05 Changed-files card.** Card, rows, diff sheet, Checkpoints; counts readable in the light theme.
- [x] **06 Elapsed time and goal line.** Timer, real start after switching chats, duration in the stats, `/goal` line
      with Pause, Resume and Clear goal.
- [x] **07 Context ring.** Fits next to the model name; sheet numbers; Compress older turns.
- [x] **08 Animations.** Slides and turning arrows, effort bars, instant with `animator_duration_scale 0`.
- [x] **09 New since your last visit.** First try failed (Home while Hermes answers, back to the same chat: no line,
      the chat was never reopened); fixed with `window.hermesPause` / `noteBack` (commit e54d7ff). Retest on build 869
      (commit b184623): the line before the reply that arrived while away and scrolled there; none for a reply watched
      on screen; none after reopening the chat.
- [x] **10 Several questions at once.** One at a time, auto-advance after a pick, Back keeps the answer, Answer.
- [x] **11 Stash a draft.** Stash, swap, clear all.
- [x] **12 File previews.** CSV table, highlighted code, JSON, HTML page, mp3 and mp4 play, PDF note and Open with….

## On-device dictation (Settings → Voice → Speech recognition)

Tried on emulators only (Android 15 and 8.0, arm64): downloads with progress and hash check, the check on the test
recording, Use / Test model / Delete, a model added by Hugging Face link and from a `.zip` picked in Android's file
picker, a damaged model file (the check fails, the card says why, dictation falls back), the check process killed
mid-way (the app keeps running), live dictation through the emulator's microphone (previews, then the phrase). Still to
check on a real phone:

1. Download Moonshine Base on Wi-Fi; the card shows the test result. Note the "<s> s for 6.6 s of speech" figure.
2. Dictate a few sentences in the composer with pauses: a phrase lands after each pause, previews appear while speaking.
   Talk for over 8 s without a pause: the phrase is cut and nothing is lost.
3. Live mode with the model: it sends after the pause and answers out loud; it doesn't hear its own reading.
4. Battery and heat: dictate for 5 minutes with each built-in model (`adb shell dumpsys batterystats` before and after,
   or `top` for the app's CPU share while dictating and once stopped: no CPU once the microphone is off).
5. Leave the app while dictating: the microphone indicator goes off at once.
6. A 32-bit (armeabi-v7a) phone, if one is at hand: Moonshine Tiny downloads, checks and dictates.

## Checks from 2026-11-02 (docs/status/phone-checks-2026-11-02.md)

- [x] **Done chip stays (#67).** (2026-11-02, 0.8.72-plugintest: stayed over 2 min, cleared on open.) With a build that has #67: send a short prompt, press Home before the reply ends.
      Expected: the green Done chip appears and stays (wait 2 minutes) until you open the app or the chat.
- [x] **/yolo from Auto access.** (2026-11-02, 0.8.72-plugintest: Full access in 0.86 s; `ls ~` ran without asking.) In a chat whose Auto button (beside the model chip) shows Auto access, type `/yolo`.
      Expected: "⚡ Full access on…", the button reads ⚡ Full access; `/yolo` again: "Back to Auto access". Note how long
      the notice takes right after opening a chat.

- [x] **Start with Hermes stopped.** (2026-11-03, 0.8.73-test: the shell asked for the token within 0.02 s of a phone-side curl loop's first 200, with the app opened 0, 3 and 5 s after the stop, each time before the next backoff step. 3 starts opened at once: `socket` 18.1–18.3 s, `sessions` 19.3–19.5 s, `chat-live` 20.5–20.8 s.) With a build that has the fix: in Termux, stop the dashboard
      (`~/bin/hermes-debian --restart`, which stops it at once; a plain `pkill -f 'hermes dashboard'` can leave it answering for a while. The service
      loop starts it after 10 s and it answers about 18 s after the stop), force stop the app and open it at once. In Termux, watch
      `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9119/` turn 200. Expected: the app connects within about
      a second of that, not up to 15 s later. Note the `socket` and `sessions` times in Settings → About → Last start-up.

## Confirm approvals with fingerprint (owner only: needs the phone's fingerprint or PIN)

- [x] (2026-11-02, 0.8.72-plugintest: asked once per chat, the second approval didn't ask.) With Auto off, ask Hermux for something it must approve; tap Allow once. Expected: the fingerprint prompt
      ("Allow Hermux to run this?" with the command); after it, the command runs. A second approval in the same chat
      doesn't ask.
- [ ] Cancel the prompt: nothing runs, the sheet stays, the toast says why. Deny never asks.
- [ ] Leave the app with an approval waiting, tap Allow once on the notification (phone unlocked): the app opens on
      the chat and Allow asks for the fingerprint. After that, notification Allows in that chat go straight through.
- [ ] Restart the app (close it from Recents): the next Allow asks again.
- [ ] Settings → Permissions → Confirm approvals with fingerprint: turning it off asks for the fingerprint first.
- [ ] Android 8 or 9 phone if at hand: the screen-lock screen or "Use screen lock" fallback works.

## Connectors (Settings → Connectors)

- [ ] **MCP sign-in on the phone.** Add a remote MCP server with an account sign-in (for example from the catalog) and tap Sign in.
      Expected: the service's page opens in the browser, its redirect reaches Hermes on the phone ("Authorization received"),
      and back in the app the sheet says "Signed in."; Test lists its tools; a new chat can use them.
- [ ] **A command server.** Add a server by a command whose program is installed in Debian; Test lists its tools.
- [ ] **Google with a real account.** Paste an OAuth client file, sign in, paste back the localhost:1 address from the browser's address bar.
      Expected: the row reads Connected and Hermux reads your calendar in a new chat; Sign out returns to the sign-in step.
- [ ] **A tool with a key.** Web search: save a key for another service; it reads "In use" and a new chat searches with it. Disconnect deletes the key.

## The plugin follows the app (Settings → About → Hermux plugin; spec 6.6)

Needs a phone with Hermes set up and an app build from this branch or later. Before you start, keep a copy of the
plugin: `~/bin/hermes-debian sh -c 'cp -a /root/.hermes/plugins/hermes-mobile /root/hermes-mobile-plugin-backup'`.

1. **Old plugin catches up.** On a phone whose plugin predates this (no `BUILD_STAMP`:
   `~/bin/hermes-debian cat /root/.hermes/plugins/hermes-mobile/BUILD_STAMP` fails), install the new APK over the old
   app, open it once, then leave it with no chat running. Within about a minute Settings → About → Hermux plugin goes
   from "This app has a newer version…" to "Up to date with this app"; the `BUILD_STAMP` now ends in `apk`; Settings →
   Replies → Dynamic UI is there, and every profile's `plugins/hermes-mobile` is a link to the main copy.
2. **Never during a chat.** With an update waiting, start a long turn and leave the app: nothing restarts until the
   turn ends; about 15 s after it does, Hermes restarts once and the row reads "Up to date".
3. **Tap to update.** With the app open and Hermes idle, tap the row: "Updating… Hermux restarts for a moment", the
   chat reconnects by itself, and the row reads "Up to date".
4. **Rollback.** Make the APK's plugin fail to load (a test build whose `plugin_api.py` raises on import), tap the
   row: after up to 3 minutes the row says "Couldn’t update (load rolled-back). The plugin that was there still works",
   and the old plugin is back in place and answering.
5. **Left alone.** Add a line to the installed `plugin.yaml`: the row reads "Changed by hand…"; tap → "Replace the
   plugin?" → Cancel changes nothing. `touch /root/.hermes/hermes-mobile-plugin/hold` makes it "Held for testing".
   Remove the hold file when done.
6. **Interrupted.** During step 3, force-stop Termux right after "Updating…" shows; open Termux and the app again: the
   next check settles it (the new plugin kept if it serves, else the old one back), never a missing plugin.

## Phone pass of 2026-11-02 (build 0.8.72-plugintest, Android 16)

The owner's test agent ran 16 checks on a real phone. Results as found, with what was really wrong where a check first
read as a pass:

| # | Check | Result |
|---|---|---|
| 1 | Name: launcher, App info and the title say Hermux | PASS. The build predates #86, so the agent subtitle still said "Hermes Agent"; it now says "Hermux agent" (not seen on the phone yet) |
| 2 | Done chip stays until the chat is opened | PASS: stayed 2+ min, cleared on open |
| 3 | Tapping the background-app chip opens the viewer | PASS on retest. The first run's setup was wrong: its Calculator ran on the real screen rather than the hidden display, so the tap opened Calculator and there was no thumbnail, which is how the chip is meant to work (#88). In the retest the tap opened the live viewer and the card showed a thumbnail |
| 4 | Auto button | PASS: beside the model chip; Off / Auto access / Full access; a small 🛡 chip in Live mode |
| 5 | /yolo | PASS: Full access in 0.86 s; `ls ~` ran without asking |
| 6 | Confirm approvals with fingerprint | PASS: asked once per chat; the second approval in the same chat didn't ask |
| 7 | Tool cards | PASS: "Ran ls", "Read" |
| 8 | Links | PASS: open in the phone's browser |
| 9 | Hermes settings | PASS: the Memory toggle changed the config and was put back |
| 10 | Provider rotation | NOT VERIFIED: the Fallback models card stayed on "Loading…" (the phone has no `fallback_providers`). Fixed: the card now loads the config on its own, says "No fallback models yet" when the list is empty, and every settings load ends after 20 s in an error with Try again. Reordering not tested; to check again |
| 11 | Connectors | PASS: page and statuses right (no server sign-in or key tried) |
| 12 | Opt-in stats | PASS: no switch and no requests without a key |
| 13 | What's new | NOT VERIFIED: hidden on test builds, whose version is newer than the latest release, so the new wording wasn't seen |
| 14 | OpenUI | PASS: the skill `hermes-mobile:openui` loaded and the card rendered inline |
| 15 | /btw pull and Clear | PASS: the 230 px pull works but needs a deliberate drag from near the bottom; Clear forgets |
| 16 | Launch with Hermes running / stopped | Running: PASS, chat live in 0.2–0.4 s over 3 cold starts. Stopped: BLOCKED, the app has no action that stops Hermes |

- [ ] **Fallback models again (#10).** With a build that has the fix: Settings → Model providers. Expected: the card
      shows the main model, "No fallback models yet" and "Add a fallback model" within a second or two, never a
      "Loading…" that stays. Add two fallbacks, reorder them with ↑ ↓, remove one (the config changes each time), and
      put the owner's providers back as they were.

## Moving pictures to Pictures/Hermux (emulator, 2026-11-03)

On an Android 15 (API 35) emulator: pictures saved by a build from before #87 (1aeb309), then updated with
`adb install -r` to a build from `main` (6489374). An emulator pass only: no real phone, and no phone with old pictures.

| Check | Result |
|---|---|
| The app's 3 pictures moved from `Pictures/Hermes` to `Pictures/Hermux` | PASS: identical checksums, the same MediaStore rows, readable through their content URIs |
| Name clash with a different `same.png` already in `Pictures/Hermux` | PASS: the moved one became `same (1).png`; the one already there was unchanged |
| A file the app didn't save | PASS: stayed in `Pictures/Hermes` |
| A new save | PASS: went to `Pictures/Hermux` |
| A restart after the move | PASS: nothing changed, no errors in the log |

- [ ] **Android 11 (API 30).** NOT VERIFIED: the oldest version the move runs on; not run, for lack of disk space. Same
      steps as above on an API 30 emulator or phone, with test pictures.
- [ ] **A real phone with old pictures.** NOT VERIFIED. Update from a build before #87 on a phone with test pictures in
      `Pictures/Hermes`. Expected: each is in `Pictures/Hermux` once, and the gallery still shows them.

## 2026-11-03, app 0.8.75-test on Android 16

| Check | Result |
|---|---|
| Data kept across the update | PASS |
| The plugin updated by itself about a minute after install | PASS: Settings shows it up to date, it compiles, no errors in the logs |
| The new `rish` instruction | PASS: the agent treated the `getprop` lines as harmless |
| The Uninstall wording | PASS |
| The start-up line reaching `chat-live` | PASS: 0.4 s on 3 cold starts |

- [ ] **Live viewer tap, the viewer's closing message and the keyboard.** NOT TESTED on this build. Last seen on
      0.8.74-chiptest (see PR #92 in this repository).

## Diagnostic log

- [ ] **The log after a crash.** See [status/diagnostic-log.md](status/diagnostic-log.md) for the full list. Force stop
      the app, open it, then open Report a problem and switch on Include diagnostic log. Expected: an `app exit` line
      with a reason (Android 11+), four sections, no chat text, no file names.

## Videos in the chat

YouTube was seen playing in an Android 15 emulator's WebView (Chrome 124) through the shell's page, with fullscreen, turning with the phone, Back and the page going hidden on Home. The cards themselves were checked in the browser tests only.

- [ ] **YouTube on a phone.** Send a YouTube link, tap the card. Expected: it plays in the chat, no "Error 153". Fullscreen turns with the phone; Back returns to the chat. Home stops the sound, and coming back shows the card.
- [ ] **The other sites on a phone.** Try one public video each from Vimeo, Dailymotion, Streamable and Loom. Vimeo answered "Unable to play video" on the emulator's WebView, with or without the shell's page and sandbox; Dailymotion answered "Forbidden" for the one test address tried. Streamable and Loom were not tried. If a site refuses every WebView, take it out of `embedOf` so its links stay links.
- [ ] **Open.** The card's Open hands the address to the site's app or the browser, and stops the player.

## Answer field on the question chip

- [x] (2026-11-04, 0.9.15-chiptest, Android 16: with three choices, not again with none; not from the shade.) With the
      app in the background, have Hermux ask a question with no choices, then one with three choices. Expand the chip
      and tap it. Expected: a box with the question, its choices and a field; a typed answer and a choice each reach
      the chat and the chip goes back to the status. Back leaves the question open. Same from the shade.
- [ ] Have Hermux ask a question with choices over 80 characters, after Hermes has restarted on the new plugin.
      Expected: the box shows them whole.
- [ ] Same with the phone locked. Expected: the unlock comes first, then the box.

## Phone data for the agent (Settings → Phone data for the agent)

Tested 2026-11-05 on one real phone, Android 16, with the owner present:

- [x] (2026-11-05, Android 16) Off by default: master and every kind start off.
- [x] (2026-11-05, Android 16) The master and each kind's switch ask for the fingerprint; cancelling leaves them off.
- [x] (2026-11-05, Android 16) The Android permission dialog for Contacts and Location; denying twice shows the "Allow it in Android settings" row.
- [x] (2026-11-05, Android 16) Turning a switch off is instant.
- [x] (2026-11-05, Android 16) Revoking a permission in Android settings shows "Android removed this permission" and the switch stays off after the permission is granted again.
- [x] (2026-11-05, Android 16) SMS and call log: Android had already granted these permissions on this phone, so no dialog appeared (the fingerprint was still asked).
- [x] (2026-11-05, Android 16) An approval card with the app's own wording and only Allow once / Deny; the fingerprint on the first Allow only; Deny stops the read.
- [x] (2026-11-05, Android 16) A switched-off kind is refused without a card.
- [x] (2026-11-05, Android 16) 50-row cap with `truncated`; one approximate location point.
- [x] (2026-11-05, Android 16) The lock screen notification shows no details of what is read.
- [x] (2026-11-05, Android 16) Full access skips the question and Off asks again; Auto access refuses.
- [x] (2026-11-05, Android 16) In a protected chat (one that has read phone data): an image is blocked, `curl` asks first, and this survives a force-stop; a new chat is unaffected.
- [x] (2026-11-05, Android 16) A hostile SMS asking for an image: the model ignored it and no request was made.
- [x] (2026-11-05, Android 16) logcat held no names, numbers or message text.

Still to do (not yet tried on a phone):

- [ ] Locked phone: switch a kind on, lock the phone, and have the agent ask for it (for example from a scheduled
      chat or by waiting after sending). Expected: refused with "phone is locked", no card, nothing read.
- [ ] In a protected chat, have the agent write a remote image and a link in its reply. Expected: the image shows
      "Tap to load" with its host and loads only after the tap; the link opens a dialog with the full address first.
- [ ] In a protected chat, have the agent give an HTML preview. Expected: it shows as text, not rendered.
- [ ] Make a protected chat grow until Hermes compresses it, then ask for a remote image. Expected: still blocked.
- [ ] After some reads, Settings → About → Report a problem, look at the text before sending. Expected: no names,
      numbers, message text or coordinates.
- [ ] Fill the record of chats (many chats that read) if you can, or check the rows by their spec: the "Allow more chats"
      and "Forget" rows in Settings, each asking for the screen lock; "Forget" warns first.
- [ ] A phone with no screen lock: try to turn a switch on. Expected: it says a screen lock is needed and stays off.
- [ ] Android 8, 9, 10, 12, 13 and 14 phones, if at hand: turn on SMS and call log on a sideloaded install and note the
      permission dialog (some Android versions restrict these for sideloaded apps); on 13 and 14 turn on Latest photos
      and note the permission asked (and, on 14, "selected photos only").
- [ ] A hostile text that the model does obey (for example, a message telling it to put the data in an image address):
      confirm the image is still not requested, so the native filter is exercised in a real WebView.
