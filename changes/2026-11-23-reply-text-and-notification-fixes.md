---
rank: normal
---
- **Notifications and read-aloud now show and speak the real reply.** Reply notifications, the Done chip, the island
  panel's Done view, background read-aloud and scheduled-job notifications now receive the reply text across every
  model provider, and resumed chats keep their mobile source so background read-aloud works on them too. Chats that
  have read phone data show generic words instead of reply text and are never read aloud; reply, error, Done and
  scheduled-job notifications stay private on the lock screen. Empty or failed turns show plain words instead of
  internal status text, and only the final answer text (not thinking blocks or earlier tool commentary) is kept. The
  app-icon badge counts unseen finished chats per card instead of multiplying across reply cards, marks non-reply and
  failed-turn error cards as zero-badge, and answering a question from a pop-up notification dismisses the card
  cleanly. Checked with plugin, web and JDK unit tests; not yet tried on a real phone.
