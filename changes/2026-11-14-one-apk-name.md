---
rank: small
---
- **Releases carry the app under one name, hermux.apk.** Until v0.9.7 every release also carried the same file as
  hermes-mobile.apk, for guides and scripts from before the rename. The installed app is not affected (it takes any
  .apk of the latest release) and the installers ask for hermux.apk first. What stops working: a saved script or link
  that asks for releases/latest/download/hermes-mobile.apk. Checked in the release workflow's guard test; the first
  release built this way is the proof.
