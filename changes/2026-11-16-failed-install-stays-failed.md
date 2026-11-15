---
rank: small
---
- **A failed setup no longer blocks Hermux after the app restarts.** If the installer reported a failure and the app was then closed or restarted, Hermux treated the install as still running and held back starting Hermes, plugin updates and the Shizuku helper. It now remembers the failure. Not tried on a phone.
