# Faster work for parallel agents

**State (2026-11-01):** done: the spec is split into `docs/spec/` (#17); CI runs once per push, cancels superseded runs
and skips the web and contract jobs when they aren't needed (#18); `tools/setup.sh`, `tools/check.sh` and e2e runs on
free ports (#19); this status folder and `docs/decisions/` (#20).

**Next:** make each `tools/web-e2e/checks/` file start from a reset mock so files can run alone and in parallel CI
shards (the browser tests are about 8 of CI's 9 minutes).

**Needs a real phone:** no.

**Links:** `docs/spec/07-03-browser-e2e.md`, `docs/spec/07-04-workflows.md`, `tools/check.sh`, `tools/setup.sh`.
