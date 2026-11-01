### 5.3 System-prompt sections (4)

Registered with `ctx.register_system_prompt_section(name, fn, position="after_memory", max_chars=N)`. Hermes freezes sections into a **new** chat's prompt, so changing a setting affects new chats only. Each function returns an empty string unless the chat's `platform` is `mobile` (chats made in the app) or `tui` (the same chats once resumed).

| Section | `max_chars` | Text (summary) | Extra condition |
|---|---|---|---|
| `hermes-mobile.canvas` | 900 | The user's app has a canvas. Put things the user asks to build or write (essay, notes, plan, report, code file, HTML/SVG page or app) on the canvas with the `canvas` tool, keep the chat reply to a sentence or two, read before changing, prefer small patches, HTML must be one self-contained offline file that fits a narrow screen. | none |
| `hermes-mobile.links` | 700 | `[title](hermes-chat:SESSION_ID)` opens that chat in the app; use it when mentioning another chat, and use `find_chats` once instead of searching `state.db`, logs or folders. | none |
| `hermes-mobile.phone` | 1200 | You run on the user's phone (Termux, inside a Debian container): answer phone questions from here. `dumpsys`, `logcat` and `pm` are denied in the container, there is no `adb` device; use `termux-*` commands and `/sdcard` first. | If `~/bin/rish` exists, adds: use `rish -c "<command>"` for system-level access, say so if Shizuku is not running, and use `phone_app` to do things in apps on a hidden screen. |
| `hermes-mobile.openui` | 900 | The app draws interactive UI in replies from fenced `openui-lang` blocks; call `openui_reference` before the first block; buttons send their words back as the next user message with form values; use only real data; documents and built things go on the canvas. | Setting on (`openui.enabled()`; on unless `~/.hermes/mobile/openui.json` says `enabled: false`). |
