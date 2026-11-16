---
rank: small
---
- **An app install in progress no longer starts twice after the screen reloads.** Updating Hermux or installing a helper app now remembers an install Android is still asking about, so tapping again (or the screen restarting) opens the same prompt instead of starting a second install. If Android's prompt was lost while the app's screen was closed, the next tap starts afresh after 15 seconds. The helper-app path was tried on an Android 15 emulator; the update path only with tests. Not tried on a phone.
