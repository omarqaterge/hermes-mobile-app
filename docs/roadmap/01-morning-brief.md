# 01: Morning brief

Read [README.md](README.md) first (job kinds, unattended runs).

**Effort:** L. **Areas:** plugin, web, one line of Java. **Depends on:** job kinds. Better after 03 (follow-ups feed it).

## Goal

Once a day, before the user wakes, Hermux prepares a few short items: things to remember today, follow-ups that are
due, news on topics the user follows, loose ends from yesterday's chats. They wait in a **Today** screen. A thumb up
or down on an item steers the next brief. Items disappear after a day unless kept. It runs on the phone, with the
scheduled-job machinery that already exists.

## What exists today

- Scheduled jobs: `CronScreen`, `POST /api/cron/jobs` with `deliver: "local"`, the ticker and the wake alarm (spec
  3.14, 2.5, 6.1). A finished job sends the `cron` event (`title`, `body`, `id`, `session`), shown as a
  "Scheduled jobs" notification (spec 4.4).
- Hermes jobs take `skills`, a `model` override and a `script` whose output is put in front of the prompt (pinned
  build, `cron/jobs.py`).
- `find_chats` (all profiles, read-only), the memory store (`GET /memory`), the library (`/library` routes), plugin
  skills (`hermes-plugin/hermes-mobile/skills/`).
- A job cannot read phone data: the app's gate needs a tap (README, "Unattended runs").

## Owner decisions needed

1. **Phone data in the brief.** The calendar is the most useful source, and a job can't read it. Options: (a) no
   phone data; the calendar only through a connected account (Connectors), which is not behind the phone-data gate;
   (b) a "brief grant": one switch in Settings → Phone data, turned on with the fingerprint, that lets the brief job
   alone read `calendar` for today, enforced in the app by the job's chat id being announced by the plugin. (b) is
   weaker than today's rule because the plugin's word decides which chat is the brief. **This design builds (a).**
2. **On by default?** Recommended: off. The Today screen offers it once.
3. **Which model.** A brief costs tokens every day. Recommended: the user picks, with the cheapest configured model
   preselected.

## Design

### Data

`~/.hermes/mobile/brief/`:

- `settings.json`: `{ "on", "time": "07:00", "topics": [..max 12, 60 chars each], "model", "job_id" }`.
- `days/<YYYY-MM-DD>.json`: `{ "made", "items": [ { "id", "kind", "title", "text", "source", "link", "kept" } ] }`.
  `kind` is `today`, `follow_up`, `topic` or `loose_end`. At most 8 items, `title` 80 and `text` 600 characters.
  `link` is a `hermes-chat:<id>` link or an `https` address, nothing else.
- `feedback.jsonl`: `{ "t", "item_kind", "title", "vote": 1 | -1 }`, the newest 200 lines kept.

Days older than 7 are deleted when a new one is written; a kept item is copied to the library first (`POST /library`).

### The job

Kind `brief`, schedule from `time` as a 5-field expression, `skills: ["hermes-mobile:brief"]`, the chosen model.

- A pre-run `script` (`hermes-plugin/hermes-mobile/brief_context.py`, run by Hermes's own script support) prints the
  context so the model doesn't spend turns collecting it: the topics, the last 30 feedback lines summarised as "more
  of / less of", due follow-ups (03's store, if present), yesterday's chat titles (read-only from the session
  database, as `chat_search.py` opens it), and the memory entries. Capped at 6,000 characters. It prints titles and
  the user's own notes only, never message text.
- The skill (`skills/brief/SKILL.md`) says: use the context, search the web for at most 3 topics, write at most 8
  items, **end by calling `brief_post` once**, and say nothing else. No commands, no apps, no files.
- A new tool `brief_post(items)` (`brief.py`) validates the shape and the limits above, strips control and format
  characters (the `_clean` rule from `phone_data.py`), writes the day file and returns "saved". It refuses when not
  called from the brief job's own run.
- Bound: the job is created with a step limit of 12 model calls and a 5-minute budget. If Hermes jobs take no such
  field (Check first), the skill states it and `agent.run_budget_seconds` applies.

### Routes (`/api/plugins/hermes-mobile`)

`GET /brief` (settings and today's items; yesterday's when today's isn't made yet, marked `stale`),
`PUT /brief/settings` (creates, updates or deletes the Hermes job and its kind to match), `POST /brief/vote`
(`{ id, vote }`), `POST /brief/keep` (`{ id }`), `POST /brief/run` (triggers the job now).

### Screen

- **Hub:** a new first card "☀ Today": "N items" or "Off: tap to set up".
- **`TodayScreen`** (new file `web/src/components/Today.tsx`): the date, then one card per item: a small kind label,
  title, text, the source as a link chip. Under each: 👍 (`aria-label` "More like this"), 👎 ("Less like this"),
  Keep, and **Ask about this** (starts a new chat with the item quoted in the composer, unsent; uses `quote.ts`).
  A link opens through the same "Open this address?" path the cards use.
- Empty states: "Your brief is being prepared", "No brief today: Hermux was offline at 07:00. **Make it now**".
- A gear opens **Brief settings** (sheet): On (`Toggle`), Time (the time picker from `ui.tsx`), Topics (chips with
  add and remove), Model (`PickerSheet`), "Costs about one short reply a day on the model you pick."
- Text from the web is shown as plain text: item text never goes through the Markdown renderer.

### Notification

The `cron` event for a `brief` job gets title "Your brief is ready" and body "N items". Tapping it opens the Today
screen: the event carries `open: "today"`, `HermesService` passes it as an extra marked by `IntentGate`, and the page
gets it through `window.hermesOpenScreen('today')` (a new call from Java, next to `hermesOpenSession`).

## Build steps

1. `jobkinds.py` and its routes (README), with `tools/test_jobkinds.py`.
2. `brief.py` (store, validation, `brief_post`, routes), `brief_context.py`, `skills/brief/SKILL.md`,
   `tools/test_brief.py` (limits, cleaning, pruning, the tool refusing outside the job).
3. `web/src/brief.ts` (types, pure helpers: `scheduleFor(time)`, `isStale`), `Today.tsx`, the hub card, the `today`
   value of `Screen` in `store.ts`.
4. The `cron` branch of `on_session_end` reads the kind; `HermesService` and `MainActivity` pass `open`.
5. Mock: `GET /brief` with three items; e2e in a new `tools/web-e2e/checks/30-today.cjs`.

Shared files touched: `App.tsx` (mount the screen), `store.ts`, `styles.css`, `mock.cjs`, `HermesService.java`,
`MainActivity.java`.

## Tests

- Unit: `scheduleFor("07:05")` gives `5 7 * * *`; stale and expiry rules; vote summarising.
- Plugin: an item over the limits is cut or refused as specified; a `javascript:` link is dropped; day pruning keeps
  kept items in the library.
- E2E: the hub card count; votes call `POST /brief/vote`; Keep; Ask about this fills the composer unsent; the
  settings sheet creates a job (`POST /api/cron/jobs` in the RPC log) and Back closes it.
- Phone: the alarm wakes the phone at the set time with the screen off, the notification opens Today, battery cost
  of one run (add a row to `docs/battery-report.md`).

## Spec and changes

Spec 3.14 (hub card, Today screen), 3.1 (screens list, calls from Java), 4.4 (`cron` event's new field), 5.2
(`brief_post`), 5.4 (routes), 5.5 (files), 5.6 (skill), 2.5 (one more daily wake). `changes/` file with `rank: big`.

## Check first

- Whether Hermes jobs accept a per-job step or time limit; otherwise rely on the global limits.
- That a job's `script` runs with the plugin folder importable under proot, and what its working folder is.
- That a tool can tell it runs inside a given job (the session's platform is `cron`; find the job id in the tool
  handler's arguments).

## Out of scope

Phone data in the brief (decision 1), a home-screen widget showing the brief, reading it aloud at wake-up.
