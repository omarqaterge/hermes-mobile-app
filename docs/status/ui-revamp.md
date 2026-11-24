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

- **The Settings main page (task 06, PR against `redesign`).** The main page is Search settings, the attention cards
  (Connect a model in gold → Models; Hermux is offline in red → Reconnect; Update to <version>, the update row itself;
  each only when it applies, `web/src/settings.css`) and two sections: Hermux (Models, Connectors, Behaviour, Access &
  privacy) and This app (Appearance, Voice, About & help), each row with its value or line and no switch. New pages:
  Models (Default models, Model providers, All keys), Access & privacy (Approvals, Phone data, Background apps, Kept on
  this phone) and About & help (Updates, Help, Versions, Developer, Uninstall last); "Hermux settings" is Behaviour,
  starting with Replies (Dynamic UI, moved to `components/DynamicUI.tsx`), with "See what Hermux remembers" (Memory
  inside Settings) and Advanced settings last. Back goes up one step (`PARENT` in `Settings.tsx`). The protected rows
  (Auto for all chats, Confirm approvals with fingerprint, Phone data, Background apps, the diagnostic log) are the same
  components, byte for byte, in their new place. Old place names in the app, the plugin's messages and the Android
  notification text now name the new places. Decision: `settings-layout.md`. Checks: the new part of `30-settings.cjs`;
  the other Settings checks only navigate differently (`lib.cjs` `settingsPage`), none removed or reworded. `uicost.cjs`
  gained opening Settings and each page. Costs: opening Settings is 10 to 20% cheaper, **opening Behaviour 9 to 12% more
  work** (the total for Settings then Behaviour is the same; cause not found after six tries, left for the owner:
  docs/performance-history.md). Needs a phone: the moved protections, the cards, TalkBack, battery (manual-tests).
  - Found, not changed (on `redesign` before this task, same failures there): `08-queue-and-feed.cjs` "then the saved
    document replaces it" and "idle label says who wrote it" fail when `run.sh --only 01-08` runs here and pass in `check.sh`'s 07-11 shard; at 4x CPU
    `16-canvas-panel.cjs` stops at its line 402 (`getByText('Plan', { exact: true })` finds the tab and the document's
    heading) and `29-phone-data.cjs` "a Markdown document's remote image waits behind a tap" failed once in three (it
    waits a fixed 900 ms for the document to open). Each belongs in its own PR.

- **One Models page and Add a provider (task 07, PR against `redesign`).** Settings → Models is one page (`ModelsPage`):
  bot chips with several bots, New chats use (the model picker, with the switch "Set one model for all bots" when there
  are several bots), Connected (`ProviderListView` part `connected` over `useCatalog`), the gold Add a provider, If the
  model fails (`FallbackSection` folded to "Fallback models · N fallback models / None", a `group` when open) and a dim
  All keys. With nothing connected and no working model, one sentence instead. The pages Default models and Model
  providers are gone; a new page Add a provider (`AddProviderPage`, `ProviderList` part `add`: Sign in with an account
  you have, Use an API key, All providers, Your own server, minus what is connected). After a first connect with no
  model the picker opens by itself for that provider and ends on Models ("New chats use <model>"). Ways in: the Connect
  a model card, the chat's model sheet's last row and the empty new-chat screen's "No model connected yet" notice
  (`openSettingsOn` in `settings-open.ts`; Back there returns to the chat). The model question is shared
  (`model-ready.ts`, asked once per bot while connected, again after a connect or a pick; no polling). The setup flow's
  model step keeps the whole list (part `all`). Checks: a new section in `23-provider-rotation.cjs`; three checks of
  `30-settings.cjs` rewritten because the pages they covered changed (listed in the PR). Chat height unchanged (614 /
  314 px at 360 x 740). Needs a phone: real sign-ins and keys, TalkBack, the empty screen (manual-tests).

- **"Needs you" (task 08, PR against `redesign`): what the app knows, found before building.** Read in the app, the
  plugin and the Hermes build the app is pinned to (`web/vendor/hermes-shared/.hermes-commit`).
  - **A chat the page is attached to: yes, at once.** A chat left running stays attached to the page's socket, so its
    approval or question arrives as a request in `store.requests`, with the live session id, and leaves through
    `request.cancel` when it is answered anywhere or times out. `App` draws it as the sheet whichever chat is open.
  - **Any other chat (the socket was replaced while the app was away, the usual case when someone comes back later):
    the page gets no frame until it opens that chat.** Then `session.resume` hands back the live session with
    `open_requests`, and the shared channel delivers them, so the existing sheet asks. Nothing is lost, but nothing
    tells the list either.
  - **`GET /activity` does not fill that gap today.** The hooks do set the status short to "Approve?" or "Asking", but
    a status with no tool running goes stale after 180 s (`STALE_AFTER`, and the route's own 180 s limit), while Hermes
    waits 300 s for an approval and 3600 s for a question by default. And "Approve?" stays after the answer until the
    next hook, so it can't be read as "still waiting".
  - **The Android service** knows the pending approval or question for its notification, from the plugin's events, but
    keeps it to itself; the page is not told.
  - **The smallest change:** one added field on the `GET /activity` answer, `waiting`: for each open request the chat
    id, a kind (`approval`, `phone_data`, `question`), who asks when it isn't the chat itself, and when it started and
    ends. It is set by the hooks that already fire, cleared by the ones that fire when the request ends, and carries no
    request text. It rides on the app's existing activity poll. **No Hermes patch, no new route, no new polling, no
    timer**, and it can't answer anything: answers still go through the sheet, the fingerprint and the unlock.
  - **Limit:** a chat running in another Hermes process (the messaging gateway) can show as waiting, but its request is
    not delivered to this page, as today: opening it shows no sheet, and it is answered where it was asked.
  - **Built.** `GET /activity` gained `waiting` (`tools/test_waiting.py`). `web/src/needsyou.ts` merges it with the page's
    own requests; the chat list has the Needs you group on top (amber dot, "Needs you · wants to run a command", no
    shimmer, no Allow or Deny; a tap opens the chat and the existing sheet asks); the header button turns amber and reads
    "Chats (one needs you)" / "Chats (2 need you)", before the unread state; a sub-agent's request shows its top chat with
    "A sub-agent …" (task 09 can put a name in `who`). Checks: the end of `05`.
  - **The banner differs from the task on purpose.** It names waiting chats first whenever it is showing, but a chat that
    only waits does not bring it up: a wait can last an hour, and a banner for that long took 32 px from the chat (614 to
    582 px, 314 to 282 with the keyboard). So the chat keeps its height in every state.
  - **Polling is unchanged:** a chat that only waits keeps the 9 s schedule, so one answered from a notification leaves the
    group at the next poll, or at once when the app returns to the screen. Answers given in the app or known to the
    socket take it out at once.
  - **Costs:** no change a person can feel at 4x CPU (docs/performance-history.md, measured again after review round 2), with no chat waiting. Chat
    height unchanged: 614 / 314 px at 360 x 740, also while a chat waits.
  - **Review round 1.** `activity.json` is treated as editable by an agent: the route and the writer take only well-formed
    entries (numeric pid, known kind and who, finite times, an end at most a day away), and the app prints only its own
    words. Writes hold a file lock (a few short tries, never a hang) through their own temporary file, and an unreadable
    file doesn't wipe other processes' requests. The feed also gives `open` and `last`, so a chat stays listed while
    another of its requests is open (`web/src/waiting.ts`). The sheet shows the tapped chat's request first and says
    "From <chat>" for a chat not on screen. Over the lock screen the banner line, a docked group and "From" are gone; the
    existing banner text "Waiting for your approval" still shows there, as before this task. A chat in the group keeps its
    place in Pinned. The checks in `05` find everything by role, name and visible text.
  - **Review round 2.** A request on the sheet now stays until it is answered or withdrawn; the chat opened from Needs you
    only decides what comes next, and the `waiting` feed has no say in that. The feed's reader can't hang (no blocking,
    regular files of at most 1 MiB), no entry can break it, its work lines carry only strings, and nothing is restored from
    memory: a failed read skips the write instead. The lock view clears the group at once. At the pinned Hermes every
    request the app accepts carries a session id, so nothing changed for a request without one.
  - **Review round 3.** A sheet that follows another request ignores answers for 700 ms, except Deny and Cancel. The feed
    refuses text that can't be encoded, replaces a file this user may not read, runs off the event loop, reads at most 64
    process entries, and drops entries dated in the future.
    The pause's browser checks live in `36-sheet-pause.cjs`: in `05` they kept the shared page idle for more than 45 s, so
    the app re-synced the chat `05` leaves running, and `06` saw a late `session.close`. Keep `05` short.
  - **Final review.** Only live processes count toward the feed's 64 places, and the writer drops dead ones and always
    keeps its own entry. The sheet's pause restarts when the app comes back and also covers choices, Next and the dots.
  - **Needs a phone:** a real wait of more than three minutes, answering from a notification, TalkBack (manual-tests).

- **Sub-agents and nested chats (task 09, PR against `redesign`).** Built: the one-line group in the chat, the sub-agent's
  sheet, the rows under a chat in the list, who asks on the request sheet (`web/src/subagents.ts`,
  `components/SubAgentsCore.tsx`, `subagents-core.css`, and the lazy bundle `hm-subagents` with the rows and the sheet:
  `components/SubAgents.tsx`, `subagents-view.ts`, `subagents.css`; the plugin's `nested` counts and `/nested` routes; checks in `38-subagents.cjs`,
  `web/src/subagents.test.ts`, `tools/test_nested.py`). **Background tasks are not built:** the owner chose on 2026-11-18 to
  leave them for later ([roadmap 21](../roadmap/21-background-tasks.md), [decision](../decisions/nested-chats.md)), because
  of what answers 3 and 6 below show. `/bg` is refused in a chat that has read phone data (its own PR). Where a goal comes
  from: the `subagent.*` events of the app's socket, or Hermes's stored chat through `GET /nested`, shown as plain text. The
  `activity.json` feed gives only numbers and the fixed words of task 08, because an agent can edit that file. Chat height
  unchanged while sub-agents run: 614 / 314 px at 360 x 740 (`38`). With ten running, no frame took over 25 ms in the chat
  or the list. After the rows and the sheet became a lazy bundle, start-up costs about 1% more work at 4x CPU (about 3 ms);
  the rise first reported for opening Behaviour was drift between runs (docs/performance-history.md). A security review's 14
  findings are fixed (who is named as asking, goals, what ends a record, Stop, leaving a chat, Continue, the plugin's rows). A second review's six are fixed too: the group of a chat being left while another opens is filed under the right chat and Continue checks Hermes's record; a compression keeps a chat's sub-agents (the old id leads to the new one); who asks is named only when one sub-agent runs and the feed's entry is about this request; a chat kept open for its sub-agents is closed once they end; more quote-like marks; the plugin's size limit counts bytes. A third review's eight are fixed: `_chat_segments` walks only compression continuations (never branches or sub-agents) and Continue fails closed with the lowest access of the real parent chain; Composer Stop is disabled while switching chats and `interrupt()` requires a settled view and checks `lockView()` for sub-agent-only stops; waiting `since`/`last` are clamped, `subAgentAsks` requires an `approval` within the slack window, and `AskedBy` shows only when `subAgentAsks` agrees; `continueSubAgent` re-checks `lockView()` after every `await`; `openNestedRow` requires `!opening`, navigation closes a mismatched sub-agent sheet, and `canContinue` uses `chatTainted(chat)`; `compressChat`, background/`kept` `session.info`, and `setNestedFeed` keep sub-agents across compression; the plugin `/nested*` routes bound queries, URI-escape and catch SQLite errors, and cap column/id lengths; the parent goal subtitle uses `quotedGoal` inside `<bdi>`, `closeLater` protects `kept` runtimes, and explicit Stop drops the 5 s roster grace with a single bounded follow-up sync. A fourth review's five are fixed: the chat made by Continue joins no lineage group (it is a different chat, and starts clean because Continue refuses when the chain read phone data); Continue refuses unless `GET /nested` sends 1 to 17 valid segments starting with the chat (an older plugin can no longer skip the earlier segments' checks); closing a compressed chat's live session forgets the fingerprint confirmation under every stored id it had; the chat on screen counts for phone data under any id it has had, so a sheet opened by the new id after a compression stays guarded; Continue's check after `session.resume` reads the chat on screen again and asks about the ids the resume answers with. A fifth review's two are fixed: the chat being left while another opens is judged for phone data by its own items and ids (not the preview drawn), and a sheet over the chat on screen asks about every id of its chat; a fingerprint confirmation is noted under every live session an approval came through and forgotten whenever one closes, is lost on a reconnect, is replaced by a new one for the same chat, or leaves the kept ones (at most 64 sessions and 32 ids each). Parts of the second were already in the released app (an overtaken opening, `syncRunning`, a reconnect, a resume with a new live session, no bound). A sixth review asked for every way a live session leaves the page's lists: each now keeps it in another list, closes it, or forgets the confirmations made through it (`unfollow`; the list is in spec 3.6 and the PR, one test row per path in `subagents-round6.test.tsx`). A seventh re-check still found paths (F1 to F6, and a page reload), so the confirmation is now filed under the live session (runtime id) instead of the chat (branch `approval-confirm-per-session`, a draft PR on top of this one): a new live session always asks, a closed one's id never returns, and the forgetting bookkeeping (`unfollow`, `forgetRuntime`, `idsOfRuntime`, `noteConfirmKey`) is gone; a page reload needs no clearing (a reattached live session within Hermes's 20 s is the same session), and the notification's Allow now always opens the app (it never names the live session). Needs a phone: the fingerprint prompt and the notification's Allow on Android 8, 11 and 12+. A swipe on a
  chat row now needs a press, because a mouse passing over a row could start one. Needs a phone: see
  `docs/manual-tests.md`.

  What the pinned Hermes does, found first by running it (b8a8be18 with `hermes/patches`, started by
  `tools/hermes-contract/start-hermes.sh`) with a scripted fake model and the app's calls, on a desktop:
  1. **A sub-agent's approval reaches the app: yes. It does not say which sub-agent asks.** It arrives as an ordinary
     `approval` request on the parent chat. Allow ran the command, Deny blocked it.
     The plugin's `waiting` lists the top chat with "A sub-agent" (read from `activity.json`: the route's `/proc` check
     can't pass on a desktop Mac). The request carries no sub-agent id or goal. For a top-level sub-agent the request's
     `command` was identical to the text of its latest `subagent.tool` event, so the app can name it by matching them. A
     nested sub-agent sends only `subagent.start` and `subagent.complete`, so it can't be matched and keeps the fixed
     words; neither can two sub-agents running the same command. **Questions:** a sub-agent has no `clarify` tool (calling
     it answers "Tool 'clarify' does not exist"), so it can't ask one. No Hermes patch is needed.
  2. **`subagent.tail`, `subagent.steer`, `subagent.interrupt` work,** at depth 0 and depth 1. `tail` gives a plain-text
     transcript (its header repeats the goal), `available: false` once finished or for an unknown id. `steer` answers
     `queued` and the text reached the sub-agent's next model request; after the end it answers `rejected`. `interrupt`
     stops that one only (its command is killed, state `interrupted`, a sibling's command runs to its end); after the end it
     answers `found: false`. `subagent.list` gives both depths with `parent_id`, `status`, `last_tool` and
     `accepting_steer`, and forgets a sub-agent when it ends.
  3. **`prompt.background` works, and does not follow the chat's rules.** It answers `task_id` and runs beside a reply.
     `background.complete` carries only `task_id` and `text` (a failure is the text `error: …`), not the prompt. Hermes's
     code sends nothing else for it, and the task is in neither `subagent.list` nor `delegation.status`. It has a
     stored chat (`bg_…`, source `tui`) with **`parent_session_id` empty**, which `session.list` returns as an ordinary
     chat with its own title. It starts with none of the chat's history. Its rules, for a command Hermes flags, compared
     with a sub-agent in the same chat:

     | The chat is in | Sub-agent | Background task |
     |---|---|---|
     | Off (asks) | asks in the app | **never asks**: left "pending approval", not run, the task carries on and reports done |
     | Full access | runs | **not run** (stricter than the chat) |
     | Auto access | blocked by the plugin | not run, by Hermes's check rather than Auto's |
     | Has read phone data, recorded under its stored id (any chat reopened since) | asks | **`curl` ran without asking** |
     | Has read phone data, recorded under both ids | not tested | not run |

     It runs under its own key (`bg_…`), so `/yolo`, the approval channel and the plugin's links to the chat don't reach it.
  4. **The reasoning level can be known without a Hermes patch.** The events and `SubagentSnapshot` don't carry it, but the
     sub-agent's stored chat does: `model_config.reasoning_config` in `GET /api/sessions/{child_session_id}`, there within
     a second of the start, while it runs and afterwards. Tested: nothing set gives the chat's level at that moment
     (high, and low after the chat changed); `delegation.reasoning_effort: minimal` gives minimal over a chat on high; `false`
     gives `enabled: false`; an unknown word falls back to the chat's. **Limit:** this is the level Hermes gave the
     sub-agent. On the way out Hermes lowers it to what the provider supports (`clamp_effort`), and for a sub-agent nothing
     reports that lowered level. The composer's chip also shows the level set, not the level sent.
  5. **After it has finished: readable, branchable, not listed.** `GET /api/sessions/{id}/messages` reads a sub-agent's
     chat while it runs and afterwards. `session.resume` opens a finished one, and `session.branch` then makes an ordinary
     chat from it, so "Continue in a new chat" is possible with existing calls (its title starts "Subagent: …"). Its row
     has `parent_session_id` set, but neither `session.list` nor `GET /api/sessions` returns it on request
     (`include_children` and similar do nothing). Only the setting `sessions.show_subagents` brings such chats into
     `session.list`, as rows with no parent field, and it is a setting of the whole bot. Rows for chats finished earlier
     would need something new, most simply a plugin field reading `parent_session_id` from the database.
  6. **Stopping: sub-agents stop, background tasks don't.** `session.interrupt` stopped sub-agents at both depths, during
     the parent's turn and after it (their commands were killed, state `interrupted`, the marker files never appeared).
     A background task kept running after `session.interrupt` and after `session.close`, wrote its marker file and delivered
     `background.complete`. No call stops one: `subagent.interrupt` answers `found: false` and `session.interrupt` with its
     id answers "session not found".
  - **Found on the way:** a top-level sub-agent always runs detached, so the parent's turn ends while it works. The
    composer now keeps Stop until they have ended (checked in `38`).
  - **Found on the way:** `/bg <task>` goes through `slash.exec` to a separate Hermes process. In a chat that has read phone
    data (recorded under both ids) its `curl` ran without asking, and no result reached the chat in the 8 s watched. The app
    now refuses it in such a chat (PR #206).
  - **The owner's answers (2026-11-18):** build the sub-agent parts now and keep background tasks for later; fix `/bg`
    without taking a feature away; show the level Hermes gave the sub-agent.

- **Inner pages sweep (task 10, PR against `redesign`).** The design rules on Skills, Memory, Scheduled, the Library's
  three parts, Bots, Connectors and every Settings page. Empty lists say what the thing is and offer one button
  (`EmptyState` in `ui.tsx`). The bot chips are gone with one bot; with several, the bot a page applies to shows in its top
  bar (`BotTag.tsx`). A change that applies only to new chats says "Applies to new chats" in its toast with a New chat
  button (`newchats.ts`; the toast's button is the only new behaviour). Buttons on these pages are at least 44 px; the
  chat's small controls (photo remove, compress close, canvas tools, reply actions) get a larger transparent tap area
  so the chat keeps its height (614 / 314 px at 360x740, unchanged). Pages keep a centred 720 px width and sheets 640 px
  on wide screens. Footers are one sentence; the longer text moved behind "About this" (`AboutThis.tsx`). Cron jobs is
  now "Scheduled", each card leading with the next run and the last result in words (`jobwords.ts`). The Hermes update
  line says what to do first (`mismatchLine`). Light theme text on these pages reaches 4.5:1 (checked by `lowContrast`
  in `lib.cjs`). All styles in `web/src/pages.css`.
  - **Left for later:** the tap areas and the toast were tried in a desktop browser at phone size only; how they feel
    under a thumb, and the pages on a tablet, need a phone (`docs/manual-tests.md`, "Inner pages").

- **A calmer chat (task 11, PR against `redesign`).** A finished turn's work (tool cards, runs, sub-agent groups, thoughts,
  earlier reply parts) folds into one line above its answer, "Worked 1m 20s · 14 steps", with " · 1 failed" in `--err`
  (`web/src/turnfold.ts`, `TurnWorkHead` in `ChatItems.tsx`, the chat view in `App.tsx`). A tap opens it to exactly what
  showed before (with the shared row movement), another closes it; a failed step is brought to the top when it opens; the
  choice lasts while the chat is open. The running turn never folds; one that finishes on screen folds only when its
  work is above what the reader sees, else at the next opening. Notices, canvas and picture cards, reply parts with cards,
  pictures or files, and the changed-files card stay in view. Find in chat, message search and the scrubber open a fold
  first. A finished thought reads "Thought for 12s" (measured in the page while it streams; "Thought process" for
  history) with its first line on the same row; the status line's time and speed use same-width figures. Nothing
  moved or removed: the status line, the line under each reply, the context ring, the reply actions and the status dot
  are where they were. Chat heights unchanged (614 / 314 px at 360x740). Costs: docs/performance-history.md (scrolling
  the same chat content costs 41% less; a 90-frame scroll of a chat of work +9%, because a folded turn is shorter).
  Checks: `web/src/turnfold.test.ts`, the ends of `03`, `06` and `07`; the mock gained `fail a step`, `work slowly`
  and the stored chat `s-work`, and `uicost.cjs` the moments `openWork` and `scrollWork`.
  - **Found:** the app never marks a tool card as failed (`tool.complete` always gives `done`; only tests make `error`
    cards), so "failed" on the line counts failed or timed-out sub-agents, and tool cards only if a later change marks
    them. Changing that is a change to `gateway.ts`'s event handling, left for the owner to decide.
  - **Found:** `08-queue-and-feed.cjs` "then the saved document replaces it" and "idle label says who wrote it" fail on
    `redesign` before this task too when `03`–`08` run together (and "no canvas polling during a turn with the panel
    closed" when `08` runs alone); not changed here.
  - **Left for later:** closing a turn has no movement (the steps leave at once and the chevron turns): a leaving movement
    would keep every step mounted for its length. Needs a phone: `docs/manual-tests.md`, "A calmer chat".

- **Text size from the phone and two notification switches (task 12, PR against `redesign`).** Until a size is picked in
  Appearance → Text size (`hm.textScale` unset), the app's text scale follows Android's font size, read once at start
  through the keyed bridge (`phoneTextScale`) and clamped to 90 to 135 % (`web/src/textscale.ts`); the first choice
  "Phone default" (on its own line above the five sizes, `seg-text`) forgets the pick. The WebView's own text zoom stays
  at 100 %, so only the app's `--scale` grows the text and the layout stays sound. Light theme: `--accent` #b57a10 →
  #8c600e and `--dim` #6a6e75 → #63676e, so gold and grey text reach 4.5:1 on white, `--surface` and `--surface-2`
  (no text on the chat, the panel, the chat's menu or any Settings page is under 4.5:1 or faded under it by opacity, with
  glass on and off). Settings → Notifications, the eighth row (This app): When a task finishes (the Done chip, reply and
  failed-turn cards, scheduled-job cards) and When Hermux needs me (approval and question chips, pop-ups and
  re-alerts, the masked-prompt notification; turning it off asks first), kept by the shell (`NotifyChoice.java`,
  preferences `notifyFinishes` and `notifyNeedsMe`; bridge `notifyChoices` and `setNotifyChoice`, which stores only the
  two names and exactly `true` or `false`), the row Sound, vibration and the lock screen (Android's page for the app's
  notifications, the app's own page as the fallback), and a notice with a button while Android shows none
  (`setupFix('notify-permission')`). Off, nothing waiting is answered or dropped; the app's sheet and Needs you still
  show it. The mapping of every notification to a switch is in spec 4.3. Checks: `39-notifications.cjs`, the end of
  `30-settings.cjs`, `web/src/textscale.test.ts`, `web/src/notifychoice.test.ts`, `tools/test_notify_choice.sh` (in
  `java-check.sh`); `lib.cjs` gained `fadedText`, `uicost.cjs` two moments. Three checks were reworded for the eighth row
  (listed in the PR). Costs: docs/performance-history.md (unchanged within the rounds' spread). Needs a phone: the
  font size driving the app and each switch silencing its notifications (`docs/manual-tests.md`).
  - **Left for later:** the "learning" notifications (memory and skill updates) and the momentary chips other than Done
    are under neither switch (the task names only the two kinds); they keep their own Android channel (`Learning`).
    Light `--warn` (#9a6b00, 4.30:1 on `--surface`) and `--ok` (#1d8a56, 4.36:1 on white) are still under 4.5:1 as
    text where they are used outside the pages task 10 fixed; no page this task checked shows them as text.

- **Agent motion (task 13, PR against `redesign`).** Movement that shows the agent at work, each piece tied to a state
  and ending with it (spec 3.2 "Agent motion" has the table): a light that travels round the text box while a turn or
  the chat's sub-agents run (`EdgeLight`, a conic layer turning under a mask, stepped to 24 frames a second) and stands
  still in amber while Hermux waits for an answer; a still gold glow behind the chat (`WorkGlow`, none in OLED black);
  Send turning into Stop; the sent message lifting; the thinking orb (`ThinkOrb`); the running step's shimmer (only the
  newest running step, `liveStep`); a green tick or a red cross that draws itself once when a step seen running ends
  (`DrawnMark`, `useStepEnd`), with a shake for a failure; a lane per sub-agent in an opened group; the reply's actions settling; one `haptic()` per finished turn (`turnTick`: none
  for steps, none when away or over the lock screen; no new bridge method); the Live orb's rhythm per phase; and small
  appear and value changes (chips, queued messages, the scroll button, the model chip, the title). States in
  `web/src/agentmotion.ts` (tests in `agentmotion.test.ts`), movement in `web/src/agent-motion.css` on the motion
  tokens, check `40-agent-motion.cjs` (heights per frame, renders per streamed batch, Reduced, Off, OLED, the haptic).
  `streamcost.cjs` gained `--motion`, `--glass` and frame counts. Costs: docs/performance-history.md, task 13.
  - **Two repeating animations at most** (review): the text box's light and the newest live thing (`liveStep`: a reply's
    orb or caret, a running step, a group's line or lanes); the tray handle has no shimmer (check 34 rewritten); the Needs
    you ring stands still while the open chat works; nothing repeats while Hermux waits. Check 40 counts them per frame.
  - **Left for later:** the background-tasks row (13) is not built: background tasks are not offered yet
    (`docs/decisions/nested-chats.md`); the streaming reply (row 10) is in its still form (a fade over the newest words
    cost 3 to 4 % of streaming work at 4x CPU); the turn fold's numbers rise rather than count;
    sub-agent lanes show only in an opened group (no automatic opening); the Live orb has no voice level (the shell
    reports none); text box growth, the keyboard, theme changes, skeleton to chat, chat-list reorders and nested rows
    folding back have no new movement. The first words of a reply cost about 1.5 ms more at 4x CPU (+4 %): the movements
    that start on Send. Needs a phone: `docs/manual-tests.md`, "Agent motion",
    including ten minutes of work for the battery.

- **Approvals you can read (PR against `redesign`).**
  - **Short-viewport approval sheet:** `.sheet.request-sheet` wraps its content in `.request-sheet-body` and, on short viewports (`max-height: 540px`, such as landscape, split screen or portrait with keyboard), keeps `.sheet::before` fixed behind it, allows vertical touch scroll on `.sheet-title` (`touch-action: pan-y`), caps `.sheet-desc` and `.sheet-code` inside a scrollable `.sheet-scroll`, and lays `.sheet-actions.col` out in two columns so the start of the command and Deny are both visible and tappable on first paint before any scroll. Approve, fingerprint, unlock and input-pause logic is untouched.
  - **Hermes `approvals.mode` (`smart` / `off`):** `web/src/approvals-mode.ts` shares `loadDefaultModel()`'s `GET /api/config?profile=` read on start-up and bot switches (read-only, no polling, per-profile sequence counter and reconnect generation guard, failed reads never cached as `null`, neutral wording when unknown/offline, re-read on picker/Settings open, `/approvals …`, and after saving `approvals.mode`). When `smart` or `off`, the chat's Auto chip (and Live mode's `hideWhenOff` bar), its picker, `/yolo off`, the Settings main page's Access & privacy value, and Access & privacy's Approvals section state plainly what Hermes approves on its own and link straight to `approvals.mode` in Advanced settings for the active bot; saving `approvals.mode` as `off` or `smart` in Advanced settings asks through `confirmLooseApprovals` (naming every bot when "Apply to all bots" is on), while `manual` needs no dialog. Over the lock screen (`lockView()`), `AutoButton` hides mode wording and asks to unlock instead of opening its picker, and `openSettingsOn` asks to unlock and leaves no pending target.
  - **Single sub-agent generic wording (`Asked by a sub-agent`):** checked against spec 3.6, `subagents.ts` `askerOf`, `RequestSheet.tsx` `AskedBy`, and Hermes's `summarize_shell_command` (`agent/display.py`): a compound command (`A && B`) is summarised by Hermes in `subagent.tool` (`tool_preview`), so it does not match the raw `approval` command verbatim; falling back to "Asked by a sub-agent" is the intended result of the strict naming rule. No code changed for it.
  - **Checks:** `web/src/approvals-mode.test.ts` (11 unit tests) and the end of `05-questions-and-approvals.cjs` (`740 × 360` and `360 × 520` at `1×` and phone font scale `2.0` with Deny and command start visible on first paint; `approvals.mode` wording, Advanced settings warning, lock screen, Live mode, 360 px fit, per-profile switching, `/yolo off`, `/approvals` recheck, offline Settings). Needs a phone: visual check on the phone in landscape and with `approvals.mode` on `smart`.

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
   data. Never `HM_DEVTOOLS` with the release key (the script refuses). Settings → About & help shows `0.9.8-redesign`; the
   app's update check reads it as 0.9.8, so it offers nothing until the next release, which then replaces the test
   build as a normal update. Checked on 2026-11-17 with a throwaway key: the APK says versionCode 908, versionName
   0.9.8-redesign.

2. **What else it changes on the phone**, and whether the released app still works after going back:
   - **The Hermux plugin inside Hermes: yes, it is replaced.** The APK carries the plugin of the commit it was built
     from, stamped with that commit's time, which is newer than the release's, so the app's plugin update (spec 6.6)
     installs it at the first quiet moment. After going back, the release finds the installed plugin `newer` and leaves
     it ("Newer than this app's copy, so it was left as it is" in Settings → About & help → Hermux plugin): **the plugin stays
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
   3. Open Hermux: the chats and settings are there. Settings → About & help shows the release's version; the Hermux plugin
      row says the plugin is newer than this app's copy, which is expected (see 2).
   4. Optional, to put the release's own plugin back as well: in Termux run the installer again,
      `curl -fsSL https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/phone/install.sh | bash`. It
      takes the latest release (not `main`), installs that release's plugin and scripts and opens Android's installer
      for the release APK (the same build, so Update or cancel). Settings → About & help → Hermux plugin then says current.
   - To keep the release's plugin untouched for the whole trial instead: before installing the test build, in Debian
     run `touch /root/.hermes/hermes-mobile-plugin/hold` (the app then leaves the plugin and scripts alone, "Held for
     testing"), and `rm` that file after going back.

**Needs a real phone:** the checklist in `docs/manual-tests.md` ("Trying the redesign build"); the test build was built
here but not installed on a phone, and going back has not been tried on one.

- **Reply text, notifications, badge and read-aloud fixes (`fix-reply-text-notifications`, PR against `redesign`).**
  Captured reply text from Hermes's synchronous `post_llm_call` hook (`assistant_response`) in `hermes-plugin/hermes-mobile/__init__.py`
  keyed by `(session_id, turn_id)` and source (`_turn_replies`, `_ended_turns`, `_clear_reply`, `_take_reply`) so
  `post_llm_call` always beats async worker-thread `on_stream_end` (which only fills in for `finished` final model
  calls when empty and never overwrites), `_on_pre_tool_call` clears commentary before `auto_mode` / `_taint_directive`
  early returns without letting late parallel tool workers wipe newer/ended turns, thinking/reasoning blocks are skipped
  and text is capped at 64 KiB, `/btw` and background reviews are skipped even without `turn_id`, and failed turns
  always prefer `_plain_exit_reason`. Added synchronous `_chat_has_read_phone_data` (including compression lineage and
  `_inherit_read` for branches) so the plugin redacts `reply`/`flash`/`error`/`cron`/`status`/`ask`/`learning` first
  with `phone_data: true` and empty `speak_text`. Added `source: 'mobile'` to `session.resume` in `web/src/gateway.ts`
  and hid `ActivityBanner` in lock view (`web/src/App.tsx`). Added `NotifyPrivacy.java` and `BadgePlan.java` and updated
  `HermesService.java` so `hasReadPhoneData` fails closed on null/empty/invalid ids and `isPhoneData` only tightens;
  every notification from a phone-data chat (`working`, `ask`, `learning`, `reply`, `error`, `Done`, `flash`, `cron`)
  uses generic words, skips `bgThumb` and `readAloud`, and applies `makePrivate` (never cloning into `publicVersion`);
  `error:<chat>` and private zero-badge `answer_fail:<chat>` stay outside `BadgePlan`; `answerAction` uses boolean
  `error_card` via `BadgePlan.answerTag`; API 26–30 empty inline answers keep the card when locked; and
  `dismissAnsweredCard` synchronizes and guards all notification calls on `HermesService.this`.
  Needs a phone: verify Done chip/card/island reply text, phone-data redaction, lock-screen private versions, background
  read-aloud, scheduled-job cards, HyperOS badge behaviour on `Learning`/`Scheduled jobs`/`error` cards, and
  `RemoteInput` dismissal on a real phone.

- **Canvas save and approvals wording follow-ups (`fix-followups-web`, PR against `redesign`).**
  - **Canvas open/save-file guards (`canvas.py`, `plugin_api.py`, `canvas.ts`, `Canvas.tsx`, `Screens.tsx`, `tools/canvas-path-vectors.json`):** `open_file` allows read-only opens of text files Files can browse (including outside save roots such as `/tmp`, `/storage/<UUID>`, `/etc/hosts`) via parent-`O_NOFOLLOW` bounded reads, while refusing NUL-byte/`~user` paths, `/proc`/`/sys`/`/dev`, `proot-distro`/`chroot-distro`, `etc/ssh`, and secret/internal segments at any depth case-insensitively (`.hermes-mobile`, `.ssh`, `.android`, `.gnupg`, `.netrc`, `.aws`, `.termux`, `.env*`, Hermes/profile secrets and `mobile/` under any `.hermes` segment plus resolved `_hermes_homes()` including symlinked profiles, and hard links inside Hermes folders). `save_file` uses parent-dir-fd `O_DIRECTORY | O_NOFOLLOW` traversal (falling back before any write only when `openat`/`dir_fd` itself is unsupported) to refuse leaf or intermediate symlinks, `..` segments, paths outside case-sensitive home/`/sdcard`/`/storage/emulated/0` roots, and protected segments at any depth case-insensitively (`.hermes`, `.hermes-mobile`, profiles, plugin dir, secrets, `.gitconfig`, `.config/git`, `.config/fish`, `bin`, `.local/bin`, `.termux`, shell rc files) with HTTP 403, preserves `mode & 0o777` via `os.fchmod`, converts filesystem `OSError` to plain-word `CanvasError`, and returns HTTP 409 on disk change unless `force: true`. All `/canvas*` routes in `plugin_api.py` are plain `def` and `_canvas()` guards module load with a lock and registers `hm_canvas` only after `exec_module`. Shared parity vectors in `tools/canvas-path-vectors.json` are checked by both `tools/test_canvas.py` and `web/src/canvas-save.test.ts`. Files disables "Open in canvas" for always-refused files (`canvasOpenBlockReason`) and awaits `openFileInCanvas` before closing; `Canvas.tsx` disables "Save to the original file" via case-sensitive allow-list-first `canvasSaveBlockReason`, and `saveToFile` captures `state.session` and checks `lockView()` before both save calls.
  - **Advanced settings approvals payload guard (`Settings.tsx`, `approvals-mode.ts`):** Checked against the pinned Hermes's real `/api/config/schema` (887 flattened leaf fields: `string`, `number`, `list`, `boolean`, `select`; no parent `approvals` or `object`/`dict` fields exist today, and `approvals.mode` is the only key controlling interactive approval mode). Kept `configApprovalsUpdate` and the post-confirm `lockView()` check in `ConfigTab.save` as a cheap guard tested by `approvals-mode.test.ts` (and kept `ConfigSheet` unchanged).
  - **Live mode and lock-view reads in `AutoButton.pick` (`AutoAccess.tsx`) and `ACCESS_UNSURE` (`gateway.ts`):** `AutoButton.pick` re-checks `lockView()` after `confirmFullAccess()` and reads live `lockView()` and `currentApprovalsMode(a.profile)` after `setAccess(...)` instead of render-time `shownHermesMode`. `settleAccess` and the resume Auto-restore fallback use `accessUnsureOff` and `autoRestoreOffNotice`, reflecting the current `approvals.mode` and staying neutral when unknown or in `lockView()`.
  - **Checks:** `tools/hermes-contract/run.sh`, `tools/test_canvas.py` (including FastAPI `TestClient` 403/409/200 route checks), `web/src/canvas-save.test.ts`, `web/src/approvals-mode.test.ts`, `web/src/access-settle.test.ts`, `web/src/auto-access.test.tsx`, `tools/web-e2e/checks/05-questions-and-approvals.cjs`, and `tools/web-e2e/checks/16-canvas-panel.cjs`. Not checked on a real phone.

**Links:** [decision: the redesign stays on its branch](../decisions/redesign-branch-until-tried.md),
[decision: no UI-coverage project before the revamp](../decisions/no-ui-test-work-before-revamp.md) (held until it
started), [where the UI work stands](ui-revamp-overview.md), [UI inventory](../design/ui-inventory.md),
[image prompts](../design/chatgpt-ui-prompts.md), [island panel design](../design/island-panel.md),
[research: how people use Hermes and what to keep on a phone](../research/hermes-usage-and-phone-ui.md) (2026-11-02),
[research: showing agent work in chat](../research/chat-tool-visuals.md) (2026-11-02).
