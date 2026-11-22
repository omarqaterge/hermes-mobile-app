# The island panel (what opens from the status chip)

**State** (2026-11-22): parts 1 and 2 of 3 built. Part 1 (the Question state, `AnswerBox` removed) is merged into
`redesign`. Part 2, the Permission state, is in review (branch `island-panel-part2`, against `redesign`): the
permission card's body and, while the fingerprint is needed, its Allow buttons open the panel on that request, with
the timer ring, Deny / Allow once / Allow this session, the fingerprint asked every time through
`ApprovalLock.askOnce`, a one-use grant the service checks (`approveFromPanel`), Sending then Allowed or Denied, a
failed send, running out, answered elsewhere, "N more waiting" and moving on to the next request, and phone-data
requests with no Allow. The owner's decision (the card's Allow opens the panel and asks there) is recorded in
`docs/decisions/approval-needs-fingerprint.md`. Seen on Android 15 and Android 8.0 emulators without Hermes, so the
answer was never seen arriving and "Allowed"/"Denied" were not seen on screen.

**Review round 1 (2026-11-22):** the security review's findings are fixed on the branch: the screen-lock result is
taken only by the activity whose prompt is up, with that prompt's own request code, and a cancelled prompt's screen is
closed; two requests of one chat no longer share a notification button; with animations off the Permission state
still starts; no Allow past the deadline; the card's choice is used once; on Android 10+ the answer buttons also
ignore touches while another app covers part of the window.

**Design round (2026-11-22):** a send that finds the request gone or run out shows that without the Sending motion;
"N more waiting" is part of the opening stagger and "Allow this session" arrives with the buttons; the expired Open
chat fades in on the out curve; the ring's pulse and resize, and each view's fade, replace the previous one; a failed
Deny on phone data or an unreadable request shows no second Open chat; an empty plain line leaves no gap; the grow
bounce stays inside the card. The panel follows every waiting request whatever "When Hermux needs me" says. Back from
the Android 8 PIN screen its keyboard is put away once the panel has focus.

**Next:** the phone checks in `docs/manual-tests.md` ("The island panel"), for parts 1 and 2. Then part 3 (Progress,
Done, the links between states). It changes `HermesService.java` too, so it waits for part 2.

**Known limits:** the service keeps waiting requests in memory, so a restart (an app update) drops them from the chip
and the panel. A failed answer leaves the question off the chip, as for the card's own buttons. The service's own
"Couldn't send your answer" card drops down over the panel when a send fails (as it did for the card's buttons). The
panel follows waiting requests even with "When Hermux needs me" off (the chip still respects it). Home from the PIN
screen (Android 8-10, or the PIN fallback) leaves the panel and that screen in the background until the request's
deadline, when both go; nothing is sent.

**Needs a real phone:** yes. The motion and its frame rate, the blur's cost, the keyboard, TalkBack and the
locked-phone path can only be judged on one.

**Links:** [design](../design/island-panel.md), [prototype](../design/island-panel-prototype.html),
[plan and prompts](../plans/15-island-panel.md), spec 3.22, 4.1, 4.3.
