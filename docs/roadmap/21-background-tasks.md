# 21: Background tasks

Read [README.md](README.md) first.

**Effort:** M, plus a Hermes patch. **Areas:** `hermes/patches`, plugin, web. **Depends on:** the sub-agent work
(`web/src/subagents.ts`, `components/SubAgents.tsx`), which already has the rows and the sheet to build on.

## Goal

While a reply runs, the send button's options offer **Run in background**. The task gets one line in its chat and a nested
row under the chat in the list, and its result arrives as a card with the task's text as its heading and the same actions
as a reply. It follows its chat's rules like any other work in that chat. Nothing is added above the composer or to the
header.

## Why it isn't built yet

The owner held it back on 2026-11-18 ([decision](../decisions/nested-chats.md)). Tested on the pinned Hermes (b8a8be18),
`prompt.background` runs a separate agent under its own key (`bg_…`), and so:

- **Stop doesn't reach it.** It went on after `session.interrupt` and after `session.close`, and no call stops it:
  `subagent.interrupt` doesn't find it and `session.interrupt` with its id answers "session not found".
- **It can't ask.** A flagged command is left pending and not run, in every access mode, so Full access doesn't apply and
  Off never shows a request. The task still reports that it finished.
- **The phone-data rule can miss it.** In a chat whose read is recorded under its stored id only (one reopened since), its
  `curl` ran without asking.
- **It has no parent.** Its stored chat has an empty `parent_session_id`, and `session.list` returns it as an ordinary chat.
- `background.complete` carries only `task_id` and `text`, and nothing is sent while it runs.

## What has to change

A small patch in `hermes/patches` so that a background task belongs to its chat:

1. `session.interrupt` and `session.close` stop the chat's background tasks.
2. It runs under the chat's approval key, so `/yolo` and requests work as for sub-agents.
3. Its stored chat records the chat that started it, which also gives the plugin the link the phone-data rule needs.
4. An event when it starts, so the line and the row don't depend on the page that started it.

Then the app: the option on the send button (`prompt.background`, only while a reply runs, checked over the lock screen),
the line, the row, the result card, and hiding `bg_…` chats from the ordinary list.

## Until then

`/bg` still works from the composer, except in a chat that has read phone data (spec 3.4).
