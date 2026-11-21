---
rank: small
---
- **Sharing into Hermux and app installs are checked more strictly.** A file shared into Hermux is read only when the
  app that shared it could read it itself, an install or update answer counts only for the install Hermux started, and
  the app's screen loads no file but its own page. Before Android 15, with the Contacts switch on, a contact card
  shared from the Contacts app is refused ("can't be shared"). Checked by the unit tests and a compile; not yet tried
  on a phone.
