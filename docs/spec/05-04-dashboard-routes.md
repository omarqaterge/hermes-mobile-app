### 5.4 Dashboard routes (all 46)

Base path: `/api/plugins/hermes-mobile`. Most routes accept a `?profile=` query that the app adds through its `api` helper (routes marked "global" are sent without it). Errors are standard `HTTPException`s. The web page reaches these through `web/src/api.ts` `api`; `HermesService` and `MainActivity` call a few from Java.

| Method and path | What it does | Who calls it |
|---|---|---|
| `GET /memory` | Built-in memory: `memory` and `user` snapshots (`entries`, `used`, `limit`) read through Hermes's own `MemoryStore` for the profile (limits from `config.yaml`, default 2200 / 1375). | Memory screen (`web/src/components/Screens.tsx`) |
| `POST /memory` | Add, replace or remove one entry (`action`, `target` memory or user, `content`, `old_text`); same locks, limits and threat scan as the agent's memory tool. | Memory screen |
| `GET /tool-result` | Stored output of one tool call by `tool_call_id` from the profile's `state.db` (read-only), 60,000 characters at most with `truncated`. 404 when not stored. | Tool cards (`web/src/components/ChatItems.tsx`) |
| `POST /sent-counts` | Body `{ids}` (up to 500 chat ids). `sent_counts` reads the profile's `state.db` (read-only) in one query and answers `{counts: {id: n}}`: the `role = 'user'` rows of each chat and of the chats it was compressed into (`end_reason` `compression`), leaving out the rows the user never typed (`_NOT_TYPED_KINDS` display kinds such as `model_switch`, and `_NOT_TYPED_PREFIXES` such as `[System:` and `[CONTEXT COMPACTION`). A plain `def`, so the dashboard runs it off its event loop. | The drawer's "N msgs" (`web/src/sent-counts.ts`) |
| `GET /bots` | State of the always-on bots: `keep`, `host_running`, `running`, `parked`, `platforms`, `keeper_alive`. | No caller in the app today (`web/src/components/Bots.tsx` defines the base path but uses `/api/profiles`) |
| `PUT /bots/{name}` | Switch one bot on/off in `bots.json` (`keep`, `restart`); 404 for an unknown profile. | No caller in the app today |
| `GET /bots/log` | Tail of `mobile-gateway.log`. | No caller in the app today |
| `POST /approve` | Answer a pending approval from a notification button: opens Hermes's dashboard WebSocket (token scraped from the dashboard page) and sends `approval.respond` with `choice` once / session / always / deny. Refuses (409) when no `request_id` is given, so it never answers the wrong approval. | `HermesService` (notification actions) |
| `POST /stop` | Interrupt a running turn: finds the live runtime with `session.active_list` and sends `session.interrupt`. 404 when the chat is not running here. | `HermesService` (chip Stop button) |
| `GET /media` | Streams a phone file with HTTP Range support (206/416), so `<video>` can seek. Path is made absolute with `realpath`. | `MainActivity` (`shouldInterceptRequest`) |
| `GET /activity` | Live work reported by the hooks in every Hermes process (from `activity.json`; drops entries older than 300 s, dead pids, and items older than 180 s, or 60 s for background review). Also re-runs the battery slow-down. | Status banner (`web/src/activity.ts`) |
| `GET /phone-access` | What of the phone Hermes can reach: `files` (`/sdcard` readable), `termux_api` (a `termux-battery-status` answer, one retry), `shizuku` (`ok`, `off`, `denied`, `blocked`, `missing` from `rish -c id`, one retry on "Request timeout"). Cached 15 s, or 5 s while `shizuku` is not `ok` or `missing` so a fix shows soon; one check at a time (`_phone_lock`): a request that comes while one runs waits for its answer instead of starting another `rish`, which could ask Shizuku's "Allow Termux?" again. Global. | Setup check (`web/src/components/Sheets.tsx`, `web/src/components/Setup.tsx`) |
| `POST /refresh-logins` | Refreshes an expired Claude subscription token (`load_pool("anthropic")`) so the model picker can fetch the live model list. Returns `{ok, anthropic}` or `{ok: false, error}`. Global. | `web/src/api.ts` |
| `GET /prefs` | The saved order of pinned and manually ordered chats for a profile. | `web/src/order.ts` |
| `PUT /prefs` | Saves `pinned`, `manual`, `at` to `prefs.json`; the newest `at` wins (an older one is ignored). | `web/src/order.ts` |
| `GET /bgapps` | Background apps setting: `allow_sensitive`, `available`, and `reason` ("Needs Shizuku (rish isn't set up)" or "Needs Android 14 or newer"). Global. | Settings (`web/src/components/Settings.tsx`) |
| `PUT /bgapps` | Sets `allow_sensitive` in `bgapps.json`. | Settings |
| `GET /openui` | Cards in replies setting: `{enabled}`. Global. | Settings, Replies section |
| `PUT /openui` | Sets `enabled` in `openui.json` (new chats only). | Settings |
| `GET /auto` | Auto mode of one chat (`?session=`): `{session, mode}` where mode is `auto` or empty. | No caller in the web app today |
| `PUT /auto` | Puts a chat in or out of Auto mode (`mode: "auto"` or empty); 400 for an empty or too long id. Global. | `web/src/gateway.ts` (`setPluginAuto`) |
| `GET /canvas` | The chat's canvas documents (metadata, oldest first). | `web/src/canvas.ts` |
| `GET /canvas/doc` | One document with content and version list. | `web/src/canvas.ts` |
| `GET /canvas/version` | Content of one older revision. | `web/src/canvas.ts` |
| `POST /canvas/doc` | Create a document as the user. | `web/src/canvas.ts` |
| `PUT /canvas/doc` | Replace a document's content as the user; `base_rev` makes a stale write fail with 409 "conflict". | `web/src/canvas.ts` |
| `POST /canvas/restore` | Restore an old revision as a new revision. | `web/src/canvas.ts` |
| `POST /canvas/rename` | Rename a document. | `web/src/canvas.ts`, `web/src/gallery.ts` |
| `POST /canvas/open-file` | Load a phone text file into a new (or reloaded) document. | `web/src/canvas.ts` |
| `POST /canvas/save-file` | Write a document back to the file it was opened from. | `web/src/canvas.ts` |
| `DELETE /canvas/doc` | Delete a document (the app's "close"). | `web/src/canvas.ts`, `web/src/gallery.ts` |
| `GET /gallery` | Every chat's canvas documents and old Library items in one list, newest first, with `categories` counts; `?q=` needs every word in the title or text. Global. | Gallery (`web/src/gallery.ts`, `web/src/components/Screens.tsx`) |
| `GET /library` | Old Library items and category counts. | No caller in the web app today |
| `GET /library/item` | One old Library item with content. | `web/src/gallery.ts` |
| `POST /library` | Copy a canvas document into the Library. | No caller in the web app today (nothing new is saved) |
| `PUT /library/item` | Rename or recategorise an old item. | `web/src/gallery.ts` |
| `DELETE /library/item` | Delete an old item. | `web/src/gallery.ts` |
| `POST /cleanup` | Delete uploads (photos, attached files) and canvas folders that no existing chat uses; files newer than 15 minutes and names in `keep` are kept; `?dry_run=true` only reports. | `web/src/gateway.ts` after a chat is deleted |
| `GET /checkpoints` | The chat's file snapshots grouped by folder, newest first. | `web/src/checkpoints.ts` |
| `GET /checkpoints/diff` | Per-file diff between a snapshot and now (`workdir`, `snap`); 404 when pruned. | `web/src/checkpoints.ts` |
| `POST /checkpoints/restore` | Restore a folder or one file to a snapshot (user edits made after Hermes's last write are kept); the restore itself becomes a new snapshot. | `web/src/checkpoints.ts` |
| `DELETE /checkpoints` | Forget a deleted chat's ledger. | `web/src/checkpoints.ts` |
| `POST /openui/call` | A card's live-data call: runs one allow-listed read-only tool. 403 for a tool not allowed, 504 after 30 s, 502 if the tool failed. Global. | Card renderer (`web/src/components/OpenUIBlock.tsx`) |
| `POST /claude-login/start` | Starts the Claude Pro/Max sign-in; returns `session_id`, a claude.ai `url`, `expires_in`. 501 if this Hermes lacks the helpers. | Sign-in sheet (`web/src/components/SignIn.tsx`) |
| `POST /claude-login/finish` | Exchanges the pasted `code#state` and saves the login; 400 with a readable reason for a wrong or expired code. | `web/src/components/SignIn.tsx` |
| `POST /claude-login/cancel` | Forgets a started sign-in. | `web/src/components/SignIn.tsx` |
| `POST /profiles/link` | Links the plugin into every profile now; returns the profiles changed. Global. | Bots page (`web/src/components/Bots.tsx`) after creating a profile |

#### Behaviour notes for the routes

- **Memory.** `_store(profile)` builds a `MemoryStore` subclass whose paths are the profile's `memories/MEMORY.md` and `USER.md`, de-duplicating entries on read.
- **Auto, OpenUI, Background apps** settings live in small JSON files (5.5) written atomically (`tmp` then replace).
- **Canvas errors.** `CanvasError` becomes HTTP 409 when its text starts with "conflict", otherwise 400. `LibraryError` becomes 400.
- **Claude sign-in** (`claude_login.py`): `start` creates a PKCE pair and state and keeps `{verifier, state, profile}` in memory for 600 s (8 sessions at most, oldest dropped). `finish` checks the session exists, belongs to the same profile and that the code's `#state` part matches (constant-time); the session survives a wrong paste but is single-use once the exchange starts. It then exchanges the code with Hermes's own `agent.anthropic_credentials` helpers and adds a pool entry exactly like `hermes auth add anthropic` (`hermes_cli.auth_commands`). Tokens are never returned or logged. These helpers are private to Hermes; recheck them on every Hermes pin move (6.4).
- **Cards.** `openui_query.call_tool(name, args)` raises `PermissionError` for anything not in `openui_tools.json` with `readOnlyHint`. `find_chats` runs in-process; the other tools go through Hermes's `model_tools.handle_function_call` under task id `hm-openui-card` with no session (no chip). After `read_file` and `search_files` the read tracker for that task is cleared, so the same read can be repeated.
- **Checkpoints** (`checkpoints.py`). Hermes snapshots a folder before `write_file`/`patch`, but per folder, not per chat. The hooks read the folder's ref tip before and after the call; a new tip is the snapshot for this edit and is appended to `~/.hermes/mobile/checkpoints/<chat>.jsonl` (a second edit in the same turn reuses the turn's snapshot). Snapshots are identified by tree and author date because Hermes's pruning rewrites commit ids. Diff and restore run Hermes's own `CheckpointManager` (`safe=True` restore). `install_git_env_shim` caches the answer to "does this platform use system git", turning each checkpoint git call from about 1.5 s to cheap under proot. `maintain` runs at most daily (and at most once an hour per process, in a thread after a turn): `git gc` when pending, and drops project entries that never got a snapshot.
- **Battery slow-downs** (`plugin_api.py` `slow_desktop_watchers`, `slow_background_polls`, run when the module loads and on every `GET /activity`). Hermes's dashboard runs Desktop's file watchers; under proot each wake costs CPU even with the app closed. The module raises (never lowers) intervals on `tui_gateway.server`: `sessions.changed` 2 s, `cron.changed` 5 s, every other watcher 30 s, lease poll 5 s, kanban and bot-delivery polls 30 s, the skin check 30 s (the first one runs at once, even right after boot), the group-chat runtime poll 25 s, and the notification queue wait 2.5 s. The app only listens for `sessions.changed`.
- **Profile linking.** `link_profiles()` runs on module import (every dashboard start) and via `POST /profiles/link`: for each profile it makes `<profile>/plugins/hermes-mobile` a symlink to the main copy, replacing a copied folder (a cloned profile's copy would never be updated). Without it, a profile made later has no status chip, approvals or canvas.
