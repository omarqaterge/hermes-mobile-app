---
rank: small
---
- **Cards and command aliases can no longer change a chat's access.** A card button from Hermes could carry a hidden
  `/yolo on` and turn on Full access; now a card can't run any slash command (the app says "Cards can’t run commands"),
  and a command alias can't change access however it is written. Only a `/yolo` you type yourself, or the Auto
  button, changes it. Checked in the browser tests and unit tests with the card and the alias spellings; not tested on a
  phone.
