---
rank: small
---
- **Restarting Hermes no longer shows up as a crash in problem reports.** Restarting the dashboard stopped proot but left its Python running for a moment, which filled the service log with `OSError` tracebacks that Report a problem counted as crashes. Python is now stopped first. On rooted phones the restart now also matches Hermes's Python, which the old pattern did not. Tested with one restart on an Android phone: no new tracebacks, and the dashboard came back. Rooted phones were not tried on a device.
