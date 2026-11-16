# The island panel (what opens from the status chip)

**State** (2026-11-16): designed, not built. The design is final: one small panel that grows out of the top of the
screen when the chip's card is tapped, with four states (Permission, Question, Progress, Done). It replaces
`AnswerBox`. Nothing in the app has changed yet.

**Next:** the owner confirms one point (the card's Allow, for a chat not yet confirmed by fingerprint, opens the panel
and asks there instead of opening the whole app), then the three parts are built one after the other with the prompts
in the plan. All three change `HermesService.java`, so they don't run beside each other or beside other work there.

**Needs a real phone:** yes. The motion, the blur, the keyboard and the locked-phone path can only be judged on one;
the plan lists the checks.

**Links:** [design](../design/island-panel.md), [prototype](../design/island-panel-prototype.html),
[plan and prompts](../plans/15-island-panel.md), [the answer box it replaces](chip-answer-field.md), spec 4.3.
