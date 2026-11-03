# Unreleased changes

Each change users will notice gets its own file here instead of a line at the top of [CHANGELOG.md](../CHANGELOG.md),
so branches worked on in parallel never conflict over the changelog.

- Name: `YYYY-MM-DD-short-name.md` (the day you write it, lower case, dashes), for example `2026-10-30-lock-screen-assist.md`.
- Content: one or more CHANGELOG bullets, written for users. Each starts with a **bold headline**: what users get, in
  plain words, 80 characters at most, no jargon or internal names, no pull request numbers. The app's "What's new" sheet
  shows only the headlines, so the headline must stand on its own. The details and a line saying what was tested on
  which device follow it.
- Importance: front matter with `rank: big`, `normal` (the default, may be left out) or `small`:

  ```markdown
  ---
  rank: big
  ---
  - **Talk to Hermux on the lock screen.** Settings → Voice → Phone assistant has a new row… Seen on an Android 16 phone.
  ```

  `big`: a new feature or a change most users will notice and want to hear about first. `normal`: a visible
  improvement to something that exists. `small`: fixes, tweaks, developer-only things. Release notes and the sheet
  list big changes first and put small ones last under "Smaller changes and fixes".
- No headings. `python3 tools/changelog.py check` (run by CI) checks the files.
- `python3 tools/changelog.py show` prints the next release's notes. At release time the maintainer runs
  `python3 tools/changelog.py release vX.Y.Z`, which moves these entries into CHANGELOG.md and deletes the files.
