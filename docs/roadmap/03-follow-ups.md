# 03: Follow-ups (open loops)

Read [README.md](README.md) first.

**Effort:** M. **Areas:** plugin, web. **Depends on:** none.

## Goal

When a chat leaves something for later ("I'll check the reply tomorrow", "remind me after the meeting", "let's see if
the build is green tonight"), Hermux offers to come back to it. One tap sets it; nothing is scheduled without that
tap. Open follow-ups are listed in one place and feed the morning brief (01).

## What exists today

- One-shot scheduled jobs: Hermes takes an ISO time as a schedule ("tomorrow 9am" is one of the Cron screen's chips).
- Plugin prompt sections (spec 5.3) and tools (5.2); `hermes-chat:<id>` links open a chat.
- Nothing notices a promise in a chat.

## Owner decisions needed

1. **Who notices.** (a) The model, through a short prompt section and a tool (no extra model call; depends on the
   model bothering). (b) A second small model call after each turn (reliable, but it costs on every turn).
   **This design builds (a).**
2. **What a follow-up does when due.** Recommended: it posts a notification that opens the original chat with a
   prepared message in the composer, unsent. The alternative, running a turn by itself, means an unattended run
   inside a chat the user was in; keep that for a later step.

## Design

### Noticing

- Prompt section `hermes-mobile.follow_up` (at most 350 characters): "When you or the user leave something for
  later, call `follow_up` once with what to come back to and when. Don't mention the tool. Don't call it for things
  you finish now."
- Tool `follow_up(text, when, why?)` in a new `follow_ups.py`. `text` at most 200 characters; `when` an ISO local
  time, or one of `later_today`, `tomorrow_morning`, `next_week`. It **does not schedule**. It stores a *suggestion*
  and returns "offered to the user". At most 2 suggestions per turn and 5 pending per chat; more are refused with a
  sentence.
- The tool is not offered in cron runs or sub-agents.

### Data

`~/.hermes/mobile/follow_ups.json`: `[ { "id", "chat", "profile", "text", "when", "state": "suggested" | "set" |
"done" | "dismissed", "made", "job_id" } ]`. Suggestions not taken in 48 h are dropped; done and dismissed ones after
30 days.

### In the chat

Under the reply whose turn called the tool, a **follow-up chip** (new `web/src/components/FollowUp.tsx`, rendered by
`ChatItems.tsx` after the turn's actions row):

`⏰ Come back to "<text>" · tomorrow 09:00`  **Set**  **Other time**  **✕**

- **Set** makes it real (below). The chip becomes "⏰ Set for tomorrow 09:00 · Undo".
- **Other time** opens a `PickerSheet`: In an hour, This evening (18:00), Tomorrow morning (09:00), Next week
  (Monday 09:00), Pick a time.
- **✕** dismisses. The page learns of suggestions from `GET /follow-ups?chat=<id>`, fetched when a turn ends (no
  polling).

### Making it real

`POST /follow-ups/{id}/set` with the time. The plugin creates a Hermes one-shot job at that time with `no_agent` and a
tiny `script` that marks the follow-up due and prints its text: no model call when it fires. The plugin's `cron`
branch sees a `follow_up` job and sends a `cron` event with title "Follow-up", body the text, `session` the original
chat, and `draft`: "Let's come back to this: <text>". The notification opens that chat with the draft in the composer
(`hermesOpenSession(id, draft)` already takes a draft). The state becomes `done` when the user sends or clears it.

If Hermes won't take a `no_agent` job with an inline script (Check first), the fallback is the wake alarm path
without a job: the plugin posts `wake_at` for the due time itself and sends the event when poked.

### The list

The Cron screen gets a second segment: **Jobs | Follow-ups**. Follow-ups rows: text, when, the chat's title as a
link; swipe or a button to delete; tap to change the time. The hub's Scheduled jobs card adds "· N follow-ups".

Routes: `GET /follow-ups` (optional `chat`), `POST /follow-ups/{id}/set`, `PUT /follow-ups/{id}` (time),
`DELETE /follow-ups/{id}`.

## Build steps

1. `follow_ups.py` (store, tool, section, routes, the cron branch), `tools/test_follow_ups.py`.
2. `web/src/followups.ts` (pure: the preset times from "now", label text), `FollowUp.tsx`, the Cron screen segment.
3. Mock: a prompt text `follow up` whose turn creates a suggestion; e2e at the end of `09-chat-tools.cjs`.

Shared files touched: `gateway.ts` (fetch suggestions at turn end: one call in `finishTurnStats`' neighbourhood),
`styles.css`, `mock.cjs`, the plugin's `__init__.py`.

## Tests

- Plugin: limits per turn and per chat; `when` words resolve in the phone's time zone; a past time is refused;
  expiry; the event carries the draft.
- Unit: presets at 08:59, 17:30, 23:50 and on a Sunday.
- E2E: the chip shows, Set calls the route and changes the chip, Undo, Other time, dismiss; the Follow-ups segment
  lists it; Back closes the picker.

## Spec and changes

Spec 3.3 (the chip), 3.14 (Cron screen segment), 5.2, 5.3, 5.4, 5.5, 4.4 (`cron` event's `draft`). `changes/` file.

## Check first

- A one-shot job with `no_agent` and a script path inside the plugin folder is accepted and fires through the
  plugin's ticker.
- The prompt-section budget: the sections are frozen into a chat, so the text must stay short.
- How often the default models call the tool unprompted; if rarely, add the composer command "/later <text>" that
  creates the suggestion directly.

## Out of scope

Running a turn by itself when due (decision 2), follow-ups created from notifications, shared reminders with the
phone's calendar (phone data is read-only).
