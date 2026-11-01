# Manual tests

Checks that need a person, a voice, extra hardware or another computer, so they can't be run over adb.
Tick an item off (or note what went wrong) once it's done; the status per feature is in `improvements.md`.

## Voice (Live mode)

- [ ] **Approval by voice (#33).** Start Live mode in a test chat and say "run chmod 777 /tmp/x".
      Expected: Hermes asks "Hermes needs your permission. Allow or deny?" (short, not the whole command);
      saying "allow" runs it, "deny" refuses it. Say something unclear twice: the approval sheet appears instead.
- [ ] **Live mode in the background.** While Hermes is speaking in Live mode, press Home.
      Expected: it keeps speaking to the end; Live mode is off when you come back to the app.

## Read-aloud controls

- [ ] **Lock screen.** Tap Read aloud on a long reply, lock the phone.
      Expected: the player is on the lock screen; Pause/Play, back 10 s and forward 10 s work.
- [ ] **Headset.** Same, with Bluetooth or wired headphones: the play/pause button pauses and resumes; next/previous
      (double/triple press) jump 10 s forward/back.
- [ ] **Paused card swiped away.** Pause the reading from the notification, swipe the card away.
      Expected: the reading stops; the app shows no player any more.
- [ ] **Assistant from the lock screen / headset.** With Hermes as the digital assistant app (long-press power while
      unlocked already works), lock the phone and long-press power; also press a headset's voice-assistant button.
      Expected: Hermes opens in Live mode (after unlocking, if the phone asks).

## Setup on other machines

- [ ] **Windows.** Run `tools/setup-phone.ps1` on a Windows PC with a phone connected over USB debugging.
      Expected: it completes; the app's Setup check shows files, Termux:API and Shizuku green.
- [ ] **A brand-new real phone.** Run `tools/setup-phone.sh` against a freshly reset (or never-used) Android phone.
      Expected: same as above, and a first message gets a reply. (The emulator run can't check vendor battery
      restrictions or a real Shizuku start.)
- [ ] **Setup flow at the Shizuku step.** On a phone where Hermes is installed but Shizuku isn't started, open the
      setup flow at "Hermes can see and use the screen (Shizuku)", tap Open Shizuku, start it, come back.
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

- [ ] **While you use the phone.** Watch a video, then by voice or from a chat ask Hermes to do something in an app
      (e.g. add a Keep note). Expected: the video keeps playing, no keyboard pops up, the chip says "Using <app>",
      the task gets done.
- [ ] **Locked phone.** Same with the screen locked (it worked in a test with the screen off; a real task not yet).
- [ ] **App lock.** An app behind the phone's app lock (HyperOS, Samsung, OnePlus/ColorOS… each has one) is refused
      with "another app opened instead … app lock": decide whether to take it out of the lock for Hermes.
- [ ] **Other phone makers.** Tested on a Xiaomi (Android 16) and an AOSP emulator (Android 15) only. On a Samsung,
      Pixel, OnePlus or Motorola with Android 14+: open an app, tap, type, Take over. Android 11-13: Settings →
      Background apps should say "Needs Android 14 or newer".
- [ ] **A banking app with the Settings toggle on** (opens; FLAG_SECURE screens may show black in the live view).
- [ ] **Faster steps.** Ask for something with several taps (a new note with a title). Expected: the steps run without a
      fixed pause between them, Hermes points at buttons by their text, and no keyboard shows in the live view.
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
