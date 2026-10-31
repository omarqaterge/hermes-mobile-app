# 01: Quote part of a reply into the composer

Read [README.md](README.md) first.

## Goal

The user selects some words in one of Hermes's replies, taps **Quote**, and the words appear as a quote above the
composer's text box. The next message they send starts with that quote as a Markdown blockquote, so Hermes knows
exactly which part they mean.

T3 Code's version: `apps/web/src/components/chat/AssistantSelectionToolbar.tsx` (the floating "Cite selection in
composer" button) and `AssistantCitationChip.tsx` (the chip in the composer). Ours is simpler: no comments on the
quote, and the bar sits at the bottom, not next to the selection (Android's own Copy/Share menu floats next to the
selection, and the two would overlap).

## What exists today

- `web/src/components/Canvas.tsx`, `CanvasPanel`: a `selectionchange` listener (search `selectionchange`) that shows a
  bar "Ask Hermes about the selection" when more than 2 characters are selected. Copy its approach.
- `web/src/components/ChatItems.tsx`, `AssistantMsg`: renders a reply as `<div className="msg assistant">` with the
  Markdown inside `.md`. `useTimeTap` already ignores taps while text is selected.
- `web/src/components/Composer.tsx`, `Composer` and `send()`: the composer, its attachment row (`.attach-row`) and
  the offline outbox (`queueMessage`).
- `web/src/gateway.ts`, `sendPrompt(text)`: sends the text as given.
- User bubbles render their text with `Linked` (plain text plus links), not Markdown.

## Design

1. **Selection bar.** While text is selected inside a `.msg.assistant .md` element (and nowhere else), a bar shows
   just above the composer: label "Selected text", buttons **Quote** and **Explain**.
   - Quote: adds the selection to the composer's quote list, clears the selection, focuses the text box.
   - Explain: sends at once: the quote block, then `Explain this.`. Uses the same path as Send.
   - The bar hides when the selection collapses, when a sheet opens or when the chat changes.
   - Only for selections of 3 to 2000 characters (trimmed). Over 2000: the bar shows the label
     "Selection is too long to quote" and both buttons disabled.
2. **Quote chips.** Above the text box, in the composer's attachment row area, each quote shows as a chip
   `❝ first 60 characters…` with a ✕ (aria-label `Remove quote`). Up to 3 quotes; a 4th replaces the oldest.
   Quotes belong to the chat they were taken from: switching chats clears them (no persistence needed).
3. **Sending.** `send()` builds the text: each quote as a blockquote (`> ` before every line), a blank line between
   quotes, a blank line, then the typed text. Empty typed text is allowed when there is at least one quote. The quotes
   clear after a successful send (and come back if the send fails, like the text does today).
   Offline (`conn !== 'open'`): the same built text goes to `queueMessage`.
4. **Showing it in the user's bubble.** A user message whose text starts with `> ` lines shows those lines as a quote
   block (left border, dim text) above the rest. This also makes stored chats look right after a reload.

## Implementation steps

1. **New module `web/src/quote.ts`** (pure functions, easy to test):
   ```ts
   export const QUOTE_MAX = 2000
   export const QUOTES_MAX = 3
   /** "> " in front of every line of each quote, quotes separated by a blank line, then the message. */
   export function withQuotes(quotes: string[], text: string): string
   /** Splits leading "> " lines off a sent message: { quote: string[] (one entry per quote block), body } */
   export function splitQuote(text: string): { quotes: string[]; body: string }
   ```
   `withQuotes(['a\nb'], 'why?')` → `'> a\n> b\n\nwhy?'`. `splitQuote` is its inverse: quote blocks end at the first
   line not starting with `>`; a blank line starting with `>` stays in its block. Text that doesn't start with `> `
   returns `{ quotes: [], body: text }`.
   Keep the quote state in this module too, with the same tiny pub/sub pattern as `composerPrefill` in `gateway.ts`
   or a `useSyncExternalStore` hook like `useStore`: `addQuote(text)`, `removeQuote(i)`, `clearQuotes()`,
   `useQuotes(): string[]`.
2. **Selection bar component** `QuoteBar` (put it in `web/src/components/Composer.tsx` above the slash menu, or a new
   `web/src/components/QuoteBar.tsx` rendered by `Composer`):
   - `useEffect` adds a `selectionchange` listener on `document` (remove on unmount).
   - In the handler: `const s = window.getSelection()`; ignore if `!s || s.isCollapsed`; find
     `s.anchorNode` and `s.focusNode`'s closest `.msg.assistant .md` (use `(node.nodeType === 1 ? node : node.parentElement)?.closest(...)`);
     both must be inside the same `.md`. Text is `s.toString().trim()`.
   - Clear the bar's state when the active chat changes (`useStore(s => s.active?.storedId)`).
   - Buttons call `haptic()`. After Quote/Explain call `window.getSelection()?.removeAllRanges()`.
3. **Composer**:
   - Read `useQuotes()`. Render the chips (class `quote-chip`) in the row that holds attachments.
   - In `send()`: `const full = withQuotes(quotes, t)`; use `full` instead of `t` for both `queueMessage` and
     `sendPrompt`; allow sending when `quotes.length > 0` even if `t.trim()` is empty (the send button's `disabled`
     check must allow it too). On success `clearQuotes()`; on failure keep them.
   - Slash commands: if the typed text starts with `/`, don't add quotes (send as today) and keep the quotes.
   - Placeholder when quotes exist and the box is empty: `Ask about the quote…`.
4. **User bubble** (`UserMsg` in `ChatItems.tsx`): `const { quotes, body } = splitQuote(item.text)`; render each quote
   in `<blockquote className="msg-quote"><Linked text={q} /></blockquote>` before `<Linked text={body} />`.
   Edit mode keeps editing the full text (quotes included), so nothing else changes there.
5. **CSS** in `web/src/styles.css`: `.quote-bar` (like `.canvas-sel`), `.quote-chip`, `.msg-quote` (border-left
   `3px solid var(--accent)`, `color: var(--dim)`, small padding). Use existing variables only.
6. Also make `export.ts` (`chatMarkdown`) keep working: the text already is Markdown, nothing to do; check that the
   export of a quoted message reads well.

## Edge cases

- Selection that spans two messages or starts outside a reply: no bar.
- Selection inside a code block in a reply: allowed (it is inside `.md`). Keep the exact characters.
- Selecting inside the composer textarea or a sheet: no bar (they are not inside `.msg.assistant .md`).
- Text containing `\r\n`: normalise to `\n` in `withQuotes`.
- Live mode on (`useVoice(v => v.live) !== 'off'`): don't show the bar.

## Tests

**Unit** (`web/src/quote.test.ts`, node environment is fine since the functions are pure):
- `withQuotes` with one quote, two quotes, multi-line quote, empty text.
- `splitQuote(withQuotes(q, t))` returns `q` and `t` again (round trip) for several cases.
- `splitQuote('no quote')`, `splitQuote('>not a quote marker')` (no space) behave as described; decide and test that
  `>x` without a space still counts as a quote line (Markdown does), and say so in the spec.

**E2E** (`tools/web-e2e/test.cjs`, after an existing chat with a reply, e.g. after `show diagram` or the
plain `OK` reply):
```js
// select the first 5 characters of the last reply's first paragraph
await page.evaluate(() => {
  const p = [...document.querySelectorAll('.msg.assistant .md p')].pop()
  const r = document.createRange()
  r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, Math.min(5, p.firstChild.length))
  const s = getSelection(); s.removeAllRanges(); s.addRange(r)
})
await page.getByRole('button', { name: 'Quote' }).click()
check((await page.locator('.quote-chip').count()) === 1, 'Quote adds a chip above the composer')
await page.getByPlaceholder('Ask about the quote…').fill('why?')
await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
// the last prompt.submit text starts with "> " and ends with "why?"
```
Also check: ✕ on the chip removes it; a selection in the user's own bubble shows no bar; the sent user bubble shows a
`.msg-quote` element.

## Spec and changelog

- `docs/SPEC.md` 3.3 (User message: the quote block), 3.4 (Composer: the quote chips and the selection bar, the
  aria-label `Remove quote`, the placeholder), 3.2 layout table (the selection bar row), and the source map under 3.6
  (`web/src/quote.ts`).
- `CHANGELOG.md`: "Quote part of a reply…".

## Out of scope

Comments attached to a quote (T3 has them), quoting from tool output or user messages, quotes surviving a reload.
