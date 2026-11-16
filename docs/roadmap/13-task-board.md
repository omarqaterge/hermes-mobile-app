# 13: Task board

Read [README.md](README.md) first.

**Effort:** M–L. **Areas:** web. **Depends on:** none to build; it earns its place once Hermux connects to a Hermes
on a server (connections, not designed here).

## Goal

Hermes has a durable task board where several agents take tasks, report progress and recover after a crash. Hermux
shows none of it. This design adds a **Board** screen made for a phone: see what each agent is working on, add a
task, move one, read its log, stop a run.

## What exists today

- At the pinned build the board ships as a dashboard plugin (`plugins/kanban`) with its own routes
  (`plugins/kanban/dashboard/plugin_api.py`), among them: `GET /board`, `GET` / `POST /tasks`, `GET` / `PATCH` /
  `DELETE /tasks/{id}`, `POST /tasks/{id}/comments`, `GET /tasks/{id}/log`, `GET /runs/{id}`,
  `POST /runs/{id}/terminate`, `POST /tasks/{id}/reclaim`, `POST /tasks/{id}/reassign`, `GET /assignees`,
  `GET /stats`, `GET /boards`, `POST /boards/{slug}/switch`, `POST /dispatch`, and a WebSocket `/events`.
- The workers that pick tasks up are started by a dispatcher that normally runs as a service next to Hermes's
  gateway. **On the phone only `hermes dashboard` runs**, so on a phone-only setup tasks would sit unclaimed unless
  something dispatches them.
- Hermux's tool list already names the `kanban_*` tools (they are among the tools the phone-data protections know).

## Owner decisions needed

1. **Show the board on a phone-only setup?** Recommended: the hub card appears only when the board answers **and**
   has at least one task or one active worker; otherwise it stays out of the way. No dispatcher is started on the
   phone (battery): a "Run now" button on a task calls `POST /dispatch` once, by the user's tap.
2. **Editing rights.** Recommended first version: add, comment, move between columns, reassign, stop a run. No
   delete, no board management (create, rename, import): those stay on the computer.

## Design

### Availability

`web/src/board.ts`: `boardAvailable()` does one `GET <plugin base>/board` when the hub opens (the hub already loads
each card on its own). 404 or an error: no card, and the result is cached for the session. No polling.

### Screen (`web/src/components/Board.tsx`)

A phone can't show six columns side by side, so the board is **one column at a time**:

- Top: the board's name (a `PickerSheet` of boards when there is more than one; choosing calls `…/switch`), and ＋.
- A horizontally scrolling row of column chips with counts ("Ready 3", "Running 2", "Blocked 1", "Done 12"). The
  columns and their order come from the board's answer, never from a fixed list. The screen opens on the first column
  that has a running task, else the first non-empty one. Swiping left or right changes column (`swipe.ts`).
- Task cards: title, the assignee (profile name with its avatar letter), age, a small state mark (running spinner,
  blocked, failed), and the last log line in dim text when running.
- Pull to refresh. While the screen is visible and the page is in front, one WebSocket to `/events` keeps it live;
  it closes on leaving the screen or hiding the page (the bound). If the socket can't open, the screen falls back to
  refreshing when it becomes visible, with no timer.

### Task sheet

Title, description (Markdown), then tabs with `Segmented`: **Activity** (comments and state changes, newest last,
with a comment field), **Log** (the tail from `GET /tasks/{id}/log`, monospace, "Load more"), **Runs** (each run
with its state and duration; a running one has **Stop run**, which confirms and calls `…/terminate`).

Actions at the bottom: **Move to…** (`PickerSheet` of columns, `PATCH`), **Reassign** (`PickerSheet` from
`GET /assignees`), **Run now** (only on a phone-only setup, decision 1), **Take back** for a stuck task
(`…/reclaim`). A task whose run produced a chat links to it (`hermes-chat:` when the run's session is known).

### New task

Sheet: Title, Details, Assign to (`PickerSheet`, default "anyone"), column (default the board's intake column).
`POST /tasks`.

### Text from tasks

Titles, descriptions, comments and logs can be written by agents and by content they read. They are rendered through
the sanitized Markdown renderer or as plain text, links go through the "Open this address?" dialog, and no task text
is ever fed back into a chat by this screen.

## Build steps

1. `board.ts`: types from the real answers (record one answer of each route from a Hermes with the plugin as a test
   fixture, with made-up task text), pure helpers (`firstColumn`, `ageText`, `mergeEvent`), unit tests.
2. `Board.tsx`, the hub card, the `board` screen value.
3. The WebSocket: reuse the page's authenticated socket helper for plugin sockets if there is one; else a small
   `openPluginSocket(path)` next to the REST helper in `api.ts`.
4. Mock: the routes with a board of four columns and five tasks, and a scripted event. E2E in a new
   `36-board.cjs`.

Shared files touched: `App.tsx`, `store.ts`, `styles.css`, `mock.cjs`, perhaps `api.ts`.

## Tests

- Unit: an event for a task in another column moves it; an unknown column from the server shows up as a column; an
  event for an unknown task triggers one refetch.
- E2E: the card hidden when the board is missing or empty; column chips and swipe; open a task, comment, move, stop
  a run (confirm dialog); new task; Back closes sheet, then screen.
- Against a real Hermes with the plugin (a computer is fine): each route's shape matches the fixture.

## Spec and changes

Spec 3.14 (card, screen, sheets), 3.1, 2.2 (the socket and when it is open), 2.5 (no background work), 2.6
(`board.ts`), the REST table of routes used. `changes/` file.

## Check first

- The plugin's route prefix under the dashboard (other dashboard plugins mount under `/api/plugins/<name>`), and
  that Hermux's token guard in front of the dashboard lets plugin routes and the WebSocket through.
- Whether the board plugin loads at all under `hermes dashboard` on the phone.
- The exact fields of a task and of an event at the pinned build (take them from the code, not from this file).
- What `POST /dispatch` does when no worker service exists.

## Out of scope

Drag and drop between columns, board management, time estimates, starting the dispatcher on the phone.
