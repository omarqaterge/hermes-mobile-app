### 3.5 Chat sheets

All the sheets below share the `Shell` frame in `web/src/components/Sheets.tsx` (except the two menus, which use a smaller frame): a bottom sheet with a grip, a title, and content that scrolls. Dismiss with a tap outside, Android Back, or by dragging down on the top 64 px (`useSheetDrag`: closes after a 110 px drag, or a quick flick over 30 px).

#### Model sheet
**Opens from:** the composer's model chip; the Add picker's model row; the draft menu's "Change model". **Closes with:** picking a model, tap outside, drag down, Back. **Source:** `web/src/components/Sheets.tsx` `ModelSheet`.

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
| Star button per row | ☆ / ★ (aria-label "Star <model>" / "Unstar <model>") | Toggles the favourite. | none | |
| Status text | "Loading models…" until the first answer; an error box if `model.options` failed. | | | |

**Data:** `model.options` (twice: first the catalog Hermes has cached, so the list shows at once; then, after the plugin's `POST /refresh-logins` has renewed an expired subscription token, again with `refresh: true` for the live list), `config.set` (keys `model`, `reasoning`), `session.create`, `session.close`; `hm.favModels.v1`, `hm.customModels.v1`.
**Rules:** favourites are shared by all profiles and keyed by provider + model (`web/src/favs.ts`); a favourite whose provider is not signed in on this profile simply does not show.

How picking works (`setModel` in `gateway.ts`):

- **Empty chat, or no chat yet:** a model switch on a chat with nothing sent would leave a "model changed" marker as its first history row, which breaks later edits. So the app creates a new chat with the model (and the level) set from the start, closes the old empty one in the background, and toasts "Model: <name>". A chat that is "replaceable" has nothing sent, nothing attached and no reply running. Its folder (project chats) is kept.
- **Chat with messages:** the pick shows at once; `config.set` key `model` with `<model> --provider <provider> --session` is sent after the chat's agent has finished building (a new chat's agent takes about 2 s; a switch before that is lost). Then, unless the user chose a level in the sheet, the level is reset to the profile default (`medium` when none is set) with `config.set` key `reasoning`. A send right after a pick waits for the switch. On failure the old model is shown again and the error toasted.
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
**Opens from:** the header title; the header Chat options button. **Closes with:** any item (except Rename, File checkpoints and Chat details which keep the sheet open or swap it), tap outside, drag down, Back. **Source:** `web/src/components/Sheets.tsx` `ChatMenuSheet`.

**Layout, top to bottom:**

| Element | Looks like | Tap | Long-press / swipe | States (empty, loading, error, disabled) |
|---|---|---|---|---|
| Title | The chat title (branch icon for a branch). | | Drag down closes. | "New chat" if untitled. |
| Search in chat | 🔍 | Closes the sheet and opens the find bar (3.2). | none | |
| Rename | ✏️ | The list becomes a form: field "Chat title" and Save. Save renames through the dashboard (`PATCH /api/sessions/<id>`), keeps the branch mark of a branch, and toasts "Renamed". | none | Errors toast. |
| Read every reply aloud | 🔊 with sub-line "On" / "Off", plus " · this chat only" when the chat overrides the global setting or " · all chats" when the global setting is on. | Toggles read-aloud for this chat only (`setAutoReadFor`), toast "Reading every reply aloud in this chat" / "Read-aloud off for this chat". | none | |
| Canvas | 🗒 with sub-line "N document(s)" or "Documents, notes and pages beside the chat". | Opens the canvas (3.7). | none | |
| Share chat | 📤 "As Markdown, to any app" | Shares the whole chat as Markdown through the Android share sheet (`shareText` bridge call, up to 400,000 characters). Outside the app it copies instead and toasts "Copied as Markdown (sharing works in the phone app)". | none | |
| File checkpoints | ⏪ "See and undo Hermes's file changes" | Swaps to the Rollback sheet. | none | |
| Undo last turn | ↶ | Closes the sheet and runs `session.undo`, reloads the chat, toast "Last turn undone". | none | Disabled while a reply runs. |
| Chat details | ℹ️ | Swaps to the Chat details sheet. | none | |
| Delete | 🗑 (red) | Asks "Delete “<title>”?" ("The whole conversation is removed. This cannot be undone."). On confirm: `deleteSession` and toast "Deleted". | none | |

**Data:** `PATCH /api/sessions/<id>`, `session.undo`, `session.delete`, `session.close`, plugin `POST /cleanup` (removes the deleted chat's photos, files and canvas from the phone, keeping what is still attached in the composer), plugin `DELETE /checkpoints`.
**Rules:** deleting a chat first closes its live sessions, because Hermes refuses to delete a chat that still has one. The share text format is `chatMarkdown` (`web/src/export.ts`): `# <title>`, `_Exported from Hermes on <date>_`, then `**You:**` and `**Hermes:**` blocks, attachments as `_Attached: …_`, tool calls as one italic line `_🔧 name: context (failed)_`, sub-agents as `_🤖 Sub-agent: goal_`, error notices as `> ⚠ …` quotes; info notices are left out. Pin and archive are not in this menu; they live on the drawer's session rows (3.13).

#### Draft menu sheet
**Opens from:** Chat options on the empty new-chat screen. **Closes with:** an item, tap outside, drag down, Back. **Source:** `web/src/components/Sheets.tsx` `DraftMenuSheet`.

**Layout, top to bottom:**

| Element | Looks like | Tap | Long-press / swipe | States (empty, loading, error, disabled) |
|---|---|---|---|---|
| Title | "New chat" | | | |
| Read every reply aloud | 🔊 with "On"/"Off · applies once the chat starts" | Sets the choice for the chat that will be created (`setDraftRead`); toast "This chat will read every reply aloud" / "Read-aloud off for this chat". | none | |
| Change model | 🤖 | Opens the Model sheet. | none | |
| Note | "Rename, pin, archive and delete are available once you have sent a message." | | | |

**Data:** `setDraftRead` in `voice.ts`, applied by `applyDraftRead` when the chat gets its id.

#### Chat details sheet
**Opens from:** Chat menu → Chat details. **Closes with:** tap outside, drag down, Back. **Source:** `web/src/components/Sheets.tsx` `SessionActionsSheet`.

Read-only key/value list: Title, Model, Provider, Profile, Working dir (the chat's `cwd`), then when usage is known Tokens ("N in · M out"), Context ("N% used") and Cost (`$0.0000`), and Session id. Tapping the session id copies it (toast "Copied"). Missing values show "—". **Data:** `active.info` and `active.usage`.

#### Context window sheet
**Opens from:** the context ring in the composer's model row (`setState({ sheet: 'context' })`). **Closes with:** tap outside, drag down, Back. **Source:** `web/src/components/Sheets.tsx` `ContextSheet`, `useCompress`.

**Layout, top to bottom:** title "Context window"; a bar (`.ctx-bar`) filled to the percent (amber from 80 %, red from 90 %) and "N% used"; "12,345 of 128,000 tokens" (`toLocaleString()`), and "estimated by Hermes" when `usage.context_estimated`; when `usage` has them: "This chat so far: input N · output N", "Cost: $0.0123" (`cost_usd`, 4 decimals under $1 via `fmtCost`) and "Cache hits: 63%" (`cache_hit_pct`); the button "Compress older turns" (`session.compress` through `compressChat`, spinner while it runs, then a toast with the result). The button is disabled while a reply runs, with the note "Wait for the reply to finish". `useCompress` is the small hook (`{ busy, run }`) that `CompressHint` shares with this sheet.

#### Backend status sheet
**Opens from:** the header status dot; Settings → Status. **Closes with:** tap outside, drag down, Back. **Source:** `web/src/components/Sheets.tsx` `StatusSheet`.

**Layout, top to bottom:**

| Element | Looks like | Tap | Long-press / swipe | States (empty, loading, error, disabled) |
|---|---|---|---|---|
| Title | "Backend status" | | | |
| Hero | A big dot and a headline: "Everything is working", "Connecting to Hermes…", "Hermes is offline" or "Hermes is up, with problems"; under it "Checked 12s ago · Hermes v<version>". | | | "Checking…" until the first check ends. |
| Connection row | Value: the ping in ms, "Connected", or Offline / Connecting. Note: "Live link to Hermes on this phone", or the connection detail when not open. | | | |
| Dashboard row | Value: OK, Degraded, Failed… or "Unreachable" with the note "Can't reach Hermes's dashboard on the phone". | | | |
| Agents running | Number of agents running now. | | | Only when the dashboard reports it. |
| Memory row | "N GB free", note "N GB swap in use". | | | Only when reported. |
| Storage row | "N GB free". | | | Only when reported. |
| Shizuku row | Value from `shizukuRow` (`web/src/statusrows.ts`): Running (note "Restarts by itself" or "Start it by hand after a restart"), Not installed (note "Lets Hermes see and use the screen. Install it from Setup check."), Not running ("Open Shizuku and start it."), Termux not allowed ("In Shizuku, allow Termux."; also when the app sees Shizuku running but Hermes can't reach it), Not answering ("Set Shizuku’s and Termux’s Battery to Unrestricted."), Not set up for Hermes ("Run the installer in Termux again."), or "Checking…". | Open Shizuku fixes: opens the Shizuku app (`setupFix('open-shizuku')`). Setup fixes: closes the sheet and opens the `setup` screen. | none | Hidden outside the phone app or with no answer. |
| Check again | Primary button. | Re-runs `checkHealth()` (a `gateway.ping` plus `GET /api/status`) and asks `GET /phone-access` again. | none | Reads "Checking…" and is disabled while running. |
| Reconnect / start Hermes | Button. | `reconnectNow()` (starts Hermes through the shell, then reconnects); toast "Reconnecting…". | none | |
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
| Folder list | A heading per folder (`~/projects/app`, long paths shortened to the last two folders) and a row per snapshot: date (the newest says "latest"), the reason ("Before patch", "Before a restore") and the files edited. | Opens that snapshot. | none | "No checkpoints yet. Hermes snapshots a folder before this chat first edits a file in it, once per turn." when empty. "Loading…" first. |
| Pruned note | "N older snapshots pruned (Hermes keeps 20 per folder)". | | | Only when some were pruned. |
| All checkpoints | `‹` row inside a snapshot. | Back to the list. | none | |
| Changed files | For each file changed since the snapshot: a tag new / changed / deleted, the name, `+added −removed`, and its diff (header lines cut, `DiffView`). | Restore file puts back that one file. | none | Shown only when the file was edited in that snapshot, can be restored (not "new") and several files changed. "Nothing changed since this snapshot." when empty. |
| Restore button | Red full-width button: "Restore <file>" (one file) or "Restore these N files". | Confirms (dialog "Restore this folder?" or "Restore <file>?" listing each file: "deleted (made after this snapshot)", "brought back", "back to how it was"), then restores. | none | Reads "Restoring…" while busy. |

**Data:** plugin `GET /checkpoints?session=` (list), `GET /checkpoints/diff` (a snapshot compared to now), `POST /checkpoints/restore` (body: session, workdir, snapshot id, file), `DELETE /checkpoints` (when a chat is deleted). Those calls use no profile scoping.
**Rules:** a folder restore keeps files the user changed after the snapshot, and the chat itself stays as it is. After a restore a toast tells what happened ("Restored 3 files · kept 1 file (changed by you or too big)"; amber when something was kept), the snapshot view closes, and the list reloads because Hermes snapshots the state before restoring. A snapshot id is `tree@date`, so it survives Hermes pruning its chain.

#### Pickers used in the chat

- **Add** (composer): see 3.4.
- **Copy reply** (assistant message): see 3.3.
- **Auto: run without asking** (header): see 3.2.

These are `PickerSheet` instances from `web/src/components/ui.tsx` (3.20): a list with an optional icon, a title, a sub-line, and a check on the current choice. Picking closes the picker.

---
