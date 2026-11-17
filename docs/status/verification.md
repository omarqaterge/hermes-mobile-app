# Verification: evidence that a change works

**State (2026-11-17):** in place: `docs/verification.md` (what "done" means, how to run each kind of change, what to
do when a check fails, how a miss becomes a check); the review checklist, sixteen items in `docs/review-checklist/`
with `tools/review_checklist.py` printing the ones a diff sets off (on the last 60 merged pull requests: 1.8 items
on average, none for 25 of them, nine at most); the `Verified:` line in commit messages with
`tools/check-verified.sh`, report only; `tools/web-e2e/run.sh --serve` to try the interface against the mock; the
`verify` skill; the rules in `AGENTS.md` and two lines in the pull request template.

**Next:**
- After two weeks of pull requests, read what `tools/check-verified.sh` lists and what the checklist printed: drop
  or narrow items that fired without being useful (`flaky-test-workarounds` and `security-boundary` fire most).
  Then the owner decides whether `check-verified.sh --enforce` goes into CI.
- Owner's decision: whether a pull request that changes a check, CI or the checklist may still merge itself, or
  waits for the owner (today the checklist item only asks for its own pull request and a sentence).
- Property tests for `scrub`, the version-to-build-number round trip and the queue (`docs/verification.md`, "Which
  tests to write"): none written yet. A generator library would be a new dependency; a seeded loop needs none.
- The fixed waits in `12-app-shell.cjs` and `18-setup-flow.cjs` (see `agent-workflow.md`) are what the
  `flaky-test-workarounds` item is about: replace them with waits for a state.

**Needs a real phone:** no.

**Links:** `docs/verification.md`, `docs/review-checklist/README.md`, `tools/review_checklist.py`,
`tools/check-verified.sh`, `docs/spec/07-02-every-tools-file.md`, `docs/spec/07-06-docs-for-contributors-and-agents.md`.
