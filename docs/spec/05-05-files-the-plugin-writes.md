### 5.5 Files the plugin writes and reads

Paths are in Debian unless noted. "Root" is `~/.hermes`.

| Path | Written by | Holds |
|---|---|---|
| `~/.hermes/mobile/activity.json` | hooks (`_publish_activity`) | Per Hermes process (pid): items `{session, text, short, profile, review, ts}`; read by `GET /activity`. |
| `~/.hermes/logs/mobile-status.log` | `_dbg` | Status trace for a chip stuck on "Thinking"; rotated to `.1` above 200,000 bytes. |
| `~/.hermes/mobile/auto.json` | `auto_mode.set_mode` | `{"chats": {chat id: "auto"}}`. |
| `~/.hermes/mobile/canvas/<chat>/<doc>.json` | `canvas.py` | One document with versions; `.lock` file beside them. |
| `~/.hermes/mobile/library/<id>.json` | `library.py` | Old saved copies (500 items at most). |
| `~/.hermes/mobile/checkpoints/<chat>.jsonl` | `checkpoints.py` | Snapshot ledger lines `{ts, turn, tool, file, workdir, base, tree, date, reason}`. The checkpoint store itself is Hermes's (its base folder gets a `.hm_maintained` marker). |
| `~/.hermes/mobile/prefs.json` | `PUT /prefs` | Pinned/manual chat order per profile. |
| `~/.hermes/mobile/bgapps.json` | `phone_app.write_prefs` | `{"allow_sensitive": bool}`. |
| `~/.hermes/mobile/openui.json` | `openui.set_enabled` | `{"enabled": bool}`. |
| `~/.hermes/mobile/bots.json`, `bots.heartbeat`, `~/.hermes/logs/mobile-gateway.log` | `bots.py` | Bot keeper state (retired, see 6.2). |
| `~/.hermes/cache/phone_app/screen-*.jpg` | `phone_app.py` | Screenshots for `capture` modes `som`/`vision`; the last 20 are kept. |
| `/data/local/tmp/hm-bghost.log` (phone shell side) | `BgHost` start | Host start-up log; read back through `rish` on a failed start. |
| `<profile>/memories/MEMORY.md`, `USER.md` | `POST /memory` | Hermes's own memory files. |
| `<profile>/auth.json` credential pool | `claude_login.py` | A new `anthropic` entry from the in-app sign-in. |
| `~/.hermes-mobile/key` (Termux home) | read only | The shared key for `POST /event` on the app. |
