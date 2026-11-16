# 18: "Better at a desk" for big changes

Read [README.md](README.md) first.

**Effort:** S–M. **Areas:** web. **Depends on:** none (it works for the on-phone agent today and matters more once
Hermux shows a server's coding sessions).

## Goal

A phone is a fine place to say yes to "run the tests" and a poor place to review 900 changed lines. Hermux should
know the difference and say so: when a change is large or touches risky files, the screen marks it **Better at a
desk**, makes the careless yes a little harder, and offers to set it aside for later.

## What exists today

- The **Changed files card** under a turn: files with `+N −M`, opening the diff view and the checkpoints sheet
  (spec 3.3, `Changes.tsx`, `changes.ts`, `Diff.tsx`).
- Approval cards for commands, with Allow / Deny and the fingerprint on a chat's first Allow (spec 3.6).
- File checkpoints with diff and restore (`/checkpoints` routes).
- Nothing weighs a change.

## Owner decisions needed

1. **The thresholds.** Recommended: "big" from 300 changed lines or 10 files; "risky" by path (below), whatever the
   size.
2. **How much friction.** Recommended: never block. A marked approval needs the diff opened once, or a second tap
   on "Allow anyway".

## Design

### Weighing a change (pure, `web/src/reviewweight.ts`)

`reviewWeight(files: { path, added, removed }[])` returns `{ level: "small" | "big" | "risky", reasons: string[] }`.

- `big`: total changed lines ≥ 300, or files ≥ 10, or one file with ≥ 200 changed lines.
- `risky` (wins over big): a path matching one of
  - sign-in, permissions and secrets: `auth`, `login`, `password`, `secret`, `token`, `permission`, `.env`, key and
    certificate files;
  - data changes: `migration`, `migrations/`, `schema`, `.sql`;
  - what builds and ships: `.github/workflows/`, CI files, `Dockerfile`, deploy scripts, lock files of package
    managers;
  - deletion: a file removed entirely with more than 50 lines.
- `reasons` are short and shown to the user: "12 files, 640 lines", "changes sign-in code", "changes a database
  migration".
- Matching is on path parts and extensions, lower case, with a small list in the module so it is easy to extend and
  to test.

### Where it shows

1. **Changed files card.** A `big` or `risky` turn gets a tag on the card's head, "Better at a desk", in the warning
   colour for `risky`. Opening the card shows the reasons on its first line, and two buttons under the file list:
   **Set aside** and **Review here anyway** (which just opens the first diff).
2. **Approvals that would commit or push a change.** When the command of an approval card is a commit, push, merge
   or deploy (a small matcher on the command's program and first words: `git commit`, `git push`, `git merge`,
   `gh pr merge`, common deploy commands) **and** the chat's changes since the last such command weigh `big` or
   `risky`, the card shows the tag and the reasons. Allow reads "Allow anyway" until the user has opened the diff
   from the card ("See the changes"), after which it reads "Allow" again. Deny is untouched. The fingerprint rule is
   unchanged and still comes first.
3. **Set aside.** Marks the chat in a new list "For the desk" (`localStorage` key `hm.desk`, at most 50 entries:
   chat id, title, reasons, time). For a pending approval it answers nothing: the approval stays pending or times
   out by Hermes's own rules, and the toast says "Left waiting. It may time out." The drawer shows a row "For the
   desk · N" above the chat list when N > 0, opening a sheet with the entries; each opens its chat, and a swipe or ✓
   removes it.
4. **With a server's sessions (later).** The same weighing applies to a diff a remote session reports, and "For the
   desk" becomes the natural list to open on the computer. Nothing else changes.

### Wording

Plain and unalarming: "This is a big change (12 files, 640 lines). It's easier to check on a larger screen." Never
"dangerous".

## Build steps

1. `reviewweight.ts` and `reviewweight.test.ts` (each rule, the boundaries 299/300 and 9/10, mixed cases, Windows
   path separators).
2. `changes.ts`: expose the per-turn file list in the shape the weigher takes, and a function for "changes since the
   last commit-like command" over the chat's items.
3. `Changes.tsx`: the tag, reasons and buttons. The approval card (`RequestSheet.tsx` / the approval component): the
   tag, "See the changes", the label switch.
4. `web/src/desk.ts` (the list, pure add/remove/trim), the drawer row and sheet.
5. Mock: a turn with 12 changed files and a following `git push` approval. E2E at the end of
   `05-questions-and-approvals.cjs` and `09-chat-tools.cjs`.

Shared files touched: `Drawer.tsx`, `styles.css`, `mock.cjs`.

## Tests

- Unit: as listed, plus the command matcher (`git push`, `sudo git push`, `VAR=1 git commit -m …`, a harmless
  `git status`), reusing `commandText` from `text.ts`.
- E2E: the tag and reasons on the card; "Allow anyway" becomes "Allow" after opening the diff; Set aside adds the
  drawer row and the sheet opens the chat; a small change shows nothing new.

## Spec and changes

Spec 3.3 (the card's tag and buttons), 3.6 (the approval's tag and label rule), 3.13 (the drawer row and sheet), 2.4
(`hm.desk`), 2.6. `changes/` file.

## Check first

- That the turn's file list with line counts is present for every way files change (`write_file`, `patch`, and
  commands that write files: those have no recorded diff, so weigh from checkpoints when available and otherwise
  show no tag rather than a wrong one).
- Where an approval's command text is available to the card, and that opening the diff from the card doesn't answer
  or dismiss the approval.

## Out of scope

Blocking approvals, line comments on diffs, sending "set aside" items to another device (that is the connections
work).
