### 5.5 Files the plugin writes and reads

Paths are in Debian unless noted. "Root" is `~/.hermes`.

| Path | Written by | Holds |
|---|---|---|
| `~/.hermes/mobile/activity.json` | hooks (`_publish_activity`) | Per Hermes process (pid): items `{session, text, short, profile, review, ts}`; read by `GET /activity`. |
| `~/.hermes/logs/mobile-status.log` | `_dbg` | Status trace for a chip stuck on "Thinking"; rotated to `.1` above 200,000 bytes. |
| `~/.hermes/mobile/diag.log`, `diag.log.1` | `diag.py` (`event`) | The diagnostic log on this side (3.21): checked lines only, 128 KB each, owner-only. Deleted by `clear`. |
| `~/.hermes/mobile/auto.json` | `auto_mode.set_mode` | `{"chats": {chat id: "auto"}}`. |
| `~/.hermes/mobile/phone-read.json.lock` | `phone_taint.mark` | Empty file whose `flock` makes the read-modify-write of `phone-read.json` exclusive between processes. |
| `~/.hermes/mobile/phone-read.json` | `phone_taint.mark` (and `_fallback_save` in `__init__.py` when `phone_taint.py` cannot load) | `{"chats": {chat id: time}}`: every id of the chats that have called `phone_data` (the gateway's runtime id and the stored chat id, and the stored ids of the parents of a subagent that read), newest last, at most 2000. Ids and times only, never data or commands; written to a temp file and replaced while holding a lock on `phone-read.json.lock`. A missing file means nobody has read; a damaged one (not JSON, no `chats` object, a non-numeric time, unreadable) makes every chat count as having read and is left as it is (`mark` does not overwrite it) until it is deleted. If `phone_taint.py` cannot load, `_read_before` in `__init__.py` reads this file itself (path `_READ_FILE`): a missing file means nobody has read, and a file that exists but cannot be read or understood makes every chat count as having read (fails closed); when one id of a chat matches, `_fallback_save` adds the chat's other ids to the file (atomic replace, only into a readable file). The agent's own `write_file` and `patch` are on the allowlist and can rewrite this file, so it is a speed bump, not a lock. |
| `~/.hermes/mobile/canvas/<chat>/<doc>.json` | `canvas.py` | One document with versions; `.lock` file beside them. |
| `~/.hermes/mobile/library/<id>.json` | `library.py` | Old saved copies (500 items at most). |
| `~/.hermes/mobile/checkpoints/<chat>.jsonl` | `checkpoints.py` | Snapshot ledger lines `{ts, turn, tool, file, workdir, base, tree, date, reason}`. The checkpoint store itself is Hermes's (its base folder gets a `.hm_maintained` marker). |
| `~/.hermes/mobile/prefs.json` | `PUT /prefs` | Pinned/manual chat order per profile. |
| `~/.hermes/mobile/bgapps.json` | `phone_app.write_prefs` | `{"allow_sensitive": bool}`. |
| `~/.hermes/mobile/openui.json` | `openui.set_enabled` | `{"enabled": bool}`. |
| `~/.hermes/mobile/bots.json`, `bots.heartbeat`, `~/.hermes/logs/mobile-gateway.log` | `bots.py` | Bot keeper state (retired, see 6.2). |
| `~/.hermes/cache/phone_app/screen-*.jpg` | `phone_app.py` | Screenshots for `capture` modes `som`/`vision`; the last 20 are kept. |
| `~/.hermes/mobile/app-notes/<package>.md` | `phone_app.add_note` | What the model noted about an app (`phone_app` action `note`), shown when it opens the app again; the newest 3000 characters are kept. |
| `/data/local/tmp/hm-bghost.log` (phone shell side) | `BgHost` start | Host start-up log; read back through `rish` on a failed start. |
| `<profile>/memories/MEMORY.md`, `USER.md` | `POST /memory` | Hermes's own memory files. |
| `<profile>/auth.json` credential pool | `claude_login.py` | A new `anthropic` entry from the in-app sign-in. |
| `<profile>/google_client_secret.json`, `google_oauth_pending.json`, `google_token.json` | Hermes's `google-workspace` `setup.py`, run by `google_workspace.py` | The user's OAuth client, the pending sign-in's PKCE state and the Google token, all made private; `DELETE /google` deletes the token. A temporary `hm-google-client-*.json` in the profile's home lives only while the client file is stored. |
| `~/.hermes-mobile/key` (Termux home) | read only | The shared key for `POST /event` on the app. |
