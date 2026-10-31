# 05: Card that lists the files a turn changed

Read [README.md](README.md) first.

## Goal

When a turn wrote or edited files, a small card at the end of that turn says
`✎ 3 files changed  +42 −7`. Tapping it lists the files, each with its own `+N −M`; tapping a file shows its diff.
A **Checkpoints** button opens the existing file checkpoints sheet (to undo).

T3 Code: `apps/web/src/components/chat/ChangedFilesTree.tsx` and `DiffStatLabel.tsx` (a per-turn tree of changed
files with line counts, each opening its diff).

## What exists today

- Tool items (`ChatItem` kind `tool` in `web/src/store.ts`) carry `name`, `args`, `status` and, for edits,
  `inlineDiff` (live: from `tool.complete`'s `inline_diff` in `gateway.ts`; stored chats: from `display_metadata`
  in `hydrate`). Hermes's edit tools (hermes-agent `tools/file_tools.py`): `write_file` (`args.path`, `args.content`)
  and `patch` (`args.path`, `args.old_string`, `args.new_string`, `args.replace_all`).
- `web/src/components/Diff.tsx`: `DiffView({ text })` and `looksLikeDiff`.
- File checkpoints: `RollbackSheet` in `web/src/components/Sheets.tsx`, opened with `setState({ sheet: 'rollback' })`.
- `Chat` in `web/src/App.tsx` renders one child element per item (search and jump depend on that). A folded tool run
  is rendered as one wrapper `div.tool-run-wrap` holding the run head and the item: the same trick lets us add the card
  after an item without adding a child.
- `fold.ts` folds runs of 3+ tool calls; the card must stay visible when the run is folded.

## Design

- A **turn** = a user item and everything up to the next user item.
- The card belongs after the **last item of the turn**, and shows only when the turn is finished
  (`!running` or it's not the last turn) and at least one `write_file`/`patch` tool in it ended with
  `status: 'done'`.
- Per file (by `args.path`, shown shortened: `~/…/dir/name.ext` for long paths, full path in the diff sheet title):
  - `+N −M` counted from the tool's `inlineDiff` (lines starting with `+`/`-`, excluding `+++`/`---` headers).
  - With no `inlineDiff` (older stored chats): `write_file` counts `+` as the number of lines of `args.content` and
    shows `new or rewritten`; `patch` counts `old_string`/`new_string` lines as `−`/`+`.
  - A file edited several times in the turn: one row, counts summed, diffs concatenated in order.
- Collapsed card: icon, `N file(s) changed`, total `+A −B` (green/red from the variables `DiffView` uses), chevron.
  Expanded: the file rows, then a **Checkpoints** button.
- Tap a file row: a sheet titled with the file path showing `DiffView` of its diffs, or "No diff recorded for this
  edit" when there's none.
- Failed edits (`status: 'error'`) are not counted. If all edits failed, no card.

## Implementation steps

1. **New pure module `web/src/changes.ts`:**
   ```ts
   export interface FileChange { path: string; added: number; removed: number; diffs: string[]; rewritten: boolean }
   export interface TurnChanges { files: FileChange[]; added: number; removed: number }
   export const EDIT_TOOLS = new Set(['write_file', 'patch'])
   export function diffCounts(diff: string): { added: number; removed: number }
   /** Map from the index of each finished turn's last item to that turn's changes (only turns with changes). */
   export function turnChanges(items: ChatItem[], running: boolean): Map<number, TurnChanges>
   export function shortPath(p: string): string
   ```
   Turn boundaries: iterate items; a `user` item starts a new turn. The last turn is skipped when `running`.
2. **Component `TurnChangesCard`** (new `web/src/components/Changes.tsx`): props `{ changes: TurnChanges }`; local
   `open` state; file sheet state. Reuse `DiffView`. For the sheet use `Sheet({ title, onClose, children })`, already
   exported from `web/src/components/Screens.tsx` (the Files preview uses it). Check that it registers
   `useBackHandler` itself; if not, call `useBackHandler(close, isOpen)` in the card.
3. **`Chat` (`App.tsx`)**: `const changes = useMemo(() => turnChanges(items ?? [], running), [items, running])`.
   In the map over `items.slice(start)`, when `changes.has(start + i)`:
   - if the item is rendered plainly, render
     `<div key={it.id} className="turn-end">{view}<TurnChangesCard changes={...} /></div>`;
   - if the item is part of a fold (`f` set), put the card inside the same wrapper after the item. For a hidden folded
     item (`<div className="folded" />`), still render the card in that div so it stays visible.
   Keep exactly one child element per item.
   `ItemView`'s `key` moves to the wrapper when wrapped (as `tool-run-wrap` does).
4. **CSS**: `.turn-changes`, `.turn-changes-row`, `.diffstat-add`, `.diffstat-del`. Use the colour variables already
   used by `.diff` lines in `styles.css`.
5. Export (`export.ts`) and speech: leave unchanged.

## Edge cases

- The same path written with `write_file` and then patched: one row, `rewritten: true`, counts summed.
- Paths missing from `args` (a provider that streams tool calls without args): skip that tool.
- Huge diffs: `DiffView` handles long text already; cap each file's concatenated diff at 200 000 characters with a
  "… (truncated)" line.
- The last turn while it still runs: no card until it ends (avoids a card that jumps around while streaming).

## Tests

**Unit** (`web/src/changes.test.ts`): `diffCounts` ignores `+++`/`---` and `@@` lines; `turnChanges` with two turns
(only the one with edits appears, keyed at its last item index); a running last turn is skipped; failed edits ignored;
the fallback counts without `inlineDiff`; the same file twice merges.

**Mock**: prompt `/^edit files$/` emitting:
`tool.start` + `tool.complete` for `write_file` (`args: { path: '/root/projects/site/a.txt', content: 'x\ny' }`,
`inline_diff: '--- a/a.txt\n+++ b/a.txt\n@@ -0,0 +1,2 @@\n+x\n+y'`), and for `patch`
(`args: { path: '/root/projects/site/b.txt', old_string: 'old', new_string: 'new' }`,
`inline_diff: '--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-old\n+new'`), then `message.start` and
`message.complete` (`text: 'Edited.'`).

**E2E**:
1. Send `edit files`; after `Edited.` the `.turn-changes` card reads `2 files changed` and `+3 −1`.
2. Tap it: two rows `a.txt +2 −0` and `b.txt +1 −1` (check text content); tap `b.txt`: a sheet with a diff containing
   `new`; Back closes it.
3. `Checkpoints` opens the rollback sheet (whatever that sheet's existing e2e check looks for).
4. A turn with only `terminal` tools shows no card (the `use tools` scenario).
5. Search (`find`) still lands on the right message in a chat with a card (run an existing find check after this
   scenario, or add one for `Edited.`).

## Spec and changelog

- `docs/SPEC.md` 3.3 (new subsection "Changed files card"), 3.5 "File checkpoints sheet" (new way to open it), the
  source map (`web/src/changes.ts`, `web/src/components/Changes.tsx`).
- `CHANGELOG.md` entry.

## Out of scope

A folder tree like T3's (a flat list is enough on a phone), files changed by `terminal` commands (we can't know),
counting edits made by sub-agents.
