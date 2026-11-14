---
rank: small
---
- **Running the installer again no longer stops on an old copy of Hermux.** The installer in Termux (the command from
  Setup → Copy the command) updates a copy of the code in `~/hermes-mobile`. On phones that cloned it before the
  project's history was rewritten, that update failed with "Not possible to fast-forward" and the install stopped. It
  now replaces the copy with the current code and keeps the old one as the branch `hm-before-update`. Checked in a
  script test against local repositories; seen failing on a phone that had the v0.8.67 copy.
