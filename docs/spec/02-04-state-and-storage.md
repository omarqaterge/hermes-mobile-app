### 2.4 State and storage

#### 2.4.1 Page storage (WebView `localStorage`)

Nothing secret lives in `localStorage`. "Per profile" means the key ends in `.<profile>` or the value records the
profile. Every read is wrapped in try/catch: a missing or corrupt value gives the default.

| Key | Owned by | What it holds | Per profile? |
|---|---|---|---|
| `hm.autoread` | `voice.ts` (`AUTO`) | Read replies aloud for every chat: `'1'` / `'0'`. Mirrored to the shell with `setReadAloud`. | No |
| `hm.autoread.chats` (inventory name `hm.autoread`) | `voice.ts` (`AUTO_CHATS`) | Per-chat read-aloud override: `{chatId: boolean}`; wins over the global switch. | No (chat ids) |
| `hm.autostartDone` | `components/Setup.tsx` | `'1'` once the user confirmed the Autostart step. | No |
| `hm.boot.v1` | `boot.ts` | The latest start-up's stage marks: `{at, marks: [[stage, ms]…]}` (stages `script`, `token-asked`, `token`, `socket`, `painted`, `resume-start`, `sessions`, `chat-live`; each recorded once per page load). Shown in Settings → About. | No |
| `hm.lineage.v1` | `lineage.ts` | Which chat ids are one chat: `[{s: [stored ids], r: [live ids]}]` (≤ 300 chats, ≤ 24 stored and ≤ 8 live ids each), learnt from `session.resume`, the session list, `session.compress` and `session.info`. Chat ids only. The page asks the app's phone-data record about every id of the chat on screen, not only today's (2.3). | Records the profile only through the ids |
| `hm.chatcache.v1` | `chatcache.ts` | One chat for the next cold start: `{profile, storedId, title, items}` (≤ 60 items, ≤ 1,500,000 characters). | Records the profile |
| `hm.cmds.v1` (suffix `.<profile>`) | `commands.ts` | The slash-command and skill catalog `[{name, desc, kind}]` from `commands.catalog`; refreshed when older than 10 minutes. | Yes |
| `hm.connectedOnce` | `components/Setup.tsx` | `'1'` once Hermes ever answered; after that a launch never opens the first-run flow by itself. | No |
| `hm.approvalNoLockHint.v1` | `approval-lock.ts` | `'1'` once the "no screen lock" hint for Confirm approvals with fingerprint was shown. | No |
| `hm.defaultAccess.v1` | `gateway.ts` (`DEFAULT_ACCESS_KEY`) | Settings → Auto for all chats: `'auto'` or `'full'`; absent = Off. | No |
| `hm.devBase` | `bridge.ts` | Development only, and in `sessionStorage`, not `localStorage`: the dashboard base URL the dev server injects. | No |
| `hm.devToken` | `bridge.ts` | Development only, `sessionStorage`: the dashboard token the dev server injects. | No |
| `hm.draft` | `drafts.ts` | Legacy single draft (before `hm.drafts.v1`); moved into `hm.drafts.v1` as `new:<profile>` and deleted on first read. | No |
| `hm.visit.v1` | `visit.ts` | When each chat was last on screen: `{chatId: ms}`; newest 500 kept. Drives the "New Messages" divider. | No |
| `hm.stash.v1` | `stash.ts` | Drafts put aside from the composer: `[{id, text, at, chat}]`, newest first, at most 20 (`chat` is the stored chat id or null). | No |
| `hm.drafts.v1` | `drafts.ts` | Unsent composer text: `{chatId: text}`, plus `new:<profile>` for the new-chat screen; newest 100 kept. | Mixed (new-chat drafts per profile) |
| `hm.favModels.v1` | `favs.ts` | Starred models `[{p: provider, m: model}]` in starring order. | No (shared by all profiles) |
| `hm.sideHidden.v1` | `sidepanel.ts` | `1` while the user has hidden the docked chat list on a wide screen; absent = docked. | No |
| `hm.canvasSplit.v1` | `splitview.ts` | The canvas column's share of the room beside the chat list on wide screens, 0.2–0.85, set by dragging the divider; absent = the default width. | No |
| `hm.customModels.v1` | `custommodels.ts` | Model ids typed into a model picker and picked once `[{p: provider, m: model}]`; shown as normal rows under their provider. | No (shared by all profiles) |
| `hm.hermesSeen` | `hermes-update.ts` | The Hermes version already warned about ("This Hermux agent is a different version…"), so the toast shows once per version. | No |
| `hm.lastSession` | `gateway.ts`, `store.ts` | The chat to reopen on start: `{id, profile}`; used only when the profile matches. | Records the profile |
| `hm.live.pause` (inventory name `hm.live`) | `live.ts` (`PAUSE_KEY`) | Live mode: seconds of silence before sending (0.5–10, default 2). | No |
| `hm.live.bargein` | `live.ts` (`BARGE_KEY`) | Live mode: talking over Hermes cuts it off (`"0"` = off; anything else or absent = on). | No |
| `hm.oled` | `theme.ts` | Legacy OLED switch (`'1'`), read only when `hm.theme` is absent. | No |
| `hm.queue.v1` | `queue.ts` | Follow-ups queued while Hermes works: `{storedChatId: [{id, text, at}]}`, oldest first, at most 10 per chat; a deleted chat's entry is removed. | No |
| `hm.openui.v1` | `openui-msg.ts` | Card form/variable state: `{"<chatId>:<hash of card code>": {at, s}}`; newest 150 cards, ≤ 300,000 characters. | No (chat ids) |
| `hm.order.v1` (suffix `.<profile>`) | `order.ts` | Drawer pins and custom order `{pinned, manual, at}`; mirrored to the plugin's `/prefs` (newest `at` wins). | Yes |
| `hm.outbox.v1` | `gateway.ts`, `store.ts` | The one message queued while offline: `{chat, text, atts?, runtime?}`. | No |
| `hm.profile` | `store.ts`, `gateway.ts` (`switchProfile`) | The open Hermes profile (default `default`). | — |
| `hm.recent.v1` (suffix `.<profile>`) | `recent.ts` | Recent prompts for the empty screen, newest 20, 4–200 characters. | Yes |
| `hm.seen.v1` (suffix `.<profile>`) | `unread.ts` | Unread tracking `{chatId: {n: seen, c: listed, t: changed-at}}` plus `#since`; newest 1,500 chats. | Yes |
| `hm.sessions.v1` (suffix `.<profile>`) | `gateway.ts` (`SESSIONS_CACHE`) | The last chat list (first 80 rows), shown while Hermes (re)starts. | Yes |
| `hm.setupFlowDone` | `components/Setup.tsx` | `'1'` once the first-run setup flow finished. | No |
| `hm.shizukuStepDone` | `components/Setup.tsx` | `'1'` once Shizuku was seen running (or the user said it runs). | No |
| `hm.replaceTermux` | `components/Setup.tsx` | Time (ms) the user confirmed Replace Termux; cleared once F-Droid's set is being installed, or after 10 minutes. | No |
| `hm.stats.v1` | `gateway.ts` (`STATS_KEY`) | Turn stats under replies: `{"<chatId>:<user row id>": "~41 tok/s · 1m 23s"}`; newest 2,000. Entries from older builds end in `ctx 2% · 8k/200k`: hidden when shown, and read by `savedCtx` for a chat with no `hm.ctx.v1` entry. | No (chat ids) |
| `hm.ctx.v1` | `gateway.ts` (`CTX_KEY`, `saveCtx`, `savedCtx`) | Each chat's last known context fill, `{"<chatId>": {"used", "max", "percent"}}`, written whenever `refreshCtx` gets a figure; newest 500. Fills the context ring at once when the chat is reopened. | No (chat ids) |
| `hm.statsChoice` | `stats.ts` | Usage stats: `'yes'` or `'no'`. Absent = the card (3.18) was not shown yet; it is written `'no'` as the card opens, so it never shows twice and closing it leaves stats off (with storage that can't be written: once per launch). | No |
| `hm.statsId` | `stats.ts` | Usage stats: the random install ID. Exists only while opted in; turning stats off deletes it. | No |
| `hm.statsSourceAsked` | `stats.ts` | `'1'` once "How did you hear about us?" was shown. The answer itself is not kept. | No |
| `hm.devStatsKey` | `stats.ts` | Development and browser tests only, in `sessionStorage`, not `localStorage`: an Aptabase app key for a build that has none. Ignored inside the Android app. | No |
| `hm.reportId` | `report.ts` | Report a problem: a random install ID (16 random bytes, made on the first report sent through the relay) so the relay can limit how often one install sends (3.21). Not the stats ID, nothing about the device. | No |
| `hm.diagOff` | `diaglog.ts`, `diagnostics.ts` | The diagnostic log's switch is off (`1`); in the app the shell's preference `diagOff` is what counts, and it also stops the log there (3.21). | No |
| `hm.diagPending` | `diagnostics.ts` | What Hermes's side of the diagnostic log hasn't been told yet, while it is offline: `{enabled?, clear?}`. | No |
| `hm.devReportUrl` | `report.ts` | Development and browser tests only, in `sessionStorage`, not `localStorage`: a relay URL for a build that has none. Ignored inside the Android app. | No |
| `hm.tasks.v1` | `tasks.ts` | Ticked task-list boxes in replies: `{<message hash>: {<box index>: bool}}`; newest 300 messages. | No |
| `hm.textScale` | `store.ts`, `components/Settings.tsx` | Text size factor (0.9, 1, 1.1, 1.2, 1.35). | No |
| `hm.theme` | `theme.ts` | `default`, `oled`, `light` or `system`. | No |
| `hm.tts` | `voice.ts` (`TTS`) | Voice settings `{engine, voice, rate, pitch}` (rate and pitch 0.5–2). | No |
| `hm.welcomeDone` | `components/Connect.tsx` | `'1'` once the Welcome screen was finished. | No |
| `hm.lockAssist.v1` | `lockview.ts` (`LOCK_ASSIST_KEY`) | Settings → Voice → Phone assistant → "Talk to Hermux on the lock screen": `'1'` on, `'0'` off; absent = off. Pushed to the shell with `setLockAssist`, which keeps its own copy. | No |
| `hm.yolo.v1` | `gateway.ts` (`YOLO_KEY`) | Each chat's own access choice: `{chatId: true (Full) | 'auto' | false (explicit Off)}`; absent = follows `hm.defaultAccess.v1`. | No (chat ids) |

Settings → Danger zone → Uninstall Hermux can put a settings snapshot into the backup: `uninstall.ts`
`SETTINGS_KEYS` (`hm.theme`, `hm.oled`, `hm.textScale`, `hm.tts`, `hm.autoread`, `hm.autoread.chats`,
`hm.favModels.v1`, `hm.customModels.v1`, `hm.live.pause`, `hm.live.bargein`, `hm.profile`, `hm.yolo.v1`). Caches, drafts and chat data are left out (3.19).

In-memory page state (`store.ts` `AppState`, not persisted): connection state, the open chat (`active`) and the
one being opened (`opening`, `preview`), pending server requests, open sheet/screen/drawer, toasts, health,
activity, unread list, find-in-chat, background app and the queued message.

#### 2.4.2 App-side native storage (Android `SharedPreferences`)

Owned by the Java side (4); listed here because the flows above depend on them.

| File → key | What it holds |
|---|---|
| `hermes` → `event_key` | The event key shared with Termux (2.3); only `LocalKey` reads or writes it. |
| `hermes` → `event_key_prev`, `event_key_prev_until`, `event_key_version`, `local_enforced` | `LocalKey` (2.3): the previous key and the end of its grace (epoch ms) after a rotation, the app version the current key was made under, and the switch for refusing the raw key (read only while `LocalKey.ENFORCE` is true; nothing writes it yet). |
| `hermes` → `termux_ok` | Termux has accepted one of the app's commands; gates every automatic `RUN_COMMAND`. |
| `hermes` → `plugin_state`, `plugin_detail`, `plugin_installed`, `plugin_at`, `plugin_checked_at`, `plugin_checked_version`, `plugin_try_at`, `plugin_tries_<stamp>` | The plugin update (6.6): the last state the script reported and why, the installed stamp, when it was checked (and for which app version), the last update try, failed tries per APK version. |
| `hermes` → `setup_token` | The installer's progress token while an install runs. |
| `hermes` → `wake_at` | The next cron wake-up time, re-armed after the app restarts. |
| `hermes` → `shizuku_*` | The Shizuku keeper's pairing, last result and whether it turned Wireless debugging on. |
| `hm` → `unseen` | Chats that finished while you weren't looking (Done chip + badge). |
| `hm` → `bg` | The page background colour, so the next launch doesn't flash. |
| `hm` → `readaloud` | Read-aloud mode for the service: `{global, sessions, tts}`. |
| `voice` | `Voice.java`'s own settings (4.6). |
| `voice` → `sttModel` | The on-device dictation model in use (`LocalStt`), `""` or missing = the phone's own recogniser. |
| `noBackupFilesDir/stt/` | On-device speech models: `<id>/` holds a model's files and `model.json` (`{id, name, kind, roles, punctuation, source, checked, test}`), `custom-<n>/` the ones the user added, `vad/silero_vad.onnx` the voice activity detector. Not backed up. |

#### 2.4.3 Hermes-side files the app relies on (proot Debian)

Paths are inside Debian; `~` is `/root`. Exact formats are in 5.5.

| Path | Written by | Used for |
|---|---|---|
| `~/.hermes/state.db` (and each profile's own under its `HERMES_HOME`) | Hermes | Chats and messages behind `session.*` and full-text search (`GET /api/sessions/search`); the plugin reads titles from it. |
| `~/.hermes/mobile/activity.json` | plugin (every Hermes process) | What Hermes is doing now; `GET /activity` → the activity banner. |
| `~/.hermes/mobile/auto.json` | `PUT /auto` | Chats in Auto access (the plugin's block rule reads it). |
| `~/.hermes/mobile/prefs.json` | `PUT /prefs` | Drawer pins and order, per profile. |
| `~/.hermes/mobile/openui.json` | `PUT /openui` | Settings → Replies: cards on or off. |
| `~/.hermes/mobile/bgapps.json` | `PUT /bgapps` | Background apps: allow sensitive apps. |
| `~/.hermes/mobile/bots.json`, `bots.heartbeat` | `bots.py`, `PUT /bots/{name}` | Bots on/off (3.16). |
| `~/.hermes/mobile/canvas/<chat id>/<doc id>.json` | `canvas.py` | Canvas documents with version history. |
| `~/.hermes/mobile/library/<id>.json` | `library.py` | Saved canvas copies (gallery). |
| `~/.hermes/mobile/checkpoints/<session>.jsonl` | `checkpoints.py` | File checkpoints per chat (rollback sheet). |
| `~/.hermes/cache/phone_app/` | `phone_app.py` | Background-app screenshots. |
| `~/.hermes/logs/mobile-status.log` | plugin | Status-chip trace (≤ 200 KB, rotated once). |
| `~/.hermes/mobile/diag.log`, `diag.log.1` | plugin `diag.py` | The diagnostic log on Hermes's side (3.21). |
| `~/.hermes/plugins/hermes-mobile/` | installer | The plugin itself. |
| `/root/.hermes/scripts/cron_ticker.py`, `hermes_memory_sync.py` | installer (the ticker: older installs only) | Run by the supervisor loops; the ticker now runs from the plugin folder (`/root/.hermes/plugins/hermes-mobile/cron_ticker.py`) when it is there. |

`POST /api/plugins/hermes-mobile/cleanup` (sent by `deleteSession`) removes a deleted chat's photos, attached files
and canvas, keeping whatever is still attached in an open composer.

#### 2.4.4 Termux-side files

| Path (Termux home) | Written by | Used for |
|---|---|---|
| `~/bin/hermes-services` | installer, then the app's plugin update (6.6) | The supervisor (2.1). |
| `~/.hermes-mobile/scripts.sha` | `plugin-update.sh` (`install.sh` removes it) | `NAME SHA256` of each Termux script last copied from a plugin (`hm-local`, `hm-shizuku`): a copy in `~/bin` that no longer matches it was changed by hand and is left alone (6.6). |
| `~/.hermes-mobile/services.sha`, `services-new`, `hermes-services.bak` | `plugin-update.sh` | The supervisor last installed from an APK; the dashboard's loop still runs an older one; the copy before it (6.6). |
| `~/bin/hermes-debian` | installer | Runs a command in Debian under proot-distro or chroot-distro; `--open` and `--exists` helpers. Missing on older installs, which use `proot-distro login debian --`. |
| `~/bin/hm-shizuku` | installer | Shizuku pair/start/status (2.2.9). |
| `~/bin/rish`, `~/bin/rish_shizuku.dex` | `phone/phone-access.sh` | Shizuku's shell, taken from Shizuku's own APK. |
| `~/.termux/boot/10-hermes` | `phone/bootstrap.sh` | Termux:Boot runs `~/bin/hermes-services` after a reboot. |
| `~/.hermes-mobile/key` | `HermesService.shareKeyWithTermux` | The event key (mode 600). |
| `~/.hermes-mobile/installed` | `phone/bootstrap.sh` at DONE | The app's Termux probe reads it as "the install finished". |
| `~/.hermes-mobile/distro` | `phone/install.sh` / `bootstrap.sh` | `proot` or `chroot`. |
| `~/.hermes-mobile/todo` | `phone/bootstrap.sh` | What the installer couldn't finish, shown at the end. |
| `~/.hermes-mobile/unlocked` | `hermes-services` | The boot id for which an old Termux wake lock was already released. |
| `~/.hermes-mobile/adb-paired`, `hm-shizuku.log` | `hm-shizuku` | Termux's adb is paired; its log. |
| `~/logs/loop-events.log` | `loop_exit` in `hermes-services`; `note_port` in `cron_ticker.py` | Fixed lines for the diagnostic log: a loop's name and exit code, and `local port_taken port=ticker` / `local port_ok port=ticker` when the poke port's state changes (64 KB at most; 3.21). |
| `~/.hermes-mobile/diag-off` | plugin `diag.set_enabled` | The diagnostic log's switch is off; `loop_exit` and `diag.py` both respect it. |
| `~/.hermes-mobile/enforced` | nothing yet | When it exists, `_TokenGuard` and the cron ticker no longer accept the raw event key; only local authentication's signed requests count (2.3). |
| `~/logs/<loop>.pid`, `~/logs/<loop>.log` | `run_loop` | One pid and log per loop: `dashboard`, `memory-sync`, `cron-ticker`, `app-keeper`. Each log is 2 MB at most (`trim_log`). |

Debian's root file system under proot is
`/data/data/com.termux/files/usr/var/lib/proot-distro/containers/debian/rootfs` (`MainActivity.hostPath` maps
`/root/…` there, and `/sdcard…` to `/storage/emulated/0…`, so Termux can open a file Hermes named).
