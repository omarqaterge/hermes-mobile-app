# UI revamp (the interface redesign)

**State:** started 2026-11-16. All of it is built on the long-lived branch `redesign` (made from `main` that day); every
task opens its PR against `redesign`, and nothing reaches `main` until the owner has tried it on a phone
([decision](../decisions/redesign-branch-until-tried.md)). Done so far:

- **The safety net (first task).** Nothing a user sees changed.
  - The record of today: `tools/web-e2e/baseline-checks.txt` lists the 1641 browser checks as they were when the
    redesign started; `tools/web-e2e/list-checks.sh --missing` names any of them that a later change removed or
    reworded (spec 7.2, 7.3).
  - Checks that prove the features the redesign touches *work*, each control found by its role and name, used, and its
    effect checked (the call the app makes, or the state that results): the chat list (search, a row's Rename, Pin to
    top and Unpin, Archive) in `04`, the composer (Commands, the reasoning level of an open chat) in `01`, a sub-agent's
    card in `03`, Scroll to the newest message in `06`, a reply's Copy and Branch in `07`, the chat menu and find in chat
    (Search in chat with Previous and Next match, Rename, Read every reply aloud, Undo last turn, Delete asking first) in
    `09`, Dictate and Stop dictation, Live conversation and End, the player's Reading position and Close player in `13`,
    the canvas bar's document menu (Rename, Version history, Close this document), Open the canvas and Resize the canvas
    on a wide screen in `16`, and Settings (search and Clear search, the themes, the text size, Set one model for all
    bots) in the new `30-settings.cjs`.
  - What must not move, in the new `31-fixed-points.cjs`: the chat header (57 px), the composer area (102 px) and the
    messages' visible height (581 px; 281 px with the keyboard open) at 360 x 740; the 17 `localStorage` keys a normal
    session writes, with their shapes; the 22 accessible names of the chat screen's controls. A later task may improve
    the heights, never make them worse, and may add keys and names, never drop or reshape one.
  - The phone checklist for trying a build: `docs/manual-tests.md`, "Trying the redesign build".
  - The island panel's design, prototype and plan (`docs/design/island-panel.md`, `docs/plans/15-island-panel.md`).

- **Drawn icons (task 01, PR against `redesign`).** `web/src/components/icons.tsx` (lucide-react 0.575.0 shapes) replaces
  every emoji and icon glyph in `web/src`; `tools/check-no-emoji.py` keeps it so (in `check.sh` and CI); the browser
  check `32-no-emoji.cjs` reads the rendered interface. Five checks found elements by an emoji and now use role and
  words (`01`, `07`, `08`, `10`, `12`); none was weakened. Needs a phone: how the icons look at real size (manual-tests).

- **No emoji outside the web interface (task 02, PR against `redesign`).** The Done, Skill and Memory chips, the approval
  buttons, the plugin's `flash` text and its tool registrations carry no emoji; `tools/check-no-emoji.py` now also reads
  `android/`, `hermes-plugin/` and `phone/` (tests excluded) and has its own test. Needs a phone: how the notifications
  read (manual-tests).

- **Glass and motion (task 02a, PR against `redesign`).** The material and the motion every later screen uses, with no
  screen redesigned: `web/src/glass.css` (glass tokens for Default, OLED black and Light, the `.glass` class, solid
  fallbacks), `web/src/motion.css` and `web/src/motion.ts` (springs, lengths, the Full / Reduced / Off levels, the
  stagger helper, pausing while away or off screen), `web/src/barinsets.ts` (the chat scrolls under its two glass bars,
  same heights). Settings → Appearance → Effects: Glass effects (`hm.glass`) and Animations (`hm.motion`), defaulting
  from the phone. Browser checks run with Animations Off unless about motion (`lib.cjs` `motionOff`); the new
  `33-glass-and-motion.cjs` checks heights, glass, contrast, the blur budget, each level, idle and the settings. Decisions:
  `glass-and-motion.md`, `redesign-costs-no-speed-or-battery.md`, `chat-height-belongs-to-content.md`. Costs at 4x CPU
  are within 5% of the build before (docs/performance-history.md). Not done: edge refraction (not measurable on a
  mid-range phone here); the chat list does not stagger its rows or step the chat back (each cost the list's work).
  Needs a phone: how glass looks and scrolls on a real phone and on other makers' WebViews, and the ten-minute battery
  session with the effects on and off (manual-tests).

- **The composer's tray (task 02b, PR against `redesign`).** The model row (model chip, Auto, last speed, context ring)
  and the live status line move into a tray above the text box with a handle on the bottom bar's top edge
  (`web/src/tray.ts`, `web/src/components/Tray.tsx`): open on a new chat, closed by its first message, closed for a chat
  from the list, kept as the person leaves it; a one-time hint (`hm.trayHint.v1`); Settings → Appearance → Chat screen →
  Model bar (`hm.modelBar`, Tucked away or Always open). Closed at 360 x 740: composer 69 px, messages 614 px idle and
  working, 314 px with the keyboard; open: 101 px idle, 122 px working. Legacy browser checks run with Always open
  (`lib.cjs` `trayOpen`); `34-model-bar-tray.cjs` checks the tucked mode; `31-fixed-points.cjs` was re-recorded with the
  tray closed (`trayTucked`). Costs at 4x CPU unchanged (docs/performance-history.md). Needs a phone: the drag against
  the keyboard and the gesture bar, the hint, the handle's colours, battery while a turn runs (manual-tests).
  - `tools/web-e2e/list-checks.sh --missing` names one check that was reworded on `redesign` before this task
    (`24-hermes-settings.cjs`, "hermes settings: the list row counts its items", commit 0931f45), not by it.
  - `web/src/remote-hold.test.tsx` failed once in a full `tools/check.sh --all` (all its tests passed; vitest counted an
    unhandled `ReferenceError: window is not defined` from React's scheduler) and passed in six full vitest runs after:
    the test mounts React roots and never unmounts them, so scheduled work can run after happy-dom has torn the window
    down when the machine is busy. Neither the test nor what it imports is changed by this task; unmounting its roots
    belongs in its own PR.
  - `tools/test_hermes_patches.sh` leaves its clone of Hermes (about 186 MB) in the temp folder after every run: its
    `trap` removes the two worktrees and `$work`, not `$src` (line 15). On a full disk the next run fails with "No space
    left on device". Fixing the script belongs in its own PR.

- **The side panel (task 03, PR against `redesign`).** The chat list is a glass sheet that lies over the chat
  (`web/src/panel.css`, `components/Drawer.tsx`): 8 px from the left, top and bottom edges, `min(80vw, 330px)` wide,
  corners 24 px; the chat dims and (Full animations) steps back behind it; solid without glass; on a wide screen the
  docked column as before (the same sheet when hidden). Inside: the search field ("Search chats"), three rows that scroll
  with the list (Scheduled with the next run, Skills with "N on", Library; values from `panelvalues.ts`, read when the
  panel opens, at most once a minute, no timer), the unchanged chat list, and a pinned bar with the bot (opens the bot
  sheet: switch bot, "What <bot> remembers", "Manage bots"), a Settings gear and a gold New chat. Gone: the three tiles,
  the Hermux hub page (`hub`), the top bot switcher and `screenBack` (Back from every page goes to the chat). Files,
  Projects and the canvas gallery are the three parts of the new Library page (`library`, `Library.tsx`; the part is
  remembered in `hm.libraryPart`; the screen values `files`, `projects` and `gallery` are gone from the store, kept only
  in the usage stats' list of names). Checks: `35-side-panel.cjs`; the hub and panel checks in `04`, `10`, `11` and the
  gesture check in `15` were rewritten for the new places (listed in the PR). Decisions: `side-panel-layout.md`,
  `glass-and-motion.md` (the panel now steps the chat back). Costs at 4x CPU: `docs/performance-history.md`. Needs a
  phone: the edge swipe against Android's back gesture, the glass over a real photo, the keyboard, battery
  (manual-tests). Not done: nested rows under a chat (task 09 leaves room: a row can be indented), and a closed panel's
  list still receives store updates (it is not drawn or animated while closed, but React still renders it).

- **The chat list's order and state words (task 04, PR against `redesign`).** The Chats list and its date groups follow
  each chat's last activity, newest first, from a snapshot (`web/src/chatsnapshot.ts`) taken when the panel starts to
  open (button or swipe), at the first list from Hermes, when the bot changes, when a chat is created, deleted,
  archived or restored, and, docked on a wide screen, when another chat opens or the app returns; never under a finger
  or during a drag, and never because a message arrived (an old chat that a message brings into the page of 80 waits at
  its creation time until the next snapshot). A custom order, Sort by recent and pins are unchanged. The line under a
  title: time, then "Working" or "Finished", then the source; a scheduled run shows a clock and its job's name (from the
  jobs list the panel already reads). "N msgs" is gone with the app's `POST /sent-counts` call (the plugin keeps the
  route). Decision: `chats-ordered-by-last-activity.md`. Checks: the end of `04` (the mock is put back afterwards), two
  rewritten and one removed in `08` (listed in the PR); `uicost.cjs` gained "scrolling the chat list". Costs:
  docs/performance-history.md. Needs a phone: the order and the lines with TalkBack (manual-tests). Left for task 09:
  nested rows go inside their chat's row container, so they move with it.

- **The chat menu (task 05, PR against `redesign`).** One look for every menu of a chat, from new parts in `ui.tsx`
  (`MenuSheet`, `MenuHeader`, `MenuActions` / `MenuAction`, `MenuGroup`, `MenuRow`, `MenuNote`; the look in
  `web/src/menu.css`), and `PickerSheet`'s rows restyled to match. The header's menu (`components/ChatMenu.tsx`
  `ChatMenuSheet`): the title with the model (and the bot, with several) and a Rename pencil; Search, Canvas (with a
  count), Share and Pin / Unpin as four quick actions; Read replies aloud as a real switch that flips in place ("Only
  this chat" / "Follows the setting for all chats"); Undo last turn (disabled while a reply runs, with the reason), File
  checkpoints, Chat details; Archive (a new draft follows) and Delete, red and last. A row's menu in the chat list has
  the same header and one group (Pin to top / Unpin, Archive / Unarchive, Delete); it opens over the panel as a solid
  sheet (no glass on glass; the panel and the place in the list stay) and Back now closes it. The new-chat menu: the
  switch and the note; Change model is gone. Chat details: groups Chat, Model, Usage, then Chat ID with a copy button;
  Bot, Working folder, Chat ID instead of Profile, Working dir, Session id. Pin, Archive and Delete from both menus go
  through `web/src/chatactions.ts`, so `chatListChanged` is called exactly as the list did (deleting from the header
  now also drops the chat from the pins and the custom order). A touch on a control in a sheet's top strip keeps its
  own tap (`useSheetDrag`). Checks: the end of `09` (header, every quick action, Undo while running, Archive, Delete,
  the draft menu, Chat details' copy, 320 px with a wider font in Default, Light and OLED, glass on and off, contrast
  with glass off) and of `04` (the row menu, solid over the panel, Back, the same layout checks); selectors that found
  the old menu by class were moved to role and name in `04`, `07`, `09`, `10`, `31`, `33` (listed in the PR).
  `uicost.cjs` gained two moments: opening a row's menu and opening the chat's menu. Costs:
  docs/performance-history.md. Needs a phone: the menus with TalkBack, Share's share sheet, the switch reading the next
  reply aloud (manual-tests). Not checked in the browser: Unarchive from an archived row (the mock lists no archived
  chats). Animations Off and the chat list: the ~190 ms in task 04's "effects off" rows was the measurement, not the
  app (the options most likely reached `uicost.cjs` as one word, so it ran with Full and glass on; it now stops on that):
  with `--motion off --glass off` both builds open the list in 11 ms. The menus under Off: the row menu 10 → 12 ms and the
  chat menu 10 → 11 ms at 4x CPU (traced: the chat menu draws its four tiles and three groups, about 2 ms of work; the
  row menu does the same work as before); everything else unchanged. Review round 1: CI's `04` "Pin to top pins the
  chat" failed once. Cause: `order.ts` `syncOrder` compared the phone's copy with the local copy read when it asked, so
  an answer that arrived after a pin put the older order back (reproduced by holding the GET's answer about 1.8 s).
  It now compares at answer time and uploads through the same debounce (`web/src/order.test.ts`); the check counts only
  writes made since it began. The race was on `redesign` already, the same code.

**Next:** the new look of the chat screen, the side panel, the
chat list, the chat menu and Settings, one task and one PR at a time (they share `web/src/styles.css`). Each task: its
PR against `redesign`, `tools/web-e2e/list-checks.sh --missing` clean (or each removed check named with the feature it
covered), `31-fixed-points.cjs` green.

**Found while making the safety net:**

- The browser checks run on every pull request whatever its base (`ci.yml` has `pull_request:` with no branch filter),
  and the slow groups are chosen from the PR's own file list (`gh pr diff`), so a PR against `redesign` is checked like
  one against `main`. Two differences: a push to `redesign` itself runs nothing (CI runs on pushes to `main` only, so
  merge only PRs whose checks passed), and `redesign` has no ruleset, so the required checks are not enforced there.
  `tools/check.sh` (no argument) and `tools/check-attribution.sh` compare with `origin/main`: on a branch from
  `redesign` they also take in what `redesign` already changed, which only makes them check more. A release can't come
  from `redesign`: `tools/release-gate.sh` needs the tagged commit on `main`.
- `rotation: adding writes the whole chain, keeping routing keys` (`23-provider-rotation.cjs`) failed once in a full
  `tools/check.sh --all` (seven shards in parallel) and passed three times out of three alone: the check reads the
  call log as soon as the new row shows, and the save can land a moment later. Not changed here.
- With the mock's empty command catalog the composer's `/` list stays empty, so the check for Commands can only show
  that it types `/` at the cursor; picking a command from the list has no browser check.

**The test build (an APK from `redesign` that installs over the released app):**

1. **Build.** From a checkout of `redesign` with nothing uncommitted, with the release signing key: the keystore file is
   the one stored base64 in the repository secret `KEYSTORE_B64` (decode it to a file outside the repository), and its
   password is the secret `KEYSTORE_PASS` (plus `KEYSTORE_KEY_PASS` if the key's differs). The build number must be the
   installed release's own, never higher: for v0.9.8 that is `908` (releases up to v0.9.8 used the old a*10000+b*100+c
   scheme, so `tools/version-code.sh 0.9.8` would give a higher `9008`; check the phone's with
   `adb shell dumpsys package com.omarqaterge.hermesmobile | grep version`).

   ```sh
   git fetch origin && git switch --detach origin/redesign
   cd android
   read -rs KEYSTORE_PASS && export KEYSTORE_PASS   # typed, so it is in no file and no shell history
   KEYSTORE=/path/outside/the/repo/release.keystore VERSION_NAME=0.9.8-redesign VERSION_CODE=908 ./build.sh
   ```

   Output: `android/build/hermes-mobile.apk`. Install it like an update (open the file on the phone, or
   `adb install -r android/build/hermes-mobile.apk`): same key and same build number, so Android keeps all the app's
   data. Never `HM_DEVTOOLS` with the release key (the script refuses). Settings → About shows `0.9.8-redesign`; the
   app's update check reads it as 0.9.8, so it offers nothing until the next release, which then replaces the test
   build as a normal update. Checked on 2026-11-17 with a throwaway key: the APK says versionCode 908, versionName
   0.9.8-redesign.

2. **What else it changes on the phone**, and whether the released app still works after going back:
   - **The Hermux plugin inside Hermes: yes, it is replaced.** The APK carries the plugin of the commit it was built
     from, stamped with that commit's time, which is newer than the release's, so the app's plugin update (spec 6.6)
     installs it at the first quiet moment. After going back, the release finds the installed plugin `newer` and leaves
     it ("Newer than this app's copy, so it was left as it is" in Settings → About → Hermux plugin): **the plugin stays
     on the redesign's copy**. Today that copy is `main`'s plugin, which differs from v0.9.8's only inside the plugin
     (bounded memory of chats and sub-agents, Auto access following a chat into its sub-agents, cards no longer allowed
     to call the two file tools, card pictures waiting for a tap); no route or field was removed or renamed, so the
     released app works with it. This holds only while redesign tasks add to the plugin and never remove or change what
     the release uses (brief: "the plugin stays able to serve the released app").
   - **The phone scripts: no change today.** The plugin update also brings `~/bin/hermes-services`, `hm-local` and
     `hm-shizuku`; all three are the same as in v0.9.8. `bootstrap.sh`, `install.sh` and `phone-access.sh` run only
     when installing, never from the app.
   - **Stored settings: added to, nothing renamed.** The web interface reads and writes the same 54 `localStorage` key
     names as v0.9.8 (compared in the source); the Android side adds two values to its preferences (`setup_failed`,
     `setup_seen`) and the bridge key, which the release ignores. Chats, drafts, pins, theme and every setting stay.
   - Hermes itself, its pin and patches, Debian and Termux are not touched (only `install.sh` changes them).

3. **Going back to the release, step by step:**
   1. Download the release APK (`hermux.apk` from the latest release on GitHub) on the phone.
   2. Open it and tap Update: same key and same build number, so it installs over the test build and keeps the data
      (from a computer: `adb install -r hermux.apk`). Do not uninstall the test build first: uninstalling deletes the
      app's data.
   3. Open Hermux: the chats and settings are there. Settings → About shows the release's version; the Hermux plugin
      row says the plugin is newer than this app's copy, which is expected (see 2).
   4. Optional, to put the release's own plugin back as well: in Termux run the installer again,
      `curl -fsSL https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/phone/install.sh | bash`. It
      takes the latest release (not `main`), installs that release's plugin and scripts and opens Android's installer
      for the release APK (the same build, so Update or cancel). Settings → About → Hermux plugin then says current.
   - To keep the release's plugin untouched for the whole trial instead: before installing the test build, in Debian
     run `touch /root/.hermes/hermes-mobile-plugin/hold` (the app then leaves the plugin and scripts alone, "Held for
     testing"), and `rm` that file after going back.

**Needs a real phone:** the checklist in `docs/manual-tests.md` ("Trying the redesign build"); the test build was built
here but not installed on a phone, and going back has not been tried on one.

**Links:** [decision: the redesign stays on its branch](../decisions/redesign-branch-until-tried.md),
[decision: no UI-coverage project before the revamp](../decisions/no-ui-test-work-before-revamp.md) (held until it
started), [where the UI work stands](ui-revamp-overview.md), [UI inventory](../design/ui-inventory.md),
[image prompts](../design/chatgpt-ui-prompts.md), [island panel design](../design/island-panel.md),
[research: how people use Hermes and what to keep on a phone](../research/hermes-usage-and-phone-ui.md) (2026-11-02),
[research: showing agent work in chat](../research/chat-tool-visuals.md) (2026-11-02).
