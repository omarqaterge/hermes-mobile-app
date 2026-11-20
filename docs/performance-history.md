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

The side panel (task 03), two rounds each, `uicost.cjs --runs 7` at 4x CPU against the build before it (`redesign` at the
start of the task), run in turn on one machine. With effects on (Glass effects on, Animations Full) the sheet opens
with the chat stepping back behind it:

| Date (change) | Moment | Before | After | Change |
|---|---|---|---|---|
| 2026-11-17 (the side panel, effects on) | Start-up | 507 / 511 ms, work 482 / 489 ms | 511 / 519 ms, work 488 / 486 ms | +1% |
| | Opening a chat | 23 / 23 ms, work 34 / 32 ms | 24 / 24 ms, work 34 / 35 ms | +4% time, work within 1 to 3 ms |
| | First words of a reply | 395 / 396 ms, work 34 / 34 ms | 397 / 396 ms, work 34 / 35 ms | none |
| | Scrolling a long chat | work 264 / 263 ms, no frame over 25 ms, p95 16.7 / 16.8 ms | work 261 / 258 ms, no frame over 25 ms, p95 16.7 / 16.7 ms | none |
| | Opening the chat list | 221 / 222 ms, work 18 / 18 ms | 196 / 191 ms, work 20 / 20 ms | −12% time, +2 ms work |
| 2026-11-17 (the side panel, effects off: Glass effects off, Animations Off) | Start-up | 509 / 517 ms | 512 / 512 ms | none |
| | Opening a chat | 26 / 27 ms, work 32 / 34 ms | 25 / 25 ms, work 32 / 31 ms | none |
| | Scrolling a long chat | work 254 / 254 ms | work 250 / 251 ms | none |
| | Opening the chat list | 8 / 8 ms, work 16 / 16 ms | 10 / 11 ms, work 19 / 18 ms | +2 to 3 ms of 8 (three more rows and the bar) |

How the panel got there. The first build of it measured 41 to 47 ms of work opening the list (before: 18), and the chat
stepping back was not the reason (taking it out changed nothing, nor did taking out the bars' loss of blur). Three
things were: the two values the rows show arrived during the slide and re-rendered the whole chat list beside them
(they are read once the slide has ended, and by a component of their own: −18 ms); hiding the closed panel with
`visibility: hidden` made the main thread paint all its rows when it became visible (−5 ms without it); and `inert`
on the closed panel restyled them on every open and close (+5 ms). The panel is therefore off the screen when closed,
as the drawer was. The chat's step back (`scale` on the stage, transform only) costs no measurable work when opening
the list, which the first glass round had found it did (+30%) when it was done differently. Opening a chat from the list
moves the panel away and the chat back to full size meanwhile: 23 → 24 ms. Not measured here: heat and battery on a
phone (`docs/manual-tests.md`).

The chat list's order (task 04): `uicost.cjs --runs 7` at 4x CPU, two rounds each, run in turn against the build before
it (`redesign` at the start of the task) on one machine. `uicost.cjs` gained a moment for this: scrolling the chat list
once it is open (60 frames of 40 px). Both builds were measured with the new script.

| Date (change) | Moment | Before | After | Change |
|---|---|---|---|---|
| 2026-11-17 (chat list order, effects on: Glass on, Animations Full) | Start-up | 491 / 499 ms, work 465 / 476 ms | 493 / 499 ms, work 469 / 477 ms | none |
| | Opening a chat | 30 / 30 ms, work 38 / 37 ms | 29 / 29 ms, work 37 / 38 ms | none |
| | First words of a reply | 394 / 393 ms, work 34 / 32 ms | 394 / 393 ms, work 36 / 36 ms | none (work within 4 ms) |
| | Scrolling a long chat | work 252 / 260 ms, no frame over 25 ms, p95 16.7 ms | work 251 / 251 ms, no frame over 25 ms, p95 16.8 / 16.7 ms | none |
| | Opening the chat list | 189 / 192 ms, work 20 / 20 ms | 193 / 190 ms, work 20 / 21 ms | within 2% |
| | Scrolling the chat list | work 10 / 9 ms, no frame over 25 ms, p95 16.7 / 16.8 ms | work 10 / 9 ms, no frame over 25 ms, p95 16.7 ms | none |
| 2026-11-17 (chat list order, effects off: Glass off, Animations Off) | Start-up | 510 / 506 ms | 510 / 509 ms | none |
| | Opening a chat | 30 / 30 ms, work 37 / 38 ms | 30 / 30 ms, work 37 / 38 ms | none |
| | Scrolling a long chat | work 256 / 262 ms | work 257 / 260 ms | none |
| | Opening the chat list | 194 / 191 ms, work 19 / 20 ms | 192 / 192 ms, work 21 / 21 ms | time none, +1 to 2 ms work |
| | Scrolling the chat list | work 9 / 10 ms | work 11 / 9 ms | none |

Opening the list with nothing changed renders nothing new: the snapshot finds the same times and stops. When a message
has moved a chat since the last look, the open renders the list once in its new order, in the same frame as the open
(so the rows are in place before they show): measured on the new build alone (a scratch script, the same in-page timing,
7 runs each, effects on), 222 ms / 21 ms of work with nothing moved and 230 ms / 28 ms after a message moved one chat
(+3.6% time, +7 ms work, only on those opens). The build before had no such open: it never re-sorted. On this run's
machine, Animations Off still measured about 190 ms to open the list on both builds (the side panel's own row above
measured 8 to 11 ms); the two builds agree, so the difference is in the machine or the moment's timing, not this change.
Not measured here: heat and battery on a phone (`docs/manual-tests.md`).

The chat menu (task 05): `uicost.cjs --runs 9` at 4x CPU, two rounds each, run in turn against the build before it
(`redesign` at the start of the task) on one machine, with the options as separate words (`--motion off --glass off`).
`uicost.cjs` gained two moments for this: opening a row's menu in the open chat list and opening the chat's menu from the
header, each until the sheet is on the page and none of its animations still runs. Both builds were measured with the
new script.

| Date (change) | Moment | Before | After | Change |
|---|---|---|---|---|
| 2026-11-17 (chat menu, effects on: Glass on, Animations Full) | Start-up | 511 / 518 ms, work 487 / 493 ms | 513 / 517 ms, work 490 / 494 ms | none |
| | Opening a chat | 32 / 32 ms, work 40 / 40 ms | 31 / 32 ms, work 41 / 41 ms | none |
| | First words of a reply | 394 / 394 ms | 394 / 396 ms | none |
| | Scrolling a long chat | work 274 / 274 ms, no frame over 25 ms | work 270 / 273 ms, no frame over 25 ms | none |
| | Opening the chat list | 197 / 197 ms, work 22 / 22 ms | 194 / 196 ms, work 23 / 21 ms | none |
| | Scrolling the chat list | work 10 / 12 ms | work 10 / 11 ms | none |
| | Opening a row's menu | 411 / 425 ms, work 24 / 23 ms | 426 / 411 ms, work 24 / 26 ms | time none (both builds land on 411 or 426 ms: the spring's last frame), work +0 to 3 ms |
| | Opening the chat's menu | 424 / 425 ms, work 27 / 26 ms | 426 / 412 ms, work 30 / 28 ms | time none, work +2 to 3 ms |
| 2026-11-17 (chat menu, effects off: Glass off, Animations Off) | Start-up | 509 / 507 ms | 503 / 509 ms | none |
| | Opening a chat | 28 / 29 ms | 28 / 28 ms | none |
| | Scrolling a long chat | work 262 / 264 ms | work 255 / 259 ms | none |
| | Opening the chat list | 11 / 11 ms, work 20 / 19 ms | 11 / 11 ms, work 19 / 19 ms | none |
| | Opening a row's menu | 10 / 10 ms, work 13 / 13 ms | 12 / 12 ms, work 15 / 15 ms | +2 ms |
| | Opening the chat's menu | 10 / 10 ms, work 12 / 13 ms | 11 / 11 ms, work 14 / 14 ms | +1 ms |

Where the menus' extra milliseconds go, from a trace of 15 opens each (Animations Off, glass off, 4x CPU; the main
thread's tasks from the tap to two frames later): a row's menu 11.9 ms before, 12.2 ms after (the same within the
trace's noise: it holds the same rows as before plus the header's Rename button); the chat's menu 12.0 ms before,
14.2 ms after (script +0.9 ms, style +0.3 ms, layout and paint about +0.6 ms), which is the content the menu gained:
four quick-action tiles and three groups instead of one list of nine rows. The menu shows within the same frame on both
builds; at 4x CPU the difference is 1 to 2 ms out of 10, on a phone well under one frame. The first build of the menus'
CSS had four rules ending in an `:is()` list (tested against every element at every restyle); they are plain selector
lists now.

**Animations Off and the chat list.** Task 04's "effects off" rows (about 190 ms to open the list, where tasks 02a and
03 had 7 to 11 ms) did not measure Animations Off: on `redesign` before this task, the same script with `--motion off
--glass off` opens the list in 11 ms (above), and the panel's slide is instant under Off (`panel.css` takes its length
from `--motion-base`, 0 ms under Off, and `motion.css` names `.drawer` and `.drawer-backdrop` in its Off list). The
190 ms is the list's slide under Animations Full: `uicost.cjs` reads `--motion` and `--glass` as separate words, and when
they reach it as one word (a quoted `"--motion off --glass off"`, as happened in this task's first try) it applies
neither and prints no "motion off, glass off" in its median line, so the page runs with the app's own defaults (Full,
glass on). Not measured here: heat and battery on a phone (`docs/manual-tests.md`).

The Settings main page (task 06): `uicost.cjs --runs 7` at 4x CPU, two rounds each, the build before (`redesign` at
the start of the task) and the build after run in turn on one machine, with the options as separate words. `uicost.cjs`
gained the moments for this: opening Settings from the side panel's gear (until the search box shows and nothing on it
moves), then each page from its row on the main page (until the page's own first row shows and is still): Behaviour
(found by its old name "Hermux settings" on the build before), Models, Access & privacy and About & help (pages only the
new build has). Both builds were measured with the new script.

| Date (change) | Moment | Before | After | Change |
|---|---|---|---|---|
| 2026-11-18 (Settings main page, effects on: Glass on, Animations Full) | Start-up | 493 / 498 ms, work 468 / 474 ms | 502 / 512 ms, work 480 / 488 ms | +2 to 3% (Settings is not drawn at start-up; the new CSS file is the only change on this path) |
| | Opening a chat | 34 / 30 ms, work 39 / 37 ms | 30 / 31 ms, work 38 / 39 ms | none |
| | First words of a reply | 394 / 394 ms | 394 / 393 ms | none |
| | Scrolling a long chat | work 255 / 261 ms, no frame over 25 ms | work 257 / 268 ms, no frame over 25 ms | +1 to 3% |
| | Opening the chat list | 196 / 193 ms, work 21 / 22 ms | 191 / 196 ms, work 21 / 22 ms | none |
| | Opening a row's menu / the chat's menu | work 24 / 24 and 28 / 28 ms | work 23 / 24 and 28 / 30 ms | none |
| | **Opening Settings** | 447 / 433 ms, work 67 / 68 ms | 433 / 432 ms, work 60 / 55 ms | −1 to 3% time, **−10 to 19% work** |
| | **Opening Behaviour** | 41 / 42 ms, work 55 / 54 ms | 44 / 44 ms, work 60 / 60 ms | **+5 to 7% time, +9 to 11% work** (see below) |
| | Opening Models / Access & privacy / About & help (new) | – | 3 / 3, 5 / 5, 6 / 7 ms; work 7 / 7, 9 / 9, 10 / 11 ms | new pages |
| 2026-11-18 (Settings main page, effects off: Glass off, Animations Off) | Start-up | 494 / 540 ms | 529 / 523 ms | none (noisy on both) |
| | **Opening Settings** | 28 / 30 ms, work 32 / 34 ms | 23 / 22 ms, work 26 / 27 ms | **−20% work** |
| | **Opening Behaviour** | 39 / 48 ms, work 51 / 57 ms | 55 / 55 ms, work 64 / 64 ms | **+12 to 25% work** (see below) |
| | Opening Models / Access & privacy / About & help (new) | – | 4 / 3, 5 / 5, 7 / 7 ms; work 6 / 6, 8 / 8, 10 / 10 ms | new pages |

**Opening Behaviour is over the 5% limit, and the cause is not found.** Opening Settings and then Behaviour costs the same
main-thread work in total on both builds (effects on: 122 / 122 ms before, 120 / 115 ms after; effects off: 83 / 91 ms
before, 90 / 91 ms after): the work moved from the main page, which is much shorter now, to Behaviour. A timeline trace of
the whole move to Behaviour until nothing on it moves (5 runs each, all the main thread's tasks) gives 79.6 ms before and
80.3 ms after (+1%): a little more layout and paint (Behaviour now starts with Replies and has three more rows: Dynamic
UI, "See what Hermux remembers", Advanced settings) and a little less script. Tried, each measured against the build
before in alternating rounds of 9 (the extra ~6 ms of work held in every round): the Dynamic UI answer redrawing only its
section (`RepliesSection`, kept: simpler, no measurable change); the build without `settings.css` (no change); without
the three new rows (about 2 ms of the 6); without their icons (no change); without the attention cards (no change); the
main page asking the plugin for Dynamic UI ahead, as the old main page did, so Behaviour draws once (no change,
reverted). At 4x CPU the difference is 5 to 7 ms of work on one tap that happens rarely; on a phone it is about one
frame. Left for the owner to decide (task 06's PR). Not measured here: heat and battery on a phone
(`docs/manual-tests.md`).

One Models page and Add a provider (task 07): `uicost.cjs --runs 7` at 4x CPU, the build before (`redesign` at the
start of the task) and the build after served in turn on one machine, two rounds each with effects on (the app's
defaults: Glass on, Animations Full) and one each with `--motion off --glass off`. `uicost.cjs` now times Models until
its last row, All keys, shows (both builds have it) and gained one moment: from Models, its gold Add a provider until
the catalog's "Use an API key" section shows and is still (only the new build has it).

| Date (change) | Moment | Before | After | Change |
|---|---|---|---|---|
| 2026-11-18 (one Models page, effects on) | Start-up | 490 / 505 ms, work 466 / 480 ms | 493 / 494 ms, work 464 / 473 ms | none |
| | Opening a chat | 30 / 31 ms, work 39 / 40 ms | 31 / 31 ms, work 39 / 40 ms | none |
| | First words of a reply | 393 / 402 ms | 393 / 394 ms | none |
| | Scrolling a long chat | work 265 / 253 ms, no frame over 25 ms | work 256 / 251 ms, no frame over 25 ms | none |
| | Opening the chat list | 190 / 188 ms, work 21 / 22 ms | 191 / 195 ms, work 21 / 21 ms | none |
| | Opening a row's menu / the chat's menu | work 24 / 25 and 32 / 30 ms | work 25 / 24 and 30 / 28 ms | none |
| | Opening Settings | 430 / 432 ms, work 44 / 59 ms | 430 / 428 ms, work 46 / 60 ms | none (noisy on both) |
| | **Opening Models** | 3 / 3 ms, work 7 / 7 ms | 9 / 8 ms, work 12 / 12 ms | **+5 ms work** (see below) |
| | Opening Add a provider (new) | – | 23 / 24 ms, work 26 / 26 ms | new page |
| 2026-11-18 (one Models page, effects off) | Start-up | 488 ms, work 464 ms | 488 ms, work 464 ms | none |
| | Opening Settings | 21 ms, work 24 ms | 22 ms, work 25 ms | none |
| | **Opening Models** | 3 ms, work 6 ms | 8 ms, work 12 ms | **+6 ms work** |
| | Opening Add a provider (new) | – | 24 ms, work 23 ms | new page |

**Opening Models is over the 5% limit, by design of the task.** The page before was three rows that opened two other
pages; it now holds what those pages held: the model row, the Connected rows from the provider catalog, the fold row of
the fallback list (whose config is read for its count) and the bot chips with several bots. The old way to the same
content was Models, then Model providers (about 25 ms, the cost of Add a provider now), so reaching the providers costs
less than before; the Models page alone costs about 5 ms more of work at 4x CPU, under one frame on a phone. Hermes is
asked once more each time Models opens (`setup.runtime_check`, the same question the main page asks), off the main
thread. Left for the owner to judge (task 07's PR). Not measured here: heat and battery on a phone
(`docs/manual-tests.md`).

"Needs you" (task 08, measured again after two rounds of review): `uicost.cjs --runs 7` at 4x CPU, the build before
(`redesign` at the start of the task) and the build after served in turn on one machine, two rounds each with effects on
(the app's defaults) and two each with `--motion off --glass off`. Each cell gives the two rounds. No chat was waiting in
these runs, which is the usual state; the group's own cost with a chat waiting (one or two more rows) was not timed.

| Date (change) | Moment | Before | After | Change |
|---|---|---|---|---|
| 2026-11-18 (Needs you, effects on) | Start-up | 489 / 494 ms, work 467 / 472 ms | 494 / 500 ms, work 472 / 478 ms | +1% |
| | Opening a chat | 30 / 30 ms, work 38 / 38 ms | 30 / 30 ms, work 36 / 39 ms | none |
| | First words of a reply | 392 / 394 ms, work 32 / 34 ms | 392 / 394 ms, work 34 / 36 ms | same time, +2 ms work |
| | Scrolling a long chat | work 248 / 242 ms, no frame over 25 ms | work 244 / 237 ms, no frame over 25 ms | none |
| | Opening the chat list | 198 / 193 ms, work 22 / 21 ms | 194 / 191 ms, work 21 / 20 ms | none |
| | Scrolling the chat list | work 10 / 10 ms, no frame over 25 ms | work 10 / 7 ms, no frame over 25 ms | none |
| | Opening a row's menu / the chat's menu | work 24 / 22 and 27 / 25 ms | work 23 / 24 and 27 / 25 ms | none |
| | Opening Settings | 433 / 431 ms, work 58 / 56 ms | 432 / 431 ms, work 58 / 58 ms | none |
| 2026-11-18 (Needs you, effects off) | Start-up | 490 / 489 ms, work 467 / 466 ms | 493 / 496 ms, work 469 / 472 ms | +1% |
| | Opening a chat | 26 / 28 ms, work 33 / 34 ms | 27 / 27 ms, work 34 / 34 ms | none |
| | First words of a reply | 401 / 397 ms, work 27 / 28 ms | 397 / 399 ms, work 27 / 27 ms | none |
| | Scrolling a long chat | work 241 / 238 ms, no frame over 25 ms | work 237 / 235 ms, no frame over 25 ms | none |
| | Opening the chat list | 11 / 11 ms, work 19 / 18 ms | 11 / 10 ms, work 18 / 19 ms | none |
| | Opening a row's menu / the chat's menu | work 14 / 14 and 13 / 13 ms | work 15 / 15 and 14 / 13 ms | +1 ms at most |

Everything is inside the 5% limit except the first words' work with effects on, 2 ms over about 33 ms (6%), with the time
to the words unchanged. With effects off the same moment shows no rise, and the earlier measurement of this task showed none
with effects on, so it reads as noise. The earlier measurement's +5% for scrolling a long chat with effects off did not come
back (241 / 238 before, 237 / 235 after). Not measured here: heat and battery on a phone (`docs/manual-tests.md`).

## Sub-agents in the chat and the chat list (redesign task 09, 2026-11-19)

`tools/web-e2e/uicost.cjs`, desktop browser, 4x CPU slowdown, 5 runs per round, two rounds each, on the final code. "Before"
is `redesign` without the sub-agent work. The two builds were served side by side and measured in turn (before, after, after,
before), so that a machine drifting over the hour falls on both. Main-thread work in ms for round 1 / round 2. The new
moments have ten sub-agents running, each reporting a new step five times a second, with their group open in the chat and
their rows open in the list.

| Moment | Effects on, before → after | Effects off, before → after | Change in work |
|---|---|---|---|
| Start-up | 457 / 469 → 469 / 470 | 463 / 464 → 464 / 475 | **+1%** both |
| Opening a chat | 38 / 39 → 37 / 35 | 34 / 35 → 32 / 33 | -6% both |
| First words of a reply | 35 / 37 → 33 / 33 | 27 / 29 → 26 / 26 | -8%, -7%; time unchanged (about 395 ms) |
| Scrolling a long chat | 254 / 253 → 250 / 247, no frame over 25 ms | 237 / 239 → 238 / 242, none | -2%, +1% |
| The same, ten sub-agents | 325 / 325, no frame over 25 ms, p95 16.7 to 16.8 ms | 299 / 307, none, p95 16.7 ms | as smooth as with none; 26 to 31% more work |
| Opening the chat list | 21 / 20 → 19 / 21 | 18 / 18 → 19 / 19 | -2%; **+6% off (1 ms)** |
| Scrolling the chat list | 11 / 11 → 9 / 11, none over 25 ms | 9 / 9 → 9 / 8, none | -9%, -6% |
| The list, ten sub-agents | 86 / 87, no frame over 25 ms, p95 16.8 ms | 79 / 81, none, p95 16.7 to 16.8 ms | smooth; about 80 to 90 ms of work in the 1 s scroll |
| A row's menu | 24 / 22 → 23 / 22 | 15 / 14 → 15 / 14 | -2%, none |
| The chat's menu | 27 / 27 → 27 / 26 | 14 / 13 → 14 / 13 | -2%, none |
| Settings | 47 / 59 → 45 / 45 | 25 / 24 → 24 / 24 | -15% (one slow "before" round), -2% |
| Behaviour | 57 / 58 → 57 / 56 | 57 / 55 → 54 / 53 | -2%, -4% |
| Models | 12 / 12 → 12 / 12 | 11 / 11 → 12 / 11 | none, +5% (under 1 ms) |
| Add a provider | 25 / 26 → 25 / 25 | 23 / 23 → 24 / 23 | -2%, +2% |
| Access & privacy | 9 / 9 → 9 / 9 | 8 / 8 → 8 / 8 | none |
| About & help | 11 / 10 → 11 / 11 | 10 / 9 → 10 / 9 | +5% (under 1 ms), none |

**Start-up, measured more closely.** One page load of each build in turn, 15 times, median of main-thread work: effects off
471.5 → 474.2 ms, effects on 477.1 → 480.0 ms, so **+0.6%, about 3 ms at 4x**. Before the split the same measurement gave +5.6
and +4.9 ms. The first measurement of this feature said +5 to +9%. Most of that was work every chat row did, since removed,
and the rest was drift between a "before" run and a later "after" run.

**The split.** The rows, the sheet and their styles are now a lazy bundle (`hm-subagents`, about 20 KB as text in the page) that
runs when a chat has sub-agents on screen. The script that runs at every start grew by 19.9 KB instead of 32.2 KB, and its
styles by 0.4 KB instead of 4.2 KB. What remains at every start is what a chat needs to receive sub-agent events and to draw
the group's line.

**Opening Behaviour** was reported as +9 to +13%. It was drift, not a cost: this work doesn't touch the page, and with the builds
measured in turn (11 loads each) it took 51.2 → 52.6 ms with effects off and 53.9 → 53.1 ms with effects on, in both directions
within about 3%.

**Still over 5%, all by about a millisecond.** In work: opening the chat list with effects off (18 → 19 ms in both rounds, so
probably real; its cause was not looked into further, and with effects on the list shows no rise), Models with effects off and
About & help with effects on (each under 1 ms, within the rounding of whole milliseconds). In time until the result shows, the
same size: the chat list with effects off (10 → 11 ms), Add a provider with effects on, Models with effects off, Access &
privacy with effects on (about 5.5 → 7 ms) and About & help (6 to 7 ms). Not measured: the one-time run of the bundle when the
first sub-agent appears, and heat and battery on a phone (`docs/manual-tests.md`).

**Again after the second security review (2026-11-20).** Its fixes touch opening a chat and the chat list (every id a
chat had counts), so the same measurement was repeated against `redesign`, the same way. The script that runs at every
start is now 22.2 KB larger than `redesign` (2.3 KB of it from these fixes). Start-up, 15 alternating loads: effects off
474.4 → 477.9 ms (+0.7%), effects on 478.7 → 484.7 ms (+1.3%); in the rounds +1% and +2%. Opening a chat -4 to -7%, the
chat list's scroll with effects on unchanged. Ten sub-agents: no frame over 25 ms and p95 16.7 to 16.8 ms in the chat and
the list; work in the chat's scroll 348 / 349 ms with effects on (325 before these fixes, against a `redesign` that also
measured 2 to 3% higher this time) and 297 / 295 with effects off, in the list 93 / 87 and 79 / 79. Over 5%, all by about
a millisecond: opening the chat list with effects off (17.5 → 19 ms of work, the same rise as before), its scroll with
effects off (8 → 8.5 ms), Models with effects off (under 1 ms), and in time Access & privacy with effects off (6 → 6.5 ms).

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
