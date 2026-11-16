---
rank: small
---
- **Chats keep their phone-data protection after very many sub-agents.** After about 2000 sub-agents in one run, Hermux could forget which chat had started an older one, so that sub-agent reading phone data no longer protected its parent chat. Now the oldest link is dropped one at a time, and its chat is treated as having read phone data. Checked with plugin tests on a computer; not tried on a phone.
