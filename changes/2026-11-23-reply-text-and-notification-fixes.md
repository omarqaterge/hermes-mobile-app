---
rank: normal
---
- **Notifications and read-aloud now show and speak the real reply.** Reply notifications, the Done chip, the island
  panel's Done view, background read-aloud and scheduled-job notifications now receive the reply text across every
  model provider, and resumed chats keep their mobile source so background read-aloud works on them too. Empty or
  failed turns show plain words instead of internal status text. The app-icon badge counts unseen finished chats per
  card instead of multiplying across reply cards, marks non-reply notifications as zero-badge, and answering a question
  from a pop-up notification dismisses the card cleanly. Checked with plugin, web and JDK unit tests; not yet tried on
  a real phone.
