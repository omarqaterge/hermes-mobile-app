---
rank: small
---
- **Setup notices when the installer was closed part-way, instead of waiting.** If Termux is closed, Android stops the installer or the phone restarts before it finishes, the setup screen now says the installer stopped and where, and offers the command again; before, it kept showing "Installing" and the app's plugin updates and automatic starts stayed paused. The app knows because the installer now sends a small "still running" signal, so a slow install is never cut short. Copying the command without pasting it no longer pauses anything either, and an install whose last message was missed is recognised as finished. Checked with unit tests, the installer script tests and the browser tests; not tried on a phone.
