# 04: Night shift

Read [README.md](README.md) first (job kinds, device triggers, unattended runs).

**Effort:** L. **Areas:** Java, plugin, web. **Depends on:** device triggers.

## Goal

The user hands Hermux work that can wait: "research these five laptops and write a comparison", "tidy the Downloads
folder list", "build the first version of that page". It runs **when the phone is charging on Wi-Fi during the
night window**, one task after the other, and the user finds one report in the morning. Heavy work stops costing
battery and mobile data during the day.

## What exists today

- The queue for messages typed while Hermes works (`queue.ts`), the outbox, scheduled jobs with a wake alarm.
- No job condition of any kind: jobs fire on time only.
- `HermesService` holds the CPU only while a turn sends status beats or a cron alarm is due (spec 2.5).

## Owner decisions needed

1. **The window.** Recommended default 23:00–06:00, changeable; "charging" and "Wi-Fi (unmetered)" both required,
   with a switch to drop the Wi-Fi rule.
2. **Approvals at night.** Nobody is there to allow a command. Recommended: night tasks run with Hermes's
   `approvals.cron_mode` as the user has it; a task that needed an approval it couldn't get ends as "Needs you" and
   offers **Run now** in the morning. No new way to pre-approve.
3. **How many.** Recommended: at most 5 tasks a night, each under the user's "Time budget per reply"; the whole shift
   ends at the window's end or after 3 hours of work, whichever is first.

## Design

### Queueing a task

- Composer: long-press on Send opens a small menu (`PickerSheet`): **Send now**, **Run tonight**. Also the slash
  command `/tonight <text>`.
- A queued task: `{ id, text, profile, model, cwd, attachments (paths already uploaded), made, state: "waiting" |
  "running" | "done" | "failed" | "needs_you", chat, note }` in `~/.hermes/mobile/night.json`. At most 10 waiting.
- The chat shows nothing; a toast says "Saved for tonight" with **View**.

### The trigger (native)

The agent must not be able to start its own unattended work by editing a file, so the app decides when a shift
starts (README, "Device triggers").

- The page tells the app how many tasks wait and the window: bridge `nightPlan(key, count, fromMin, toMin, needWifi)`.
  `Triggers` stores it.
- While `count > 0`, `HermesService` registers the power receiver and the unmetered-network callback. When
  **charging and (unmetered or not needed) and inside the window** has held for 2 minutes (one `postDelayed`), it
  calls the plugin's `POST /night/start` over the verified local connection, then holds the cron wake lock the usual
  way (the plugin answers with a `wake_at` of now and the ticker's `cron_idle` releases it).
- If the phone is plugged in before the window opens, one inexact alarm at the window's start re-evaluates. No
  repeating alarm.
- Unplugged or Wi-Fi lost: the service calls `POST /night/pause`. The task that is running finishes (it is bounded by
  its budget); no further task starts.
- When `count` reaches 0 the receiver and callback are unregistered.

### Running

`night.py`:

- `start` takes the oldest waiting task and creates a Hermes one-shot job (kind `night`) for "now" with the task's
  text, model and working folder. One at a time: the next starts from `on_session_end` of the previous, if not
  paused and inside the limits of decision 3.
- The run's chat is an ordinary chat with source `cron`, linked from the task as `chat`.
- End states: `done`; `failed` (with the error's first line); `needs_you` when the run ended on a refused approval
  (detected from Hermes's refusal text for cron approvals: Check first).
- No notification per task. When the shift ends (queue empty, paused at the window's end, or the limits), one `cron`
  event: title "Night shift", body "3 done, 1 needs you". It is posted silently (the existing channel's low
  importance) so it doesn't wake the user.

### Screen

`NightScreen` (`web/src/components/Night.tsx`), from a hub card "🌙 Night shift: 2 waiting" (hidden while nothing
waits and nothing ran in the last day):

- **Waiting:** rows with the text, drag handle to reorder (`order.ts` has the pattern), ✕ to remove, tap to edit.
- **Last night:** rows with a state tag; tap opens the run's chat. `needs_you` and `failed` rows have **Run now**,
  which sends the text as a normal message in a new chat.
- Header: "Runs while charging on Wi-Fi, 23:00–06:00" opens the settings sheet.
- A "Start now" button, shown only while charging, starts the shift regardless of the window.

Routes: `GET /night`, `POST /night` (add), `PUT /night/{id}`, `DELETE /night/{id}`, `PUT /night/order`,
`POST /night/start`, `POST /night/pause`.

## Build steps

1. `Triggers.java` with the night rule as pure logic (`shouldStart(now, charging, unmetered, plan, heldMs)`),
   `tools/test_triggers.sh`.
2. `HermesService`: receiver, network callback, the 2-minute hold, the window alarm; `MainActivity.Bridge.nightPlan`
   and `secure-bridge.ts`.
3. `night.py`, `tools/test_night.py`.
4. `web/src/night.ts`, `Night.tsx`, the composer menu, `/tonight` in `commands.ts`.
5. Mock and a new e2e file `32-night.cjs`.

Shared files touched: `HermesService.java`, `MainActivity.java`, `Composer.tsx`, `App.tsx`, `store.ts`, `styles.css`,
`mock.cjs`, the plugin's `__init__.py`.

## Tests

- Java: window across midnight; plugged in before the window; unplugged inside the 2-minute hold; Wi-Fi rule off;
  count 0 unregisters.
- Plugin: one at a time; pause lets the running one finish; the per-night limits; the summary counts.
- E2E: Run tonight from the long-press; reorder, edit, remove; Run now on a failed row; settings.
- Phone (needs the device lock): a real overnight run on the charger with the screen off; unplugging mid-shift;
  Android's battery saver on; the battery report for one shift. Check on one phone of a maker with aggressive
  background limits.

## Spec and changes

Spec 2.5 (the new receiver, callback and alarm, and their bounds), 3.4 (Send long-press), 3.14, 4.1 (`Triggers`),
4.4, 4.5 (`nightPlan`), 5.4, 5.5. `docs/android-versions.md` if anything differs by version. `changes/`, `rank: big`.

## Check first

- `ACTION_POWER_CONNECTED` reaches a receiver registered at run time by a foreground service on Android 8 to 16
  (it should; manifest receivers don't get it since Android 8).
- How Hermes words a cron run that stopped on an approval, to detect `needs_you` reliably.
- Doze: with the phone on the charger the system does not doze, so the shift keeps running; confirm on a real phone.

## Out of scope

Conditions for ordinary scheduled jobs ("only on Wi-Fi"); a daytime "when I'm next on the charger" rule (the same
trigger with an all-day window: easy to add once this works).
