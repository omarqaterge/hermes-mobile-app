# 03: Chat scrubber (jump between your messages)

Read [README.md](README.md) first.

## Goal

In a long chat, a thin rail on the right edge of the message list has one tick per message the user sent. Dragging a
finger along the rail shows a bubble with the message under the finger ("Fix the login bug…"); letting go scrolls the
chat to that message. The tick of the message currently at the top of the screen is highlighted.

T3 Code: `apps/web/src/components/chat/TimelineMinimap.tsx` (+ `MessagesTimeline.logic.ts`): a strip of marks, a
magnified hover preview, click to jump. Ours is the touch version.

## What exists today

- `web/src/App.tsx`, `Chat`: the scroller `.chat`. It draws only the last `WINDOW` (40) items at first
  (`win.start`); scrolling near the top draws 40 more. Search (`find`) and message-search jumps (`jump`) already
  scroll to an item that may be above the window: they `setWin({ key, start: Math.max(0, idx - 3) })`, return, and
  run again once it is drawn, then call `unfold(idx)` for folded tool runs. Reuse this exact pattern.
- Children of `.chat`: an optional `.chat-earlier` sentinel (when `start > 0`), then exactly one element per drawn
  item, so item `idx` is `el.children[(start > 0 ? 1 : 0) + idx - start]`.
- Gestures on the chat: `web/src/swipe.ts` (`installSwipeToDrawer`, swipe right = drawer, swipe left = canvas) and
  `web/src/pullbtw.ts` (pull up at the end). Each has a `SKIP` selector list of elements that never start a gesture.
- The ↓ "Scroll to the newest message" button (`.jump`) sits bottom right.

## Design

- Shown only when the chat has at least 6 user messages **and** the scroller's `scrollHeight` is more than 3 × its
  `clientHeight`. Hidden while the find bar is open (`state.find`) and while a chat is opening/previewing.
- **Rail**: absolutely positioned on the right edge of the chat area (not inside the scrolling content), from 12 px
  below the top to 72 px above the bottom (clear of the ↓ button). Visual width 3 px, touch width 28 px. Colour
  `var(--dim)` at low opacity; ticks are 2 px tall lines, the current one `var(--accent)` and wider.
- Tick `k` of `n` (user messages in order) sits at `k / (n - 1)` of the rail height. Positions are by message order,
  not pixels, because most of the chat isn't drawn.
- **Drag**: touchstart on the rail starts scrubbing (the rail widens to 6 px). While moving, the nearest tick is
  "picked": a bubble left of the finger shows the first 80 characters of that message (one line, ellipsis) and its
  number `12 / 30`. `haptic()` once each time the picked tick changes. Release scrolls to that user message so it
  sits 8 px below the top, and flashes it (reuse the `hit-flash` class the jump code uses).
- A single tap on the rail jumps to the nearest tick too.
- Accessibility: the rail is `role="slider"` with `aria-label` `Jump to a message`, `aria-valuemin` 1,
  `aria-valuemax` n, `aria-valuenow` the current message number, `aria-valuetext` its preview. ArrowUp/ArrowDown move
  one message when focused (keyboard users on tablets).

## Implementation steps

1. **New module `web/src/scrub.ts`** (pure):
   ```ts
   export interface Mark { idx: number; text: string }      // idx = index in items
   export const SCRUB_MIN = 6
   export function userMarks(items: ChatItem[]): Mark[]       // user items in order, text = first line, trimmed, max 80 chars
   export function nearestMark(marks: Mark[], fraction: number): number  // index into marks, fraction clamped 0..1
   export function currentMark(marks: Mark[], topIdx: number): number    // last mark with idx <= topIdx (0 when none)
   ```
   A user message that is only attachments gets text like `🖼 photo.jpg` (use the first image/file name).
2. **Component `Scrubber`** (new file `web/src/components/Scrubber.tsx`), props:
   `{ marks: Mark[]; current: number; onPick: (markIndex: number) => void }`. It renders the rail, ticks and the
   preview bubble. Handle `onTouchStart/Move/End` and `onPointerDown/Move/Up` (pointer for mouse/tablet):
   `fraction = (clientY - rail.top) / rail.height`. Call `e.stopPropagation()` in all of them, and `preventDefault()`
   in touchmove so the chat doesn't scroll while scrubbing (register the touchmove listener with
   `{ passive: false }` through a ref; React's `onTouchMove` is passive).
3. **Gestures**: add `.scrubber` to `SKIP` in both `web/src/swipe.ts` and `web/src/pullbtw.ts`.
4. **Wire it into `Chat` (`App.tsx`)**:
   - `const marks = useMemo(() => userMarks(items ?? []), [items])`.
   - Track the current top item on scroll: in the existing `onScroll`, throttle with `requestAnimationFrame`; find the
     first child of `.chat` whose `getBoundingClientRect().bottom > scroller.top + 1`, convert its child index to an
     item index (reverse of the formula above), then `setCurrent(currentMark(marks, idx))`. Only update state when the
     number changes.
   - Add a `scrubTo` state (`number | null`, an item index). `onPick(k)` sets `scrubTo = marks[k].idx`.
   - Add an effect copying the `find` effect's structure: if `scrubTo < start` → `setWin(...)` and return; if
     `unfold(scrubTo)` → return; else get the node, `stick.current = false`, scroll so the node's top is 8 px below the
     scroller top (`el.scrollTop += node.getBoundingClientRect().top - el.getBoundingClientRect().top - 8`), add
     `hit-flash` for 2.5 s, then `setScrubTo(null)`.
   - The rail must not scroll with the content. `.chat` is the scroll container, so render the `Scrubber` as a sibling
     of `.chat` inside a wrapper with `position: relative`, or position it `fixed` using the scroller's rect.
     Simplest: wrap the returned `.chat` element in `<div className="chat-wrap">…<Scrubber/></div>` and move the
     flex sizing from `.chat` to `.chat-wrap` in `styles.css`. Check that the ↓ button, `pull-hint` and the skeleton
     still look the same (compare screenshots before/after).
5. **CSS**: `.scrubber`, `.scrubber.active`, `.scrub-tick`, `.scrub-tick.on`, `.scrub-bubble`. Respect
   `prefers-reduced-motion` (no width transition).

## Edge cases

- Items change while scrubbing (a streaming reply): keep the picked mark index; recompute on release.
- Chats with folded tool runs: user messages are never folded, but the target can be inside the window only after
  unfolding nothing; still call `unfold` for safety (it returns false).
- Wide screens with the docked chat list (`sidepanel.ts`): the rail belongs to the chat column, so it sits at the
  chat column's right edge, left of a docked canvas panel.
- RTL is not supported elsewhere in the app; ignore.

## Tests

**Unit** (`web/src/scrub.test.ts`): `userMarks` skips non-user items and shortens text; `nearestMark` at 0, 1, 0.5,
out-of-range values, and with 1 mark; `currentMark` before the first mark, between marks, after the last.

**Mock**: add a stored chat `s-long` to the `session.resume` case in `mock.cjs` with 30 pairs:
`{ role: 'user', text: 'question N', row_id: N }`, `{ role: 'assistant', text: 'answer N\n\n' + 'line\n'.repeat(15) }`.
Make it reachable the way other tests open stored chats (search `s-card` in `test.cjs` to see how they open one,
e.g. via `window.hermesOpenSession('s-long')`).

**E2E**:
1. Open `s-long`. Check `.scrubber` is visible and has 30 `.scrub-tick`.
2. Drag from the rail's bottom to its top with `page.mouse` (pointer events) or touch: during the drag
   `.scrub-bubble` contains `question 1`; after release the `.msg.user` with `question 1` is within the viewport
   (`boundingBox().y` between the chat's top and top + 100).
3. A short chat (the 2-message mock chats) shows no `.scrubber`.
4. Swipe-to-drawer is not triggered by a horizontal move that starts on the rail (`.drawer` stays closed).

## Spec and changelog

- `docs/SPEC.md` 3.2 layout table (new row: Scrubber, with its aria-label `Jump to a message`), "Windowing, folding,
  search jump" (scrubber jumps use the same mechanism), "Gestures that move between layers" (the rail is excluded),
  source map (`web/src/scrub.ts`, `web/src/components/Scrubber.tsx`).
- `CHANGELOG.md` entry.

## Out of scope

Ticks for Hermes's replies or tool runs, a zoomed "fisheye" preview like T3's, desktop mouse-wheel on the rail.
