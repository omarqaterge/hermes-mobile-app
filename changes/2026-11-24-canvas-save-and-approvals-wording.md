---
rank: normal
---
- **Safer canvas file saves and clearer approval notices.** Saving a canvas document back to its original file now refuses Hermux’s own settings, secrets, plugin and system files (and symlinks), and asks before overwriting a file that changed on disk since you opened it. Changing approval settings through a parent object in Advanced settings now shows the same warning, and access-change notices reflect the current approvals mode without revealing it on the lock screen. Verified with browser, unit and plugin tests (not yet checked on a real phone).
