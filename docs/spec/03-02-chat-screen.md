### 3.2 Chat screen

The chat screen is the home of the app: what the user sees when no `screen` is open. It is made of the pieces in the table. Everything lives in `web/src/App.tsx` unless another file is named.

**Opens from:** app start (it reopens the last chat), Back from any screen, a notification tap, a new chat from the drawer. **Closes with:** not closable; other layers cover it. **Source:** `web/src/App.tsx` `App`, `Header`, `Chat`; `web/src/components/Composer.tsx` `Composer`.

**Layout, top to bottom:**

| Element | Looks like | Tap | Long-press / swipe | States (empty, loading, error, disabled) |
|---|---|---|---|---|
| Test-build strip (`DevtoolsStrip`) | Only in a test build (`HM_DEVTOOLS=1`, 2.3): a thin warning-coloured strip, `Test build: remote debugging is on`, above the header and drawn over full screens too. While remote debugging is on from Settings → About (2.3) the same strip reads `Remote debugging is on · N min left` (`remoteDebugStrip`). | none | none | Always shown in such a build; not in normal or release builds. |
| Menu button `☰` (`Header`) | Icon at the left. A small dot on it when any chat is unread. Its label is Sessions, or Sessions (unread chats); on wide screens Hide chat list / Show chat list. | Opens the drawer; on wide screens hides or docks the chat list column (`toggleSide`, 3.1 Wide screens). | Swipe right anywhere on the chat does the same. | Always enabled. |
| Title and subtitle (`Header`, `Title.tsx`) | Chat title, and under it: the status dot, a 🔊 badge while read-aloud is on for this chat, then the profile name (or "Hermes Agent" for the default profile). A branched chat shows a branch icon (aria-label Branch) before its title. | Title: opens the chat menu (3.5) when a chat exists, does nothing on the empty screen. While a chat is opening the title shows the cached title. | none | Fallback title is "New chat" (chat exists, no title yet) or "Hermes" (empty screen). |
| Status dot (aria-label Backend status) | Small coloured circle. Green = ok, amber = Hermes up with problems, red = offline, blinking amber = connecting (`dotState` in `health.ts`). | Opens the Backend status sheet (3.5). The tap does not also open the chat menu. | none | none |
| Auto button | Pill labelled Auto. Grey = off, green = Auto access, red with ⚡ = Full access. | Opens the Auto picker (see "Auto button" below). | none | Disabled while Hermes is not connected. |
| Canvas button (aria-label Canvas, or Canvas (Hermes is writing) while Hermes writes a document) | Document icon, with a dot when the chat has canvas documents. | Opens the canvas (3.7). | Swipe left on the chat does the same. | none |
| Chat options (aria-label Chat options) | `⋮` | Opens the chat menu, or the draft menu on the empty screen (3.5). | none | none |
| Connection banner (`ConnBanner`) | Strip with a small spinner and the connection detail ("Connecting to Hermes…" or "Hermes is offline"), plus a seconds counter. | Retry (becomes Restart Hermes after 20 s) calls `reconnectNow()`, which also asks the shell to start Hermes. Check setup (appears after 10 s) opens the `setup` screen. | none | Shown only while the socket is not open. After 3 s it adds " · Ns", after 20 s " · taking long". |
| Find bar (`FindBar`) | Search field "Search in this chat", a count such as `3 / 7` (or "none"), buttons Previous match (↑), Next match (↓), Close search (✕). | Previous match goes to an older hit, Next match to a newer one (wraps). Enter in the field goes to the next older hit, Shift+Enter to the newer. Close search ends the search. | none | Opened from chat menu "Search in chat". Closes by itself when another chat opens. Back closes it. Arrows disabled with no hit. |
| Messages (`Chat`) | The scrolling list of items (3.3). | See 3.3. | Pull up past the end: By the way (3.12). | Skeleton while a chat opens, empty screen when there are no items. |
| Scroll button (aria-label Scroll to the newest message) | Round `↓` button over the list. | Smooth-scrolls to the end. | none | Shown only when the list is more than 80 px away from its end. |
| Queued messages (`QueuedRows`, `web/src/components/Queued.tsx`) | After the last message and before the bottom space: right-aligned dashed bubbles, each with a small header `Queued · 1 of 2` and three icon buttons under it. Above them, while the queue is paused, the line `Queue paused` with a Resume button. | Send now (aria-label `Send queued message now`) removes it from the queue and sends it: it steers the running turn, or is sent as a normal message when idle. Edit (aria-label `Edit queued message`) turns the bubble into a text box with Cancel and Save. Remove (aria-label `Remove queued message`) deletes it. Resume sends the first queued message now (when a reply is still running it only lifts the pause, so the queue goes on when the reply ends). | none | Not part of `items`, so search, jump and folding ignore it. Hidden when the chat has no queued message. A chat opens with its queue paused; Stop or an error pauses it too. |
| Pull hint | Text "Release for a side question", hidden until the user pulls up at the end of the list. | n/a (`pullbtw.ts` draws it) | Pull up 160 px past the end (`PULL_TRIGGER_PX`) and release. | Needs a chat on screen. |
| Chat scrubber (`Scrubber`, `web/src/components/Scrubber.tsx`; `.chat-wrap` holds it beside `.chat`) | A thin rail on the right edge of the chat (from 700 px wide it sits beside the text column and at least 24 px in from the screen edge, clear of the canvas pull strip, 3.7), 12 px below the top to 72 px above the bottom (clear of the scroll button), with one `scrub-tick` per message the user sent, placed by message order (`k / (n - 1)` of the height). The tick of the message at or above the top of the list is highlighted (`on`). While a finger is on it the rail widens and a `scrub-bubble` left of the finger shows `12 / 30` and the first 80 characters of that message (or the first attachment's name). The rail is `role="slider"` with aria-label `Jump to a message`, `aria-valuenow` the current message number and `aria-valuetext` its text. | Drag along it, or tap it: the nearest tick is picked (`haptic()` each time it changes); letting go scrolls the chat so that message sits 8 px below the top and flashes it (`hit-flash`). ArrowUp / ArrowDown on the focused rail move one message. Swipes and the pull-up gesture skip it (`.scrubber` in `SKIP`). | Only with at least 6 user messages (`SCRUB_MIN`) and a list taller than 3 times its visible height. Hidden while the find bar is open and while a chat is only previewed. Queued bubbles and the bottom space are not items and get no tick. |
| Activity banner (`ActivityBanner`) | Strip with spinner: "<chat title>: <what Hermes does>", and "(+N more)". | Opens that chat. | none | Hidden when empty. Disabled when the item is the open chat's own background review. |
| Status bar (`StatusBar`) | While a turn runs: spinner, the live status text (or "Working…"), the turn's elapsed time as `m:ss` (`h:mm:ss` from an hour; `.status-elapsed`, from 3 s on), `~N tok/s`, `ctx N%`. Below it, the goal line (`.goal-line`) when the chat has a goal that is not cleared or done: `🎯 title · turn 3 of 20 · active`, or `paused: reason`. Below that, a "☑ Tasks done/total" line when Hermes keeps a todo list. | Goal line opens the Goal sheet (3.5). Tasks line toggles the list. Each todo shows ✓ completed, ◐ in progress, ✕ cancelled, ○ pending. | none | Hidden when nothing runs, there are no todos and no goal. The elapsed time comes from `turnStart` (the send, the first `message.start`, or Hermes's `turn_started_at` on resume; `useElapsed` redraws it once a second). |
| Selection bar (`QuoteBar`, `web/src/components/QuoteBar.tsx`) | Strip just above the composer with the label "Selected text" and the buttons Quote and Explain. | Quote adds the selection to the composer's quotes (3.4), clears the selection and focuses the text box. Explain sends the selection as a quote followed by "Explain this." at once. | none | Shown only while 3 to 2000 characters are selected inside one reply (`.msg.assistant .md`). Over 2000 characters the label reads "Selection is too long to quote" and both buttons are disabled. Hidden when the selection collapses, a sheet opens, the chat changes or Live mode is on. |
| Compress hint (`CompressHint`) | "Context N% full. Compress older turns so Hermes keeps up?", button Compress, and ✕ (aria-label Not now). | Compress calls `compressChat` (`session.compress`, up to 5 min), then a toast with the result. Not now hides the hint for that chat until the app restarts. | none | Shown from 80 % context fill, not while a turn runs (unless compressing). While busy the button shows a spinner and ✕ is hidden. |
| Read-aloud player, background-app card | See 3.11 and 3.10. | | | |
| Composer | See 3.4. | | | |

**Data:** store fields `active`, `opening`, `preview`, `conn`, `connDetail`, `health`, `activity`, `unread`, `find`, `jump`; RPCs `session.create`, `session.resume`, `session.compress`, `session.context_breakdown`, `gateway.ping`; plugin `GET /activity`; `localStorage` `hm.lastSession` (the chat to reopen), `hm.chatcache.v1` (the last-seen chat for a cold start).
**Rules:** no native `<select>` or `confirm()`; every dialog is an in-app sheet (3.20). The page is the only place the chat is drawn; Android only hosts the WebView.

#### The empty new-chat screen

Shown when there is no open chat and none is opening (`Empty`).

- A ☤ logo, the title "Hermes", and a line: "Your agent, on your phone." for the default profile, or "Profile: <name>".
- Up to four suggestion buttons, built by `suggestions()` in order, without repeats: the three latest prompts this profile sent (`web/src/recent.ts` `recentPrompts`, shortened to 70 characters), then up to two skills ("/<skill> · <description>", from the command catalog, `commands.ts`), then four built-in suggestions (calendar today, summarise unread email, a quiz prompt, files in Downloads).
- Tapping a suggestion does not send it. It puts the text into the composer (a trailing space added) and focuses it.
- Nothing is created on Hermes's side until the first message (or the first attachment, a model pick, or an Auto choice).

#### While a chat opens (skeleton and preview)

`store.opening` holds the stored id of a chat being resumed.

- If the app has the chat's last-seen items (`web/src/chatcache.ts`: 8 chats in memory, the last one also in `hm.chatcache.v1`), they are drawn at once as a read-only preview: no message actions, no editing. The title is the cached title.
- If not, a skeleton appears (aria-label Opening your chat): a spinner with the chat's title (or "Opening your chat…", or "Connecting to Hermes…" when offline) over four grey bubble shapes.
- When `session.resume` answers, the real items replace the preview.

#### Windowing, folding, search jump

- **Windowing.** Only the last 40 items (`WINDOW`) are drawn when a chat opens, because every item parses Markdown. At the top, an "Earlier messages…" line with a spinner is watched by an `IntersectionObserver` with an 800 px margin. When it comes near, the 40 items before are drawn and the scroll position is kept on the message that was first. New items arriving do not move the start index.
- **Opening at the divider.** If a chat has a "New since your last visit" divider above the last screenful, it opens scrolled to the divider instead of the end (see 3.2, New since your last visit).
- **Stick to the end.** While the user is within 80 px of the end, the list follows new content. Scrolling further up stops the following and shows the scroll button. Switching chat sticks again.
- **Folded tool runs.** `web/src/fold.ts` folds three or more tool cards in a row (`FOLD_MIN`) into one line (see 3.3).
- **Jump from message search.** The drawer's message search sets `store.jump` (`web/src/jump.ts`: chat id, the marked words, the snippet). After the chat opens, `findHit` picks the message whose text holds the most marked words and longest snippet pieces (ties go to the latest), draws earlier items if the hit is above the window, opens a folded run if the hit is inside one, scrolls it to the centre, flashes it for 2.5 s and marks the words for 6 s with the CSS Custom Highlight API (`highlightWords`, name `hm-hit`). If no message matches, a toast says "Opened the chat; the exact message wasn’t found".
- **In-chat search.** `findMatches` lists the items whose text contains the query (case-insensitive), newest first. All hits in drawn messages are marked (`hm-find`), the current one (`hm-hit`) is centred, scrolling only when the query or the chosen match changes. Searched text: user and assistant text, and for tool cards their context and result text.
- **Scrubber jump.** Letting go on the chat scrubber (3.2) sets `scrubTo` (an item index) in `Chat`: it draws earlier items first when the message is above the window, opens a folded run if needed (`unfold`), scrolls the message to 8 px below the top, and flashes it for 2.5 s: the same steps as the search jump. The tick of the current message follows the scroll (`trackTop`, once per animation frame): the first drawn item whose bottom is below the list's top gives the item index, and `currentMark` maps it to a tick; the `.chat-earlier` row, queued bubbles and the bottom space are skipped.

#### Auto button (header)

`web/src/components/AutoAccess.tsx` `AutoButton`. It sets how much Hermes may do in this chat without asking. Three states:

| State | Button | aria-label starts with | What Hermes does |
|---|---|---|---|
| Off | Grey "Auto" | "Auto is off" | Asks before risky commands (the approval sheet, 3.6). |
| Auto access | Green "Auto" | "Auto access is on" | Runs everything without asking, except commands on Hermes's dangerous list (recursive deletes, overwriting system or config files, force-killing processes, piping downloads into a shell…). Those are blocked by the plugin's `auto_mode.py`. |
| Full access | Red "⚡ Auto" | "Full access is on" | Runs every command without asking. Only Hermes's catastrophic list (wipe the disk, shut down) stays blocked. |

Every label ends with ". Change how much Hermes may do without asking".

- **Which state it shows.** With a chat open: `accessOf(active)` = off when `info.yolo` is false, Auto access when it is true and `autoAccess` is set, else Full. While a chat is opening: off. On the empty screen: `defaultAccess()`, the mode a new chat will start in (Settings, row Auto for all chats, key `hm.defaultAccess.v1`).
- **Tap** opens the picker "Auto: run without asking" with the three options (Off, Auto access, Full access) and a check on the current one. Choosing the current mode does nothing.
- **Full access asks first.** A dialog titled "Give Hermes full access?" warns that every command runs without asking (deleting or overwriting files, killing apps, installing software, changing settings, sending data) and that nothing is checked first. Buttons: Cancel and "Allow full access" (red). Declining changes nothing.
- **On the empty screen** the choice starts the chat first (`newSession`), because access is a property of a chat.
- **Setting it** (`setAccess` in `gateway.ts`; calls are queued one at a time):
  - Auto access: `PUT /auto` (plugin writes the chat id to its block list) first, then `config.set` key `yolo` = `1`. If Hermes does not turn yolo on, the plugin entry is removed again. An old plugin without `/auto` gives the error "Auto access needs the updated Hermes Mobile plugin".
  - Full access: `config.set` `yolo` = `1`, and the plugin entry is removed.
  - Off: `config.set` `yolo` = `0`, and the plugin entry is removed.
  - Order matters: a chat is never briefly in Full access by accident.
  - A toast confirms: "Auto off: Hermes asks before risky commands again", "Auto access on for this chat: dangerous commands are blocked, everything else runs", or "Full access on for this chat: Hermes runs commands without asking". Errors show as an error toast.
- **Remembering.** The user's own choice is stored per chat in `hm.yolo.v1` (`true` = Full, `'auto'` = Auto access, `false` = an explicit Off that beats the default). Hermes forgets yolo when a chat is resumed, so `resumeSession` puts it back from `hm.yolo.v1`, or from the default for a chat with no entry. The default is applied with `remember` false, so it keeps following the default. New chats get the default in `newSession`.
- **Full access chip.** When a chat is in Full access, the composer shows a red "⚡ Full access" chip (aria-label "Full access is on: Hermes runs commands without asking. Tap to turn it off"). Tapping it turns Full access off and toasts "Full access off: Hermes asks before risky commands again". Auto access has no chip; it shows only in the header.
- **`/yolo` command.** Typing `/yolo` (optionally `on` or `off`) in the composer toggles Full access the same way and adds a notice to the chat.
- **Settings row.** `DefaultAccessRow` in the same file is the Settings row Auto for all chats: a `SelectRow` with the same three options. Choosing Full asks "Full access in every chat?" (button "Allow in all chats"). Off removes the key.

#### New since your last visit

`web/src/visit.ts` keeps, per chat, when it was last on screen (`hm.visit.v1`, ms, newest 500 chats). `markVisit` runs in `gateway.ts` when the user leaves a chat (another chat opens or a new draft starts), when the app goes away while a chat is open (`noteAway`: the shell's `window.hermesPause` or the page's `visibilitychange`, whichever comes first), and when a turn ends (`message.complete`) while the page is visible and not away (`isAway`). When `Chat` shows a chat whose key changed it reads `lastVisit` once (a `visitRef`), and the first time the chat's own items (not the read-only preview) are there it asks `firstUnseen` for the first user or assistant item with `at` newer than that time (never index 0; items without `at`, such as tool cards, are skipped). That index is frozen for as long as the chat stays open, so new live messages do not move it. The item is drawn with a `visit-divider` line (`role="separator"`, text "New since your last visit", accent colour) before it, inside a `visit-wrap` element; when the item is also in a turn-end or tool-run wrapper, the divider is the first child of that wrapper, so there is still one child of `.chat` per item. A chat never opened on this phone has no divider.

**Away and back with the same chat open.** Leaving the app (Home, another app, screen off) and coming back keeps the chat on screen, so it is not reopened. `noteAway` records which chat was open and when; `noteBack` (from `window.hermesResume` or `visibilitychange`, whichever comes first) tells `Chat` through `onBack`/`lastBack`. If that chat is still the one shown, `Chat` looks, as items arrive, for the first user or assistant item stamped after the leave time and no later than `BACK_GRACE_MS` (5 s) after the return (`newWhileAway`: messages from the backlog are stamped when the page processes them). It stops looking 10 s after the return. When one is found, the divider moves there (replacing an older one) and the chat scrolls to it under the same rule as when opening. Replies watched on screen get no divider.

Initial scroll: when the divider is above the last screenful, the chat opens with it 8 px below the top instead of at the end (earlier items are drawn first if it is above the window, like a search jump), and the scroll button shows. A message-search jump or an in-chat search that is waiting takes priority and no divider scroll happens. Only once per opened chat; the user's own scrolling is never overridden afterwards.

#### Unread chats

`web/src/unread.ts` keeps, per profile, the message count the user last saw in each chat and when the count last changed (`hm.seen.v1.<profile>`). After every `session.list`, `noteSessions` updates it. A chat is unread when it has more messages than were seen; the open chat is always read. The first list ever is the baseline (nothing unread); a chat that started after tracking began and has messages counts as unread. `markSeen` runs when a chat opens. The unread list is shown as the dot on the menu button and in the drawer, and mirrored to the Android service (`setUnseen` bridge call) for its Done chip and the icon badge. `ago()` formats the drawer's "5 min" labels. At most 1500 chats are tracked.

#### Activity feed

`web/src/activity.ts` polls the plugin's `GET /activity` while the page is visible and connected: every 3 s while the banner shows something, once 0.3 s after the open chat's turn ends (the background review starts then), otherwise on every third tick (9 s). `bannerItems` hides the open chat's own live turn (it has the status bar), but keeps its background review. When a chat drops out of the list, the session list is refreshed so its unread dot appears.

---
