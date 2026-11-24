---
rank: normal
---
- **Safer canvas file saves and clearer approval notices.** Saving a canvas document back to its original file now refuses Hermux’s own settings, secrets, plugin and system files (and symlinks), and asks before overwriting a file that changed on disk since you opened it. Access-change notices now reflect the current approvals mode without revealing it on the lock screen. Verified with browser, unit, plugin and contract tests (not yet checked on a real phone).
