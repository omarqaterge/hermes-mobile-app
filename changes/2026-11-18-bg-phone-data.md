---
rank: normal
---
- **Background tasks can't carry your phone data out.** Once a chat has read data from your phone, a background task started
  from it can't send anything out, because nobody can be asked first. The app also says so when you try `/bg`, a scheduled job
  or a board task from such a chat, and you can still start one from a new chat. Other chats keep these commands as they
  are. Checked against a test copy of Hermux in a desktop browser. Not yet tried on a phone.
- **Copies of a chat stay protected.** A branch of a chat that has read your phone data, and a chat that finds that chat's
  messages through a search, now ask before sending anything out, like the original. Checked against a test copy of Hermux.
  Not yet tried on a phone.
- **Slash commands wait for an unlock over the lock screen** in a chat that runs without asking. `/yolo` can still turn
  that off. Commands that start a background task or a scheduled job always wait for the unlock there. Checked in a desktop
  browser. Not yet tried on a phone.
