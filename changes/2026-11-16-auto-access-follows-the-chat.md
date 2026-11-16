---
rank: small
---
- **Auto access keeps blocking dangerous commands after a chat is compressed.** When Hermes gives a long chat a new id while it shortens it, and in the chat's sub-agents, Auto access now still blocks the commands on its dangerous list. If Hermux can't tell which chat a command belongs to, that command is blocked instead of run. Checked with plugin tests and against the pinned Hermes's own session database on a computer; not tried on a phone.
