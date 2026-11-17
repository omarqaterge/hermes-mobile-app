# Battery map

Which parts of Hermux use the most battery, ranked, with what was measured and what is still open.
Measured on a real phone (Android 16, 8 cores) on 2026-10-07 with `dumpsys batterystats --charged` and
`/proc/<pid>/stat` CPU ticks (100 ticks = 1 s of one core). See "How to measure" at the end. Round 3 (chats and
cron jobs, with before/after numbers and the benchmark tools) is in `docs/battery-report.md`.

## The one thing to know: proot doubles the cost of Hermes

Everything Hermes does runs inside Termux → proot Debian. proot traces every system call with ptrace, so
each file stat, socket read or timer wakeup costs a round trip through the proot process. Over 17 h on
battery, Termux used 59 min of CPU: `python3` 20 min, `proot` another 20 min (almost all kernel time). So
**any polling inside Hermes costs about twice what it would on a laptop**, and the fixes below are mostly
about polling less.

## Ranked

| # | Part | Where | Cost (measured) | Status |
|---|------|-------|-----------------|--------|
| 1 | **Agent turns** (your chats and scheduled cron jobs): LLM streaming, tool calls, the `hermes:working` wake lock | Hermes in proot, `HermesService.updateWake` | Chat turn with tools: 0.41 CPU-s per second, half of it the app redrawing spinners (2026-10-07) | **Reduced** to 0.22 (see `docs/battery-report.md`): spinners on one 8 Hz tick, less polling during a turn. Self-review is the next lever (your call) |
| 1b | **Cron wake lock** | `HermesService.wakeForCron`, `cron_ticker.py` (plugin folder) | 150 s per alarm, ~19 min/18 h; agent jobs crashed the ticker | **Fixed**: the alarm pokes the ticker, `cron_idle` ends the hold (11–27 s); agent jobs run again |
| 2 | **Dashboard idle polling** (Hermes Desktop's watcher threads, running even with the app closed) | `hermes dashboard`, `tui_gateway` threads | **274 ticks/min before, 126 after** round 2; with the app open 1.13 → 0.74 CPU-s/min in round 3 | **Reduced** by `slow_desktop_watchers` + `slow_background_polls` in `dashboard/plugin_api.py`, and the app's `/api/status` poll (264 ms each) moved from 1 min to 10 min |
| 3 | **Memory sync loop** | `phone/hermes-services` → `hermes_memory_sync.py` every 10 min | ~5.5 s wall per run (starts a whole proot Debian + a network sync), ~6 runs/hour while awake | Open: run it less often, or only after a turn changed memory |
| 4 | **The app's WebView** while open | `web/src`: socket ping 15 s, `/activity` 9 s (3 s while the banner shows something), `/api/status` 10 min (ping 1 min), canvas 6 s while its panel is open | App process 10 ticks/min open and idle, 3 in the background. WebView renderer 3.7 min / 17 h | Fine. Each poll also wakes the dashboard (see 2) |
| 5 | **Screen time in the app** (dark UI, streaming text redraws) | WebView compositing, `web/src/mdsplit.ts` | Part of the phone's screen + display-pipeline cost. A streamed 8,000-character reply: 4.97 s of page work in a desktop browser | **Reduced** to 2.89 s in round 4 (below): only the newest part of a streaming reply is read again. The UI is dark; nothing animates while idle |
| 6 | **Cron ticker** | `cron_ticker.py` in the plugin folder (+ its proot) | 10–14 ticks/min while awake; sleeps with the phone | Fine. Could tick less often (60 s → 120 s) with a small delay to job starts |
| 7 | **HermesService** (status island, notifications, wake alarms) | `android/.../HermesService.java` | 8 alarm wakeups and 19 notification posts in 17 h | Fine. The wake lock is bounded (Battery #35 rules) |
| 8 | **app-keeper loop** | `phone/hermes-services` | One bash `/dev/tcp` probe every 5 min; `am` (a Java VM) only when the service is down | Fine |

### 2. What the dashboard patch changes

The dashboard runs the gateway's poll threads, which were written for Hermes Desktop on a laptop. The app
only listens for `sessions.changed`. Values are raised on `tui_gateway.server`, where the threads read them
on every pass (`bind_module` rebinds them there). Nothing is ever lowered, and the gateway is never imported
by the plugin.

| Poll | Hermes default | Now |
|------|----------------|-----|
| `sessions.changed` (the chat list) | 0.5 s | 2 s (broadcasts were already floored to one per 2 s) |
| `cron.changed` | 1 s | 5 s |
| pet, pairing, platforms, projects, bot relay outbox | 1–2 s | 30 s |
| skin check (on every 0.5 s watcher wake) | 0.5 s | 30 s |
| display lease watcher (`_LEASE_POLL_S`) | 0.5 s | 5 s |
| per-chat kanban and bot-mailbox polls | 5 s | 30 s |
| `/loop` and `/heartbeat` wakeups | 5 s | unchanged |

Still left: the change watcher still wakes every 0.5 s (its `time.sleep(0.5)` is a literal), and each open
chat has a `tui-notif-poller` waiting on a queue with a 0.5 s timeout. Removing those needs a change in
Hermes itself (an event instead of a sleep loop).

## Ideas not done yet (largest first)

1. **Memory sync on change, not on a timer.** The plugin knows when a turn wrote memory (`memory` tool,
   `post_tool_call`). It could touch a marker that the loop checks with a plain `[ -nt ]` test in bash before
   starting Debian. That avoids ~140 proot starts a day.
2. **Cron jobs.** Each run is a full agent turn of several minutes. Merging jobs that run close together, or
   moving hourly jobs to every few hours, saves more than any code change here.
3. **Hermes upstream**: make the change watcher and notification pollers event-driven (or configurable),
   then drop the plugin patch.
4. **Activity polling** (`web/src/activity.ts`): the plugin could push activity over the app's existing
   socket (the service on `127.0.0.1:9121` already receives events) instead of the app polling every 9 s.
5. **Ticker interval** 60 s → 120 s (`WAKE_CHECK` and Hermes's own ticker), if starting a minute late is OK.

## Outside the app (still worth checking on your phone)

- **Leaked `logcat` readers.** An app that reads the clipboard through `logcat` (seen with KDE Connect's
  clipboard sync) can leave a `logcat -T … ClipboardService` process behind every time it restarts. On the
  test phone 15 had piled up over 3 days. They made `logd` copy every log line 15 times: `logd` used ~10% of
  a core around the clock (619 → 36 ticks/min after killing them) and was the 5th biggest battery user.
  Check with `adb shell ps -A -o PID,STIME,ARGS | grep "logcat -T"`. Killing them is harmless; turning off
  that app's background clipboard sync stops new ones.
- **Leftover `adb logcat` sessions** from your own debugging do the same; close them when done.
- **Low free RAM**: when the phone is short of memory, `kswapd` (the kernel's swapper) burns CPU. Hermes in
  proot uses a few hundred MB; closing heavy apps helps more than anything in Hermes.

## Rules learned in round 3

- **Animations cost more than you think on a 120 Hz screen.** Any infinite CSS animation makes the WebView redraw
  every frame (~12 ms of app CPU each); several started at different times never share a frame. Use the shared
  `<Spinner>` tick, and `step-end` for blinks.
- **Ask what a request costs before polling it.** `python3 tools/battery/reqcost.py` (e.g. `/api/status` 264 ms).
- **Never import Hermes's `hermes_bootstrap` from a thread** in our own long-running Hermes processes: it may
  re-exec the process, which kills it under proot (the cron ticker bootstraps in its main thread now).

## Round 4 (2026-11-17): a reply while it streams

No phone was used in this round: the numbers are a desktop browser's (`tools/web-e2e/streamcost.cjs`, Chromium, the
mock streaming 12 characters every 40 ms, about a model's pace), so they compare before with after and say nothing
about milliamps. The phone measurement is still to do (`bench.py chat --via ui` with a prompt that asks for a long
answer; `docs/status/battery-perf-round4.md`).

| Reply | Page work before | After | Change |
|---|---|---|---|
| 2,000 characters (7.7 s turn) | 1.12 s (script 0.76) | 0.83 s (script 0.47) | −26 % |
| 8,000 characters (29.4 s turn) | 4.97 s (script 3.87) | 2.89 s (script 1.43) | −42 % |
| 16,000 characters (55.7 s turn) | 9.61 s (script 7.95) | 4.96 s (script 2.34) | −48 % |

Where it went (CPU profile of the 8,000-character turn, 5.2 s busy): 3.4 s in `react-markdown` for the streaming
reply: reading the whole reply again on each batch (1.8 s), the HTML steps after it (1.1 s), and 0.45 s of
`rehype-highlight` building its 37 language definitions for every drawing.

1. **Parts** (`web/src/mdsplit.ts`, spec 3.3). The reply is cut at the start of top-level blocks; a finished part is
   drawn once and only the last part is read again. The parser decides and checks every cut.
2. **Code colours set up once** (`highlightOnce` in `web/src/rich-entry.ts`). Also saves about 1.5 ms (desktop) for
   every message drawn when a chat opens, once code or math has been seen.

What is left of the 2.89 s: the last part's own Markdown (about 1.1 s), the browser's layout and painting of the new
text (about 1.2 s), React's commit and the store (about 0.5 s). The one lever left is how often text is put on screen
(`flushDeltas`: every 60 ms, 150 ms past 6,000 characters): every 100 ms would save roughly a third more at a
choppier look, which is the owner's call.

Checked in the same round and found fine (no change): the page while idle (0.004 s of work per 5 s, no animation
running) and while a turn waits on a command (0.05 s per 5 s); the plugin's hooks (per model call and tool call, none
per token); `HermesService` timers and the wake lock (bounded as 2.5 says; the approval countdown posts its
notification once a second, for the minute or so an approval lasts); the dashboard's idle polling (what is left needs
a change in Hermes, see above).

## How to measure

Repeatable benchmark (chat via the app or the gateway, cron via a temporary job, idle): `tools/battery/bench.py`,
method in `docs/battery-report.md`. The page alone, without a phone: `tools/web-e2e/streamcost.cjs` (spec 7.3).


```bash
# per-app battery since the last full charge (look for "Estimated power use" and the UID lines)
adb shell dumpsys batterystats --charged > bs.txt
# Termux and the app: find their UIDs, then the "Proc …: CPU" lines under each UID in bs.txt
adb shell pm list packages -U | grep -E "termux|hermesmobile"
# what is awake right now: CPU ticks over 60 s for one process (or /proc/<pid>/task/* for its threads)
adb shell 'cut -d" " -f14,15 /proc/<pid>/stat'; sleep 60; adb shell 'cut -d" " -f14,15 /proc/<pid>/stat'
python3 tools/test_battery.py   # wake-lock, status-loop and watcher checks (last part needs Linux /proc)
```
