# 11: Composer stash (put a draft aside)

Read [README.md](README.md) first.

## Goal

The user is halfway through writing a message and wants to ask something else first. They tap **Stash draft**: the
text is put aside and the box is empty. Later, **Stashed drafts** lists what they put aside (in any chat), and tapping
one puts it back in the box. Like `git stash` for the composer.

T3 Code: `apps/web/src/components/chat/ComposerStashMenu.tsx` and `ComposerStashBadge.tsx`.

## What exists today

- `web/src/drafts.ts`: one unsent draft per chat (`localStorage` `hm.drafts.v1`), saved as you type.
- `web/src/recent.ts`: recent prompts (shown as suggestions on the empty screen).
- `web/src/components/Composer.tsx`: the **Add** button (aria-label `Add`) opens a `PickerSheet` with Model, Camera,
  Photo, File (`ATTACH_OPTIONS`). `PickerSheet` (`ui.tsx`) takes `options: Option[]` with `value`, `label`, `sub`,
  `tone`, `icon`.

## Design

- In the Add sheet, two more options at the end:
  - **Stash draft** (sub: `Put this text aside and clear the box`), only when the box has text.
  - **Stashed drafts (N)** (sub: the first stash's first 50 characters), only when N > 0.
- Stash draft: saves `{ id, text, at, chat }` (chat = stored id or `null` for the new-chat screen) at the front of
  the list, clears the box, toasts `Draft stashed`. Attachments stay where they are (they belong to the chat, not the
  text).
- Stashed drafts: opens a second `PickerSheet` titled `Stashed drafts`, newest first. Each option: label = first line
  (max 60 chars), sub = `{time ago} · {chat title or "New chat"}` (`ago` from `unread.ts`). Picking one:
  - box empty: the text goes into the box; the stash entry is removed.
  - box has text: the box's text and the stash entry swap (the current text is stashed in its place). Toast
    `Swapped with your stash`.
- Deleting: the Stashed drafts sheet ends with an option **Clear all stashed drafts** (asks `confirmDialog`). Single
  deletes are not needed in v1 (`PickerSheet` has no per-row ✕); if you want them, add an optional `onRemove` to
  `PickerSheet` that draws a ✕ (aria-label `Remove {label}`) and use it here.
- At most 20 stashes; the oldest is dropped.

## Implementation steps

1. **New module `web/src/stash.ts`** (`localStorage` `hm.stash.v1`, `try/catch` like `drafts.ts`):
   ```ts
   export interface Stash { id: string; text: string; at: number; chat: string | null }
   export const STASH_MAX = 20
   export function stashes(): Stash[]
   export function pushStash(text: string, chat: string | null): Stash
   export function takeStash(id: string): Stash | null
   export function clearStashes(): void
   ```
2. **Composer**: add the two options to the Add sheet's `options` array (conditionally), handle them in `onPick`.
   For "Stashed drafts", close the Add sheet and open a second `PickerSheet` with local state `stashMenu`.
   Setting the text: use the existing `setText` + `setCaret` and focus the textarea (see how `composerPrefill.set`
   does it). The draft autosave (`setDraft`) picks up the change by itself.
3. Chat titles for the sub line: `getState().sessions.find(s => s.id === chat)?.title` passed through `plainTitle`
   from `components/Title.tsx`.
4. Icons: reuse the `line()` helper in `Composer.tsx` with simple paths (a box with an arrow down for stash, a stack
   for the list). Tones: `gray`.

## Tests

**Unit** (`web/src/stash.test.ts`, happy-dom): push/take order, the 20 cap, `takeStash` of an unknown id returns null,
corrupt storage gives `[]`.

**E2E**:
1. Type `half written`, Add → `Stash draft`: the box is empty; `localStorage['hm.stash.v1']` holds `half written`.
2. Type `other`, Add → `Stashed drafts (1)` → pick `half written`: the box now holds `half written`, and the stash
   holds `other` (swap).
3. Add → `Stashed drafts (1)` → `Clear all stashed drafts` → confirm: the option is gone from the Add sheet.
4. The Add sheet with an empty box and no stashes shows neither option.

## Spec and changelog

- `docs/SPEC.md` 3.4 "Drafts" (stash), the Add sheet's option list, 2.4.1 (`hm.stash.v1`), source map
  (`web/src/stash.ts`).
- `CHANGELOG.md` entry.

## Out of scope

Stashing attachments, syncing stashes to Hermes, a badge on the composer (T3 has one; the Add sheet is enough here).
