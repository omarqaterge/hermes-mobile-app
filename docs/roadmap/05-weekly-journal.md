# 05: Weekly journal

Read [README.md](README.md) first.

**Effort:** M. **Areas:** plugin, web. **Depends on:** none. It shows more once 01–04 exist.

## Goal

One page that answers "what did Hermux do this week, what did it learn, what did it cost?" in numbers the user can
check, built from records and not from a model's memory. It is the look-back that makes "you stay in charge" real.
A written summary is optional and costs one model call only when asked for.

## What exists today

- Per-chat cost and tokens in the context sheet. No total anywhere.
- At the pinned build the dashboard has `GET /api/analytics/usage?days=N` (1 to 365, per profile) and
  `GET /api/learning/graph` (learned skills and memory pieces). The app calls neither.
- Per-app notes in `~/.hermes/mobile/app-notes/<package>.md`, the memory store, scheduled-job runs
  (`GET /api/cron/jobs/<id>/runs`), the chat database (read-only access as in `chat_search.py`).
- The diagnostic log has one line per phone-data read with the kind and the outcome, never the content.
- There is no record of which apps were used or which commands ran, apart from each chat's own history.

## Owner decisions needed

1. **Keep a small activity record?** This design adds `activity.jsonl`: one line per app use and per phone-data read
   (time, kind, app package or data kind, chat id). No commands, no arguments, no content. Recommended: yes, kept 90
   days, shown in the journal, deleted with "Forget" in Settings. It is the seed of the fuller activity record.
2. **A weekly notification?** Recommended: off by default; a switch on the journal page.

## Design

### Collecting (no model)

`journal.py`, route `GET /journal?days=7` (7, 30 or 90). It returns:

| Block | From | Fields |
|---|---|---|
| `chats` | the session database, read-only | count, by source (yours, scheduled, sub-agents), the 5 longest by turns with title and id |
| `usage` | `GET /api/analytics/usage?days=N` passed through and reduced | cost in total and per model, tokens in and out, per-day cost for a small bar chart |
| `jobs` | each job's runs | runs, failures, by kind (brief, watch, night, plain) |
| `apps` | `activity.jsonl` | per app: times used, last time |
| `phone_data` | `activity.jsonl` | reads per kind |
| `learned` | memory snapshots, app-notes modification times, `GET /api/learning/graph` | memory entries added and removed (text), apps with new notes, skills learned |
| `files` | checkpoints (`/checkpoints`) | number of turns that changed files |

- **Memory changes** need a baseline: the plugin stores a snapshot of the memory entries (hashes and text) once a
  day, on the first journal or memory request of the day, in `~/.hermes/mobile/journal/memory-<date>.json`, keeping 100
  days. No timer: it piggybacks on requests that already happen.
- **`activity.jsonl`** is appended by `phone_app._start_use` (kind `app`) and by `phone_data` on outcome `ok` (kind
  `data`). Lines older than 90 days are dropped when the file passes 1 MB.
- Every block is computed on its own; one failing gives `null` for that block, not an error for the page.
- The work runs in a thread with a 5-second budget per block (the chat database can be large on an old phone).

### Screen

`JournalScreen` (`web/src/components/Journal.tsx`), from a hub card "📓 Journal: this week $1.84 · 23 chats":

- A `Segmented` switch: Week, Month, 3 months.
- **Cost:** the total, a bar per day (plain `div` bars with CSS variables, no chart library), and a row per model.
  When Hermes reports no price for a model, the row says "no price known" instead of $0.
- **Work:** chats, scheduled runs with failures in the error colour, turns that changed files.
- **On your phone:** apps used (the app's label), phone-data reads per kind. Each row opens a sheet listing the
  times and the chat (a `hermes-chat:` link).
- **Learned:** new memory entries (tap opens the Memory screen on that entry), apps with new notes (tap shows the
  note file through `GET /api/files/read`), new skills (tap opens the skill sheet).
- A button **Write a summary** starts a new chat with a prepared message ("Summarise my week from this data: …" and
  the numbers as text). It is an ordinary chat, so it is visible and costs what a short reply costs.
- Loading is per block (`useLoader` per block, as the hub does).

### Weekly notification (when switched on)

A Hermes job of kind `journal` with `no_agent` and a script that computes the numbers and prints one line; the `cron`
event gets title "Your week with Hermux" and body "23 chats · $1.84 · 4 new notes"; tapping opens the journal
(`open: "journal"`, the mechanism from 01). Sunday 18:00 local time.

## Build steps

1. The two appenders (`phone_app.py`, `phone_data.py`) and `activity.py` (append, prune, read), `tools/test_activity.py`.
2. `journal.py` with one function per block and the route; `tools/test_journal.py` with a small fixture database.
3. `web/src/journal.ts` (pure: money formatting, bar heights, the summary text), `Journal.tsx`, the hub card.
4. Settings → Privacy: a row "Activity record" with **Forget** (`DELETE /journal/activity`).
5. Mock and e2e at the end of `10-hub-pages.cjs`.

Shared files touched: `App.tsx`, `store.ts`, `styles.css`, `mock.cjs`.

## Tests

- Plugin: each block with empty data, with a missing file, with a database locked by a writer; the 5-second budget;
  pruning; the activity lines carry no arguments.
- Unit: bar heights with one very large day; money under one cent; the summary text has no personal data beyond the
  numbers and titles.
- E2E: the three ranges; a failing block shows "Couldn't load" while the others show; the sheets; Forget.

## Spec and changes

Spec 3.14, 3.15 (the privacy row), 5.4, 5.5 (two new files, with what is never written to them), 2.3 (what the
activity record holds), `docs/privacy.md` and `docs/security.md` (a local record, never sent). `changes/` file.

## Check first

- The shape of `GET /api/analytics/usage` at the pinned build, and whether cost is present for subscription sign-ins
  (it may be zero or missing; then show tokens).
- The shape of `GET /api/learning/graph`, and whether it is cheap enough to call from a phone.
- Whether the usage route counts scheduled-job runs.

## Out of scope

A spending cap that stops Hermux (needs Hermes's cooperation), the full activity record with commands and files,
exporting the journal.
