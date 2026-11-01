### 4.3 Notifications

#### Channels

`HermesService.createChannels(ctx)` creates all eleven. `MainActivity` and `UpdateNotice` call it too, because they post before the service may be running. It also deletes the old channels `hermes`, `learning` and `jobs` (the ids `learning2` and `jobs2` exist because a channel's badge flag cannot change once created).

| Display name | Id | Importance | Badge | What posts there |
|---|---|---|---|---|
| `Status` | `status` | LOW | no | The pinned status notification (id 1) when it is not the idle card: the working Live Update, the approval chip, the question chip, the sticky Done chip, the short flash chip. |
| `Idle` | `idle` | LOW | no | The slim green idle card ("Status: Ready"; also "Status: Setting up: …" during the app-first install). Separate so the user can set it to Minimised and drop its status-bar icon. |
| `Needs you` | `needs_you` | HIGH | yes | Approval and question pop-ups with actions, their 20 s / 40 s re-alerts, "Couldn't send your answer", "Couldn't stop Hermes", and bridge `notify` (masked prompts from the page). |
| `Replies` | `replies` | DEFAULT | yes | `reply` and `error` events: a reply that finished while the app was not on screen, or a failed turn. Has the Reply action. |
| `Learning` | `learning2` | LOW | no | `learning` events (memory and skill updates) and the group summary notification. |
| `Scheduled jobs` | `jobs2` | DEFAULT | no | `cron` events (a scheduled job finished or failed). |
| `Reading aloud` | `playback` | LOW | no | The `TtsMedia` card (id 7). |
| `Phone access` | `phone` | DEFAULT | no | The Shizuku notice (id 9) from `ShizukuKeeper`. |
| `App updates` | `update` | DEFAULT | no | "Hermes Mobile X is available" from `UpdateNotice` (id 10). |
| `Remote debugging` | `devtools` | LOW | no | The ongoing notification from `DevTools` (id 11) while remote debugging is on: "Remote debugging is on · turns off at HH:MM" with the action Turn off (`DevTools.ACTION_OFF`, handled in `HermesService.onStartCommand`). Gone when it turns off. |
| `Pairing` | `pairing` | HIGH | no | The Pairing notification from `AdbPairing` (tag `pair`, id 1): "Pair Termux: enter the code" with the Enter code field ("6-digit code"), then "Pairing…", "Termux is paired" or what went wrong. Only after the user tapped Start pairing; gone 10 minutes after that tap. |

Notification ids: 1 = status chip (also bridge `notify`, with a tag), 2 = every tagged card (`approval:<chat>`, `ask:<chat>`, `reply:<chat>`, `learn:<id>`, `cron:<id>`, `stop:<chat>`), 3 = group summary, 7 = reading card, 9 = Shizuku notice, 10 = update notice, 11 = remote debugging. All cards except the status chip are in the group `hermes` (children alert, the summary does not). The summary is posted with every card and removed when the last card goes (`dropEmptySummary`).

All of them use the small icon `ic_stat_hermes` (the approval chip uses `ic_stat_shield`) and accent colour gold `#D9A441`, green `#3DBE7A`, red `#E5564B` or amber `#E8912D` as noted below.

#### The status notification: which state shows

`HermesService.statusNotification` picks one state, in this order:

| # | State | When | Look |
|---|---|---|---|
| 1 | Flash | `flashUntil` is in the future and no approval or question is pending | Channel `Status`. Title and body from the event, colour from the event (`#2E9E5B` green by default, `#7B61D9` purple for learning), chip text `short` (for example "✅ Done", "🧠 Memory", "🧩 Skill"). Lasts 6 s (`FLASH_MS`), then `expireFlash` re-posts the normal state. A `status` event with `working: true` cancels a flash at once. |
| 2 | Needs approval | `pendingApproval` is set (from an `approval` event) | Shield icon. Title "Hermes wants to run a command". Body: the plain-language "what" in bold, then `$ command` in monospace (clipped to 280 and 400 characters). Sub-text: profile, then "expires in Ns". Chip text: the seconds left. On Android 16 a `ProgressStyle` bar drains from gold to amber (below 50 %) to red (below 20 %) as the timeout runs; below 16 a `BigTextStyle`. Actions: "✓ Allow once" (green), "Allow session" (gold, only when the event's `allow_session` is not false), "✕ Deny" (red). It is re-posted every second until answered or expired. Shown even while the app is on screen, so leaving the app with the sheet unanswered still leaves a way to answer. |
| 3 | Question | `pendingAsk` is set (from an `ask` event; expires after 10 min, `ASK_TTL_MS`) | Title "Hermes asks", the question in bold, up to 5 choices listed with "○". Chip text "Answer?". Actions below. |
| 4 | Done | Not working and the unseen list is not empty | Green. Title: the chat title (one chat) or "N chats finished". Text: the start of the reply (one chat; "Done" if none) or the titles one per line. Sub-text: profile, "Done", "N steps", the turn time ("45s", "2m 14s", "1h 3m"). Chip text "✅ Done" or "✅ N done". Action "Clear". |
| 5 | Working | `status` event with `working: true` | Gold Live Update, see below. |
| 6 | Idle | none of the above | Channel `Idle`, green, "Status: <text>", ongoing, no time, tap opens the last shown chat. |

State 5 in detail. Title: the chat title (`Hermes` if the plugin sent none). Text: the status line in bold, with `code` spans in gold monospace (for example Running `ls`), then "▸ current task" when Hermes keeps a task list, then one line per other busy chat ("<title>: <status>"). Sub-text, joined with " · ": profile (when not `default`), "N of M tasks" or "N steps", "+N chats". The turn clock runs as a chronometer from `since` (the plugin's turn start). Chip text: the `short` word from the plugin (Shell, Web, Files, "Approve?", "Asking", "Using <app>"…; "Hermes" if none). Android 16: a `ProgressStyle` with one segment per task (green done, gold current and to do, faded grey dropped) and the Hermes icon as tracker, or an indeterminate gold bar when there is no task list. Below 16: `BigTextStyle` plus a progress bar (determinate with a task list, otherwise indeterminate). Action "■ Stop" (red); while a stop is in flight the text is "Stopping…" and the button is gone. When Hermes drives an app on the hidden screen for this chat, the expanded card also shows a 256 px picture of that screen as its large icon; the lock-screen version of the card has no picture.

Every state except Idle sets the extra `android.requestPromotedOngoing` and, on Android 16, `setShortCriticalText`, which is what makes it a Live Update / status-bar chip where the system supports it. The Idle card is a plain ongoing notification.

**What expires a working chip.** The plugin repeats a `status` event about every 15 s while something runs. `HermesService` schedules `expireWorking` `WORKING_TTL_MS` (50 s) after each working event. If no beat arrived since (about 3 missed), the chip drops to Ready, so a Hermes that died mid-turn cannot leave it stuck. The wake lock uses the same horizon plus 5 s.

#### The Done chip: rules

- Source: a `flash` event with `done: true` (or a `short` containing "Done") and a non-empty `session`, sent by the plugin when a turn finishes with a reply.
- If `MainActivity.visible` the event is dropped completely (no Done chip, no flash): the in-app unread dots already show it.
- Otherwise the chat is added to the unseen list (a map `id` to title and profile, newest last; an existing entry moves to the end). The list is kept in the `hm` preferences under `unseen` and survives a restart. The reply details (`reply`, `steps`, `secs`) are kept in memory only, for the one-chat text; after a restart the chip shows the title alone.
- The icon badge number equals the number of unseen chats (`updateBadge`). It is set with `Notification.Builder.setNumber` and, by reflection, with the MIUI/HyperOS notification message count where that field exists; elsewhere the reflection finds nothing and does nothing. When the count drops to 0 the open reply cards are removed.
- The chip goes away when: the chat is opened in the app (bridge `chatSeen` → `markSeen`, also `onResume` for the chat shown last); the page reports its own unread list for a profile (bridge `setUnseen` → `replaceUnseenRows`, which only removes entries and refreshes titles, never adds); the user taps Clear (`ACTION_CLEAR_DONE` → `clearUnseen`); or the user taps the chip body (it opens the newest chat with the extra `clearDone`, handled in `MainActivity.onCreate`/`onNewIntent`, which clears the whole list even for chats that no longer exist).
- A working turn wins over the Done chip. Approval and question chips win over both.

#### Every notification action

| Where | Label | What happens |
|---|---|---|
| Working chip | ■ Stop | `ACTION_STOP` with the chat id → `HermesService.stopTurn`: sets `stopping`, re-posts the chip as "Stopping…", then `POST /api/plugins/hermes-mobile/stop` with `{session}` and the dashboard token (token scraped from the dashboard page; on 401/403 it is refreshed once). 404 reads "it isn't running in the app's Hermes", other failures "HTTP n" or the exception text; on failure the chip is restored and a `Needs you` card says "Couldn't stop Hermes — Open the chat to stop it (…)". Success shows nothing: the next `status` event ends "Stopping…". |
| Approval chip and pop-up | Allow once / Allow session / Deny | Allow once and Allow session need an unlocked phone (below the table). `ACTION_APPROVE` with `session`, `key`, `request_id`, `profile`, `choice` (`once`, `session`, `deny`) → `answerApproval`: `POST /api/plugins/hermes-mobile/approve`. On success the pending approval is cleared and the card removed. On failure a `Needs you` card says "Couldn't send your answer — Open Hermes to answer (HTTP n)". The pop-up (not the chip) is skipped while the app is on screen; `MainActivity.onResume` also removes any `approval:` card, because the in-app sheet takes over. If unanswered and the app is hidden, the pop-up is re-posted at 20 s and 40 s because some launchers (HyperOS) hide a heads-up after about 5 s. The countdown ends `timeout` seconds (60 if the event gives none) after the event; the chip is dropped 3 s after that if the plugin's `clear` never came. |
| Question chip | one button per choice (up to 3 choices) | `ACTION_ANSWER` with kind `ask` and the choice text as the answer. Choice labels are cut to 18 characters; choices to 40 characters; at most 5 are read. |
| Question chip, more than 3 choices | first two choices, then "More…" | "More…" is a text field whose quick replies are all the choices. |
| Question chip, no choices | Answer | Text field "Your answer". |
| Question pop-up | Answer | Text field; the choices are its quick replies. Not added when the event says the question is part of a batch (`single: false`). |
| Reply and failed-turn card | Reply | Text field "Message Hermes" (`RemoteInput`, generated replies off). Only added when the event has a chat id. |
| Done chip | Clear | `ACTION_CLEAR_DONE` → `clearUnseen`. |
| Reading-aloud card | Back 5 s, Pause / Play, Forward 5 s, Stop | `TtsMedia.ACTION_TTS` with `cmd` `rew`, `pause`/`play`, `ff`, `stop` → `Voice.control`. Swiping the card away while paused sends `stop` (the delete intent); while playing the card is ongoing. Compact view shows the first three buttons. Tapping the card opens the chat. |
| Update notice | tap | Opens the app with the release APK URL; `MainActivity.startUpdateFromIntent` re-checks it is an official release URL and starts the download (same as Settings → About → Update). |
| Shizuku notice | tap | Opens Shizuku, or this app when the reason is `no-permission`, `no-termux` or `unpaired`. |
| Any other card, and the status chip body | tap | Opens the app on that chat (`session` extra); the Done chip also clears the list. |

**Locked phone: nothing that acts goes through from a notification.** Allow once, Allow session, the question's choice buttons and text fields, and the Reply field go through `unlockFirst`: on Android 12+ it sets `setAuthenticationRequired(true)`, so Android asks for the PIN, pattern or fingerprint before the button works. Android 8-11 has no such flag, so `answerApproval` and `answerFromNotification` check `MainActivity.keyguardLocked` first: when the phone is locked, `openToUnlock` sends nothing and opens `MainActivity` (extra `unlock`, the chat in `session`, a typed text in `draft`), whose `applyLockScreen` brings up the unlock screen (`askUnlock`, `KeyguardManager.requestDismissKeyguard`); after the unlock the app shows that chat with its sheet, or the text in the composer. The notification stays. Logcat tag `HermesLock`. Deny, Stop, Clear and the reading-aloud buttons stay one tap: they only stop things.

**How typed answers reach Hermes.** `answerFromNotification` reads the `RemoteInput` text (or a choice button's fixed text). If it is empty, the card is only dismissed. Otherwise it calls `MainActivity.deliverAnswer`, which first calls `wakePage(30 s)` (the page is frozen about a minute after the app is hidden; the call tells the `WebView` its window is visible so timers and sockets run) and then `window.hermesAnswer(kind, session, text)`. The page answers `"y"` when it took the text (it owns the gateway connection Hermes asked on). If the activity is gone or the page says no, a `Needs you` card "Couldn't send your answer" appears; tapping it opens the chat with the text already in the composer (extra `draft`, at most 20,000 characters). For a question, the chip returns to the status once an answer is typed.

**Reply and error cards** (`reply`, `error`): skipped while the app is on screen. The card carries the Reply action, the badge number, and opens the chat. Opening the chat removes it (`markSeen`).
