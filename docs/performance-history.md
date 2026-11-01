# Performance history

How fast Hermes Mobile gets you to a usable chat, from the first measurements to now, and how to add the next
measurement so the history stays comparable. Battery and background work have their own report:
[battery-report.md](battery-report.md).

## Time to a usable chat after opening the app

"Usable" means the chat you had open is loaded and the message box says "Message Hermes" (before that it says "Opening
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
