# The interface redesign stays on its own branch until the owner has tried it on a phone

**Decided:** 2026-11-16, by the owner.

The redesign changes nearly every screen, and the owner's first worry is that it breaks features that work today. It
must be tried on a real phone, on real chats, before anyone else gets it, and the owner must always be able to go back
to the released app.

**So:**

- All redesign work is built on the long-lived branch `redesign`, made from `main`. Every redesign task branches from
  the current `redesign` and opens its PR against it (`gh pr create --base redesign`), one task and one PR at a time.
  `main` keeps getting ordinary fixes; they are brought into `redesign` before each task.
- Nothing of the redesign reaches `main` until the owner has tried a test build of it on a phone and says so. No `v*`
  tag and no release from `redesign` (the release gate refuses a tag off `main` anyway).
- `redesign` has no branch protection: don't turn on auto-merge for its PRs (it would merge before CI ends); merge
  only with CI green.
- A redesign change alters how things look and where they sit, not what they do. Stored data stays readable by the
  released app: no `localStorage` key, file or setting is renamed, removed or given a new meaning (new ones go beside
  them), and the plugin only gains routes and fields, so the released app still works with it after going back. How to
  build the test build and how to go back are in [docs/status/ui-revamp.md](../status/ui-revamp.md).
- The browser checks are the record of what works: a check is removed only with the feature it covers
  (`tools/web-e2e/list-checks.sh --missing` against `tools/web-e2e/baseline-checks.txt`).
