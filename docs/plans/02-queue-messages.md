# 02: Queue messages while Hermes works

Read [README.md](README.md) first.

## Goal

While Hermes is answering, the user can type a follow-up and choose:

- **Queue**: the message waits and is sent by itself when the current reply ends. Until then it shows at the end of
  the chat as a dashed bubble the user can edit, cancel or send right away.
- **Steer**: today's behaviour (`session.steer`, injected into the running turn).

T3 Code: `apps/web/src/components/chat/QueuedRunsControl.tsx` (dashed rows with edit/cancel at the end of the
timeline) and `apps/mobile/src/features/threads/ComposerQueuedEdit.tsx`.

## What exists today

- `web/src/gateway.ts`, `sendPrompt(text)`: when `a.running` is true it calls `session.steer` and adds a
  "Steer: …" notice. Otherwise it pushes a user item and calls `prompt.submit`.
- `web/src/components/Composer.tsx`: the right-hand button shows **Stop** when running with an empty box, otherwise
  Send with aria-label `Steer` while running. Placeholder "Steer the running task…".
- The offline outbox (`state.queued`, `queueMessage`, `unqueueMessage`, `flushOutbox` in `gateway.ts`,
  `localStorage` `hm.outbox.v1`) is a different thing (one message for when Hermes is offline). Don't merge the two;
  reuse its style (`.queued-chip`).
- `message.complete` handler in `gateway.ts` (`client.onEvent`, `case 'message.complete'`) ends a turn and sets
  `running: false`.

### Why a queue in the page and not Hermes's own queue

Hermes's gateway can queue too (`prompt.submit` with `queued: true` answers `status: 'queued'`, see
`tui_gateway/session_auto_continue.py::_handle_busy_submit` in hermes-agent at the commit in
`web/vendor/hermes-shared/.hermes-commit`). But it has no RPC to edit, cancel or reorder a queued message, and it
consumes photos queued for the next turn. A queue in the page can do all of that. The cost: a queued message is only
sent while the app is open on that chat. That is acceptable for a first version; say it in the spec.

## Design

1. **Buttons while running.** When `running && text.trim()`:
   - The right-hand button becomes **Queue** (aria-label `Queue`): a send arrow with a small clock badge.
   - A second, smaller pill button **Steer** (aria-label `Steer`) sits just left of it.
   - With attachments in the composer, Queue is disabled (aria-label `Queue (remove attachments first)`), because
     Hermes would attach those photos to whatever is sent next. Steer works as today.
   - The placeholder while running becomes `Queue or steer a follow-up…`.
   Keep the aria-label `Steer` on the steer button: existing e2e tests click it.
2. **Queued bubbles.** Each queued message shows at the end of the chat (after the last item, before `.chat-pad`) as
   a right-aligned bubble with a dashed border and a small header `Queued · 1 of 2`. Under it, three icon buttons:
   - **Send now** (aria-label `Send queued message now`): while running, steers it (and removes it from the queue);
     when idle, sends it as a normal message.
   - **Edit** (aria-label `Edit queued message`): turns the bubble into a textarea with Cancel / Save, like editing
     a sent message in `UserMsg`.
   - **Remove** (aria-label `Remove queued message`): removes it.
3. **Sending the queue.** When the open chat's turn ends (`running` goes from true to false), and the turn did not end
   with an error or a Stop, and no approval/question is open (`state.requests` is empty), and Hermes is connected:
   send the first queued message with `sendPrompt`. Its reply ends the next turn, which sends the next one, and so
   on.
4. **Pausing.** After an error or after the user pressed Stop, the queue pauses: a line above the queued bubbles says
   `Queue paused` with a button **Resume** (sends the first one now). Opening a chat that has queued messages and is
   idle also shows it paused (never send by surprise when a chat opens).
5. **Persistence.** The queue is kept per chat (stored id) in `localStorage` key `hm.queue.v1`
   (`{ [storedId]: { id: string; text: string; at: number }[] }`), so a reload or app restart keeps it. At most 10
   queued messages per chat; a full queue disables Queue with aria-label `Queue (full)`.

## Implementation steps

1. **New module `web/src/queue.ts`:**
   ```ts
   export interface Queued { id: string; text: string; at: number }
   export function queuedFor(chat: string): Queued[]
   export function enqueue(chat: string, text: string): Queued | null   // null when full
   export function editQueued(chat: string, id: string, text: string): void
   export function removeQueued(chat: string, id: string): Queued | null
   export function takeFirst(chat: string): Queued | null
   export function isPaused(chat: string): boolean
   export function setPaused(chat: string, paused: boolean): void        // in memory only
   export function useQueue(chat: string | undefined): { items: Queued[]; paused: boolean }
   ```
   Store in `localStorage` (`try/catch` around every access, like `drafts.ts`). Notify subscribers on every change
   (copy the listener pattern from `store.ts`). Use `newId('q')` from `store.ts` for ids.
2. **Draining** (in `queue.ts` or `gateway.ts`): `subscribe` (from `store.ts`) to state changes and remember the last
   `{ storedId, running }`. When the same chat goes `running: true → false`:
   - If the turn was stopped or failed: `setPaused(chat, true)`. To know that, set a module flag in `interrupt()`
     (`gateway.ts`) and in the `message.complete` handler when `p.error || p.failure_reason`.
   - Else, if not paused, `requests.length === 0`, `conn === 'open'` and `active.attachments.length === 0`:
     `const q = takeFirst(chat)`; `if (q) sendPrompt(q.text).catch(e => { re-insert q at the front; setPaused(chat, true); toast(errText(e), 'error') })`.
   - Opening a different chat (`storedId` changes) marks the newly opened chat paused if it has a queue.
3. **Composer** (`Composer.tsx`): in `send()`, when `running`: call `enqueue(storedId, t)` for Queue and keep today's
   path for Steer. Split `send` into `send(mode: 'send' | 'queue' | 'steer')`. Ctrl/Cmd+Enter while running = Queue.
   A new chat that has no stored id yet can't be running, so `storedId` is always there when queuing.
4. **Queued bubbles**: a `QueuedRows` component (in `ChatItems.tsx` or a new `web/src/components/Queued.tsx`) rendered
   by `Chat` in `App.tsx` right before `<div className="chat-pad" />`. It is not part of `items`, so search, jump and
   folding (which use child indexes of `items`) are not affected. Keep it **after** all item children.
   Edit mode: a textarea plus Cancel / Save (Save calls `editQueued`). Send now: `removeQueued` then
   `sendPrompt(text)` (that already steers when running).
5. **CSS**: `.queued-msg` (like `.msg.user .bubble` but `border: 1.5px dashed var(--accent)` and transparent
   background), `.queue-paused`. Variables only.
6. When a chat is deleted (`deleteSession`) drop its queue (`localStorage` cleanup), so keys don't pile up.

## Edge cases

- The user sends a normal message (not running) while a queue exists: it goes first; the queue still waits for its
  turn to end. That is fine.
- Slash commands (`/…`) typed while running: keep today's behaviour (they run through `runSlash`), never queue them.
  Disable Queue when the text starts with `/`.
- A turn that ends because the chat was opened elsewhere and `syncRunning()` loaded the stored transcript also flips
  `running` to false: that path counts as a normal end (drain).
- The page reloads in the middle of a turn: the queue is still there (persisted) and the chat opens paused.

## Tests

**Unit** (`web/src/queue.test.ts`, `// @vitest-environment happy-dom` for `localStorage`): enqueue/edit/remove/
takeFirst order; the 10-item cap; storage survives a module re-import (or read the key directly); corrupt JSON in the
key gives an empty queue.

**Mock**: add a prompt in `mock.cjs` `prompt.submit`, e.g. `/^slow reply$/`: `message.start` at 100 ms, a delta at
300 ms, `message.complete` (`text: 'Slow done.'`) at 1500 ms.

**E2E** (`test.cjs`):
1. Send `slow reply`; while running, fill `next one`; click `Queue`. Check: `.queued-msg` with text `next one` is
   visible; no `prompt.submit` and no `session.steer` with `next one` yet.
2. Wait for `Slow done.`; then check one `prompt.submit` with text `next one` and the `.queued-msg` is gone.
3. Send `slow reply`, queue `a` and `b`, remove `a` (`Remove queued message`), edit `b` to `c`; after the reply
   ends exactly one `prompt.submit` with `c`.
4. Send `slow reply`, queue `d`, press Stop (`Stop` button needs an empty box). Check `Queue paused` shows and no
   `prompt.submit` with `d`; click Resume → sent.
5. Reload the page with a queued message: it is still shown, paused.
6. Steer still works: fill text while running and click `Steer` → `session.steer` called (an existing test may cover
   this; keep it passing).

## Spec and changelog

- `docs/SPEC.md`: 3.4 "What the button on the right does" (new faces Queue and Steer), "Sending" (the queue),
  2.2.1 data flow (queue drains on turn end), 2.4.1 (`hm.queue.v1`), 3.2 (queued bubbles, `Queue paused`), and the
  new aria-labels. Say clearly that queued messages are sent only while the app shows that chat.
- `CHANGELOG.md` entry.

## Out of scope

Server-side queueing (`queued: true`), queuing with attachments, reordering by drag.
