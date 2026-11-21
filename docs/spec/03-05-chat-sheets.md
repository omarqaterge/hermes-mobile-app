### 3.5 Chat sheets

All the sheets below share the `Shell` frame in `web/src/components/Sheets.tsx` (except the two menus, which are `MenuSheet`s, 3.20): a bottom sheet with a grip, a title, and content that scrolls. Dismiss with a tap outside, Android Back, or by dragging down on the top 64 px (`useSheetDrag`: closes after a 110 px drag, or a quick flick over 30 px).

#### Model sheet
**Opens from:** the composer's model chip (in the tray above the text box, 3.4 Tray); the Add picker's model row. **Closes with:** picking a model, tap outside, drag down, Back. **Source:** `web/src/components/Sheets.tsx` `ModelSheet`.

**Layout, top to bottom:**

| Element | Looks like | Tap | Long-press / swipe | States (empty, loading, error, disabled) |
|---|---|---|---|---|
| Title | "Model" | | Drag down closes. | |
| Reasoning pills | A row of pills: none, minimal, low, medium, high, xhigh, max, ultra (`REASONING_EFFORT_VALUES`). The current level is highlighted (the chat's level, else the profile default from Settings, else "medium"). | Sets the reasoning level for this chat (`setReasoning`: `config.set` key `reasoning`; toast "Reasoning: <level>"). On the empty screen it first creates the chat. | none | A level picked here wins over the automatic reset below. |
| Search field | "Search models…" | Filters models by model name or provider name. | none | |
| Favourites group | "Favourites" with a row per starred model that this profile can use now and that matches the search. Each row also names its provider. | As a model row. | none | Hidden when empty. |
| Provider groups | Provider name (with a "free" tag for free tiers), then its models. The current provider comes first. A ● marks the current model. | Picks the model, closes the sheet. | none | Providers that are not signed in are left out unless current. A provider with no matching model is hidden. |
| Typed-id block | "Use “<id>”" when the search text is a model id (no spaces) that no provider lists exactly; one row per connected provider (current first, also providers whose list is empty), each naming the provider (aria-label "Use <id> with <provider>"). | Picks that id for that provider like a model row; once the switch succeeded the id is remembered (`hm.customModels.v1`) and shows from then on as a normal row under its provider. | none | Hidden without a search or when the id is listed. |
| Forget button | ✕ on a remembered typed id's row (aria-label "Forget <model>") | Removes the id from `hm.customModels.v1`. | none | Only on remembered ids. |
| Hint | "Missing a model? Type its exact name in the search box to use it." | | | Only without a search. |
| Add a provider | The last row, with a plus (`.model-add`) | Opens Settings on the Add a provider page (`openSettingsOn` in `web/src/settings-open.ts`, 3.15) and closes this sheet; Back there returns to the chat. | none | Always shown. |
| Star button per row | ☆ / ★ (aria-label "Star <model>" / "Unstar <model>") | Toggles the favourite. | none | |
| Status text | The list shown last time on this profile appears at once (`hm.modelOptions.v1`); with none kept, "Loading models…" until the first answer. With nothing to show, a failed `model.options` or one with no answer after `LOAD_LIMIT_MS` (20 s) shows the shared error box (`LoadError`: Hermes's reason or "Hermux didn’t answer in time.", Report a problem, "Try again", which loads again); a late answer still fills the list. | Try again loads the list again. | none | |
| Refresh the list | "Refresh the list" link after the hint; "Updating the list…" while a live refresh runs. | Asks Hermes for the live list now, even when the last one is recent. | none | Only without a search, once a list shows. |

**Data:** `model.options` on every open, reading the catalog Hermes has cached (its answer replaces the kept list); then, only when the last live list on this profile is older than `REFRESH_EVERY_MS` (10 minutes), after a sign-in, key or endpoint change (`modelsChanged`), or on "Refresh the list", the plugin's `POST /refresh-logins` (renews an expired subscription token; waited for at most `LOGIN_LIMIT_MS`, 8 s) and again `model.options` with `refresh: true` for the live list, which then wins over a later cached read in the same open. One live refresh per profile runs at a time (`liveOnce`); one still running when the sheet closes finishes and fills the next open (live refreshes make Hermes fetch every provider's catalog again: slow on a phone and beside a running reply). `config.set` (keys `model`, `reasoning`), `session.create`, `session.close`; `hm.favModels.v1`, `hm.customModels.v1`, `hm.modelOptions.v1` (`web/src/modelcache.ts`: `cachedModels`, `saveModels`, `slim`, `refreshDue`, `refreshing`).
**Rules:** favourites are shared by all profiles and keyed by provider + model (`web/src/favs.ts`); a favourite whose provider is not signed in on this profile simply does not show.

How picking works (`setModel` in `gateway.ts`):

- **Empty chat, or no chat yet:** a model switch on a chat with nothing sent would leave a "model changed" marker as its first history row, which breaks later edits. So the app creates a new chat with the model (and the level) set from the start, closes the old empty one in the background, and toasts "Model: <name>". A chat that is "replaceable" has nothing sent, nothing attached and no reply running. Its folder (project chats) is kept.
- **Chat with messages:** the pick shows at once; `config.set` key `model` with `<model> --provider <provider> --session` is sent after the chat's agent has finished building (a new chat's agent takes about 2 s; a switch before that is lost). Then, unless the user chose a level in the sheet, the level is reset to the profile default (`medium` when none is set) with `config.set` key `reasoning`. A send right after a pick waits for the switch. On failure the old model is shown again and the error toasted.
- **Several quick picks on one chat:** their `config.set` calls go to Hermes one after the other in the order picked (`runSwitch` in `agentbuild.ts` starts each after the earlier ones settled, a failed one included), so the newest lands last; a message sent meanwhile waits for the newest. The screen shows the newest pick. A pick that fails goes back to the model Hermes last confirmed (`appliedModel` in `gateway.ts`, forgotten when the chat closes), but only if the screen still shows that pick, so a late failure of an earlier pick never overwrites a newer one.
- **Fast mode** is not in this sheet. It is the `/fast` command (3.4).

#### Commands sheet
**Opens from:** nothing in the current code sets `sheet` to `commands`; the composer's "/" button uses the inline slash menu instead. **Closes with:** tap outside, drag down, Back. **Source:** `web/src/components/Sheets.tsx` `CommandsSheet`.

**Layout, top to bottom:**

| Element | Looks like | Tap | Long-press / swipe | States (empty, loading, error, disabled) |
|---|---|---|---|---|
| Title and search | "Commands"; field "Search commands and skills…", focused. | Filters commands (by name or description) and skills (by name). | none | "Loading…" until `commands.catalog` answers; an error toast if it fails. |
| Command groups | One group per category Hermes reports, rows `/command` + description. | Picks the command: closes the sheet and puts it in the composer (like an injected text). | none | Categories with no match are hidden. |
| Skills group | "Skills (N)" with up to 200 rows `/skill` + description. | As above. | none | Hidden when empty. |

**Data:** `commands.catalog`.
**Rules:** unlike the inline slash menu it does not hide commands the app already covers.

#### Chat menu sheet
**Opens from:** the header Chat options button (the header title opens the Backend status sheet, 3.2). **Closes with:** most items (Rename's Save, a quick action, Undo last turn, Archive, Delete), tap outside, drag down, Back. Read replies aloud flips in place and keeps the menu open; File checkpoints and Chat details swap it for their sheet. **Source:** `web/src/components/ChatMenu.tsx` `ChatMenuSheet`, built from the menu parts of 3.20 (`MenuSheet`, `MenuHeader`, `MenuActions`, `MenuGroup`, `MenuRow`); Pin, Archive and Delete through `web/src/chatactions.ts`, the same code the chat list's row menu uses (3.13).

One menu for one chat: the header's menu and a row's menu in the chat list share the header and the look; this one adds what needs the chat to be open. It is a glass sheet (`aria-label` "Chat options") over the chat, which dims and (Full animations) steps back.

**Layout, top to bottom:**

| Element | Looks like | Tap | Long-press / swipe | States (empty, loading, error, disabled) |
|---|---|---|---|---|
| Header (`ChatMenuHeader`) | The chat title (two lines at most; the branch icon for a branch), a dim line under it with the model and, when there are several bots, the bot ("mock-model · Work"), and a pencil button on the right (`aria-label` "Rename"). | Rename swaps the header for the field "Chat title" and Save. Save closes the menu and renames through the dashboard (`PATCH /api/sessions/<id>`), keeps the branch mark of a branch, and toasts "Renamed". | Drag down on the header strip closes. | "New chat" if untitled. Errors toast. |
| Quick actions (`MenuActions`) | Four equal tiles, an icon above a short label: Search, Canvas, Share, Pin (Unpin when pinned). | **Search** (`aria-label` "Search in chat"): closes the menu and opens the find bar (3.2). **Canvas** (`aria-label` "Canvas", or "Canvas (N documents)"): opens the canvas (3.7); a small count on its icon when the chat has documents. **Share** (`aria-label` "Share chat"): shares the whole chat as Markdown through the Android share sheet (`shareText` bridge call, up to 400,000 characters); outside the app it copies instead and toasts "Copied as Markdown (sharing works in the phone app)". **Pin** (`aria-label` "Pin to top") / **Unpin**: pins the chat first in Pinned or unpins it (`pinChat`), toast "Pinned" / "Unpinned", as the chat list does. Each closes the menu. | none | |
| Read replies aloud | A row with a speaker icon and a real switch (`role="switch"`, `aria-checked`); the line under it says "Only this chat" when this chat overrides the setting for all chats, else "Follows the setting for all chats". | Flips read-aloud for this chat (`setAutoReadFor`) in place: the menu stays open, the switch and the line change, and the toast says "Reading every reply aloud in this chat" / "Read-aloud off for this chat". | none | |
| Undo last turn | A row. | Closes the menu and runs `session.undo`, reloads the chat, toast "Last turn undone". | none | Disabled while a reply runs, with "Wait for the reply to finish" under it. |
| File checkpoints | A row with a chevron. | Swaps to the File checkpoints sheet. | none | |
| Chat details | A row with a chevron. | Swaps to the Chat details sheet. | none | |
| Archive | A row. | Closes the menu and archives the chat (`archiveChat`: `session.set_hidden` with `hidden: true`, the chat leaves Pinned, toast "Archived"); the open chat gives way to a new draft, as archiving it from the chat list does. | none | Errors toast. |
| Delete | A red row, last. | Closes the menu and asks "Delete “<title>”?" ("The whole conversation is removed. This cannot be undone."). On confirm: `deleteChat` (the chat's live sessions are closed first, `session.delete`, it leaves Pinned and the custom order) and toast "Deleted". | none | |

**Data:** `PATCH /api/sessions/<id>`, `session.undo`, `session.set_hidden`, `session.delete`, `session.close`, plugin `POST /cleanup` (removes the deleted chat's photos, files and canvas from the phone, keeping what is still attached in the composer), plugin `DELETE /checkpoints`, the pins in `hm.order.v1.<profile>` (mirrored to the plugin's `/prefs`, `web/src/order.ts`).
**Rules:** deleting a chat first closes its live sessions, because Hermes refuses to delete a chat that still has one. Pin, Archive and Delete tell the chat list's snapshot exactly as the list's own menu does (`chatListChanged` after Archive and Delete, nothing after Pin; 3.13), because both call the same functions in `chatactions.ts`. The share text format is `chatMarkdown` (`web/src/export.ts`): `# <title>`, `_Exported from Hermux on <date>_`, then `**You:**` and `**Hermux:**` blocks, attachments as `_Attached: …_`, tool calls as one italic line `_🔧 name: context (failed)_`, sub-agents as `_🤖 Sub-agent: goal_`, error notices as `> ⚠ …` quotes; info notices are left out.

#### Draft menu sheet
**Opens from:** Chat options on the empty new-chat screen. **Closes with:** tap outside, drag down, Back. **Source:** `web/src/components/ChatMenu.tsx` `DraftMenuSheet`.

**Layout, top to bottom:**

| Element | Looks like | Tap | Long-press / swipe | States (empty, loading, error, disabled) |
|---|---|---|---|---|
| Header | "New chat" | | | |
| Read replies aloud | A row with a switch (`role="switch"`), "Applies once the chat starts" under it. | Flips the choice for the chat that will be created (`setDraftRead`) in place, the menu stays open; toast "This chat will read every reply aloud" / "Read-aloud off for this chat". | none | |
| Note | "Rename, pin, archive and delete are available once you have sent a message." | | | |

There is no model row: the model chip is on the same screen (3.4). **Data:** `setDraftRead` in `voice.ts`, applied by `applyDraftRead` when the chat gets its id.

#### Chat details sheet
**Opens from:** Chat menu → Chat details. **Closes with:** tap outside, drag down, Back. **Source:** `web/src/components/Sheets.tsx` `SessionActionsSheet`.

Read-only facts in groups (`Section` and `Row`, 3.20), in plain words: **Chat** (Title; Bot, the bot's display name or its name; Working folder, the chat's `cwd`), **Model** (Model, Provider), **Usage** only when something is known (Tokens "N in · M out", Context "N% used", Cost `$0.0000`, each only when known), then **Chat ID** (the stored chat id) with a copy button (`aria-label` "Copy chat ID") that copies it and toasts "Copied". Missing values show "—". **Data:** `active.info`, `active.usage` and the bots list (`profiles`).

#### Context window sheet
**Opens from:** the context ring in the composer's model row, in the tray (`setState({ sheet: 'context' })`). **Closes with:** tap outside, drag down, Back. **Source:** `web/src/components/Sheets.tsx` `ContextSheet`, `useCompress`.

**Layout, top to bottom:** title "Context window"; a bar (`.ctx-bar`) filled to the percent (amber from 80 %, red from 90 %) and "N% used"; "12,345 of 128,000 tokens" (`toLocaleString()`), and "estimated by Hermux" when `usage.context_estimated`; when `usage` has them: "This chat so far: input N · output N", "Cost: $0.0123" (`cost_usd`, 4 decimals under $1 via `fmtCost`) and "Cache hits: 63%" (`cache_hit_pct`); the button "Compress older turns" (`session.compress` through `compressChat`, spinner while it runs, then a toast with the result). The button is disabled while a reply runs, with the note "Wait for the reply to finish". `useCompress` is the small hook (`{ busy, run }`) that `CompressHint` shares with this sheet.

#### Backend status sheet
**Opens from:** the header status dot; Settings → Status. **Closes with:** tap outside, drag down, Back. **Source:** `web/src/components/Sheets.tsx` `StatusSheet`.

**Layout, top to bottom:**

| Element | Looks like | Tap | Long-press / swipe | States (empty, loading, error, disabled) |
|---|---|---|---|---|
| Title | "Backend status" | | | |
| Hero | A big dot and a headline: "Everything is working", "Connecting to Hermux…", "Hermux is offline" or "Hermux is up, with problems"; under it "Checked 12s ago · Hermux agent v<version>". | | | "Checking…" until the first check ends. |
| Connection row | Value: the ping in ms, "Connected", or Offline / Connecting. Note: "Live link to Hermux on this phone", or the connection detail when not open. | | | |
| Dashboard row | Value: OK, Degraded, Failed… or "Unreachable" with the note "Can't reach Hermux's dashboard on the phone". | | | |
| Agents running | Number of agents running now. | | | Only when the dashboard reports it. |
| Memory row | "N GB free", note "N GB swap in use". | | | Only when reported. |
| Storage row | "N GB free". | | | Only when reported. |
| Shizuku row | Value from `shizukuRow` (`web/src/statusrows.ts`): Running (note "Restarts by itself" or "Start it by hand after a restart"), Not installed (note "Lets Hermux see and use the screen. Install it from Setup check."), Not running ("Open Shizuku and start it."), Termux not allowed ("In Shizuku, allow Termux."; also when the app sees Shizuku running but Hermes can't reach it), Not answering ("Set Shizuku’s and Termux’s Battery to Unrestricted."), Not set up for Hermux ("Run the installer in Termux again."), or "Checking…". | Open Shizuku fixes: opens the Shizuku app (`setupFix('open-shizuku')`). Setup fixes: closes the sheet and opens the `setup` screen. | none | Hidden outside the phone app or with no answer. |
| Check again | Primary button. | Re-runs `checkHealth()` (a `gateway.ping` plus `GET /api/status`) and asks `GET /phone-access` again. | none | Reads "Checking…" and is disabled while running. |
| Reconnect / start Hermux | Button. | `reconnectNow()` (starts Hermes through the shell, then reconnects); toast "Reconnecting…". | none | |
| Setup check | Button. | Closes the sheet and opens the `setup` screen. | none | |

**Data:** `store.health` from `web/src/health.ts` (`gateway.ping` every minute while the app is in front, the full `GET /api/status` every 10 minutes or when this sheet opens), `GET /phone-access` (plugin), the `setupState` bridge call. A late answer after the sheet closes is dropped.
**Rules:** the header dot uses only what the app needs (the gateway socket, the dashboard and storage components, critical memory or disk pressure). Messaging platforms Hermes may also run do not turn it amber.

#### Goal sheet
**Opens from:** tapping the goal line in the status bar (local state in `StatusBar`, not a `state.sheet`). **Closes with:** tap outside, drag down, Back (`useBackHandler`), or after Clear goal. **Source:** `web/src/components/Sheets.tsx` `GoalSheet`.

Shows the goal (Hermes's `/goal`) from `ActiveSession.goal`: title, status (with the pause reason), turns used of the maximum, the contract fields that are not empty (Outcome, Verification, Constraints, Boundaries, Stop when), Last verdict and Reason when set, and the subgoals as a list. Buttons: Pause (while active) or Resume (while paused), each calling `goalAction`; Clear goal asks "Clear this goal?" (confirm "Clear") first. Errors are toasted. The goal is read by `loadGoal` and kept current by `session.control.update` events.

#### File checkpoints sheet
**Opens from:** Chat menu → File checkpoints; the Checkpoints button of the changed files card (3.3). **Closes with:** tap outside, drag down, Back (Back first leaves a snapshot view). **Source:** `web/src/components/Sheets.tsx` `RollbackSheet`; `web/src/checkpoints.ts`.

Hermes snapshots a folder before it edits a file there (once per turn). The plugin (`checkpoints.py`) records which snapshots this chat caused; the sheet lists them and can restore a folder or one file.

**Layout, top to bottom:**

| Element | Looks like | Tap | Long-press / swipe | States (empty, loading, error, disabled) |
|---|---|---|---|---|
| Title | "File checkpoints", or "Snapshot · <date>" inside a snapshot. | | | |
| Folder list | A heading per folder (`~/projects/app`, long paths shortened to the last two folders) and a row per snapshot: date (the newest says "latest"), the reason ("Before patch", "Before a restore") and the files edited. | Opens that snapshot. | none | "No checkpoints yet. Hermux snapshots a folder before this chat first edits a file in it, once per turn." when empty. "Loading…" first. |
| Pruned note | "N older snapshots pruned (Hermux keeps 20 per folder)". | | | Only when some were pruned. |
| All checkpoints | `‹` row inside a snapshot. | Back to the list. | none | |
| Changed files | For each file changed since the snapshot: a tag new / changed / deleted, the name, `+added −removed`, and its diff (header lines cut, `DiffView`). | Restore file puts back that one file. | none | Shown only when the file was edited in that snapshot, can be restored (not "new") and several files changed. "Nothing changed since this snapshot." when empty. |
| Restore button | Red full-width button: "Restore <file>" (one file) or "Restore these N files". | Confirms (dialog "Restore this folder?" or "Restore <file>?" listing each file: "deleted (made after this snapshot)", "brought back", "back to how it was"), then restores. | none | Reads "Restoring…" while busy. |

**Data:** plugin `GET /checkpoints?session=` (list), `GET /checkpoints/diff` (a snapshot compared to now), `POST /checkpoints/restore` (body: session, workdir, snapshot id, file), `DELETE /checkpoints` (when a chat is deleted). Those calls use no profile scoping.
**Rules:** a folder restore keeps files the user changed after the snapshot, and the chat itself stays as it is. After a restore a toast tells what happened ("Restored 3 files · kept 1 file (changed by you or too big)"; amber when something was kept), the snapshot view closes, and the list reloads because Hermes snapshots the state before restoring. A snapshot id is `tree@date`, so it survives Hermes pruning its chain.

#### Pickers used in the chat

- **Add** (composer): see 3.4.
- **Copy reply** (assistant message): see 3.3.
- **Auto: run without asking** (composer's Auto button): see 3.2.

These are `PickerSheet` instances from `web/src/components/ui.tsx` (3.20): rows on a card, with the menus' row look (an optional icon, a title, a sub-line, and a check on the current choice). Picking closes the picker.

---
