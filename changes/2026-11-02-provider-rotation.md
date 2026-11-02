---
rank: big
---
- **Fallback models and several keys per provider.** Settings → Model providers has a new "Fallback models" list: the models Hermes switches to, in order, when the main one is rate-limited, out of credit or refuses its key. Add one from any connected provider, move it up or down, or remove it. Each provider's sheet now lists all its keys and logins with their state (In use, Cooling down, Stopped working) and how often each was used; add another key, remove one, and choose which key Hermes uses (in order, take turns, least used or random). Checked in the browser tests against a mock with the pinned Hermes's routes; not yet seen on a phone.
