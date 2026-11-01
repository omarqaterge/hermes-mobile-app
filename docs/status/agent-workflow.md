# Faster work for parallel agents

**State (2026-11-01):** done: the spec is split into `docs/spec/` (#17); CI runs once per push, cancels superseded runs
and skips the web and contract jobs when they aren't needed (#18; CI for a docs-only PR now takes about 1.5 minutes instead of 9);
`tools/setup.sh`, `tools/check.sh` and e2e runs on free ports (#19); this status folder and `docs/decisions/` (#20);
the browser tests run as three parallel shards in CI and in `tools/check.sh` (`run.sh --only`), 829 checks in about
3 minutes instead of 6.5 locally.

**Next:** the `07-12` shard is the longest (about 3 minutes); a fourth shard needs a file in the middle of it that
starts cold, which means moving the state it borrows (from earlier files) into the file itself. The review of
2026-11-01 (`docs/status/review-2026-11-01.md`) measured this and the rest of CI; its items carry this on.

**Needs a real phone:** no.

**Links:** `docs/spec/07-03-browser-e2e.md`, `docs/spec/07-04-workflows.md`, `tools/check.sh`, `tools/setup.sh`.
