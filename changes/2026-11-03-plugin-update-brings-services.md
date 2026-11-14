---
rank: small
---
- **Updating the plugin also updates Hermux's background loop script.** Only a first install used to copy it, so phones
  that were already set up never got its log trimming or restart logging. The app's plugin update now installs it too,
  checked before it replaces the old copy, which is kept. Running loops keep the old script until they restart (the
  dashboard's with the next plugin update, the others after a phone restart). Checked in script tests; not yet on a
  phone.
