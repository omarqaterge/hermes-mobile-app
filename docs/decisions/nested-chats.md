# A chat can start nested chats, and the chat list shows them under it

**Decided:** 2026-11-16 by the owner; background tasks held back on 2026-11-18.

What a chat's agent starts and runs as its own chat in Hermes is a nested chat. The owner wants to tap one and see what it
does, the model it runs on and its reasoning level, and to see them under their chat in the chat list. This replaces the
earlier "the agent does not open chats by itself".

**So:**

- Sub-agents, at any depth, appear as one line in the chat, as rows under their chat in the list, and in a sheet of their
  own. On screen they are "sub-agents": never "session" or "child".
- A nested row belongs to its chat. It has no swipe actions, can't be pinned, dragged, archived or deleted by itself and
  stands in no group of its own; when a sub-agent needs the person, its parent chat is the one in Needs you.
- A nested chat never has more access than the chat that started it: the same access mode, approval rules and phone-data
  rule. `delegation.subagent_auto_approve` keeps its meaning and its default.
- Approvals are answered on the parent chat's request sheet, with the fingerprint rule. Nothing is approved from the list
  or from the sub-agent's sheet.
- How many run and how deep they nest stay Hermes's settings. Stopping a chat stops what it started.
- The sheet shows the reasoning level Hermes gave the sub-agent, read from its stored chat, never a guess. A provider may
  support less, and Hermes then sends a lower level that it doesn't report for a sub-agent; the composer's chip also shows
  the level set.
- **No task board with worker agents:** unattended agents with their own approvals, and the phone's battery, are the reason.
- **Background tasks are not offered yet (2026-11-18).** On the pinned Hermes they don't follow these limits: Stop doesn't
  reach them, they can't ask for approval, and the phone-data rule can miss them. "Run in background" and their rows wait
  for a Hermes change: [roadmap 21](../roadmap/21-background-tasks.md).
