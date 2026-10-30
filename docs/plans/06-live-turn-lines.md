# 06: Elapsed timer and goal line under the chat

Read [README.md](README.md) first.

## Goal

Two things that say what Hermes is doing right now, shown in the status area above the composer:

1. **Elapsed time** of the running turn in the status line: `⟳ Searching the web… · 1:23 · ~41 tok/s · ctx 12%`.
   It survives reopening the chat (Hermes reports when the turn started).
2. **Goal line** when the chat has a goal set (Hermes's `/goal`): `🎯 Ship the login fix · turn 3 of 20 · active`.
   Tapping it opens a sheet with the goal's details and **Pause**/**Resume** and **Clear** buttons.

T3 Code: `apps/web/src/components/chat/AgentElapsed.tsx` (live elapsed timer), `ThreadNow.tsx` and
`ThreadActivityBanners.tsx` (lines at the end of the timeline: goal, background work, what needs you).

## What exists today

- `StatusBar` in `web/src/App.tsx`: while running shows a spinner, the status text, `~N tok/s` and `ctx N%`, plus the
  Tasks line (todos).
- `gateway.ts`: `case 'message.start'` resets the stream counters; `baseActive(r, storedId)` builds the active chat
  from `session.create`/`session.resume` results. `SessionResumeResult` has `turn_started_at` (epoch **seconds**, or
  null when idle; hermes-agent `tui_gateway/server.py::_turn_started_at`).
- Gateway contract (`web/vendor/hermes-shared/gateway-contract.generated.ts`):
  - RPC `session.control.read` `{ session_id }` → `{ control: SessionControlSnapshot }` with
    `goal: GoalSnapshot | null` (`title`, `status`, `turns_used`, `max_turns`, `contract.{outcome, verification,
    constraints, boundaries, stop_when}`, `subgoals`, `paused_reason`, `last_verdict`, `last_reason`).
  - RPC `session.control` `{ session_id, action, args? }` with actions `goal.pause`, `goal.resume`, `goal.clear`
    (hermes-agent `tui_gateway/methods_session_control.py`).
  - Event `session.control.update` `{ control: SessionControlSnapshot }`: sent when goal/loop/heartbeat state changes.
- `ActiveSession` (`store.ts`) holds per-chat live state; add fields there.

## Design

**Elapsed**
- `ActiveSession.turnStart: number | null` (ms). Set to `Date.now()` on `message.start` if not set yet for this turn,
  and to `turn_started_at * 1000` from a resume of a running chat. Set to null when `running` becomes false.
  Note: Hermes may send `message.start` more than once per turn (after tools), so only set it when it is null.
  Also set it in `sendPrompt` right where `running: true` is set (the clock starts at send).
- Display `m:ss` (`h:mm:ss` from one hour) after the status text, from 3 seconds on.
- The 1-second ticker runs only while `running` is true **and** `document.visibilityState === 'visible'`, and stops by
  itself otherwise (battery rule). Put it in a small `useElapsed(turnStart)` hook that clears its interval on unmount
  and on `visibilitychange` to hidden.
- When the turn ends, the reply's `meta` (`finishTurnStats` in `gateway.ts`) gains the total: `~41 tok/s · 1m 23s ·
  ctx 12%`. Keep the order tok/s, time, ctx. Stored stats (`saveStat`) carry it automatically since `meta` is a string.

**Goal line**
- `ActiveSession.goal: GoalSnapshot | null`. Load it with `session.control.read` after a chat is created/resumed
  (don't block opening; fire and forget, ignore errors: older Hermes builds may not have the RPC), and update it from
  `session.control.update` events for the open chat (`ev.session_id` matches runtime or stored id, like other events).
- Show the line under the status line (also when not running) when `goal` is set and `goal.status` isn't `cleared`
  or `done`-like. Copy: `🎯 {title} · turn {turns_used} of {max_turns} · {status}`; when `paused_reason`:
  `paused: {paused_reason}`.
- Tap → sheet `Goal`: title, status, the contract fields that are non-empty (label: value), subgoals as a list,
  `last_verdict` / `last_reason`, then buttons: **Pause** (when active) or **Resume** (when paused), **Clear goal**
  (asks `confirmDialog({ title: 'Clear this goal?', confirmLabel: 'Clear' })`). Each calls `session.control` with
  the matching action, then re-reads with `session.control.read` and toasts errors with `errText`.

## Implementation steps

1. `store.ts`: add `turnStart: number | null` and `goal: GoalSnapshot | null` to `ActiveSession` (import the type
   from the generated contract). Initialise both in `baseActive` (`gateway.ts`) and anywhere else an
   `ActiveSession` literal is built (search for `attachments: []` to find them; TypeScript will flag missing fields).
2. `gateway.ts`:
   - `baseActive`: `turnStart: running && resumed.turn_started_at ? resumed.turn_started_at * 1000 : null`.
   - `message.start`: `updateActive(a => ({ running: true, tps: null, turnStart: a.turnStart ?? Date.now() }))`.
   - Wherever `running: false` is set for the open chat (`message.complete`, failed sends, `syncRunning`), also set
     `turnStart: null`. Simplest: in `updateActive`/`setState` callers you can't miss; or derive: add one `subscribe`
     listener that clears `turnStart` when `running` is false (keep it simple and explicit; prefer the explicit edits).
   - `finishTurnStats`: compute `secs = (Date.now() - turnStart) / 1000` **before** `turnStart` is cleared (pass it in
     as a parameter from the `message.complete` case), format with the same rules as `fmtDuration` in `ChatItems.tsx`
     (move that function to `text.ts` and export it so both use one copy).
   - New `export async function loadGoal(): Promise<void>` and `export async function goalAction(action: 'goal.pause' | 'goal.resume' | 'goal.clear'): Promise<void>`.
   - Call `void loadGoal()` at the end of `resumeSession` and `newSession` success paths.
   - In `client.onEvent`'s switch: `case 'session.control.update': updateActive(() => ({ goal: (payload as SessionControlUpdatePayload).control?.goal ?? null })); break`.
3. `App.tsx`: in `StatusBar`, add the elapsed text and the goal line; show the bar when `running || todos.length || goal`.
   New `GoalSheet` component (in `web/src/components/Sheets.tsx`, next to the other sheets). Open it with local state
   in `StatusBar` (it's not one of the `state.sheet` sheets) and close with `useBackHandler`.
4. CSS: `.goal-line` like `.todos-head`; `.status-elapsed` (tabular numbers: `font-variant-numeric: tabular-nums`).

## Edge cases

- A goal running "continuations" without user messages: `running` toggles per continuation; the timer restarts for
  each turn. Fine.
- The phone sleeps during a turn: the ticker stops (page hidden); when visible again the next tick shows the right
  time because it's computed from `turnStart`.
- `turn_started_at` missing (older Hermes): fall back to the moment the chat was opened, and show nothing for the
  first 3 seconds anyway.

## Tests

**Unit**: move `fmtDuration` to `text.ts` and test it (0.85 s, 3.2 s, 65 s, 3700 s); a pure `fmtClock`-like
`fmtElapsed(ms)` for `m:ss`/`h:mm:ss` (note: `voice.ts` already has `fmtClock`; reuse it if it fits, else don't add a
near-duplicate without a reason).

**Mock**:
- `session.control.read`: return `{ control: { goal: { title: 'Ship it', status: 'active', turns_used: 3, max_turns: 20, contract: { outcome: 'Login works' }, subgoals: ['tests'], gates: [] }, loop: null, heartbeat: null, revision: 'x', updated_at: 0 } }`
  only for one stored chat (e.g. a new `s-goal` in `session.resume`); `{ control: { goal: null, … } }` otherwise.
- `session.control`: log it and answer `{}`; for `goal.pause` emit `session.control.update` with `status: 'paused'`,
  `paused_reason: 'by user'`.
- `s-run` already resumes as running: add `turn_started_at: Date.now() / 1000 - 75` to its resume result.

**E2E**:
1. Open `s-run`: the status line shows an elapsed time of at least `1:15` (regex `/1:1[5-9]/`).
2. Send `slow reply` (plan 02's mock; add it if missing): the reply's meta contains a duration like `1s` or `1.5s`.
3. Open `s-goal`: `.goal-line` contains `Ship it` and `turn 3 of 20`; tap → sheet shows `Login works`; Pause →
   `session.control` called with `goal.pause`; the line now says `paused: by user`.
4. Other chats show no `.goal-line`.

## Spec and changelog

- `docs/SPEC.md` 3.2 status bar row (elapsed, goal line), new "Goal sheet" under 3.5, 2.6 gateway RPC table
  (`session.control.read`, `session.control`), events list (`session.control.update`), 2.5 battery (the ticker's
  bounds).
- `CHANGELOG.md` entry.

## Out of scope

Loops and heartbeats (`LoopSnapshot`, `HeartbeatSnapshot`) and background processes (`process.list`): possible later
lines in the same place. Editing the goal's contract.
