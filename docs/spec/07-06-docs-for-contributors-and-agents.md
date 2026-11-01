### 7.6 Docs for contributors and agents

| File | For whom | What it holds |
|---|---|---|
| `README.md` | users | Features, install routes, the "Android versions" table (what needs which Android, up-to-date WebView), uninstall, how to build. |
| `AGENTS.md` | every coding agent | Start here: `tools/setup.sh`, `docs/status/` and `docs/decisions/`, the spec's contents list then the area files, `tools/check.sh`, and a map of the folders; working in parallel (one file per shared item, open the PR with auto-merge on, keep the status file current); then the rules: update the area's file in the same commit as each change and run `tools/check_spec.py`; every-Android-phone rules and `tools/api-check.sh`; working in parallel (plan streams by file, short branches, add rather than edit the middle, `tools/device-lock.sh` per device); checks before committing; UI, public-repo, attribution and commit rules; no `v*` tags. |
| `CLAUDE.md` | Claude Code | Imports `AGENTS.md` (`@AGENTS.md`). |
| `GEMINI.md` | Gemini CLI | Points to `AGENTS.md` (Gemini CLI reads `GEMINI.md`; Codex, Cursor, Copilot and Hermes read `AGENTS.md`). |
| `CONTRIBUTING.md` | people sending PRs | The checks (`tools/setup.sh`, then `tools/check.sh`; it lists no test commands itself, it points at spec 7.2 and 7.3), the spec and CHANGELOG rule, what to do after a Hermes update, project rules. |
| `AGENT_INSTALL.md` | a user's own coding agent | How to set up a phone (6.3). |
| `changes/` | everyone changing user-visible behaviour | One file per unreleased change (7.5), folded into `CHANGELOG.md` at release. |
| `CHANGELOG.md` | users, release notes | What's new per release (7.5). |
| `docs/SPEC.md`, `docs/spec/` | everyone | The specification: `docs/SPEC.md` is the index (how to read it, how to keep it current, the contents list); `docs/spec/NN-MM-name.md` holds the text, one file per section, so changes to different areas don't touch the same file. `tools/check_spec.py` reads them all. |
| `docs/status/` | every agent picking up work | One file per workstream (**State**, **Next**, **Needs a real phone**, **Links**); a PR edits only its own workstream's file and deletes it when done. `README.md` says how. |
| `docs/decisions/` | every agent changing behaviour | One file per owner decision (**Decided:**, the reason, **So:**); read the ones for a screen before changing it, add one when the owner decides something. |
| `.github/ISSUE_TEMPLATE/agent_task.md` | whoever files work | A complete brief: goal, area and files, acceptance, how to verify, needs a phone, decisions that apply. |
| `docs/improvements.md`, `docs/manual-tests.md` | maintainers | Backlog with what was verified where; hand-test list. |
| `docs/performance-history.md` | maintainers | How fast the app gets to a usable chat, from the first measurements to now, and the method for adding the next measurement (Last start-up row over five starts, `tools/gw-time`). |

---
