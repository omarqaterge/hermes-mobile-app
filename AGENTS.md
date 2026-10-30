# Instructions for coding agents

These rules apply to every agent (and person) changing this repository: Claude Code, Codex, Cursor, Hermes, or anyone
else. `CLAUDE.md` imports this file.

## Start here

- **Read [docs/SPEC.md](docs/SPEC.md) first.** It describes the whole app: architecture, data flows, every screen and
  UI element, the Android shell, the Hermes plugin, the phone scripts, build, tests and releases. Use it to find the
  code you need instead of guessing.
- Changes for users go in a new file in [changes/](changes/README.md) (never edit the top of CHANGELOG.md: that's how
  parallel branches conflict); checks and project rules are in [CONTRIBUTING.md](CONTRIBUTING.md).
- On the maintainer's machine, `.hermes.md` and `.handoff/history.md` (git-excluded) hold the current state and the full
  history: if they exist, read `.hermes.md` and search the history before solving something that looks familiar.

## Keep the spec current (required)

- **Update `docs/SPEC.md` in the same commit as every change it describes**: a new or changed feature, screen, button,
  setting, gesture, notification, bridge method, plugin route/hook/tool, gateway RPC, `localStorage` key, script,
  permission, test tool or CI step. Removing something means removing it from the spec too.
- Run `python3 tools/check_spec.py` before committing. CI runs it and fails when the code has a name the spec doesn't
  mention. Identifiers go in backticks exactly as in the code; on-screen text as shown.
- Give each new name a sentence saying what it does: a bare list passes the checker but helps nobody.
- The spec says what the code does, not what was tested: verification status goes in `docs/improvements.md` and
  `docs/manual-tests.md`. When code and spec disagree, fix whichever is wrong.

## Every Android phone

- Hermes Mobile is for every Android phone and maker, minimum Android 8.0 (API 26). Prefer public/AOSP APIs; put
  vendor-specific handling behind a generic fallback; don't hard-code one maker's wording.
- Every framework call newer than API 26 needs a `Build.VERSION.SDK_INT` check: `tools/api-check.sh` (Android lint,
  run in CI) fails otherwise. `javac` and `tools/java-check.sh` can't see API levels.
- New features that need a newer Android: say so in the README's "Android versions" table and in the spec (4.2).

## Checks before you commit

`cd web && npm test && npm run build`, `tools/web-e2e/run.sh` (add a check for each web change),
`python3 tools/check_spec.py`, `python3 tools/changelog.py check`, and for Android changes `tools/java-check.sh` (JDK 21+) and `tools/api-check.sh`
(Android SDK command-line tools). Plugin and phone-script tests: see CONTRIBUTING.md. CI runs all of them on every push.

## Rules

- UI: no native form controls (`<select>`, range/checkbox/radio/date inputs) and no `confirm()`/`prompt()`/`alert()`:
  use `web/src/components/ui.tsx` and `web/src/dialog.tsx`. Colours from CSS variables (there is a light theme). Keep
  `rehype-sanitize` in front of rendered Markdown. Every native bridge method takes the per-page key first and is listed
  in `web/src/secure-bridge.ts`. No periodic loop or wake lock without a bound (battery).
- The repo is public: no keys, tokens, `*.keystore`, `.env` files, personal data (emails, paths, phone models, IPs),
  chat contents or screenshots of real chats.
- No AI attribution anywhere: no `Co-Authored-By`, "Generated with" or similar lines in commits, PRs or docs.
- Commit messages: a title plus a body naming everything the commit changes (user-visible changes, fixes, limits,
  tests, CI, docs). Small commits.
- Don't create `v*` tags or releases (they publish the app); the maintainer decides.
- Report plainly what you verified, how, and what you could not verify (for example: no real phone).
