### 5.2 Tools (4)

All four are registered with `ctx.register_tool(...)` in toolset `canvas`. Each registration is wrapped in its own `try`, so one failing module never stops the rest of the plugin.

#### `canvas`
Defined in `canvas.py` (`TOOL_SCHEMA`, `tool_handler`). The model shows documents in the app's canvas panel instead of pasting them into chat. Actions: `create`, `write` (replace all content), `patch` (exact find/replace edits, each `find` must match once unless `all: true`), `read` (current content including the user's edits, cut at 60,000 characters), `list`, `open_file` (load a phone text file), `close`, `rename`; the old `save_to_library` returns a note that every document is already in the gallery.

- Types: `markdown`, `html`, `code` (with `lang`), `text`, `json`, `csv`, `svg`, `mermaid`. If `type` is empty it is guessed from the file name, then from the content start.
- Storage: `~/.hermes/mobile/canvas/<chat id>/<doc id>.json`, one file per document with its version list. Limits: 400,000 characters per document, 40 versions kept, 30 documents per chat, 1,500,000 bytes to open a file. Every change takes an exclusive `flock` on `<chat>/.lock` and writes atomically.
- `id` may be the document's exact title; if the canvas has one document, `id` can be left out.
- After writing an `html` or `svg` document it returns `warnings` when the page uses external URLs, `fetch`, `XMLHttpRequest`, `WebSocket`, `localStorage` or `sessionStorage` (the sandbox is offline).
- `open_file` needs an absolute path, rejects binary files (a NUL byte in the first 4 KB) and files over the size limit, and reloads an existing document that is linked to the same path instead of making a copy. `POST /canvas/save-file` writes the document back to that path.

#### `find_chats`
Defined in `chat_search.py`. One call finds chats (all profiles) by words and/or by media. Arguments: `text` (every word must appear in one message or the title), `kind` (`image`, `video`, `audio`, `file`, `media`; with neither text nor kind, `image`), `who` (`user`, `agent`, `any`), `profile` (name or `all`), `limit` (default 30, at most 200). Every database is opened read-only. Media counts: from the user, `@image:` and `@file:` lines; from the agent, `MEDIA:` lines, markdown images, canvas documents that are or embed images, `vision_analyze` calls, `text_to_speech` calls. Results are newest first with a `hermes-chat:<id>` link (`@session:<profile>/<id>` for non-default profiles), snippets, file paths and whether each file still exists. Also used by cards through `POST /openui/call`.

#### `phone_app`
Defined in `phone_app.py`. Hermes uses an app on a **hidden virtual screen** while the user keeps the real one. Registered only if `availability()` is true: `~/bin/rish` exists (Shizuku set up) and the phone's API level is 34 or newer (`MIN_SDK`; an unknown level passes).

- Actions: `list_apps`, `open`, `capture` (modes `ax` element list, `som` list plus screenshot path, `vision` screenshot only), `tap` (element number or `[x, y]` on the 720x1600 screen), `set_text`, `type`, `key`, `scroll`, `wait` (at most 10 s), `hand_over` (put the app on the real screen), `close`. `capture_after` returns a fresh element list.
- How it works: the app's `BgHost` (a small program started through Shizuku's `rish` with `app_process`) listens on `127.0.0.1:9131`. `ensure_host()` starts it with a random per-start token, passed on stdin, never on a command line; it exits after about two idle minutes. If the port is still held by an older host, it is killed and restarted once. Calls carry `X-HM-Token`.
- Rules: the user is asked once per app per chat through Hermes's approval gate (`request_tool_approval`; `/yolo` skips it). Banking, payment, password, 2FA and similar apps are refused (matched by package name or label against the `SENSITIVE` pattern) unless the user switched on the Background apps setting (`GET`/`PUT /bgapps`, file `bgapps.json`). The app itself ("Hermes Mobile") cannot be opened.
- One app at a time on the phone. If another chat owns it and has been silent for 130 s (`STALE_S`), or its turn is over and quiet for 20 s (`STALE_IDLE_S`), it is closed and taken over. `on_session_end` and `api_request_error` call `end_session`, so the app closes when the turn ends.
- It sends `bgapp` events (`state` open / act / done, `pkg`, `label`, `action`, `port`, and `token` while open) so the app can show its card and the viewer. The chip says "Using <app>" while an app is open in that chat.

#### `openui_reference`
Defined in `openui.py`. No arguments. Returns `openui_reference.txt` (about 51,000 characters), the language and component reference for cards. The model calls it once per chat before its first openui-lang block. If the file is missing it returns an error JSON saying to answer without cards.
