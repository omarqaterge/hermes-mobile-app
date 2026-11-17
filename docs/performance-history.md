# Performance history

How fast Hermux gets you to a usable chat, from the first measurements to now, and how to add the next
measurement so the history stays comparable. Battery and background work have their own report:
[battery-report.md](battery-report.md).

## Time to a usable chat after opening the app

"Usable" means the chat you had open is loaded and the message box says "Message Hermux" ("Message Hermes" in rows from before the rename; until then it says "Opening
your chat…"). All rows are on the owner's Android phone unless they say otherwise.

| Date (app) | What changed | Measured |
|---|---|---|
| before 2026-10-02 | — | A spinner for 3–5 s while Hermes started, then the chat. |
| 2026-10-02 | The chat as last seen is saved and drawn at once; the real one replaces it when Hermes answers. | Saved chat on screen 0.4–0.5 s after launch. Switching between idle chats 0.1 s (was 0.3–0.5 s). |
| about 0.7.76 | Mermaid built as a separate bundle that runs on the first diagram; KaTeX's woff/ttf fonts dropped (woff2 kept). Main script 4.4 → 1.2 MB, page file 5.06 MB. | Desktop `coldstart.cjs` (CPU ×4): message box drawn at 2702 → 1177 ms. Phone: first paint 196 ms after launch. |
| 2026-10-15 (0.8.28–0.8.31) | — | Start just after installing: chat usable at 4.5 s (Last start-up row: `script` 0.4 s, `painted` 0.5 s, `sessions` and `chat-live` 4.5 s). After the phone idled: in 4 of 8 probes the chat took 3–14 s (`session.list` up to 20 s), in the others about 1.3 s. |
| 2026-10-15 (0.8.33) | Hermes patch 0003: one YAML reader per thread instead of one per skill file. The app asks for the profile list (a skill walk) only after the chat opened. | Skill scan 1.80 → 0.49 s; Hermes's start-up work ~1 s → 0.28 s when warm. After idling: chat 1.2–3.0 s in 5 of 5 probes (was 3–20 s in half). |
| 2026-11-01, before that day's changes | — | Chat usable at 2.0 s (Last start-up `chat-live`, median of 5 starts; `script` 0.2 s, `painted` 0.2 s). |
| 2026-11-01 (#32) | KaTeX and highlight.js load on the first message that needs them. Start-up script 1404 → 970 KB, CSS 435 → 75 KB. | Desktop `coldstart.cjs`: 481 → 429 ms. Phone: `script` 0.2 → 0.1 s; chat usable unchanged (2.0 s), because the wait was elsewhere. |
| 2026-11-01 (#38) | The chat goes first: the app's other start-up requests (status, commands, skills, model, settings, plugin routes) wait until it is open; the full status is asked for once, not twice. With them in the same moment, Hermes answered the chat's two requests in about 1.2 s instead of 30–70 ms. | Chat usable at **0.3 s** (`sessions` 1.9 → 0.3 s, `chat-live` 2.0 → 0.3 s, medians of 5 starts). |
| 2026-11-01, long chat (after #38) | — (first row measured with the method below) | A chat of 146 messages (resume reply 209 KB, against about 1 KB for a short one): chat usable at **0.3 s**, the same as a short chat (`script` 0.1 s, `painted` 0.2 s, `sessions` and `chat-live` 0.3 s, medians of 5 starts). Android's `am start -W` `TotalTime`: 130 ms. Hermes's side (`tools/gw-time longest`): `session.resume` 139 ms alone. Scrolling up 15 times: 5 slow frames of 3040 (0.16%), 95th percentile 15 ms, no blank areas or jumps. |
| 2026-11-03 (0.8.73-test), Hermes restarting | — (a different case from the rows above: `hermes-debian --restart`, then the app opened at once; 3 starts) | Hermes's dashboard answers about 18 s after the stop (10 s of that is the service loop's wait). The app connects as it answers: `socket` 18.1–18.3 s, `sessions` 19.3–19.5 s, chat usable (`chat-live`) 20.5–20.8 s. |
| 2026-11-17 (redesign, drawn icons) | Line icons from lucide-react 0.575.0 replace the emoji (only the ~110 used are built in). | Main script gzipped 374.2 → 383.7 kB (+9.4 kB, under the 15 kB limit); whole page file gzipped 2708.5 → 2716.2 kB. Desktop start-up not re-measured; no new work at start-up. |

In short: from a 3–5 s spinner, and 4.5 s to a usable chat in mid-October, to 0.3 s on 2026-11-01.

**Read it as a trend, not a precise series.** Until 2026-11-01 the numbers came from different methods (a stopwatch
on the phone, the app's start-up marks, scripted probes of Hermes, a desktop test with the CPU slowed) and different
conditions (just after installing, warm, after the phone idled for 15 minutes). The app's own start-up marks exist
only since mid-October. From 2026-11-01 on, use the method below so new rows compare with the last ones.

## Other speed work

- **Streaming long replies:** every streamed batch re-parsed the whole message and rebuilt every code
  block, table and diagram; now they are built once per message and the language of an unlabelled code block is
  guessed only when the reply is complete.
- **Long chats** (0.8.37): only the last 40 messages are drawn, 40 more as you scroll up. A 121-message chat scrolled
  to its first message with no blank areas or jumps.
- **Reconnecting** (0.7.76): the bridge's token call no longer blocks the page, so the drawer opens at once with the
  cached chat list while Hermes is still starting.
- **CPU and battery** (2026-10-07): a chat costs roughly half the CPU it did; details in
  [battery-report.md](battery-report.md).

Earlier rows' sources: [improvements.md](improvements.md) (rows 3, 11, 19, 25, 36), `CHANGELOG.md`, and
[status/review-2026-11-01.md](status/review-2026-11-01.md) (items 5 and 11).

## What the interface costs, in a desktop browser at 4x CPU

The redesign may not make five moments slower by more than 5% (`docs/decisions/redesign-costs-no-speed-or-battery.md`).
They are measured with `tools/web-e2e/uicost.cjs --runs 7` (median of 7, CPU slowed 4x, against the mock), the build
before a change and the build after it run in turn on one machine, twice; the table gives both rounds. Time is until
the result shows; work is the main thread's (all tasks) meanwhile. Streaming is `streamcost.cjs 4000 --runs 3` (the
page's main-thread seconds during a 4000-character reply), cold start `coldstart.cjs` (message box visible). Numbers
from `uicost.cjs` compare only with numbers from the same version of it: since glass and motion it taps and times the
chat list, opening a chat and the first words inside the page, which reads lower for every build.

| Date (change) | Moment | Before | After | Change |
|---|---|---|---|---|
| 2026-11-17 (glass and motion, effects on: Glass effects on, Animations Full) | Start-up | 494 / 496 ms, work 472 / 470 ms | 511 / 511 ms, work 487 / 487 ms | +3.2% time, +3.4% work |
| | Opening a chat | 23 / 24 ms, work 32 / 33 ms | 23 / 23 ms, work 31 / 32 ms | none |
| | First words of a reply | 397 / 396 ms, work 34 / 33 ms | 396 / 396 ms, work 35 / 34 ms | none |
| | Scrolling a long chat (90 frames) | work 246 / 242 ms, no frame over 25 ms, p95 16.8 / 16.7 ms | work 256 / 254 ms, no frame over 25 ms, p95 16.8 / 16.7 ms | +4.5% work, same frames |
| | Opening the chat list | 225 / 230 ms, work 19 / 19 ms | 221 / 222 ms, work 18 / 17 ms | −3% |
| | A streamed 4000-character reply | 1.22 / 1.27 s (style 0.04 s) | 1.24 / 1.29 s (style 0.06–0.07 s) | +1.6% |
| | Cold start (message box visible) | 424 ms | 416 ms | none |
| 2026-11-17 (glass and motion, effects off: Glass effects off, Animations Off) | Start-up | 491 / 497 ms, work 467 / 470 ms | 500 / 513 ms, work 476 / 480 ms | +2% |
| | Opening a chat | 23 / 23 ms | 22 / 26 ms | none |
| | First words of a reply | 397 / 397 ms | 394 / 394 ms | none |
| | Scrolling a long chat | work 242 / 245 ms | work 243 / 245 ms | none |
| | Opening the chat list | 219 / 229 ms | 7 / 8 ms (no slide) | instant |
| 2026-11-17 (the composer's tray, effects on; four rounds) | Start-up | 496 / 517 / 515 / 520 ms, work 472 / 495 / 488 / 497 ms | 500 / 514 / 508 / 510 ms, work 475 / 486 / 485 / 486 ms | none |
| | Opening a chat | 23 ms, work 31–33 ms | 23 ms, work 31–33 ms | none |
| | First words of a reply | 395–397 ms | 395–397 ms | none |
| | Scrolling a long chat | work 257–269 ms, no frame over 25 ms | work 254–267 ms, no frame over 25 ms | none |
| | Opening the chat list | 221–230 ms | 221–230 ms | none |
| | A streamed 4000-character reply | 1.71 / 1.72 s | 1.66 / 1.64 s | −4% |
| | Cold start (message box visible) | 404 ms | 399 ms | none |
| 2026-11-17 (the composer's tray, effects off; two rounds) | Start-up | 510 / 507 ms | 507 / 507 ms | none |
| | Opening a chat | 26 / 26 ms | 25 / 22 ms | none |
| | First words of a reply | 396 / 394 ms | 398 / 394 ms | none |
| | Scrolling a long chat | work 252 / 259 ms | work 254 / 250 ms | none |
| | Opening the chat list | 8 ms | 7 ms | none |

The chat list's row stagger and the chat stepping back behind it, measured on their own (opening the list, 4x CPU,
median of 7, two rounds; time until the list is in place with its rows, main-thread work over the 900 ms after the
tap): none 218–222 ms / 22–24 ms; stagger 231–236 ms / 52 ms; stagger without CSS variables 227–230 ms / 47–52 ms;
fade only 228–230 ms / 37–39 ms; step back 223–234 ms / 30 ms; both 230–233 ms / 54–59 ms. No frame over 25 ms in
any of them; each costs more than 5%, so neither is on the chat list (`docs/decisions/glass-and-motion.md`).

The page file gzipped: 2720.6 → 2724.9 kB (`glass.css`, `motion.css`, `motion.ts`, `barinsets.ts`). On the way there,
four things cost style work and were changed (the commit "Glass and motion cost no more style work"): rules ending in
an `:is()` list, a rule for Animations Off that matched every element, the bars' heights as inherited custom
properties (a bar changing height restyled every message), and `:has()` rules that looked at every descendant of the
app (re-checked at each streamed word). The chat list's row stagger and the chat stepping back behind it were left out
(they added about half to the list's work). Not measured here: heat and battery on a phone (`docs/manual-tests.md`,
"Trying the redesign build").

The composer's tray (task 02b): the first build of it rendered the tray open for the new-chat screen at start and then
closed it as the app reopened the last chat, which cost start-up 2–3.5% and opening a chat about 2%; the tray now starts
closed when the app reopens a chat and takes a change that comes with another chat without moving, and the rows above
are measured after that. A closed tray renders nothing; the handle's shimmer runs only while a turn runs (compositor
only, `steps(48)`, off under Reduced and Off). The page file gzipped (`gzip -9`): 2714.5 → 2717.4 kB. Not measured
here: heat and battery on a phone (`docs/manual-tests.md`).

## Adding a measurement

Measure the same way each time, on the phone, with the app build you are testing installed:

1. **Last start-up, five starts.** Open a chat with text only and wait until it is ready. Then five times: force-stop
   the app (`adb shell am force-stop com.omarqaterge.hermesmobile`), wait 5 s, start it, wait 6 s, and read Settings →
   About → **Last start-up**. Write down `script`, `painted`, `sessions` and `chat-live`, and take the median of each.
2. **Hermes's side:** `tools/gw-time` on the same chat (it force-stops the app first). Note the medians of
   `session.list` and `session.resume` alone and in "everything at once".
3. Add a row to the table above: the date and app version, what changed (with the PR), and the medians. Say if
   anything differed from the method (another chat, a phone that had just idled, fewer starts).

No phone model, chat titles or chat text in this file: the repository is public.
