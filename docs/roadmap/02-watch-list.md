# 02: Watch list (a standing checklist)

Read [README.md](README.md) first (job kinds, device state).

**Effort:** M. **Areas:** plugin, web. **Depends on:** job kinds.

## Goal

The user keeps one short list of things Hermux should keep an eye on: "tell me when the price drops under 300",
"has the ticket page opened sales", "is my site up". Hermux looks every so often and **stays silent unless something
needs the user**. A scheduled job always runs one task and always reports; the watch list is many small checks, one
run, and no noise.

## What exists today

- Scheduled jobs and their notification (spec 3.14, 4.4).
- At the pinned build Hermes jobs have **monitor mode**: `monitor_url` or `monitor_script` runs first, and the model
  is called only when the output changed since the last time (`cron/monitor.py`: exact-bytes hash, a capped diff put
  in the prompt, a fetch of at most 256 KiB in 30 s, a failed fetch is an error and not a change).
- Hermes also has in-process "session heartbeats" (`hermes_cli/heartbeat.py`), but they live only while one chat's
  process runs, so they don't fit a phone that sleeps.

## Owner decisions needed

1. **How often at most.** Each look wakes the phone and may call a model. Recommended: choices 30 min, 1 h, 2 h
   (default), 4 h, twice a day; active hours 08:00–22:00 by default.
2. **Only on Wi-Fi / only above 20 % battery?** Recommended: skip a look under 15 % battery unless charging; no Wi-Fi
   rule (the looks are small).

## Design

Two kinds of item, because one of them costs no tokens while nothing changes:

- **Watch a page** (`type: "page"`): an address and what to look for. Built as its own Hermes job with `monitor_url`.
  Unchanged page: no model call. Changed: the model reads the diff and decides whether it matters for "what to look
  for".
- **A check in words** (`type: "check"`): anything else. All checks run together in one job.

### Data

`~/.hermes/mobile/watch.json`: `{ "every": "2h", "from": "08:00", "to": "22:00", "job_id", "items": [ { "id", "type",
"text" (200 chars), "url", "job_id", "paused", "last": { "t", "said" } } ] }`. At most 20 items, at most 8 of type
`page`.

### The jobs

- Kind `watch`. The schedule is built from `every`, `from` and `to` by a pure function
  (`2h`, 08–22 gives `0 8-22/2 * * *`; "twice a day" gives `0 9,18 * * *`).
- The checks job: `skills: ["hermes-mobile:watch"]`, prompt = the numbered checks. The skill says: check each item
  with the fewest steps, web search and page reads only, no commands, no apps; then answer with **exactly** one line
  per item that needs the user, `N: <one sentence>`, or the single word `NOTHING`.
- A page job: `monitor_url`, same kind, prompt "The page changed. The user watches it for: <text>. If the change
  matters for that, answer `1: <one sentence>`; otherwise answer `NOTHING`."
- Text fetched from a page is outside text: the prompt says so, and the answer format leaves it no room to do more
  than produce a sentence. The run has no command or app tools (the skill, and the job's toolset if Hermes lets a job
  restrict it: Check first).

### Silence

In `on_session_end` for a job of kind `watch` (`watch.py`, called from the `cron` branch):

- Final answer `NOTHING` (after trimming): **no `cron` event**, so no notification. The run's chat is hidden
  (`session.set_hidden`) and the plugin deletes hidden watch chats older than 3 days.
- Otherwise: parse the `N: sentence` lines, store each in the item's `last`, and send one `cron` event: title
  "Watch list", body the first sentence, plus "and N more".
- Anything else (the model ignored the format): treated as a report with the first 200 characters, so a real finding
  is never dropped.
- Three failed runs in a row send one notification "The watch list couldn't run" and nothing more until one works.

### Battery gate

Before the checks job spends anything, a `script` asks the app's `POST /device` (README). Under 15 % and not charging
it prints `SKIP`, and the skill answers `NOTHING` at once. Better, if Hermes supports a script ending the run without
a model call (Check first), use that.

### Screen

`WatchScreen` in a new `web/src/components/Watch.tsx`, opened from a hub card "👁 Watch list: N items · last looked
<time>":

- Rows: the text, a "page" tag for pages, and under it the last finding with its time, or "Nothing so far". Switch
  per row to pause. Tap opens the edit sheet (text, optional address, Delete).
- ＋ adds an item: one text field "What should Hermux watch for?", an optional "Page address" (https only).
- A header row "Looks every 2 h, 08:00–22:00" opens the settings sheet (`Segmented` for how often, two time pickers).
  Under it: "About N looks a day. Each look is one short model call; watched pages cost nothing while they don't
  change."
- "Look now" runs the jobs once (`…/trigger`).

Routes: `GET /watch`, `PUT /watch` (the whole list; the plugin creates, updates and deletes the Hermes jobs to
match), `POST /watch/run`.

## Build steps

1. `jobkinds.py` if not there yet.
2. `watch.py`: store, `schedule_for`, job sync, answer parsing, the hook branch; `skills/watch/SKILL.md`;
   `tools/test_watch.py`.
3. `web/src/watch.ts` (pure: schedule text, looks per day), `Watch.tsx`, hub card, `Screen` value `watch`.
4. Mock routes and a new e2e file `31-watch.cjs`.

Shared files touched: `App.tsx`, `store.ts`, `styles.css`, `mock.cjs`, the plugin's `__init__.py` (one call in the
`cron` branch).

## Tests

- Plugin: `NOTHING` sends no event; `2: price is 289` sends one and stores it on item 2; garbage is reported; the
  three-failures rule; job sync when an item changes type; more than 8 pages refused.
- Unit: the schedule function for every choice, across midnight (`from` 22:00, `to` 06:00 gives two hour ranges).
- E2E: add, pause, edit, delete; settings change the "looks a day" line; Look now.
- Phone: a look with the screen off sends nothing when nothing changed; battery cost of a silent look.

## Spec and changes

Spec 3.14, 3.1, 5.1 (the hook's new branch), 5.4, 5.5, 5.6, 2.5. `changes/` file, `rank: big`.

## Check first

- That `monitor_url` jobs work under `hermes dashboard` with the plugin's ticker (they should: same scheduler).
- Whether a job can restrict its toolsets, and whether a `script` can end a run early without a model call.
- That `on_session_end` gives the final answer text for a cron run (the hook already reads enough to build the
  notification body).

## Out of scope

Watching phone things (a notification from another app, a location): those need the notification-listener and
trigger work in `docs/research/phone-agent-landscape.md`.
