# The island panel (what opens from the status chip)

**State (2026-11-22):** parts 1 to 3 of 3 built. Part 1 (the Question state, `AnswerBox` removed) and part 2 (the
Permission state) are merged into `redesign`. Part 3 (Progress, Done, changing in place, the chip's confirmation of a
card answer) is PR 227 against `redesign`, under review. The owner's decision on the card's Allow (it opens the panel
and asks there) is in `docs/decisions/approval-needs-fingerprint.md`.

**Part 1:** the question card and its Answer button open the panel on the Question state; `AnswerBox` is removed.

**Part 2, review round 1:** the screen-lock result is taken only by the activity whose prompt is up, with that
prompt's own request code; two requests of one chat no longer share a notification button; with animations off the
Permission state still starts; no Allow past the deadline; the card's choice is used once.
**Design round:** sends that find the request gone show that without the Sending motion; the opening stagger, fades
and the grow bounce follow the design. **Review round 2:** the partly-covered rule (Android 10+) only on Allow once and
Allow this session while the fingerprint is not asked; a recreated panel never asks for the card's choice again; the
panel ends its prompt before its teardown; behind its own prompt every motion ends where it was going.

**Part 3, review round (78239d3):** the task bar's motions on a changing list, Progress and Done scrolling, one path
into Stopping, the chip's drawn check and cross, one Done per chat. **Re-check:** pop-ups and reminders back as on
`redesign` (see the question below); a stop counts from when it was sent and one the plugin accepted is never shown as
failed; new content takes no touch for 260 ms after a change in place; the stop failure line scrolls with the body,
and the scrolled part cuts its content at its edges. **Security review fixes:** monotonic change-in-place hold blocks
touches, activation keys (including on `Pill` and `GuardedText` during the Allow pause, tracking simultaneous held keys
in an `IslandMotion.HeldKeys` set on any key-down during the hold and consuming each held key's repeats and matching
key-up across the hold boundary, with swallow counted only on repeat count 0), focus and accessibility/click handlers until fade-in completes (Deny stays usable at once);
Allow once and Allow this session wait 320 ms after fade-in finishes (580 ms minimum, same with reduced motion,
extended by 200 ms on swallowed input, capped at +400 ms past base), and Allow once stays held while fading back in after a failed Deny;
Stop tracking is unified in one per-turn `IslandState.StopBook` fed by explicit plugin `turn_id` and `proc` fields on
`status` (for both `lastSession` and every `others` entry, with `since`), `done` flashes, and `/stop` responses (with
safe fallback for older plugins and missing turn identity): both chip and panel derive Stop state from `StopBook.view`,
a timeout or failure restores Stop on both chip and panel immediately (with no phantom 15 s wait on reopen and late
failures ignored), events from other chats or Hermes processes never end a turn's stop, all ad-hoc stop flags/counters
are deleted, `stopFate` prefers `!sameTurn` over a late failure, and the stop failure line scrolls into view after layout
via a one-shot `OnLayoutChangeListener` without moving focus.

**Open question for the owner:** while the panel is open, the service's heads-up pop-up for a new request or question
(and a request's 20 s / 40 s reminders) can drop over the panel's header. The design doesn't cover notification
changes, so they behave as they do with the panel closed. An earlier attempt to hold them back while the panel showed
the request was undone: a request could then run out unheard (a panel on Progress or Done with nobody looking, a
second request behind the one on screen, the panel hidden behind our own PIN screen). Whether to change this, and how,
is the owner's call.

**Next:** the owner's answer to the question above; the phone checks in `docs/manual-tests.md` ("The island panel"),
parts 1 to 3.

**Known limits:** the service keeps waiting requests and the last turn's reply in memory, so a restart (an app update)
drops them from the chip and the panel. A failed answer leaves the question off the chip, as for the card's own
buttons. The service's own "Couldn't send your answer" card drops down over the panel when a send fails, and so does
its "Couldn't stop Hermux" card when a stop fails. The panel follows waiting requests even with "When Hermux needs me"
off (the chip still respects it). Home from the PIN screen (Android 8-10, or the PIN fallback) leaves the panel and
that screen in the background until the request's deadline, when both go; nothing is sent. A turn that ends with no
reply heard closes the Progress state 2 s later instead of showing Done.

**Needs a real phone:**
- Parts 1 and 2: the motion and its frame rate, the blur's cost, the keyboard, TalkBack and the locked-phone path;
  the answer arriving and "Allowed" / "Denied" on screen (the emulators had no Hermes).
- Part 3: the Progress and Done states end to end with a real Hermes (a real stop, the chip's two-second confirmation
  after a card answer, the app-in-use row with a real app), a real rotation and reduced motion, the lock screen,
  battery once hidden.

**Links:** [design](../design/island-panel.md), [prototype](../design/island-panel-prototype.html),
[plan and prompts](../plans/15-island-panel.md), spec 3.22, 4.1, 4.3.
