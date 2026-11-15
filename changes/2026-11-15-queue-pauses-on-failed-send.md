---
rank: small
---
- **A queued message that can't be sent no longer uses up the rest of the queue.** When Hermux refused a queued follow-up, the app went straight on to the next one, and the next, until the queue was empty and every message showed "Send failed". Now the queue pauses with the remaining messages kept, like after Stop or an error, and Resume sends them. Also: the status line no longer shows the previous reply's speed before a new reply starts, the timer of an edited or retried message starts when you send it, and a send that fails after you opened another chat no longer stops that chat's spinner. Checked with unit tests and the browser tests against the mock; not tried on a phone.
