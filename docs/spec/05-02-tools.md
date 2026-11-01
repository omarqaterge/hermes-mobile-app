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

- Actions: `list_apps`; `open` (an app by name or package, or straight to a screen: `url` opens a link, `share_text`
  sends text the way the share sheet would, `intent` takes `{action, data, type, extras}`); `capture` (modes `ax`
  element list, `som` list plus a screenshot with the element numbers drawn on it, `vision` screenshot only); `tap`,
  `long_press`; `set_text` (replaces a field's text), `type` (adds to the focused field); `key`; `submit` (the
  field's keyboard action: Search, Send, Go); `toggle` (a switch or checkbox; with `on`, only when it isn't in that
  state); `scroll`, `scroll_to` (scroll until `target` is on the screen), `swipe` (`coordinate` `[x1, y1, x2, y2]`);
  `wait` (at most 10 s), `wait_for` (until `target` shows, or with `gone` until it is no longer there; at most 12
  s); `steps` (up to `MAX_STEPS` = 20 of the actions in `STEP_ACTIONS`, in order, stopping at the first failure,
  with one screen at the end); `note`; `hand_over` (put the app on the real screen); `close`.
- Which element: `target` (its text, label, hint or view id, matched by the host on a fresh reading of the screen:
  exact, then one part of a row's name, then starts with, then contains; usable elements before plain text; for
  `set_text` and `toggle` the field or switch right after a matching label) or `element` (its number in the last
  list), or `coordinate` `[x, y]` on the 720x1600 screen. `tap`, `long_press`, `toggle`, `scroll_to` and `wait_for`
  given only `text` use it as `target`. A number whose element left the screen or now shows something else is
  refused ("capture again") instead of acting on the wrong thing.
- Every action except `wait` answers with the new screen (`capture_after`, default true): an `ax` capture, or
  `screen_changed: false` and a note when it looks exactly as the last list the model saw (`_last_view`; after a
  scroll: the end of the list). `wait_after` (seconds, at most 10) waits before looking.
- The element list (`format_elements`): one line per element, `[n] role "name"` plus `hint=`, `on`/`off`,
  `selected`, `focused`, `disabled` and which way a list can still scroll ("more below"); a nameless element shows
  its view `id` and position `@x,y`. Roles: button, image button, tab, field, switch, checkbox, radio, slider,
  list, pager, image, text. A button or row is named with the words inside it ("Wi-Fi, Connected"); a switch or
  button inside it stays its own element. Above the list: `screen` (the activity's class name and the window
  title) and `popup` when a dialog or menu is open (its elements come first). The keyboard's keys never appear.
- `note` (`text`, at most 500 characters) keeps what the model learned about the open app (or `app`) in
  `~/.hermes/mobile/app-notes/<package>.md` (`add_note`; the newest `NOTES_MAX` = 3000 characters); `open` returns
  them as `your_notes_for_this_app` (`read_notes`).
- A link, share or intent is resolved by the host first (`/resolve`, `intent_of`): the approval and the sensitive-app
  check are for the app it opens; several candidates are an error naming them (pass `app`). The host only accepts
  intent actions that show a screen (`SAFE_ACTIONS`: view, send, sendto, insert, edit, search, web search, dial,
  main, alarms and timers), `android.settings.*` pages and an app's own actions, and no `file:`, `intent:`,
  `javascript:` or `android-app:` links.
- A host older than the plugin answers 404 for a new action: the tool says the Hermes Mobile app needs an update.
- How it works: the app's `BgHost` (a small program started through Shizuku's `rish` with `app_process`) listens on `127.0.0.1:9131`. `ensure_host()` starts it with a random per-start token, passed on stdin, never on a command line; it exits after about two idle minutes. If the port is still held by an older host, it is killed and restarted once. Calls carry `X-HM-Token`.
- Rules: the user is asked once per app per chat through Hermes's approval gate (`request_tool_approval`; `/yolo` skips it). Banking, payment, password, 2FA and similar apps are refused (matched by package name or label against the `SENSITIVE` pattern) unless the user switched on the Background apps setting (`GET`/`PUT /bgapps`, file `bgapps.json`). The app itself ("Hermes Mobile") cannot be opened.
- One app at a time on the phone. If another chat owns it and has been silent for 130 s (`STALE_S`), or its turn is over and quiet for 20 s (`STALE_IDLE_S`), it is closed and taken over. `on_session_end` and `api_request_error` call `end_session`, so the app closes when the turn ends.
- It sends `bgapp` events (`state` open / act / done, `pkg`, `label`, `action`, `port`, and `token` while open) so the app can show its card and the viewer. The chip says "Using <app>" while an app is open in that chat.

#### `openui_reference`
Defined in `openui.py`. No arguments. Returns `openui_reference.txt` (about 51,000 characters), the language and component reference for cards. The model calls it once per chat before its first openui-lang block. If the file is missing it returns an error JSON saying to answer without cards.
