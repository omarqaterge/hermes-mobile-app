## 8. Feature index

One line per user-visible feature, with the section that describes it. Sources: README "Highlights" and every `CHANGELOG.md` entry, each checked against the code.

**Chat and rendering**

| Feature | Section |
|---|---|
| Streaming chat with live tool cards, reasoning, sub-agents, to-do list, speed and context per reply | 3.2, 3.3 |
| Stop or steer a running reply | 3.4 |
| Edit, retry or branch any turn; edit and retry keep photos and files | 3.3, 3.5 |
| `/` autocomplete for skills and commands; `/yolo` and `/fast` switch instantly for the chat | 3.4, 2.2.1 |
| Per-chat drafts; messages typed offline are queued and sent on reconnect (outbox) | 3.4 |
| Scroll to the newest message button | 3.2 |
| Models: picker, favourites (starred models on top), reasoning level per chat | 3.4, 3.5 |
| KaTeX equations, sortable tables with "Copy table", task lists, Obsidian-style callouts, coloured diffs, collapsing long code, inline SVG and HTML cards | 3.3 |
| Mermaid diagrams, full screen with pinch zoom | 3.3 |
| Photo viewer: pinch and double-tap zoom, save to Pictures/Hermes, share, open with another app | 3.3, 2.2.7 |
| Links open in the default app everywhere (messages, tool cards, thinking, sheets, canvas) | 3.3, 2.3 |
| Every memory write shown as a diff | 3.3 |
| File checkpoints: folders a chat changed, diff per file, restore (undoable) | 3.5 |
| Header Auto button: Off / Auto access / Full access per chat, with a warning dialog for Full | 3.2, 2.2.1a |
| Default Auto mode for all chats (Settings → Permissions → Auto for all chats) | 3.15 |
| Approvals and questions with long warnings scrolling and repeats shown once with a count | 3.6 |
| `/btw` side questions, opened by pulling up past the last message (about 110 px) | 3.12 |
| Share to Hermes from any app; attach photos, camera shots and files; share a chat as Markdown | 3.4, 3.5, 4.2, 4.7 |
| Cards in replies (tables, charts, tabs, buttons, forms) drawn by OpenUI, with live read-only data; off switch in Settings → Replies | 3.9, 3.15, 5.4 |

**Canvas, gallery, apps**

| Feature | Section |
|---|---|
| Canvas shared with Hermes: sandboxed HTML, versions with diff and restore | 3.7 |
| Canvas opens as a panel from the right (tap button or swipe left; swipe right on its top bar, ✕ or Back closes); wide screens keep it beside the chat | 3.7 |
| Canvas gallery of every document from every chat and profile, type chips, search, rename/copy/share/delete; old Library items shown as "Saved copy" | 3.8 |
| Hermes uses an app on a hidden screen (`phone_app`), with a card, live thumbnail, Take over and Stop; sensitive apps refused unless allowed in Settings → Background apps | 3.10, 2.2.8, 3.15, 4.7, 5.2 |

**Voice**

| Feature | Section |
|---|---|
| Read-aloud player: pause, seek bar, 5-second back and forward, speed, any installed speech engine; card in the notification shade with real position | 3.11, 4.6 |
| Read-aloud says "card shown in the app" for a card | 4.6 |
| Dictation and hands-free Live mode; approvals asked and answered by voice in Live mode | 3.11, 4.6 |
| On-device speech recognition: offline models (Moonshine, NeMo, Zipformer) or your own sherpa-onnx model, each checked on a test recording | 3.15, 4.6 |
| Hermes as the phone's Digital assistant (long-press power opens Live mode) | 4.6 |

**Navigation and settings**

| Feature | Section |
|---|---|
| Drawer: search inside every message, pin, archive, delete, stable order by creation time, Sort by recent | 3.13 |
| Links from one chat to another (`hermes-chat:` links in replies, bare chat ids become links) | 3.3, 5.3 |
| Skills, memory screen, cron jobs, files, projects | 3.14 |
| Settings: Dark / OLED black / Light theme, every Hermes setting | 3.15 |
| Last start-up timings (Settings) and faster start-up (the last chat drawn from its cache before Hermes answers) | 3.15, 2.2.5 |
| Bots (profiles) with their own default model, keys and SOUL.md; the plugin is linked into every profile | 3.16, 6.1 |
| Model providers: every provider Hermes supports, Paste API key, Sign in (ChatGPT, Grok, Nous Portal), search | 3.17 |
| Claude signs in inside the app (claude.ai code), Use Termux instead | 3.17, 5.4 |
| Launcher shortcuts (New chat, Live mode, last chat) | 4.2, 4.6, 3.1 |
| Two-column layout on tablets and foldables | 3.1, 3.7 |
| One-tap app update (Settings → About) and the "App updates" notification | 2.2.10, 3.15, 4.7 |
| Uninstall Hermes (Settings → Danger zone), with a backup offer | 3.19, 4.7, 6.5 |

**Notifications and background**

| Feature | Section |
|---|---|
| Status chip as an Android 16 Live Update (older Android: normal notification); tap for progress, Stop button | 4.3 |
| Approvals and questions answered from the chip or notification (Allow once/session/Deny, choices, reply) | 2.2.2, 2.2.3, 4.3, 3.6 |
| Done chip listing chats that finished while the app was closed; a tap clears it all | 4.3 |
| App-icon badge with the number of unseen chats | 4.3 |
| Notifications while the app is closed: replies, questions, cron results, a "failed" note | 4.3, 4.4 |
| "Learning" (memory/skills review) and "Answering a side question" statuses | 4.3, 5.1 |
| No permanent wake lock; phone sleeps while Hermes is idle | 2.5, 6.2 |
| Hermes Mobile service revived after a force stop (app keeper) | 6.2 |

**Setup and install**

| Feature | Section |
|---|---|
| App-first install: Install all (Termux, Termux:API, Termux:Boot, Shizuku; replaces a Termux from another source), copy the command, step times, resumes after leaving the app | 3.18, 6.3 |
| Setup opens full screen on a fresh install; first-run flow picks up at the first missing step | 3.18 |
| Hermes already installed? Check; no Termux error popups before the first install | 3.18 |
| Setup check with a fix button per row; Backend status sheet (Shizuku row) | 3.18, 3.5 |
| Shizuku: required step, runs in background, restarts by itself via Wireless debugging (Android 11+), "Shizuku stopped" notice | 3.18, 2.2.9, 4.7, 6.1 |
| Autostart step with the phone maker's page and a Done button | 3.18, 4.7 |
| Install from a computer (`setup-phone.sh`, `setup-phone.ps1`) or by your own coding agent (`AGENT_INSTALL.md`) | 6.3, 7.2 |
| Rooted phones: Debian through chroot-distro | 6.3 |
| Ready-made Debian + Hermes image, restored instead of building on the phone (falls back to the normal install) | 6.3, 7.4 |
| New installs get the Hermes build the app is tested against (pin) plus `hermes/patches` | 6.4 |
| Installer works in any Hermes profile and after an interrupted install | 6.1 |

---
