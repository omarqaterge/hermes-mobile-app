# 09: "New since your last visit" divider

Read [README.md](README.md) first.

## Goal

When the user opens a chat that got new messages while they were away (Hermes finished a long task, a cron job or a
bot wrote into it), a divider `New since your last visit` sits before the first message they haven't seen, and the
chat opens scrolled so that divider is near the top, instead of at the very end of a long reply.

T3 Code: `apps/web/src/components/chat/ThreadVisitWatermark.tsx` (tracks the last visit and marks the timeline).

## What exists today

- `web/src/unread.ts`: per profile, `localStorage` `hm.seen.v1.<profile>` keeps the **message count** seen per chat,
  from `session.list`. It decides which chats are unread (dot in the drawer). Counts can't tell us *where* in the chat
  the new part starts, so this plan adds a time-based mark.
- Chat items have `at` (ms) for user and assistant messages: from stored `timestamp` in `hydrate` (`store.ts`) and
  `Date.now()` for live ones. Tool and notice items have no `at`.
- `Chat` (`web/src/App.tsx`) scrolls to the end on open (`stick.current = true` in a `useLayoutEffect` keyed on
  `sessionKey`, then `el.scrollTop = el.scrollHeight` when items arrive).
- `document.visibilitychange` is already used in `gateway.ts`.

## Design

- **Last-seen time per chat** (`localStorage` `hm.visit.v1`, `{ [storedId]: ms }`, at most 500 entries, oldest
  dropped). Updated to `Date.now()` when:
  - the user leaves a chat (another chat opens, a new draft starts),
  - the page goes hidden while the chat is open,
  - a turn ends while the chat is open and the page is visible (they watched it happen).
- **Divider**: when a chat opens, read its last-seen time `t`. If `t` exists, find the first `user` or `assistant`
  item with `at > t`. If found **and** it isn't the first item, show the divider right before it, for as long as the
  chat stays open (it goes away on the next open).
- **Scroll**: if a divider is shown and it is above the last screenful, open the chat with the divider 8 px below the
  top instead of at the end. If the divider's item isn't drawn yet (above the window of 40), draw from 3 items before
  it, like the search jump does.
- No `t` (never opened on this phone): no divider.

## Implementation steps

1. **New module `web/src/visit.ts`:**
   ```ts
   export function lastVisit(storedId: string): number | null
   export function markVisit(storedId: string, at?: number): void
   /** Index of the first user/assistant item newer than `since`, or -1. Never 0 (nothing to separate). */
   export function firstUnseen(items: ChatItem[], since: number | null): number
   ```
   `try/catch` around `localStorage` like `drafts.ts`.
2. **Marking** (`gateway.ts` is where chats change; or a `subscribe` listener in `visit.ts` started from `App`):
   - Keep `prevStoredId`; when `state.active?.storedId` changes and `prev` is set, `markVisit(prev)`.
   - `visibilitychange` to hidden: `markVisit(active.storedId)` (the handler in `gateway.ts` already saves the chat
     there; add one line).
   - In the `message.complete` handler: if `document.visibilityState === 'visible'`, `markVisit(active.storedId)`.
3. **`Chat` (`App.tsx`)**:
   - When `sessionKey` changes, compute once: `const since = lastVisit(sessionKey)` **before** anything marks it
     (read it in the same `useLayoutEffect` that sets `stick.current`, store it in a ref `visitRef = { key, since }`).
   - `const dividerIdx = useMemo(() => firstUnseen(items, visitRef.current.since), [items, sessionKey])`. Freeze it
     after the first non-empty result for this `sessionKey` so new live messages don't move it.
   - Render: for the item at `dividerIdx`, wrap it:
     `<div key={it.id} className="visit-wrap"><div className="visit-divider" role="separator">New since your last visit</div>{view}</div>`.
     One child per item is kept. If the item is inside a folded run, put the divider in the same wrapper the fold uses.
   - Initial scroll: in the layout effect that sticks to the end, if `dividerIdx >= 0` and it hasn't been applied for
     this `sessionKey`, scroll to the wrapper instead (`stick.current = false`). Reuse the "draw earlier items first"
     logic (`setWin`) when `dividerIdx < start`.
   - A message-search `jump` or `find` takes priority over the divider scroll.
4. **CSS**: `.visit-divider`: a thin line with the text in the middle, `color: var(--accent)`, small caps size like
   other dim labels.

## Edge cases

- The phone's clock vs Hermes's timestamps: both are the phone's clock (Hermes runs on the phone), so comparing is
  fine. Stored timestamps are seconds; `hydrate` converts them to ms already.
- Items without `at` (tools, notices) are skipped when looking for the first unseen; the divider still goes before
  the first unseen user/assistant item, which may sit after some tool cards. Acceptable.
- The chat preview shown while opening (`state.preview`) is read-only: don't show a divider there.
- A chat opened from a notification tap: same behaviour (that's the main use).

## Tests

**Unit** (`web/src/visit.test.ts`, happy-dom): `firstUnseen` with `since` null, before everything (returns -1 if the
first unseen is index 0), between two messages, after everything; items without `at` are skipped; `markVisit` trims
to 500 entries.

**E2E**: the mock's stored chats have messages at `timestamp: 1790000000` and `1790000060` (seconds), see the default
`session.resume` reply in `mock.cjs`.
1. Before opening a stored chat (e.g. `s-7`), set
   `localStorage['hm.visit.v1'] = JSON.stringify({ 's-7': 1790000030 * 1000 })` with `page.evaluate`. Open it: a
   `.visit-divider` with text `New since your last visit` is right before the `.msg.assistant` with `answer s-7`.
2. Open another chat, then reopen `s-7`: no divider now (the visit was marked when leaving).
3. A chat never opened before: no divider.
4. For the scroll: add a stored chat in the mock with a long first answer and set the visit between the two
   messages; check the divider's `boundingBox().y` is near the chat's top after opening.

## Spec and changelog

- `docs/SPEC.md` 3.2 (new subsection near "Unread chats"), 2.4.1 (`hm.visit.v1`), "While a chat opens" (initial
  scroll rule), source map (`web/src/visit.ts`).
- `CHANGELOG.md` entry.

## Out of scope

Syncing visits across devices, marking unread inside a chat that is already open.
