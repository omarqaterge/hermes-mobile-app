---
rank: normal
---
- **The installer sets up the same version as the app it downloads.** The installer in Termux (and the full setup
  that runs it) used to put the newest development version of the Hermux plugin on the phone, while it downloaded the
  latest released app. When the two didn't match, the app could stay offline with "Hermes is running" never turning
  green, although Hermes worked. The installer now takes the plugin and scripts from the latest release, the one the
  app comes from, and keeps an older copy as the branch `hm-before-update`. Checked in a script test against local
  repositories and against the real release on GitHub (from a computer, not on a phone).
