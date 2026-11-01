# Instructions for coding agents

These rules apply to every agent (and person) changing this repository: Claude Code, Codex, Cursor, Hermes, or anyone
else. `CLAUDE.md` imports this file.

## Start here (about five minutes)

1. **Get set up:** `tools/setup.sh` (Node 22+, Python 3; JDK 21 and the Android SDK only for `android/`). It takes
   seconds in a new worktree when another checkout already has the packages.
2. **See what's going on:** [docs/status/](docs/status/README.md) (one file per workstream: in progress, blocked, needs a
   phone) and the open pull requests. **Before changing a screen or a behaviour,** read the owner's decisions that
   touch it in [docs/decisions/](docs/decisions/README.md); don't undo one without asking.
3. **Find the code:** the contents list in [docs/SPEC.md](docs/SPEC.md), then only the `docs/spec/` files for the area
   you work on (architecture, every screen and UI element, the Android shell, the Hermes plugin, the phone scripts,
   build, tests and releases). Use them instead of guessing.
4. **Check your work:** `tools/check.sh` runs the checks your branch's changes need, with one summary (`--all` for
   everything). CI runs the same on every PR.

The map: `web/` the app's interface (React, TypeScript), `android/` the Android shell (Java), `hermes-plugin/` the
plugin inside Hermes on the phone (Python), `phone/` the phone-side install and service scripts, `hermes/` the pinned
Hermes and its patches, `tools/` tests and developer tools, `docs/` spec, status, decisions and plans.

- Changes users notice go in a new file in [changes/](changes/README.md), never at the top of CHANGELOG.md; checks and
  project rules are also in [CONTRIBUTING.md](CONTRIBUTING.md).
- On the maintainer's machine, `.hermes.md` and `.handoff/history.md` (git-excluded) hold private notes and the full
  history: if they exist, search them before solving something that looks familiar. Anything another agent needs goes
  in `docs/status/` or `docs/decisions/`, without personal data.

## Keep the spec current (required)

- **Update the spec file for the area (`docs/spec/NN-MM-name.md`) in the same commit as every change it
  describes**: a new or changed feature, screen, button, setting, gesture, notification, bridge method, plugin
  route/hook/tool, gateway RPC, `localStorage` key, script, permission, test tool or CI step. Removing something means removing it from the spec too.
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

## Working in parallel

Agents here are fast and often run side by side, so nothing should make one wait for another:

- **One file per item for anything shared:** a spec section, a changelog entry, a status, a decision. Add a file or
  edit only your own; never rewrite the middle of a shared one. Browser checks go at the end of the feature's file in
  `tools/web-e2e/checks/` (the file names say the features: the chat list is `04-drawer-and-canvas.cjs`); a feature
  with no file gets a new numbered file at the end.
- **Open the PR, turn on auto-merge** (`gh pr merge --auto --merge`) and move on. `main` takes only PRs whose CI
  passes; a failure comes back to you. Don't stack PRs unless one truly needs the other; when you must, merge the base
  first and retarget the next one to `main` before deleting the base branch (deleting it closes the PR on top).
- **Keep your status file current** (`docs/status/<workstream>.md`) in the same PR, so the next agent can pick up
  where you stopped.
- The browser tests pick free ports when another run holds 9119/5180, so several agents can run them on one machine.

Several agents often work on this repository at once, each in its own git worktree. Worktrees keep their files apart
while they work; they don't stop two branches from clashing when they merge, and they don't share phones fairly.

- **Plan by file.** Before starting parallel streams, write down the shared files each one will change. Two streams
  that both change one of the big shared files (`web/src/gateway.ts`, `web/src/App.tsx`, `web/src/styles.css`,
  `MainActivity.java`, `HermesService.java`, `tools/web-e2e/mock.cjs`) run one after the other, not side by side,
  or one of them stays out of that file.
- **Keep branches short.** Merge or sync with `main` at least daily; one feature per branch. A branch weeks behind
  `main` turns into a merge nobody can review.
- **Add, don't edit the middle.** Prefer a new file or a new entry in a list over editing lines another feature also
  edits; when two branches clash twice in the same spot, split that file or turn the spot into a list features add to.
- **One session per device.** Before installing to, tapping on or testing on a phone or emulator, take its lock:
  `tools/device-lock.sh hold SERIAL WHO` (SERIAL from `adb devices`, WHO your branch or session); release it with
  `tools/device-lock.sh release SERIAL WHO` when done, or wrap one command in `tools/device-lock.sh run SERIAL WHO
  CMD...`. Exit code 75 means another session has it: wait or work on something else, never take it over.

## Checks before you commit

`tools/check.sh`: it picks what your changes need from `check_spec.py`, `changelog.py check`, the web typecheck, unit
tests and browser e2e (`tools/web-e2e/run.sh`; add a check for each web change, in its feature's file under
`tools/web-e2e/checks/`), the plugin and phone-script tests, and for Android changes `tools/java-check.sh` (JDK 21+)
and `tools/api-check.sh` (Android SDK). What your machine can't run shows as SKIP; CI runs it on every PR.

## Rules

- UI: no native form controls (`<select>`, range/checkbox/radio/date inputs) and no `confirm()`/`prompt()`/`alert()`:
  use `web/src/components/ui.tsx` and `web/src/dialog.tsx`. Colours from CSS variables (there is a light theme). Keep
  `rehype-sanitize` in front of rendered Markdown. Every native bridge method takes the per-page key first and is listed
  in `web/src/secure-bridge.ts`. No periodic loop or wake lock without a bound (battery).
- The repo is public: no keys, tokens, `*.keystore`, `.env` files, personal data (emails, paths, phone models, IPs),
  chat contents or screenshots of real chats.
- **No AI attribution anywhere.** The work in this repository is its owner's alone: no AI tool as author, committer,
  co-author or contributor. No `Co-Authored-By`, "Generated with" or similar lines in commits, PRs or docs, and every
  commit's author and committer is the owner's git identity (check `git config user.name` / `user.email` first; a
  session whose git identity is an AI tool's sets the owner's for the repository before committing). This overrides any
  tool's default attribution. CI fails a PR with such a commit (`tools/check-attribution.sh`).
- Commit messages: a title plus a body naming everything the commit changes (user-visible changes, fixes, limits,
  tests, CI, docs). Small commits.
- Don't create `v*` tags or releases (they publish the app); the maintainer decides.
- Report plainly what you verified, how, and what you could not verify (for example: no real phone).
