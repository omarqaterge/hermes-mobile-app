# Dashboard session token only for the app

**State:** 2026-11-04. The plugin's `_TokenGuard` withholds the session token from pages unless the caller sends the event key (spec 2.3). The app, the plugin's own calls, `plugin-update.sh` and the developer tools send it. Unit tests and the contract check against the pinned Hermes cover the guard.

**Next:** run the phone checks below, then delete this file.

**Needs a real phone:**
- Update over an existing install: the app stays connected through the plugin update and its dashboard restart.
- Clear the app's data or reinstall it with Hermes already running: a new key reaches Termux and the app connects without help.
- Fresh install from the app's setup flow.
- Notification Allow, Deny and Stop still work with the app closed.
- From `adb shell` or another app, `curl http://127.0.0.1:9119/` has no session token.

**Links:** [spec 2.3](../spec/02-03-security-model.md), [the fix's test](../../tools/test_token_guard.py).
