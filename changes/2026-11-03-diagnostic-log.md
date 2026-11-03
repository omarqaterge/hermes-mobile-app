---
rank: big
---
- **Problem reports can now say what went wrong, without your chats.** Hermux keeps a small log on your phone for 7 days:
  crashes, why Android closed the app, failed connections and service restarts, never messages, file names or keys.
  It's sent only if you switch it on in Report a problem, where you read it first and the app says where it goes: when
  a report goes through GitHub's page the log is public with it, and when it goes through Hermux's own service it stays
  out of the public issue. Settings → About has a switch and a delete button. Checked in the automated tests, not yet on
  a phone.
- **A crashed page no longer closes the whole app.** When Android's web view dies, for example when the phone runs out
  of memory, Hermux reloads the page and keeps its notifications running. Not yet seen on a phone.
