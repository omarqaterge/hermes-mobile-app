# 19: Test results and screenshots as cards

Read [README.md](README.md) first, and `docs/research/chat-tool-visuals.md` (how tool calls are worded today).

**Effort:** M. **Areas:** web. **Depends on:** none.

## Goal

After "run the tests", the user wants one glance: **182 passed, 2 failed**, the two names, and a tap for the detail.
Today they get a tool line and, behind a tap, a wall of terminal output. The same goes for pictures a tool produced
(a screenshot of the page it built): they should appear as thumbnails, not as a path in text.

## What exists today

- Tool items in a turn with plain-words labels (`toolsay.ts`), their arguments and a stored result, opened on tap
  (`GET /tool-result` for large ones).
- `MEDIA:` lines and Markdown images in replies render as pictures; canvas documents can hold images.
- The diff view, the changed-files card.
- Nothing reads a command's output for meaning.

## Owner decisions needed

1. **Which test tools first.** Recommended: the ones whose summary line is stable and common: pytest, vitest and
   jest, `go test`, `cargo test`, and Hermux's own `tools/check.sh` summary. Others fall back to today's text.

## Design

### Parsing (pure, `web/src/testresult.ts`)

`parseTestRun(command: string, output: string, exitCode?: number): TestRun | null`

```ts
type TestRun = {
  tool: 'pytest' | 'vitest' | 'jest' | 'go' | 'cargo' | 'check'
  passed: number; failed: number; skipped: number
  seconds?: number
  failures: { name: string; where?: string; message?: string }[]  // at most 20
  truncated: boolean
}
```

- One small parser per tool, chosen by the output's own summary line first (so a wrapper script still works) and by
  the command's program second (`programName` from `text.ts`). Each parser reads the summary line for the counts and
  the failure list for names; `message` is the first line of the failure, at most 200 characters.
- ANSI colour codes are stripped first (the diff view has a stripper).
- Only the **last 60,000 characters** of the output are read (summaries are at the end), and parsing is skipped for
  outputs the item doesn't hold (large results that live behind `GET /tool-result` are parsed when the user opens
  them, not before: no extra requests).
- Strictness: a parser returns a result only when the summary line matches fully. Counts that don't add up to at
  least 1 test give `null`. When in doubt, no card: a wrong green tick is worse than plain text.
- A run that the exit code says failed but whose parse shows 0 failures is shown as "ended with an error" with no
  tick.

### The card (`web/src/components/TestCard.tsx`)

Rendered in place of the tool line's collapsed body for a `terminal` (or `execute_code`) item with a parse:

- Head: a state mark (✓ in the success colour, ✕ in the error colour), "**182 passed · 2 failed · 3 skipped**",
  the duration, the tool's name in dim text.
- A thin bar split by the three counts (CSS variables; shapes differ as well as colours, for colour-blind users:
  the failed part is hatched).
- Failures: one row each, name and message; tap expands the row to that failure's part of the output when it can be
  cut out, else opens the full output scrolled to the name.
- **Show full output** opens what the tool line opens today.
- When there are failures, a button **Ask Hermux to fix these** puts "Fix the failing tests: <names>" in the
  composer, unsent.

In the turn's summary line (the collapsed turn), a test run shows as "Tests: 182 passed, 2 failed" instead of "Ran
pytest".

### Pictures from tools

- `web/src/toolmedia.ts` (pure): `imagesOf(item)` finds image file paths in a tool item: the `path`-like argument of
  screenshot and image tools, and paths ending in `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` that appear on a line of
  their own in a result of at most 4,000 characters. At most 6 per item.
- A row of thumbnails under the tool line, loaded through the existing media route (`GET /media`) **only when the
  row scrolls into view** (the lazy helper in `lazy.ts`), 96 px high. A tap opens the picture viewer the chat
  already uses.
- A path that doesn't load shows nothing (no broken-image box).
- In a chat that has read phone data nothing changes: these are local files, not remote addresses.

### For a server's sessions (later)

The same parsers and cards apply to command results from a remote session; pictures then load through that
connection's media route. Nothing here assumes the phone.

## Build steps

1. `testresult.ts` with one fixture output per tool and case under `web/src/fixtures/testruns/` (made-up project and
   test names; no real paths): all passing, some failing, with skips, with colour codes, cut-off output, a compile
   error before any test ran.
2. `TestCard.tsx`, the tool item rendering in `ChatItems.tsx`, the turn summary wording in `toolsay.ts`.
3. `toolmedia.ts` with tests; the thumbnail row.
4. Mock: prompt texts `run tests` (a failing pytest result) and `take a screenshot`. E2E at the end of
   `09-chat-tools.cjs`.

Shared files touched: `ChatItems.tsx`, `toolsay.ts`, `styles.css`, `mock.cjs`.

## Tests

- Unit: every fixture; a summary line inside a failure message is not taken for the run's summary (take the last
  match); a 1 MB output is cut to the tail before parsing; `imagesOf` ignores a path inside a sentence and a `http`
  address.
- E2E: the card with counts and two failures; expanding one; "Ask Hermux to fix these" fills the composer; the
  thumbnail appears on scroll and opens the viewer; an unparsed command still shows today's line.
- Phone: a long test output on a slow phone doesn't stall scrolling (parse is done once and memoised on the item).

## Spec and changes

Spec 3.3 (tool items: the card, the summary wording, thumbnails), 2.6 (new files), 7.3 (the new mock prompts).
`changes/` file.

## Check first

- Which fields a `terminal` item carries in the page (command, output, exit code) and up to what size the output is
  kept on the item.
- That local image paths from tools are readable through `GET /media` (it serves files the chat references; a path
  outside its allowed roots will not load, which is the safe failure).

## Out of scope

Coverage reports, linters and type-checkers (good next parsers), re-running a single failed test from the card.
