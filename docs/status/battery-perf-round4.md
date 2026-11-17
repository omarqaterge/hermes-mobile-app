# Battery and speed, round 4: a reply while it streams

**State (2026-11-17):** done in the web code, not measured on a phone. An audit of the page, the Android service, the
plugin and the pinned Hermes for battery and speed found one large cost left: while a reply streamed, the page read the
whole reply as Markdown again on every batch of text and built highlight.js's language definitions for every drawing.
Fixed with `web/src/mdsplit.ts` (a streaming reply is drawn in parts; only the last is read again) and `highlightOnce`
in `web/src/rich-entry.ts`. Desktop browser, `tools/web-e2e/streamcost.cjs`: page work for a 2,000 / 8,000 /
16,000-character reply 1.12 / 4.97 / 9.61 s → 0.83 / 2.89 / 4.96 s. The table, the profile and what was checked and
left alone are in [docs/battery.md](../battery.md) ("Round 4").

**Next:**
- The phone measurement (below).
- The owner's call: text on screen every 100 ms instead of every 60 ms would save about a third of what is left, at a
  choppier look (`flushDeltas` in `web/src/gateway.ts`). Not changed.
- Still open from earlier rounds, unchanged: background self-review, memory sync on change, the dashboard's 0.5 s
  watcher (needs Hermes), listed in `docs/battery.md` and `docs/battery-report.md`.

**Needs a real phone:**
- `tools/battery/bench.py chat --via ui` with a prompt that asks for a long answer (several thousand characters, with
  code and a table), old build against new, three runs each: the app's CPU per second of turn should drop.
- A long reply with code blocks, a table, a task list, a `<details>` block and a video link, read while it streams and
  after: nothing missing or doubled, "Show all" and Wrap on a code block keep their state when the reply completes.

**Links:** `web/src/mdsplit.ts`, `web/src/mdsplit.test.tsx`, `web/src/components/Markdown.tsx` (`MdPart`),
`web/src/rich-entry.ts`, `tools/web-e2e/streamcost.cjs`, [spec 3.3](../spec/03-03-messages.md),
[spec 7.3](../spec/07-03-browser-e2e.md), [docs/battery.md](../battery.md).
