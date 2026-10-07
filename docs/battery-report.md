# Battery report: chats and scheduled jobs (2026-10-07)

What a chat turn and a scheduled (cron) job cost on the phone before and after this round, how it was measured,
what each change contributed and what is left. Phone: Android 16, 8 cores, 120 Hz screen, Hermes 0.21.5 in Termux →
proot Debian, provider reached through a local proxy in the dashboard process. The broader map is `docs/battery.md`.

## Before / after

CPU = seconds of CPU time (all cores) for Termux's UID (Hermes's Python + proot) and the app's UID (app + WebView
renderer). Lock = how long the app held the `hermes:working` wake lock. Means of the runs listed under Method.

| Scenario | Metric | Before | After | Change |
|---|---|---|---|---|
| **Chat turn**, app in front, prompt with a terminal call + a file write (≈5 model calls) | CPU per second of turn (app + Hermes) | 0.41 | 0.22 | **−47 %** |
| | app's share, per second | 0.214 | 0.095 | −55 % |
| | CPU for a 34 s turn (before's mean length) | 13.8 s | 7.3 s | −47 % |
| | wake lock after the reply ends | ~1–2 s | ~1–2 s | unchanged (already fine) |
| | wall time | model-bound (25–57 s) | same | — |
| | Hermes alone per turn (gateway-driven, no app drawing) | 5.0 s | 5.2 s (median 4.1) | unchanged: nothing here changes Hermes's turn |
| **Turn waiting on a 45 s command**, app in front | CPU per second of turn | 0.336 | 0.157 | **−53 %** |
| | app's share, per second | 0.248 | 0.100 | −59 % |
| **Scheduled agent job** (fixed prompt, one terminal call) | result | **job lost: the ticker crashed (signal 11) and restarted** | completed (3/3) | fixed |
| | wake lock from the alarm | 150 s | 24 s (21–27) | **−84 %** |
| | CPU of the run | 10.9 s (crash + restart) | 2.8 s (7.7 s for the first job after a ticker start) | — |
| | start after it was due | job lost | ~1–4 s (the alarm pokes the ticker) | — |
| **A 30-min script job** (`no_agent`, a shell script) | wake lock when its alarm fires | 150 s | 11–14 s | **−91 %** |
| | start after it was due | up to 60 s (57 s seen) | 0–1 s | — |
| | CPU of a run | 4–7 s; ~35 s when its slow path runs | same (the script's own work) | — |
| **Idle, app open on a chat** | dashboard CPU per minute | 1.13 s | 0.74 s | **−35 %** |
| | app CPU per minute | 0.08 s | 0.09 s | same |
| **Idle, per thread** (5 min, same conditions) | group-chat driver / per-chat notification poller | 0.59 s / 0.53 s | 0.08 s / 0.23 s | −86 % / −57 % |

What this means over a day, from the 18 h `batterystats` snapshot taken before the changes: `hermes:working` was
held 19 min, almost all of it 150 s cron-alarm holds (9 alarms, max = 150 108 ms). At ~15 s per alarm that becomes
~2–3 min. A chat costs roughly half the CPU it did, and most of the saving is in the app, not in Hermes.

Network per chat turn: ~70–140 KB down, ~180–430 KB up (the whole context goes up with every model call); unchanged.

## Method

Tools in `tools/battery/` (all run from the computer over adb):

- `hmsamp.sh` runs on the phone as the adb shell user (so its own CPU is not counted) and records every ~1.5 s:
  `/proc/<pid>/stat` of every process of Termux's UID and the app's UID, every thread of them, the app's WebView
  renderer (an isolated UID, found through `dumpsys activity`), and whether `hermes:working` is held
  (`dumpsys power`). `hmnet.sh` reads per-UID network bytes from `dumpsys netstats`.
- `hmreport.py` turns a capture into CPU per group: `dash.py`/`dash.proot` (the dashboard, where app chats run),
  `ticker.py`/`ticker.proot` (the cron ticker, where scheduled jobs run), `transient` (other proot sessions such as
  memory sync), `termux.other` (bash loops, sshd, Termux), `app.main`, `app.renderer`; plus the busiest threads.
- `bench.py chat --via ui` sends a fixed prompt as a new chat through the app (share intent + tap on Send) with
  the app in front; `--via ws` drives the same gateway JSON-RPC from the computer (`wschat.py`), no app drawing.
  `--prompt sleep` is a turn that waits on one 45 s command. `bench.py cron` creates a one-shot job due 100 s later
  (the alarm path), measures until the lock is gone + 60 s, then deletes the job and its session. `bench.py idle`.
- `reqcost.py`: what one app request costs the dashboard (CPU ms, idle subtracted).
- Before each run: leaked `logcat -T … ClipboardService` readers killed, no turn running (`/activity`), screen on.

Runs: chat UI A/B with the same Hermes side, old app (0.8.16 web build as 0.8.19) vs new (0.8.20), 3 runs each;
waiting turn 2 runs per variant (smooth spin / stepped CSS / shared tick); cron agent job 1 run on the old ticker,
3 on the new; script job: captures of the real runs at 15:11, 16:12 (before) and 17:44 (after); idle: 3 min of the
first capture (14:55, app open) vs 10 min after all changes, and 5 min per variant for the dashboard patches.
Chats and jobs made by the benchmark were deleted (UI ones with `tools/gw session.delete` after switching the app
to another chat).

Where the time goes (turn with tools, before): app 52 % (RenderThread, GPU, compositor: redrawing spinners),
Hermes 48 % of which about half is proot tracing Python's syscalls. Per request (`reqcost.py`): `/api/status`
264 ms, `session.context_breakdown` 103 ms, `/canvas` 41 ms, `session.list` 23 ms, `/activity` 21 ms, ping 1 ms.

## What each change did

1. **Cron ticker crash** (`phone/cron_ticker.py`, 3712ab0). The ticker ran under the venv Python; the first agent
   job imported Hermes's `hermes_bootstrap` from a worker thread, which re-execs the process into Hermes's own
   interpreter (`os.execv` from a non-main thread) and proot killed it with signal 11. Every agent cron job was lost
   (also on 2026-10-02). The ticker now loads the bootstrap in its main thread at start; faulthandler is on.
2. **Cron wake lock** (`phone/cron_ticker.py`, `HermesService.java`, 3712ab0). The alarm now pokes the ticker on
   127.0.0.1:9122 (Hermes's ticker sleeps on a clock that stops while the phone sleeps, so a job started up to 60 s
   late) and the ticker reports `cron_idle` once no job runs (after re-reporting the next due time), which ends the
   hold. 150 s stays as the upper bound; an agent job's status beats keep the phone awake as before.
3. **Spinners** (`web/src/components/Spinner.tsx`, 5e8947f). Up to four spinners ran smooth CSS spins during a
   turn; on a 120 Hz screen the WebView redrew every frame (~40 fps even when stepped, because they never shared a
   frame). One shared 8 Hz tick turns them all; it stops with the last spinner. Blinking dots step instead of fade.
4. **App polling during a turn** (`canvas.ts`, `activity.ts`, 5e8947f). No canvas poll every 2 s during a turn
   (the canvas tool's completion refreshes it); the activity feed every 3 s only while the banner shows something,
   once right after the open chat's turn ends, else every 9 s.
5. **Health check** (`health.ts`, 8fc26ea). `/api/status` (264 ms of dashboard CPU) ran every minute and on every
   reconnect; now the minute check is a ping and the full status is fetched every 10 min or when the sheet opens.
6. **Dashboard pollers** (`dashboard/plugin_api.py`, d336eac, 71abc30). Group-chat runtime idle poll 5 s → 25 s
   (under its 30 s lease); each live chat's notification poller waits 2.5 s instead of 0.5 s on its queue (a new
   event still wakes it at once). Both are logged once in agent.log ("battery: slowed …").

Verified on the phone: all of the above (numbers in the table), the status sheet ("Checked just now"), agent cron
jobs completing, the poke (jobs start at their due time), the release (`cron_idle` after the run). Tests:
`tools/test_battery.py` (ticker poke/idle/listener, poller patches; full suite on the phone), web unit tests
(`battery.test.ts`, `health.test.ts`), web-e2e (no canvas poll, idle-pace activity during a turn).
Not verified: a deep-sleep (screen off, Doze) alarm on the new code — during the test the phone stayed awake, so
the lock window was measured but not the suspend/resume around it.

## What's left (largest first) and the trade-offs

These change behaviour or your setup, so they are your call; numbers are from this round.

1. **Background self-review** (memory every 10 user turns, skills every 15 tool iterations): ~1 review per 4–5
   turns in your logs, each ≈ a 3-model-call turn (~3–5 s CPU + the full context uploaded 3×). Raising
   `memory.nudge_interval` / `skills.creation_nudge_interval` (or turning reviews off) saves ~15–20 % of chat cost;
   Hermes then learns less from chats.
2. **The 30-min script job** (4–7 s CPU per run, ~35 s on its slow path). It starts several Java processes
   (Android shell helpers) inside proot, where every start is traced. Combining them into one call would roughly
   halve a normal run; running every 60 min halves it again.
3. **Memory sync loop**: ~2 s CPU + a network sync every 10 min while awake (~12 s/h), refused every run (left for
   you). Syncing only after a turn changed memory (the plugin sees `memory` tool calls) would drop most runs, at
   the cost of picking up Mac-side changes later.
4. **File checkpoints** (`HERMES_TUI_CHECKPOINTS=1`): ~10 git processes per edited file per turn.
5. **Smaller items**: chat title generation (one extra model call per new chat), an HTTP MCP server's keepalive (a
   request every 180 s while awake; `keepalive_interval` in its `mcp_servers` entry), the spinner tick (8 Hz; 4 Hz would
   save about half of what's left in the app during a turn, at a choppier look).
6. **Hermes upstream** (no change here): proot doubles every syscall; the dashboard's change watcher still wakes
   every 0.5 s; `context_breakdown` (103 ms) runs after each reply because this provider reports no token usage.

Seen once, not reproduced: after installing the app while the phone was locked, it stayed on "Starting Hermes…"
until restarted (dashboard was up). Doesn't look related to these changes; watch for it.
