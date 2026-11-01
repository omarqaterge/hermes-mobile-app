### 7.6 Docs for contributors and agents

| File | For whom | What it holds |
|---|---|---|
| `README.md` | users | Features, install routes, the "Android versions" table (what needs which Android, up-to-date WebView), uninstall, how to build. |
| `AGENTS.md` | every coding agent | Read the spec's contents list, then the area files; update the area's file in the same commit as each change and run `tools/check_spec.py`; every-Android-phone rules and `tools/api-check.sh`; working in parallel (plan streams by file, short branches, add rather than edit the middle, `tools/device-lock.sh` per device); checks before committing; UI, public-repo, attribution and commit rules; no `v*` tags. |
| `CLAUDE.md` | Claude Code | Imports `AGENTS.md` (`@AGENTS.md`). |
| `CONTRIBUTING.md` | people sending PRs | Checks to run, the spec and CHANGELOG rule, what to do after a Hermes update, project rules. |
| `AGENT_INSTALL.md` | a user's own coding agent | How to set up a phone (6.3). |
| `changes/` | everyone changing user-visible behaviour | One file per unreleased change (7.5), folded into `CHANGELOG.md` at release. |
| `CHANGELOG.md` | users, release notes | What's new per release (7.5). |
| `docs/SPEC.md`, `docs/spec/` | everyone | The specification: `docs/SPEC.md` is the index (how to read it, how to keep it current, the contents list); `docs/spec/NN-MM-name.md` holds the text, one file per section, so changes to different areas don't touch the same file. `tools/check_spec.py` reads them all. |
| `docs/improvements.md`, `docs/manual-tests.md` | maintainers | Backlog with what was verified where; hand-test list. |

---
