# Faster work for parallel agents

**State (2026-11-01):** done: the spec is split into `docs/spec/` (#17); CI runs once per push, cancels superseded runs
and skips the web and contract jobs when they aren't needed (#18; CI for a docs-only PR now takes about 1.5 minutes instead of 9);
`tools/setup.sh`, `tools/check.sh` and e2e runs on free ports (#19); this status folder and `docs/decisions/` (#20);
the browser tests run as five parallel shards in CI and in `tools/check.sh` (`run.sh --only`), 829 checks in about
1 minute 45 instead of 6.5 locally; the longest shard (`07-11`) has about 105 s of checks in CI.

**Next:** the open items of the review of 2026-11-01 (`docs/status/review-2026-11-01.md`). More shards gain little now:
`07-11`, `17-18` and `12` all take 85–105 s. The next step is fewer fixed `sleep`s in `12-app-shell.cjs` and
`18-setup-flow.cjs` (waits for the state instead).

**Needs a real phone:** no.

**Links:** `docs/spec/07-03-browser-e2e.md`, `docs/spec/07-04-workflows.md`, `tools/check.sh`, `tools/setup.sh`.
