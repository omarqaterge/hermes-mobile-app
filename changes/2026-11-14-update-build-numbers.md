---
rank: small
---
- **Updates keep working as version numbers grow past 99.** Each release's internal build number now has room for
  version parts up to 999, so a version such as 0.9.100 can never block the update to 0.10.0, and a release whose
  number wouldn't fit fails before it is published. The in-app update also installs a newer version that carries the
  same build number as the installed copy, instead of saying "You already have this version.". Checked with script
  and Java tests; the update itself was seen on an Android 16 phone going from a test build to 0.9.8 with the same build
  number (installed over USB, not yet through the app).
