---
rank: small
---
- **Test builds with remote debugging.** `HM_DEVTOOLS=1 android/build.sh` makes a test build whose page can be inspected and driven from a computer over `adb`; it shows a "Test build: remote debugging is on" strip at all times. Normal and release builds are unchanged, and the build script and the release workflow both refuse or fail if a release would carry it. Seen on an Android 16 phone: the test build installs over an earlier self-built one, shows the strip, and its `webview_devtools_remote` socket is there; the earlier build without `HM_DEVTOOLS` had none. Playwright attached over `adb forward` and drove a whole test session.
