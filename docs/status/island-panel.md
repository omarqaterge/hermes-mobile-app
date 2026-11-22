# Island panel

**State (2026-11-22):** parts 1 to 3 (Question, Permission, Progress and Done) are built; part 3 is PR 227 against
`redesign`, under review. The design is `docs/design/island-panel.md`, the plan `docs/plans/15-island-panel.md`, the
spec 3.22.

**Open question for the owner:** while the panel is open, the service's heads-up pop-up for a new request or question
(and a request's 20 s / 40 s reminders) can drop over the panel's header. The design doesn't cover notification
changes, so they behave as they do with the panel closed. An earlier attempt to hold them back while the panel showed
the request was undone: a request could then run out unheard (a panel on Progress or Done with nobody looking, a
second request behind the one on screen, the panel hidden behind our own PIN screen). Whether to change this, and how,
is the owner's call.

**Next:** the owner's answer to the question above; the phone checks in `docs/manual-tests.md` for part 3.

**Needs a real phone:** the Progress and Done states end to end with a real Hermes (a stop that really succeeds, the
chip's two-second confirmation after a card answer, the app-in-use row with a real app), the lock screen, battery once
hidden.

**Links:** [spec 3.22](../spec/03-22-island-panel.md), [design](../design/island-panel.md),
[plan](../plans/15-island-panel.md).
