# The island panel (what opens from the status chip)

**State** (2026-11-22): part 1 of 3 built, in review (branch `island-panel-part1`, against `redesign`). The question
card and its Answer button open the panel on its Question state: choices, typed answer, Open chat, sending, sent,
failed and closed elsewhere; opening and closing motion, dragging, reduced motion. `AnswerBox` is gone. Seen on
Android 15 and Android 8.0 emulators; not yet on a phone.

**Next:** the phone checks in `docs/manual-tests.md` ("The island panel"), including the two carried over from the
answer box (the locked phone; choices over 80 characters). Then part 2 (the Permission state; the owner's point about
the card's Allow for an unconfirmed chat is still open) and part 3 (Progress, Done, the links between states). All
three change `HermesService.java`, so they run one after the other.

**Known limits:** the service keeps the open question in memory, so a restart (an app update) drops the chip and the
panel until the next question. In part 1 a permission request arriving while the panel is open does not change it
(part 3 does). A failed answer leaves the question off the chip, as for the card's own buttons: the service takes
it off when it hands the answer on and posts its own "Couldn't send your answer" card.

**For part 2:** `IslandPanel.onStop` ends the panel (`finishNow`) whenever it is hidden. The fingerprint or PIN
screen `ApprovalLock` brings up hides it too, so as written the panel would close while the user confirms an Allow.
Part 2 must keep the panel through that screen (skip `finishNow` while its own credential request is up).

**Needs a real phone:** yes. The motion and its frame rate, the blur's cost, the keyboard, TalkBack and the
locked-phone path can only be judged on one.

**Links:** [design](../design/island-panel.md), [prototype](../design/island-panel-prototype.html),
[plan and prompts](../plans/15-island-panel.md), spec 3.22, 4.1, 4.3.
