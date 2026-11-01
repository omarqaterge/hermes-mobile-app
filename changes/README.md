# Unreleased changes

Each change users will notice gets its own file here instead of a line at the top of [CHANGELOG.md](../CHANGELOG.md),
so branches worked on in parallel never conflict over the changelog.

- Name: `YYYY-MM-DD-short-name.md` (the day you write it, lower case, dashes), for example `2026-10-30-lock-screen-assist.md`.
- Content: one or more CHANGELOG bullets, written for users, with a line saying what was tested on which device:

  ```markdown
  - **Talk to Hermes on the lock screen.** Settings → Voice → Phone assistant has a new row… Seen on an Android 16 phone.
  ```

- No headings. `python3 tools/changelog.py check` (run by CI) checks the files.
- `python3 tools/changelog.py show` prints the next release's notes. At release time the maintainer runs
  `python3 tools/changelog.py release vX.Y.Z`, which moves these entries into CHANGELOG.md and deletes the files.
