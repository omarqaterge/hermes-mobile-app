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

## Remote debugging setting (Settings → About & help), needs a release-style build (not `HM_DEVTOOLS`)

Tried on a Xiaomi phone, Android 16 (HyperOS), normal build 0.8.66-test (commit a9d6741), and on an Android 15 emulator (Pixel 6 image, arm64). Emulator images are debuggable, so there every WebView opens a `webview_devtools_remote` socket by itself: check the row, strip and notification there, not the socket.

- [x] 1. Android Developer options off: Settings → About & help has no "Remote debugging" row.
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
      a second of that, not up to 15 s later. Note the `socket` and `sessions` times in Settings → About & help → Last start-up.

## Confirm approvals with fingerprint (owner only: needs the phone's fingerprint or PIN)

- [x] (2026-11-02, 0.8.72-plugintest: asked once per chat, the second approval didn't ask.) With Auto off, ask Hermux for something it must approve; tap Allow once. Expected: the fingerprint prompt
      ("Allow Hermux to run this?" with the command); after it, the command runs. A second approval in the same chat
      doesn't ask.
- [ ] Cancel the prompt: nothing runs, the sheet stays, the toast says why. Deny never asks.
- [ ] Leave the app with an approval waiting, tap Allow once on the notification (phone unlocked): the app opens on
      the chat and Allow asks for the fingerprint. After that, a notification Allow in that chat still opens the app
      (the notification can't tell the chat's live session), and the sheet's Allow goes through without the fingerprint.
- [ ] Confirm one Allow in a chat, restart Hermes (not the app), then ask for another approval in that chat: the chat
      has a new live session, so Allow asks again.
- [ ] Restart the app (close it from Recents): the next Allow asks again.
- [ ] Settings → Access & privacy → Approvals → Confirm approvals with fingerprint: turning it off asks for the fingerprint first.
- [ ] Android 8 or 9 phone if at hand: the screen-lock screen or "Use screen lock" fallback works.

## Connectors (Settings → Connectors)

- [ ] **MCP sign-in on the phone.** Add a remote MCP server with an account sign-in (for example from the catalog) and tap Sign in.
      Expected: the service's page opens in the browser, its redirect reaches Hermes on the phone ("Authorization received"),
      and back in the app the sheet says "Signed in."; Test lists its tools; a new chat can use them.
- [ ] **A command server.** Add a server by a command whose program is installed in Debian; Test lists its tools.
- [ ] **Google with a real account.** Paste an OAuth client file, sign in, paste back the localhost:1 address from the browser's address bar.
      Expected: the row reads Connected and Hermux reads your calendar in a new chat; Sign out returns to the sign-in step.
- [ ] **A tool with a key.** Web search: save a key for another service; it reads "In use" and a new chat searches with it. Disconnect deletes the key.

## The plugin follows the app (Settings → About & help → Hermux plugin; spec 6.6)

Needs a phone with Hermes set up and an app build from this branch or later. Before you start, keep a copy of the
plugin: `~/bin/hermes-debian sh -c 'cp -a /root/.hermes/plugins/hermes-mobile /root/hermes-mobile-plugin-backup'`.

1. **Old plugin catches up.** On a phone whose plugin predates this (no `BUILD_STAMP`:
   `~/bin/hermes-debian cat /root/.hermes/plugins/hermes-mobile/BUILD_STAMP` fails), install the new APK over the old
   app, open it once, then leave it with no chat running. Within about a minute Settings → About & help → Hermux plugin goes
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

## The island panel

Seen on an Android 15 emulator (2026-11-22, a test build of this branch): the question card's tap opens the panel
from the top centre, the pill widening first and then dropping; a choice and a typed answer each reach the page (with
the page's answer stubbed) and close the panel after the check; a failed send shows the red line and the gold Open
chat, which opens the chat with the text; a question cleared while open says "This question is closed" and closes;
Back, a tap outside and a fast drag up close it and leave the question on the chip; a short drag springs back; with
animations off it only fades. On an Android 8.0 emulator: the panel's layout under the status bar, the dim without
blur, the keyboard, a failed typed send and Back. Not yet on a phone.

- [ ] **On a phone, from the island.** A question answered by a choice, by typed text and through Open chat each
      reach Hermes; the chip goes back to the status. Back, a tap outside and a drag up each close it and leave the
      question open.
- [ ] **Open and close 20 times over different apps.** No dropped frames, no flash of a system animation, the pill
      starts at the top centre where the island is.
- [ ] **Themes and sizes.** Dark and light system theme, the largest font size, landscape, a tablet or a wide window:
      the header and the field stay in view, the rest scrolls.
- [ ] **Locked phone.** Tap the question card on the lock screen. Expected: the unlock comes first, then the panel.
      (Carried over from the answer box.)
- [ ] **Long choices.** Have Hermux ask a question with choices over 80 characters, after Hermes has restarted on the
      current plugin. Expected: the panel shows them whole. (Carried over from the answer box.)
- [ ] **The keyboard.** With choices it stays down until the field is tapped; without, it opens by itself; Send stays
      visible above it.
- [ ] **TalkBack.** Every control is named; "Sent" is spoken after an answer, the closed headline when the question
      closes.
- [ ] **A phone without a chip** (Android below 16): the same panel from the pinned notification's question.
- [ ] **Battery.** Nothing moves once the panel is hidden; the blur behind it on Android 12+ does not stutter.
- [ ] **Animations off.** With Remove animations on, the panel only fades in and out.
- [ ] **Running out.** Leave the panel open on a question until it expires (10 minutes). Expected: the reject buzz,
      "This question is closed", and it closes. Answered in the app instead: the same headline with no buzz.

Part 2, the Permission state. Seen on an Android 15 emulator (2026-11-22, a test build of this branch, no Hermes, so
every send failed): the card's body opens "Run a command?" with the ring, the command block, Deny / Allow once (with
the fingerprint) and Allow this session; two requests show "1 more waiting"; with a PIN set, Allow once brings up the
system prompt "Allow Hermux to run this?" with the command, a cancel leaves the panel as it was, the PIN sends (the
service took the grant) and the failure line, the two buttons and Open chat come back; Deny sends at once with no
prompt; the card's Allow once opens the panel with the prompt already up; a request cleared while open says "Answered
in the app" and closes; a request left to run out says "This request expired" and closes; a phone-data request shows
"Let Hermux read your phone?", Deny and "Review in Hermux" with no Allow. On an Android 8.0 emulator: the card's Allow
once closes the shade and opens the panel under the PIN screen, the PIN sends for that request, and Home from the PIN
screen leaves both until the deadline, when they go. Not yet on a phone.

- [ ] **Allow once with the fingerprint, on a phone with Hermes.** Expected: the prompt, then "Sending…", then the
      green check with "Allowed"; the command runs; the panel moves to the next request or closes.
- [ ] **Allow this session.** Expected: the prompt, then "Allowed for this session"; the chat's later requests in that
      session no longer ask Hermes for approval.
- [ ] **Deny.** One tap, no prompt; the red cross with "Denied"; Hermes reports the command was denied.
- [ ] **Cancelled fingerprint.** Nothing is sent; the panel stays as it was with the timer running.
- [ ] **The card's Allow.** On the card, Allow once with "Confirm approvals with fingerprint" on: the panel opens on
      that request and the prompt comes up at once.
- [ ] **Running out.** A request with a short timeout left open: the ring turns amber then red with one tick, pulses
      in the last 10 seconds, then "This request expired" with the reject buzz, and it closes.
- [ ] **Answered in the app while open.** "Answered in the app"; the panel closes.
- [ ] **Phone data.** A phone-data request: no Allow anywhere in the panel; "Review in Hermux" opens the chat, whose
      sheet asks.
- [ ] **TalkBack.** "30 seconds left", "10 seconds left", "5 seconds left"; every button named; the result spoken.
- [ ] **Android 8-10 PIN screen.** On a phone without a fingerprint: the PIN screen opens over the panel, the PIN
      sends that one answer, Back from it leaves the panel as it was.
- [ ] **Another app drawing over the panel.** With a floating window over the buttons, taps on Allow do nothing.
- [ ] **Partly covered (Android 10+).** With a small floating window (a chat bubble, a screen filter) anywhere over
      the panel, not over the buttons, and "Confirm approvals with fingerprint" off or no screen lock: taps on Allow
      once and Allow this session do nothing; Deny, Review in Hermux and Open chat still work. With the fingerprint
      asked, Allow brings up the system prompt as usual. Not tried on Android 10 or 11.
- [ ] **Allow this session's prompt.** It says "Allow Hermux to run this for this session?" with the command;
      Allow once says "Allow Hermux to run this?".
- [ ] **Animations off, Permission state.** With Remove animations on: the ring still drains and the seconds change,
      TalkBack speaks at 30, 10 and 5 seconds, the request runs out on time, and the card's Allow brings up the
      fingerprint. Seen on an Android 15 emulator (2026-11-22) except TalkBack.
- [ ] **Android 8.0 PIN screen opened by the card's Allow.** The PIN screen's keyboard may not open by itself; after a
      tap on the field and the PIN, that request is sent and the keyboard is gone from the panel. Seen on an Android
      8.0 emulator (2026-11-22).

Part 3, the Progress and Done states and the links between states. Not yet on a phone.

- [ ] **The working card, on a phone with Hermes.** Tap the working card's body during a turn. Expected: the panel
      opens on the chat's live step, the arc turning, the clock counting; the headline changes in place as steps run.
- [ ] **Task list.** A turn with a task list: the bar shows each task, the current one in gold; a finished task fills
      green with a short swell and the next turns gold; "2 of 5 tasks" counts. A turn without one: the sweep runs.
- [ ] **Other busy chats.** Two other chats at work: both listed under the step; with three or more, two and
      "+N more chats".
- [ ] **An app in use.** While Hermux uses an app for this chat (Android 14+), the working card opens the live viewer
      as before. With the panel already open on Progress when Hermux starts using an app: the app row appears with
      its picture, "Using X" and Watch, which opens the live viewer.
- [ ] **Stop.** Expected: "Stopping…", then "Stopped" with the red cross, and the panel closes; the chat shows the
      turn stopped exactly as the app's own Stop does. With Hermes unreachable: "Couldn't stop Hermux. Open the chat
      to stop it." within 15 s.
- [ ] **The 90 s close.** Leave Progress open without touching it. Expected: it closes after 90 s; a touch resets
      the wait. Done stays open.
- [ ] **Done.** Leave the panel open until the turn ends. Expected: the check pops with the ring, "Done", the first
      lines of the reply, steps and time; Open chat opens the chat and the chip's Done goes away.
- [ ] **Changing in place.** A permission request or a question arriving while Progress shows: the panel changes to
      it. After answering it from the panel with another waiting: the next one takes its place.
- [ ] **Change-in-place hold (keyboard and TalkBack).** With a keyboard, D-pad, Switch Access or TalkBack active on
      Progress or Done, trigger a permission request arriving in place and press Enter/Space or activate Allow once
      immediately during the fade-in. Expected: focus stays off the new content until the fade-in ends, activation keys
      and accessibility clicks on Allow once / Allow this session (and on Question choices / Send / Progress Stop during
      the fade-in) do nothing, and Back still closes the panel.
- [ ] **Longer Allow pause on change in place (normal and reduced motion).** While tapping Open chat on Progress or
      Done, have a permission request arrive in place and tap Allow once right as it appears (and again immediately if
      swallowed). Expected: Allow once and Allow this session ignore taps for about 580 ms (anchored to fade-in
      completion plus a reaction pause, extended briefly after a swallowed tap, same with Remove animations on), while
      Deny works as soon as the request is visible. Also let Deny fail to send: Allow once stays disabled until it has
      faded back in.
- [ ] **A card answer.** Allow once, Deny or a choice from a card's own button. Expected: the chip says "Allowed",
      "Denied" or "Sent" for two seconds, then the usual state.
- [ ] **Lock screen.** With the phone locked during a turn, the working card unlocks first; the app's picture never
      shows on the lock screen.
- [ ] **Battery, Progress.** Close the panel during a turn and leave the phone: no wake-ups or frames from the panel
      (`adb shell dumpsys gfxinfo` shows no new frames for the app).
- [ ] **Animations off, Progress and Done.** The arc stands still, the sweep's band sits in the middle, the clock
      still counts; Done's check draws without a pop.

## Phone data for the agent (Settings → Access & privacy → Phone data)

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
- [ ] After some reads, Settings → About & help → Report a problem, look at the text before sending. Expected: no names,
      numbers, message text or coordinates.
- [ ] Fill the record of chats (many chats that read) if you can, or check the rows by their spec: the "Allow more chats"
      and "Forget" rows in Settings, each asking for the screen lock; "Forget" warns first.
- [ ] A phone with no screen lock: try to turn a switch on. Expected: it says a screen lock is needed and stays off.
- [ ] Android 8, 9, 10, 12, 13 and 14 phones, if at hand: turn on SMS and call log on a sideloaded install and note the
      permission dialog (some Android versions restrict these for sideloaded apps); on 13 and 14 turn on Latest photos
      and note the permission asked (and, on 14, "selected photos only").
- [ ] A hostile text that the model does obey (for example, a message telling it to put the data in an image address):
      confirm the image is still not requested, so the native filter is exercised in a real WebView.

## What's new after an update

Needs a release-style build with a plain version name (`VERSION_NAME=0.9.7 android/build.sh`: a `+devtools` name keeps
the sheet away by design) and Settings → About & help → Remote debugging to change `hm.whatsNewSeen.v1`.

Seen on an Android 16 phone (build `0.9.7` at d66178c, before the scroll bar): with the stored version set to 0.9.5 the
sheet opened about 25 ms after the chat, listed 0.9.7 and 0.9.6 from the real changelog with "Smaller changes and fixes"
last, one changelog request; Details / Hide details, dark and light themes, Got it, ✕, Back, drag down and backdrop all
worked and the sheet stayed away after a restart; a blocked changelog showed nothing and kept the version for the next
start; a stored 0.9.9 or 0.9.7 showed nothing; no stored version stored 0.9.7 silently; it waited while the chat
options sheet was open. Back, the drag and the offline case were driven from the computer (script events, blocked
requests), not by hand or airplane mode.

- [ ] The scroll bar: on a phone, a long list shows a visible bar at the right of the sheet even when not scrolling.
- [ ] A real update from an installed older release to the next one, by hand.
- [ ] Settings → About & help → What's new (before an update) still opens, once a release newer than the installed one exists.

## Security fixes (the `security-fixes` PR): phone pass 2026-11-16

Driven over adb by a local agent on a Xiaomi phone, Android 16 (HyperOS). Nothing failed; the open items are checks
that were not finished, not faults.

- [x] **Web pictures in replies wait for a tap.** Remote pictures in a reply, a tool card and a `/btw` answer stayed
  held until tapped (no request before the tap, one after); a local camera picture showed at once.
- [x] **Diagrams.** Safe Mermaid diagrams drew; one carrying a picture or an address showed as code and fetched nothing.
- [x] **Page policy.** KaTeX, OpenUI cards, Canvas offline and online, a Canvas form post and YouTube playback worked;
  an outside script was blocked by the policy and nothing was refused at start-up. The YouTube preview picture loads
  before Play, as the spec says (3.3).
- [x] **Untrusted intent extras.** `session` and `draft` opened no chat and wrote no draft; `updateUrl` started no
  update; `unlock=true` left the app behind the lock screen; `clearDone=true` cleared nothing.
- [x] **Shares of the app's own files.** A `file://` address of the app's preferences and a `content://` address of
  the app's camera provider added nothing to the composer; a plain-text share filled a new draft.
- [x] **Done chip and approval notification.** The Done chip opened its chat; the approval notification opened the
  confirmation sheet and asked for the fingerprint. The approval had expired, so nothing ran, and the notification said
  "Couldn't send your answer" / "Open Hermux to answer (HTTP 409)".
- [ ] The remaining notification actions and launcher shortcuts (New chat worked; the last-chat shortcut was seen but
  not tapped; Live mode asked for the microphone and then said "Allow the microphone to use live mode", so the grant
  itself is unchecked).
- [ ] Sharing a picture, a PDF and several files from Gallery or a file manager (adb shares carry no read grant, so
  they read as unreadable).
- [ ] The Shizuku helper recovery: back up and remove `~/bin/rish` and `rish_shizuku.dex`, run the setup script again,
  and check it restores them, plus its error cases. Not tried; the agent left a copy `~/bin/rish.pr163bak` on the
  phone, which can be deleted.
- [ ] A fresh approval answered from the notification (only an expired one was tried).

## Installer liveness (the beat and the lost state): emulator pass 2026-11-16

Emulator (AOSP Android 15, arm64), build from `main` at the #185 merge. The command was typed with `adb shell input text`
(Termux's paste menu didn't open on the emulator), same command and one-time token.

- [x] Copied and not pasted: after more than 3 minutes the card still read "Waiting for the installer to start", never stopped.
- [x] Termux force-stopped on the Hermes step: the card read "The installer stopped at Hermux agent … It stopped without saying
      why" 124 s later, and the notification changed to "Setup stopped: open Hermux".
- [x] Pasted again: "Installing Hermux" with steps ticking within a minute.
- [x] Screen off for about 10 minutes of the run: DONE arrived with the screen off, never read as stopped.
- [ ] After DONE, the model card: not reached; the flow moved on and stopped at the Shizuku row, which the emulator can't authorise.
- [ ] On a real phone: vendor background limits, a phone restart mid-install.

Found and fixed after this pass: the stopped card's "So far" kept counting (it now stops where the installer was last
heard), and the kill left `.git/index.lock` in the Hermes checkout, so the next run stopped with "could not write index"
(the installer now removes git locks over 2 minutes old there).

## Trying the redesign build

The `redesign` branch reaches `main` only after the owner has tried it on a phone. How to build it and how to go back to
the release are in `docs/status/ui-revamp.md`. The browser checks cover what a page can show; these lines are what only a
phone shows, in the order a person meets them. Try each on the redesign build, then again after going back to the release.

- [ ] Start-up: the app opens on the last chat from its cache, then goes live; Settings → About & help shows the redesign version name.
- [ ] The keyboard: tap the text box; the composer sits right above the keyboard, the last message stays readable, nothing jumps when it closes.
- [ ] A quick request typed one-handed, then the same by Dictate (the phone's or the on-device recogniser); Stop dictation ends it.
- [ ] Live mode from the composer: talk, pause, hear the reply; Interrupt and talking over it cut in; Mute microphone; End.
- [ ] Live mode from the launcher shortcut and from long-press power (Hermux as the Digital assistant), also over the lock screen.
- [ ] Read aloud a long reply: pause, the seek bar, 5 seconds back and forward, speed, close; the card in the notification shade follows it, with the screen locked too.
- [ ] Notifications without emoji: the working chip, the Done chip (one chat, then several), a memory and a skill chip, an approval (Allow once, Allow session, Deny) and a question notification, the read-aloud player and a scheduled job's result read as plain words, with no emoji or symbol in a title, button or channel name (Settings, Apps, Notifications).
- [ ] Share into the app: a photo and a text from another app, and a camera shot from the + sheet; they land in the composer and send.
- [ ] Share a chat as Markdown and save a photo from the viewer (Pictures/Hermux); open a link from a reply in the default app.
- [ ] An approval: the first Allow in a chat asks for the fingerprint or screen lock; later ones in that chat don't; Deny never asks.
- [ ] Leave the app during a reply: the status chip (a Live Update on Android 16, a notification on older Android) shows the progress; Stop from it.
- [ ] Answer a question and an approval from the chip or the notification (Allow once, choices, a typed reply), with the app closed.
- [ ] Replies, cron results and a failed turn notify while the app is closed; the Done chip lists them, one tap clears it; the app-icon badge counts unseen chats.
- [ ] The background-app viewer: Hermux uses an app on a hidden screen (`phone_app`); the card, the live thumbnail, Take over and Stop.
- [ ] The setup check and the Backend status sheet (Shizuku row) after a phone restart; Shizuku restarts by itself.
- [ ] The drawn icons at real size on a phone: Settings rows, the chat menu, tool lines, the chat list's swipe strips and the composer's attachment chips look right in the Dark, OLED black and Light themes, and none is cut off or too big.
- [ ] A tablet or a foldable opened: two columns, the canvas beside the chat, the divider dragged.
- [ ] Glass: the chat scrolls under the header and the composer; a photo or a code block passing behind them blurs, and the title, the status line and the composer's text stay easy to read over it in Default, OLED black and Light. A menu, a dialog and a toast are glass too; with a sheet open the bars behind it are not blurred.
- [ ] Motion on a real phone (Settings → Appearance → Effects, Animations Full): sheets spring up and the chat steps back, a dialog sinks away, the chat list slides in, buttons press in; scrolling a long chat and a streamed reply stay smooth (no stutter) on a mid-range phone. Then Reduced (short fades, nothing repeats) and Off (every change instant).
- [ ] The phone's own "Remove animations" (Settings → Accessibility, or Developer options' animation scales at 0): with no choice made in the app, Animations shows Off.
- [ ] On a phone of another maker, or with an older Android System WebView: glass shows or falls back to solid bars cleanly, with no unreadable text and nothing missing.
- [ ] Ten minutes of the same working session twice, Glass effects and Animations Full first, then Glass effects off and Animations Off: compare the battery drop and how warm the phone gets.
- [ ] Ten minutes of ordinary use, then the battery drop compared with the release over the same ten minutes; the phone sleeps while Hermux is idle.
- [ ] The composer's tray: a new chat shows the model row open; sending the first message tucks it away and, the first time ever, "Model and context are here" shows for a few seconds (a touch takes it away). A chat from the list starts tucked away.
- [ ] The tray's handle on a real phone: a tap opens and closes it; a drag follows the finger and a short flick is enough; it never fights the keyboard, the gesture bar, the drawer swipe or the pull-up for /btw; a button just above the bar is still tappable.
- [ ] The handle's colours: dim at rest, gold with a shimmer while a turn runs, amber and still while Hermux waits for an approval or an answer, the ring's colour when the context is nearly full; in Default, OLED black and Light; with Animations Reduced and Off the shimmer stops.
- [ ] Settings → Appearance → Model bar → Always open: the model row stays above the text box with no handle; back to Tucked away. TalkBack reads the handle as "Model and status, closed. Open" / "Model and status, open. Close".
- [ ] Ten minutes with a long turn running and the tray closed: the battery drop is no worse than with Always open.
- [ ] The side panel's edge swipe against Android's own back gesture: the sheet now starts 8 px from the edge. With gesture navigation on, swipe right from the left edge on a chat (the panel should follow the finger, not go Back); then from a little in (20 to 40 px). On a phone with three-button navigation too. Try with the chat scrolled, with a code block under the finger, and with a tablet-sized window.
- [ ] The side panel on a real phone: it floats 8 px in from the left, top and bottom edges with a strip of the chat on the right; the chat dims and steps back and returns on close; swipe right follows the finger and settles; a tap beside it, a swipe left and Back close it; the glass reads in Default, OLED black and Light over a photo in the chat; with Glass effects off it is a solid sheet in the same place.
- [ ] The side panel with the keyboard: tap the search field, the sheet's bottom edge sits just above the keyboard and the list scrolls; clearing the search brings the three rows back.
- [ ] The side panel's bar on the smallest phone you have (or Display size at its largest): the bot's name shortens first, the gear and New chat stay 44 px; a narrow phone shows New chat as the plus icon.
- [ ] The panel's rows: Scheduled shows the next run and Skills how many are on within a moment of opening; Library opens the three-part page and remembers the part; Back from each goes to the chat. The bot sheet switches bots, opens Memory and Bots.
- [ ] Ten minutes of the same working session, opening and closing the panel often, with glass and animations Full and then off: the battery drop and warmth are the same as before the panel changed.
- [ ] The chat list's order on a phone: open an old chat (from under This week or Older), send a message, open the panel: that chat is first, under Today. Leave the panel open while a reply lands in another chat (start one, open the panel, wait): no row moves, the line under that chat changes from "Working" to "Finished". Close and open the panel: it moves up. Keep a finger on the list (or scroll it slowly) while a new chat arrives (a scheduled job, or a chat made on another device): nothing re-sorts until the finger lifts.
- [ ] The chat list's lines with TalkBack: a working chat is read as "Working" and an unread one as "Finished, not opened yet", once each, before the title; a scheduled job's run says "Scheduled" and the job's name. The line never wraps at the largest font size.
- [ ] A custom order (drag a chat to a new place) stays put after messages arrive and the panel is reopened; Sort by recent still sorts it once. Pinned chats keep their order.
- [ ] The chat menu on a phone (Chat options at the top of a chat): Search opens the find bar, Canvas opens the canvas (its count matches the documents), Share opens Android's share sheet with the chat as Markdown, Pin puts the chat first under Pinned in the chat list and Unpin takes it out. Read replies aloud flips without closing the menu and the line under it changes; the next reply is read aloud. Archive starts a new chat and the old one is under Archived. Delete asks first. With TalkBack: each quick action is read with its full name ("Search in chat", "Share chat", "Pin to top"), the switch as a switch with its line, Undo last turn while a reply runs as dimmed with "Wait for the reply to finish".
- [ ] A chat's menu in the chat list opens over the open panel as a solid sheet (no blur on blur), Back closes it and leaves the panel open; the pencil renames, Pin to top, Archive and Delete work as before. On the smallest phone (or the largest Display size and font size) no label in either menu wraps.
- [ ] Chat details: Bot, Working folder, the model and provider, Usage when known; the copy button copies the Chat ID.
- [ ] The Settings main page on a phone: Search settings, then Hermux (Models, Connectors, Behaviour, Access & privacy) and This app (Appearance, Voice, About & help); the current model, the Auto mode, the theme and the app version on the right; no switch. At the largest font and Display size no title or line wraps (they end in "…"). With TalkBack each row is read as its title, line and value; Back from every page goes up one step, and from the main page closes Settings.
- [ ] Access & privacy keeps every protection: turning "Confirm approvals with fingerprint" off asks for the fingerprint or screen lock first (a cancel leaves it on); Phone data asks Android for each permission and Forget asks first; turning a Background apps app to Always asks first; Auto for all chats to Full access asks first; Delete the log asks first. Then the same after going back to the release, in their old places.
- [ ] The attention cards: with Hermux stopped (Settings → About & help → Reconnect, or Termux closed), the main page shows "Hermux is offline" in red; Reconnect brings it back and the card goes. A new bot with no provider shows "Connect a model" in gold; Add a provider opens Add a provider (since task 07). When an update exists the card "Update to <version>" downloads and installs it as the row did.
- [ ] Behaviour opens on Replies with Dynamic UI first; "See what Hermux remembers" opens Memory, and Back returns to Behaviour; Advanced settings is last. Read every reply aloud is only on Voice.
- [ ] Ten minutes of ordinary use with Settings opened a few times: the battery drop is the same as before (the main page asks Hermes once whether a model is connected when it opens, and nothing repeats).
- [ ] Settings → Models on a phone (task 07): New chats use shows the bot's model and its provider; Connected lists each provider that is signed in or has a key, and a tap opens its sheet as before; Add a provider is the one gold button; If the model fails is closed, saying "None" or "N fallback models", and opens to the old list; All keys is dim and last. With two bots the chips show and the picker has "Set one model for all bots". TalkBack reads the fallback row as collapsed / expanded.
- [ ] Add a provider with a real account on a bot that has no model: sign in with ChatGPT (or another sign-in), approve it in the browser; back in the app the model picker opens by itself with only that provider's models; picking one ends on Models with "New chats use <model>", and a new chat answers. Then paste a real API key for a second provider: nothing opens by itself, the sheet's Choose a model works. Then your own server (Add an OpenAI-compatible endpoint) on a bot with no model: Save opens the picker for it. The Claude sign-in in Termux, then back to the app, does the same.
- [ ] The empty new-chat screen with no model (a new bot with no provider): "No model connected yet" and Connect a model under the line, the Hermux mark and title exactly where they are on a bot with a model (compare two screenshots); with the keyboard open nothing overlaps. Connect a model opens Add a provider, Back returns to the chat. Once a model is chosen the notice is gone on the next new chat.
- [ ] The chat's model sheet (the model chip above the text box): its last row "Add a provider" opens Settings on Add a provider, Android Back returns to the same chat with the draft kept.
- [ ] Needs you (task 08), with the app closed or on another chat: start a turn in a chat with Auto off that needs an approval, leave it and wait more than three minutes. Open the app: the header button is amber and TalkBack says "Chats (one needs you)"; the chat list has the group on top with "Needs you · wants to run a command". A tap opens the chat with the approval sheet; the first Allow asks for the fingerprint as always.
- [ ] Needs you, answered from the notification: with a chat in the group, answer it from the notification (Deny, or Allow once when the chat is already confirmed; a question from its Answer box) and come back: the row has left the group. On a locked phone the notification still needs the unlock first.
- [ ] Needs you, a question left for ten minutes: it is still in the group, and answering it on the sheet takes it out at once. TalkBack reads "Needs you", the title and what it waits for.
- [ ] Needs you, the sheet: two chats ask at once; tap one in the group and its own request shows first. A request from a chat that is not on screen says "From <chat>" under the sheet's handle; over the lock screen it doesn't, and the banner has no "Needs you" line.
- [ ] The sheet's pause: with two approvals waiting (two commands in one turn, or two chats), double-tap Allow once: only the first is allowed and the second stays on the sheet. Read it, tap Allow once about a second later, and it goes through. Deny works at once. Try with Animations on Full, Reduced and Off, and with TalkBack. With a second request arriving while the app is in the background, a tap right after coming back does nothing; a moment later it works. On a batch of questions that follows another request, a quick tap on a choice records nothing.
- [ ] Needs you with a chat from a messaging platform that asks: the row shows, opening it shows no sheet, and answering where it was asked removes the row. Say if this is confusing.
- [ ] Sub-agents (task 09), in a chat that starts several at once: they fold to one line; open it and tap one. The sheet opens at half height, Model and Reasoning show at once, pulling up stops under the header, and the output moves while it works. Check the level against Settings → Behaviour → Sub-agents and the chat's own level.
- [ ] A sub-agent, from its sheet: "Tell it something" reaches it, Stop asks first and ends it, and Android Back closes the sheet. With the keyboard open the field stays visible. Over the lock screen no goal or row shows and the sheet doesn't open.
- [ ] A sub-agent that needs approval, with only that one running: the request sheet says which one asks, with its goal in quotation marks; Allow still needs the fingerprint. With two running, or when the chat itself asks, it says "A sub-agent" or names nobody. Leave the chat: it stands in Needs you, and a nested sub-agent's request says "A sub-agent".
- [ ] A long chat that compresses while a sub-agent runs: its row and the composer's Stop stay, Stop still ends it, and leaving the chat doesn't stop it.
- [ ] The chat list with sub-agents: rows under their chat while they run, a tap opens the chat with the sheet, the rows fold to "N sub-agents" when all have ended, the chevron opens them, and swiping the parent still archives and deletes it as before. TalkBack reads a row's goal and state.
- [ ] Stop with sub-agents running after the reply has ended: the composer shows Stop, and it ends them all, at every depth.
- [ ] Ten sub-agents for ten minutes (`delegation.max_concurrent_children`): the chat and the list scroll smoothly; compare heat and the battery drop with a chat without them. With a sub-agent's sheet open, then closed, the battery screen shows no extra wake-ups once it is closed.
- [ ] `/bg` in a chat that has read phone data is refused with the reason, and works in a new chat.
- [ ] A chat that has read phone data, in Debian with Hermes running: `/bg` is refused with the reason, and a quick command aimed at `/bg` starts a task whose network command is blocked. Start a `/bg` task in another chat, let that chat read phone data while the task runs: the task's next network command is blocked.
- [ ] Branch a chat that has read phone data: remote images in the branch wait for a tap at once, and its first network command asks. In a new chat, ask the agent to search for words from that chat: its next network command asks.
- [ ] `/cron add`, `/kanban create` and `/blueprint <name> a=b` are refused in a chat that has read phone data and work in a new chat. `/cron list` works in both.
- [ ] Over the lock screen (Talk to Hermes on the lock screen on): in a chat in Full access a slash command asks for an unlock and `/yolo off` works; in a chat with approvals on `/bg` asks for an unlock.
- [ ] Over the lock screen, in a chat with approvals on: type `/approvals off`, `/cron run <a job>` and a quick command from your config: each asks for an unlock and nothing changes (`/approvals` afterwards still says manual). `/status`, `/help` and `/kanban list` still answer. Say whether the keyboard over the lock screen works at all on your phone, and whether Live mode ever turns speech into text starting with `/`.
- [ ] Unlocked: `/approvals off` shows the Full access warning; Cancel leaves `/approvals` at manual, Allow sets it off. Set it back with `/approvals manual`.
- [ ] Open a chat with an answer, open the side chat (`/btw`) or start editing a message, then lock the phone and bring
      the app back over the lock screen: the side chat and the edit box are closed, and no message has Edit or Retry.
      After unlocking they are back.
- [ ] A chat that has read phone data, in Debian with Hermes running: start `/bg` asking it to run `hermes chat -q hi`, `rish -c id`, and a script it writes to `/tmp`: each is blocked in the task, while `ls` and `cat` of a file work. `/kanban swarm x` and `/bp <name> a=b` are refused in that chat.
- [ ] Branch a chat before it reads phone data, then let it read: the branch's network commands don't ask. In a new chat, ask the agent to list recent chats without searching: its network commands don't ask.
- [ ] Go back to the release (`docs/status/ui-revamp.md`): the chats, drafts, pins, theme and settings are all there and the release works.

## Model picker opens at once (not yet on a phone)

- [ ] Open a chat's model picker twice: the second open shows the list at once (no "Loading models…"), and the list
      matches the providers that are signed in on that profile.
- [ ] "Refresh the list" shows "Updating the list…", then new models a provider added show up.
- [ ] Sign in to a provider (or save a key), then open the picker: its models are there after the refresh.
- [ ] With a reply running in another chat, opening the picker no longer slows that reply.
- [ ] Stop the dashboard (Hermes running without the plugin's dashboard): Settings → Model providers shows
      "Hermux unreachable" with a "Setup check" link that opens Setup check; Back returns to Settings.

## Inner pages (task 10, not yet on a phone)

- [ ] In a chat, tap a photo's remove button, the compress hint's close button, the canvas tools and each reply action
      with a thumb: each one takes the tap at its edge, and a tap just below a reply action never opens the next message.
- [ ] The chat shows as many lines as before (idle and with the keyboard open).
- [ ] Change a setting that applies to new chats (a model, Dynamic UI, an app in Connectors): the toast says "Applies to
      new chats"; New chat on it closes Settings and opens a new chat.
- [ ] With one bot, no bot chips anywhere; add a second bot: the chips come back and each bot page's top bar names its bot.
- [ ] Empty Skills, Memory, Scheduled and Library parts: each button starts the right thing.
- [ ] On a tablet or a phone in landscape: pages and sheets keep a centred width; Light theme small text reads well.

## A calmer chat (task 11, not yet on a phone)

- [ ] Ask for something that takes several tools and a long answer. While it works, every step shows. When it ends while
      you are at the bottom with the answer filling the screen, the steps fold into "Worked … · N steps" and the answer
      does not move; with a short answer the steps stay until you open the chat again.
- [ ] Scroll up to earlier text while a turn works: when it ends, the text you read does not move.
- [ ] Tap a "Worked" line: the steps appear (Animations Full: they rise in; Off: at once), every step and run as before;
      tap again to fold. Leave the chat and come back: every finished turn is folded again.
- [ ] A turn where a sub-agent failed: the line ends "· 1 failed" in red; opening it brings the failed step to the top.
- [ ] Find in chat for a word inside a folded tool output, a search hit from the chat list, and the scrubber on a long
      chat: each lands on its message with the fold open.
- [ ] A finished thought reads "Thought for 12s" with its first line on the same row, and "Thought process" in a chat
      reopened from history. The status line's time and speed keep still as they count.
- [ ] TalkBack reads the line as one button with its state ("expanded" / "collapsed").
- [ ] A long chat of many folded turns opens and scrolls as smoothly as before.

## Text size from the phone and the notification switches (task 12, not yet on a phone)

Text size (Settings → Appearance → Text size):

- [ ] In Appearance tap Phone default (it shows as chosen; it already is when no size was ever picked). Android Settings → Display → Font size: set the largest
      size. Go back to Hermux: the app restarts its screen and every text is bigger, at most 135 % (the footer says
      "Phone default follows your phone’s font size (135% here)."). Set the smallest: the text is 90 %. Set the default:
      100 %.
- [ ] With the phone at its largest font, pick 110 % in Appearance: the app shows 110 % and keeps it after a force-stop
      and restart. Change the phone's font size again: Hermux stays at 110 %. Tap Phone default: it follows the phone
      again at once.
- [ ] At the phone's largest font on the narrowest phone you have (or `adb shell wm size 720x1520` and
      `adb shell wm density 360` for about 320 dp wide; `wm size reset` and `wm density reset` after): the chat, the
      composer with the keyboard open, the side panel, the chat's menu and every Settings page show every button whole
      and nothing scrolls sideways.
- [ ] Light theme: the gold words (links, chips, the Send button's colour) read clearly on white in daylight.

Notifications (Settings → Notifications). Before each, leave the app with Home so it is not on screen:

- [ ] **When a task finishes off.** Turn it off. Ask a question and leave the app: when the reply is done, no Done chip,
      no reply card and no badge appear; the working chip shows while it works and goes to Ready. With read-aloud on,
      the reply is still read aloud. A scheduled job that runs (Scheduled → a job → Run now) posts no card. Open the
      app: the chat has its unread dot. Turn it back on: the next reply posts the Done chip and the card as before.
- [ ] **When Hermux needs me off.** Turn it off: the app asks "Hermux will wait silently until you open the app."
      first; Cancel keeps it on. Turn it off, ask for something that needs an approval (with Auto off) and leave the
      app: no pop-up, no approval chip and no re-alert at 20 s and 40 s; the status chip shows the working state only.
      Open the app within the timeout: the approval sheet is there and the chat is under Needs you; Allow works (with
      the fingerprint prompt when "Confirm approvals with fingerprint" is on). Let one time out instead: Hermes gets
      no answer from the phone (it times out as it does when nobody answers).
- [ ] The same with a question (`clarify`) and with a phone-data approval (Settings → Access & privacy → Phone data on,
      ask "who called me today"): neither posts anything; both wait in the app.
- [ ] A masked prompt (a sudo password or a secret Hermes asks for) with the app in the background: no "Hermux needs
      your input" while needs me is off, and it is there when the app opens.
- [ ] While an approval chip is showing, open the app, turn needs me off, leave the app: the chip and the pop-up are
      gone and the approval still waits in the app. Turn it back on while one waits: the chip shows it again with Allow
      once, Allow session and Deny, and Allow from the chip still opens the app while "Confirm approvals with
      fingerprint" is on, and on a locked phone still asks for the unlock first.
- [ ] Sound, vibration and the lock screen opens Android's notification page for Hermux; a channel turned silent there
      stays silent after both switches are turned off and on again.
- [ ] Android 13+: Android Settings → Apps → Hermux → Notifications off. Settings → Notifications shows "Notifications
      are off" and the main page's row says "Off in Android". After one refusal of Android's dialog, the button says
      "Turn on notifications" and shows the dialog; after "Don't allow" twice it says "Open Android settings" and opens
      the page. Turning them on there and coming back removes the notice. Android 8 to 12: the button opens the page.
- [ ] A phone with no app notification page (some makers): Sound, vibration and the lock screen opens the app's own
      App info page instead.

## Agent motion (task 13, not yet on a phone)

Settings → Appearance → Animations Full, glass on, unless a step says otherwise.

- [ ] Send a question that takes a few tools. The message lifts out of the text box; Send turns into Stop with a small
      turn; a gold light travels round the text box and a faint gold glow shows behind the chat (none in OLED black).
      The header and the text box never jump in height, with the keyboard open and closed.
- [ ] While it works, only the running step shimmers; each finished step draws a green tick before its time, once.
      Reopen the chat: the ticks are there and nothing draws.
- [ ] A step that fails (for example ask it to read a file that does not exist): a red cross draws and the step's line
      shakes once.
- [ ] While it thinks, the dot beside "Thinking…" turns; it settles when "Thought for …" shows.
- [ ] While the reply streams the text above never moves, and
      scrolling up while it streams keeps the text you read in place.
- [ ] When the reply ends: the light fades, Stop turns back into Send, the reply's buttons settle in, and the phone
      gives one light tick. A reply that ends while the phone is locked over the lock screen (Talk to Hermux) gives no
      tick; one that ends while you are in another app gives none either.
- [ ] An approval or a question (Auto off): the light stands still in amber until you answer, then turns gold again;
      meanwhile nothing else moves (the running step, the sub-agent group's line and lanes stand still).
- [ ] With the Model bar tucked away, the handle is gold and still while Hermux works; at no moment do more than two
      things repeat (the light and one step, thought, caret or lane).
- [ ] Ask for two sub-agents and open their group: each row has a thin lane; the working one moves, a finished one is
      filled green and still, a failed one red; the group's line does not shimmer while open. A failed sub-agent makes
      the group's line shake once.
- [ ] Hermux uses an app in the background: its card above the text box carries the travelling light and the text
      box's light stays lit and still.
- [ ] Leave the app with Home while it works and come back: everything was still while away and runs on at once.
- [ ] Animations Reduced: the same states show as short fades, the light is a still gold edge, nothing repeats.
      Animations Off: every change is instant and each state still shows (the still edge, ticks, words).
- [ ] TalkBack: Stop, Send, the ticks ("done"), the crosses ("failed") and the thinking line read as before; nothing
      that moves is read twice.
- [ ] **Ten minutes of work, battery.** Charge to about 80 % and unplug. Settings → Appearance: glass on, Animations
      Full, theme Dark. Give Hermux a task that keeps it working for about ten minutes (for example "go through the
      files in my Downloads one by one and summarise each"), keep the app open on the chat with the screen on and
      brightness fixed, and note the battery level and Android's battery use for Hermux before and after, and whether
      the phone grows warm. Repeat with glass off and Animations Off. Write both results in
      `docs/performance-history.md`; the first should use at most a little more than the second.
