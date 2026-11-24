---
rank: small
---
- **Command approvals in phone-data chats now stay hidden on the lock screen.** Approval pop-ups, their re-alerts and the
  status chip hide command details on the lock screen whenever the chat (or any of its sub-agents or parents) has read
  phone data, while still letting you review and answer command approvals once unlocked. Notification replies are also
  hardened against malformed or overwritten inline-reply intents and guarded against service crashes. Checked with JDK
  and plugin unit tests; not yet tried on a real phone.
