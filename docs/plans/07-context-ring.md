# 07: Context ring and context sheet

Read [README.md](README.md) first.

## Goal

A small ring next to the model chip above the composer shows how full the chat's context window is, all the time (not
only while Hermes answers). It turns amber from 80 % and red from 90 %. Tapping it opens a sheet with the numbers
(tokens used of the maximum, cost and cache figures when Hermes reports them) and a **Compress older turns** button.

T3 Code: `apps/web/src/components/chat/ContextWindowMeter.tsx` (SVG ring, popover with tokens, cost and a Compact
button).

## What exists today

- `ActiveSession.ctx: { used, max, percent } | null` and `usage: Usage | null` (`web/src/store.ts`).
- `refreshCtx(usage?)` in `web/src/gateway.ts`: takes context numbers from the turn's usage, else asks
  `session.context_breakdown`. Called by `finishTurnStats` at the end of each turn and by `compressChat`.
  It is **not** called when a chat is opened, so `ctx` is null until the first turn ends.
- `fmtCtx(ctx)` formats it. `StatusBar` (`App.tsx`) shows `ctx N%` only while running. `CompressHint` (`App.tsx`)
  offers Compress at ≥ 80 % (`COMPRESS_AT`).
- `Usage` (contract) also has `cost_usd`, `cache_hit_pct`, `input`, `output`, `total`, `context_estimated`.
- The model row in `Composer.tsx` (`.model-row`) holds the model chip and the Full access chip.

## Design

- **Ring** (`ContextRing`): 18 px SVG circle, stroke `var(--dim)` for the track and `var(--accent)` for the fill
  (`stroke-dasharray`/`dashoffset`, same maths as T3: `r = 7`, `circumference = 2πr`). Classes `warn` at ≥ 80 % and
  `full` at ≥ 90 % change the fill colour to the warning/error variables the app already uses for toasts.
  Shown at the right end of `.model-row` when `ctx` is known; hidden in Live mode (the row is hidden then anyway).
  aria-label: `Context 12% used. Show details`.
- **Sheet** `Context window` (title), contents:
  - A bar with the percent, then `12,345 of 128,000 tokens` (numbers with `toLocaleString()`), and
    `estimated by Hermes` when `usage.context_estimated`.
  - Rows when present in `usage`: `This chat so far: input N · output N`, `Cost: $0.0123` (`cost_usd`, 4 decimals
    under $1), `Cache hits: 63%`.
  - Button **Compress older turns** (disabled while running, with the dim note `Wait for the reply to finish`).
    Runs `compressChat()` with a spinner, then toasts its result, like `CompressHint`.
- A new chat shows no ring until its first turn ends (nothing to show).
- Keep `CompressHint` as it is (it's the prompt; the ring is the always-there control).

## Implementation steps

1. `gateway.ts`: `resumeSession` already calls `refreshCtx` (nothing to add there). In the `case 'session.usage'`
   handler, when the payload's usage carries `context_max` and `context_used`, also call `void refreshCtx(usage)`
   (it uses the usage without an RPC in that case), so the ring moves during long turns.
2. New component `ContextRing` in `web/src/components/Composer.tsx` (or its own file), reading
   `useStore(s => s.active?.ctx)` and `useStore(s => s.active?.usage)`.
3. `ContextSheet`: put it next to `StatusSheet` in `web/src/components/Sheets.tsx`. Open it with
   `setState({ sheet: 'context' })`: add `'context'` to the `Sheet` union in `store.ts` and render it in `App`'s sheet
   list like the others. Android Back already closes `state.sheet` sheets (`window.hermesBack`).
4. Extract the compress action so the hint and the sheet share it (a tiny `useCompress()` hook returning
   `{ busy, run }` in `App.tsx` or `Sheets.tsx`).
5. CSS: `.ctx-ring`, `.ctx-ring.warn`, `.ctx-ring.full`, `.ctx-bar`. Variables only; make sure it reads in the
   light theme.

## Tests

**Unit**: a pure `ringDash(percent, r)` helper (clamps to 0..100, returns `{ dasharray, dashoffset }`) and a
`ctxLevel(percent)` → `'ok' | 'warn' | 'full'`; test boundaries 79.9 / 80 / 90.

**Mock**: already answers `session.context_breakdown` with 10 % (and 85 % for `rt-s-full`).
Add `cost_usd: 0.0123, cache_hit_pct: 63` to one `message.complete` usage (e.g. the default `OK` reply) to show the
optional rows.

**E2E**:
1. Open an existing stored chat (no message sent): the ring shows with aria-label containing `Context 10% used`
   (the ctx loaded by `resumeSession`).
2. Tap it: the sheet `Context window` shows `100 of 1,000 tokens`.
3. Open the 85 % chat (`s-full`, whatever the existing compress test uses): the ring has class `warn`; the sheet's
   Compress button calls `session.compress` (check the RPC log) and the toast appears.
4. Android Back closes the sheet.

## Spec and changelog

- `docs/SPEC.md` 3.4 (model row: the ring and its aria-label), 3.5 (new "Context sheet"), the `Sheet` values list in
  3.1 ("Every `Screen` value" / sheets table), 2.2.1 (`session.usage` now also updates `ctx`).
- `CHANGELOG.md` entry.

## Out of scope

Per-message token counts, a breakdown by category (Hermes's `session.context_breakdown` may offer more fields later).
