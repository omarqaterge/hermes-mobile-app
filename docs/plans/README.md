# Feature plans (ideas taken from T3 Code)

Plans for features seen in [T3 Code](https://github.com/pingdotgg/t3code) (`apps/web/src/components/chat/*`,
`apps/mobile`) that Hermes Mobile lacks. Each file is written so an agent that has not seen the comparison can build it:
what to make, which files and functions to touch, what to test, and what "done" means.

| # | Plan | Effort | Depends on |
|---|---|---|---|
| 01 | [Quote part of a reply into the composer](01-quote-reply.md) | M | none |
| 02 | [Queue messages while Hermes works](02-queue-messages.md) | M–L | none |
| 03 | [Chat scrubber (jump between your messages)](03-chat-scrubber.md) | M | none |
| 04 | [HTML preview inside replies](04-inline-html-preview.md) | M | none |
| 05 | [Card that lists the files a turn changed](05-turn-changes-card.md) | M | none |
| 06 | [Elapsed timer and goal line under the chat](06-live-turn-lines.md) | M | none |
| 07 | [Context ring and context sheet](07-context-ring.md) | S–M | none |
| 08 | [Motion: animated open/close, effort bars](08-motion-polish.md) | M | none (do it after 01–07 to avoid conflicts) |
| 09 | ["New since your last visit" divider](09-new-since-divider.md) | S–M | none |
| 10 | [Questions sheet: move to the next question by itself](10-clarify-auto-advance.md) | S | none |
| 11 | [Composer stash (put a draft aside)](11-composer-stash.md) | S–M | none |
| 12 | [More file previews in Files](12-file-previews.md) | M | 04 (shares `HtmlFrame`) |

Build them one at a time, one plan per branch or commit series. Don't mix two plans in one commit.

## Read first (every plan)

1. `AGENTS.md`: the project rules. The most important ones are repeated here.
2. `docs/SPEC.md`: find the section each plan names, read it, and update it in the same commit as the code.
3. The source files each plan lists. Line numbers in the plans are approximate: search for the function name.

## Rules you must keep (from AGENTS.md)

- **No native form controls** (`<select>`, checkbox/radio/range/date inputs) and no `confirm()`, `prompt()` or
  `alert()`. Use `web/src/components/ui.tsx` (`PickerSheet`, `Toggle`, `Segmented`, `Row`…) and `web/src/dialog.tsx`
  (`confirmDialog`, `promptDialog`).
- **Colours come from CSS variables** in `web/src/styles.css` (there is a light theme). Never hard-code `#fff`/`#000`.
- Keep `rehype-sanitize` in front of rendered Markdown. Don't put model text into `dangerouslySetInnerHTML`.
- **No periodic loop or wake lock without a bound.** Timers run only while something is happening (e.g. while
  `active.running` is true and the page is visible) and stop by themselves.
- Every new native bridge method takes the per-page key first and is listed in `web/src/secure-bridge.ts`. None of
  these plans needs a new bridge method; if you think one does, stop and ask.
- Every Android API newer than 26 needs a `Build.VERSION.SDK_INT` check. None of these plans touches Java.
- Android Back must close whatever you open: use `useBackHandler(close, isOpen)` from `web/src/backstack.ts`.
- Tap feedback: call `haptic()` from `web/src/bridge.ts` on taps that change something.
- Public repo: no personal data, keys or real chat text in tests, fixtures or docs.
- No AI attribution lines in commits.

## Checks before every commit

```bash
cd web && npm test && npm run build
```

```bash
tools/web-e2e/run.sh
```

```bash
python3 tools/check_spec.py
```

- `npm test` runs vitest (`web/src/*.test.ts`). Pure logic goes in a plain `.ts` module so it can be unit-tested.
  Files that touch `window`/`localStorage` at load time start with `// @vitest-environment happy-dom`
  (see `web/src/helpers.test.ts`).
- `tools/web-e2e/run.sh` builds the page and drives it with Playwright against a mock Hermes
  (`tools/web-e2e/mock.cjs`). Every web change needs at least one new `check(...)` in `tools/web-e2e/test.cjs`. New mock
  behaviour goes into `mock.cjs`: a new prompt text in the `prompt.submit` case (see `use tools`, `show diagram`), or
  a new stored chat in the `session.resume` case (see `s-run`, `s-card`). In cloud sessions the script finds
  Chromium under `/opt/pw-browsers` by itself.
- `tools/check_spec.py` fails when the code has a name (aria-label, localStorage key, RPC, file…) that
  `docs/SPEC.md` doesn't mention. Identifiers go in backticks exactly as in the code; on-screen text as shown.

## What every plan's commit must contain

1. The code.
2. Unit tests and e2e checks, as the plan says.
3. `docs/SPEC.md` updated: the section the plan names, plus the source maps, `localStorage` table (2.4.1) and
   gateway RPC table (2.6) when you add a key or call a new RPC.
4. A line in `CHANGELOG.md` under `## Unreleased`, in the style already there, ending with what was verified (for
   example "Browser tests only; not yet on a real phone.").
5. A commit message with a title and a body naming every change (user-visible, tests, docs).

## Done means

- All checks above pass. Paste their summary lines in your report.
- You state what you could not verify. These plans can't be tried on a real phone from a cloud session: say so.
