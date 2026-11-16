# 15: The island panel (what opens from the status chip)

The design is final: [docs/design/island-panel.md](../design/island-panel.md), with a prototype that shows every
animation: [island-panel-prototype.html](../design/island-panel-prototype.html). This file is how to build it: three
pull requests, one after the other, and the prompt that starts each session.

Unlike plans 01–14, this one is Android Java, not the web page. The rules in [AGENTS.md](../../AGENTS.md) apply; the
"Read first" part of this folder's README is about web plans and mostly doesn't.

## Before starting

- **One thing for the owner to confirm.** The design changes one sentence of the
  [fingerprint decision](../decisions/approval-needs-fingerprint.md): the card's Allow, for a chat not yet confirmed,
  opens the panel and asks for the fingerprint there instead of opening the whole app. The check itself stays. If the
  owner says no, leave that row of the design's section 6 as it is today and don't touch the decision file.
- **Shared files.** All three parts change `HermesService.java`; part 1 also changes `AndroidManifest.xml`. Don't run
  them side by side, or beside other work in `HermesService.java`.
- **A phone.** The motion can only be judged on a real phone. Take the device lock first
  (`tools/device-lock.sh`), install a test build that reuses the installed build number, and say plainly what was and
  wasn't seen.

## What gets built

### New files (`android/src/com/omarqaterge/hermesmobile/`)

| File | What it is |
|---|---|
| `IslandPanel.java` | The activity: a see-through window over the current app that draws the panel, runs the open/close/state-change motion, and sends the answers. Replaces `AnswerBox`. |
| `IslandState.java` | Plain Java, no Android classes: one unchangeable snapshot of what the panel should show (which state, and that state's fields), and the rule that picks the state. Tested with a plain JDK. |
| `IslandMotion.java` | Plain Java: the spring (closed form, as in the prototype's `spring`), the timer colour, the named curves and durations from the design's section 4. Tested with a plain JDK. |
| `IslandViews.java` | The drawn parts: the badge with its arc and pulse, the timer ring, the task bar, the rolling number, the buttons. Custom `View`s drawing on a `Canvas`; no layout files, as in the rest of the app. |

Tests: `tools/test_island_state.sh` and `tools/test_island_motion.sh`, in the style of `tools/test_pending_ask.sh`
(copy the class into a temp folder, compile with a test class, print PASS/FAIL lines). Add them to `tools/check.sh` and
the CI workflow where `test_pending_ask.sh` is listed.

### The contract between the service and the panel

- **The panel shows the service's state, never the intent's.** The intent says only which chat and which state the
  user tapped (`IslandPanel.EXTRA_SESSION`, `IslandPanel.EXTRA_KIND`: `approval`, `ask` or `working`; and
  `IslandPanel.EXTRA_CHOICE`, `once` or `session`, when the card's Allow opened it for the fingerprint).
- `HermesService.islandState()` (synchronized) builds an `IslandState` from the fields the notifications already use:
  `pendingApproval`, `approvalDeadline`, `pendingAsk`, `pending` (how many more wait), `lastStatus`, `lastTitle`,
  `lastTodo`, `lastSteps`, `lastOthers`, `lastMore`, `workingSince`, `stopping`, `answering`, `bgApp`, `bgThumb`,
  `doneInfo`. The state shown follows the chip's order: Permission, then Question, then Progress, then Done.
- `postStatus()` already runs on every change: it also calls `IslandPanel.refresh()`, which hands the visible panel a
  new snapshot on the main thread. The panel compares it with the one on screen and animates the difference.
- **Outcomes.** The panel must tell "sent", "failed" and "gone" apart. The service records the last outcome (which
  request, `allowed` / `denied` / `sent` / `failed` / `stopped`, a short reason, when) where it already knows it:
  `answerApproval` (after the POST), the `done` callback in `answerFromNotification`, `stopTurn`. The snapshot carries
  it. A request that vanished with no outcome was answered elsewhere.
- **Answers go the way they go today.** Allow/Deny: `HermesService.ACTION_APPROVE` with the session, `key`,
  `request_id`, `profile` and `choice` taken from the snapshot. A choice or typed answer: `ACTION_ANSWER` with kind
  `ask`. Stop: `ACTION_STOP`. Open chat: `MainActivity` through `IntentGate.mark`, with `session` and, for typed text,
  `draft`, exactly as `AnswerBox` does.
- **Fingerprint.** Before sending Allow, when `ApprovalLock.needed(...)`: `ApprovalLock.ask(panel, session, what,
  result)`. The panel forwards `onActivityResult` for `ApprovalLock.REQ` to `ApprovalLock.onResult` and calls
  `ApprovalLock.activityGone` in `onDestroy`, as `MainActivity` does.
- **Phone data.** No Allow from the panel: `Review in Hermux` opens the app. `answerApproval` already refuses anything
  else; keep it that way.

### The window

- Manifest: not exported, `singleTask`, empty task affinity, excluded from recents (as `AnswerBox` is), a translucent
  theme with no title and no window animation, `adjustResize`. No "show when locked".
- Draws behind the status bar and the cutout, so the pill can start inside the status bar: API 30+
  `setDecorFitsSystemWindows(false)` and inset types; below, the system-UI layout flags and
  `getSystemWindowInsetTop`. The keyboard's height comes from the IME inset (30+) or `adjustResize` (below).
- The dim is our own full-screen view, so it animates cheaply. The blur is `FLAG_BLUR_BEHIND` with
  `setBlurBehindRadius` on API 31+ when `WindowManager.isCrossWindowBlurEnabled()`; if changing it every frame drops
  frames on the phone, set it once when the dim is half way.
- The grow/shrink animates the panel's outline (`ViewOutlineProvider`, `setClipToOutline`), not its layout: the content
  is laid out once at its final size and revealed.
- Springs run on `Choreographer` frame time, so they are right at 60, 90 and 120 Hz.
- Every API newer than 26 sits behind a `Build.VERSION.SDK_INT` check (`tools/api-check.sh` fails otherwise): blur 31,
  inset types 30, the confirm/reject haptics 30, shadow colours 28.

### Spec, changes, status (in the same PR as the code they describe)

- Spec: `docs/spec/04-01-every-java-class.md` (the four classes; `AnswerBox` removed),
  `04-02-manifest-components-and-permissions.md` (the activity), `04-03-notifications.md` (what each tap opens; the
  `AnswerBox` rows become the panel; the confirmation flash), `07-02-every-tools-file.md` (the two tests), and a new
  section file for the panel itself next to 3.6 (its states, every on-screen text, every gesture), linked from
  `docs/SPEC.md`. `python3 tools/check_spec.py` must pass.
- One file in `changes/` per part, written for users.
- `docs/status/island-panel.md`: keep it current; delete `docs/status/chip-answer-field.md` in part 1 and carry its two
  open phone checks (locked phone; choices over 80 characters) into the new file.
- `docs/manual-tests.md`: a section "The island panel" with the phone checks below; replace "Answer field on the
  question chip".
- `README.md`: the "Answer from the island" part, once part 3 is in.

## The three parts

### Part 1: the panel and the Question state

The window, the open/close motion, dragging, reduced motion, `IslandState`, `IslandMotion`, the shared drawn parts,
and the Question state (design 5.2). The question card and its Answer button open the panel. `AnswerBox` is deleted
(class, manifest entry, spec, `answerBox(...)` in the service).

Done when: both JDK tests pass; `tools/check.sh` passes; on a phone, a question answered by a choice, by typed text
and through Open chat, from the island, each reaches Hermes; Back, a tap outside and a drag up each close it and
leave the question open; with the phone's animations off it fades.

### Part 2: the Permission state

Design 5.1: the timer ring, the answer row, the fingerprint, running out, answered elsewhere, more waiting, phone
data. The permission card's body opens the panel; the card's Allow for an unconfirmed chat opens it with
`EXTRA_CHOICE` (if the owner confirmed, see "Before starting"). Update the fingerprint decision file.

Done when: `tools/test_approval.py` and `tools/test_notification_unlock.sh` still pass; on a phone, Allow once with
the fingerprint, Allow this session, Deny, a cancelled fingerprint, letting it run out, and answering in the app
while the panel is open each behave as designed; a phone-data request offers no Allow.

### Part 3: Progress, Done, and the links between states

Design 5.3 and 5.4, the live changes between states (section 4, Changing state), the working card's tap, the
90-second close, and the two-second confirmation on the chip after a card-button answer (design section 6).

Done when: `tools/test_chip.py` still passes; on a phone, a turn with a task list shows the bar filling, a turn
without one shows the sweep, Stop stops it, a permission request arriving while the panel is open changes it in
place, the turn ending changes it to Done, and tapping the working card while Hermux uses an app still opens the live
viewer.

## Phone checks (for `docs/manual-tests.md`)

1. Open and close 20 times over different apps: no dropped frames, no flash of a system animation, the pill starts at
   the top centre.
2. Dark and light system theme, the largest font size, landscape, a tablet or a wide window.
3. Locked phone: tapping the card asks for the unlock first, then the panel shows.
4. The keyboard: with choices it stays down until the field is tapped; without, it opens; Send stays visible.
5. TalkBack: every control is named, the timer speaks at 30, 10 and 5 seconds.
6. A phone without a chip (Android below 16): the same panel from the pinned notification.
7. Battery: with the panel left open on Progress, it closes after 90 seconds; nothing animates once it is hidden.

## Prompts

Either paste the orchestrator prompt into one session, which runs the three parts with sub-agents and checks each
against the design, or paste prompts 1 to 3 into new sessions yourself, in order. Each part ends with a merged pull
request before the next starts.

### Orchestrator prompt

```text
You are running the build of the island panel from start to finish. You delegate the building to sub-agents, one
part at a time, and your own job is to make sure that what they build is what was designed. I want to hand this
over and come back to three merged pull requests and an honest report.

My answer to the open question in docs/plans/15-island-panel.md ("Before starting"): [yes / no]. Yes means the
card's Allow, for a chat not yet confirmed by fingerprint, opens the panel and asks for the fingerprint there.

Read first, fully: docs/design/island-panel.md (the design, final), docs/design/island-panel-prototype.html
including its script (the reference for every animation), and docs/plans/15-island-panel.md (the build plan and
prompts 1 to 3). The design is not yours or a sub-agent's to change. If a part of it turns out to be impossible
on Android as written, stop that part and ask me, with what you found; don't let a quiet substitute through.

Step 0. The design files may still be uncommitted on another branch. Get them onto main first with a docs-only
pull request (the design file, the prototype, the plan, docs/status/island-panel.md, the plans README row, the
spec 7.6 row), and wait for it to merge. Leave unrelated untracked files alone.

Then, for part 1, part 2 and part 3 in that order, never two at once (they all change HermesService.java):

1. Start one sub-agent in its own worktree from the current main. Give it the matching prompt from the plan word
   for word, with my yes/no filled into prompt 2. Add nothing that contradicts the design.
2. When it reports, don't take the report as the result. Check the work yourself, against the design:
   - Motion: every spring, curve, duration, delay, distance and scale in IslandMotion.java and where it is used,
     against the tables in the design's section 4 and the prototype's constants. List each mismatch.
   - Look: every colour, size, radius and text size against section 3.
   - Words: every on-screen text against section 5, exact to the character.
   - Behaviour: each state's cases in section 5 (sending, sent, failed, expired, answered elsewhere, more waiting,
     phone data), each row of the tap table in section 6, each rule in section 7. For each, find the code that
     does it; a case with no code is a finding.
   - The plan's "Done when" for that part, its tests, the spec, the changes/ file and the status file.
   - Run tools/check.sh yourself and read the output.
   - If a phone is connected and free (tools/device-lock.sh; exit code 75 means leave it), install the test build
     (it must reuse the installed build number) and go through that part's phone checks. Record the screen and
     compare the recording with the prototype, slowed down, for the opening, the closing and each state's main
     animation. Without a phone, say so; never report motion as verified from reading code.
3. Send every finding back to the same sub-agent as a numbered list, each with the design section it breaks.
   Check again after its fix. Repeat until nothing is left. Small slips that are quicker to fix than to explain
   you may fix yourself.
4. Only then let the pull request merge (auto-merge, CI passing), wait until it is on main, and start the next
   part from the new main.

Rules for you and every sub-agent: AGENTS.md in full. In particular the owner's git identity on every commit and
no AI attribution anywhere, no v* tags or releases, the spec updated in the same commits, one session per phone.

Stop and ask me only when the design can't be built as written, or when a decision of mine in docs/decisions/
would have to change beyond the one above. Otherwise keep going through all three parts.

At the end, report: the three pull requests; for each part, what you checked and how; what was seen on a phone
and what was not; every place the result still differs from the design, however small, and why.
```

### Prompt 1

```text
Build part 1 of the island panel: the panel itself and its Question state.

The design is final and is not yours to change: docs/design/island-panel.md. Open
docs/design/island-panel-prototype.html and read its script: it is the reference for every animation
(springs, curves, durations, sizes, colours), and the Java must match it. The build plan is
docs/plans/15-island-panel.md: read all of it, then build "Part 1" only.

Before writing code, read: android/src/.../AnswerBox.java (what you replace), HermesService.java
(askNotification, answerBox, answerFromNotification, postStatus, onEvent), PendingAsk.java, IntentGate.java,
docs/spec/04-03-notifications.md, and the decisions no-actions-from-locked-phone.md and
no-native-form-controls.md.

Build:
- IslandMotion.java and IslandState.java as plain Java with their JDK tests (tools/test_island_motion.sh,
  tools/test_island_state.sh), wired into tools/check.sh and CI like tools/test_pending_ask.sh.
- IslandViews.java and IslandPanel.java: the window, opening and closing, dragging, reduced motion, the header,
  the Question state with choices, the answer field, Open chat, sending, sent, failed and closed states.
- HermesService: islandState(), IslandPanel.refresh() from postStatus(), the outcome record for answers, and the
  question card and its Answer button opening the panel.
- Remove AnswerBox everywhere.

Keep: the panel never shows over the lock screen; it shows the service's live state, not the intent's; no API
newer than 26 without a Build.VERSION.SDK_INT check; no loop that keeps running once the panel is hidden.

Finish the way AGENTS.md says: spec updated in the same commits (plan section "Spec, changes, status"), a
changes/ file, docs/status/island-panel.md updated and docs/status/chip-answer-field.md deleted, tools/check.sh
passing, the owner's git identity on every commit and no AI attribution. If a phone is connected and free
(tools/device-lock.sh), install a test build that reuses the installed build number and go through the part 1
checks in the plan; record a short screen video of the opening if you can. Report what you saw on the phone, and
what you could not check. Open the pull request with auto-merge on.
```

### Prompt 2

```text
Build part 2 of the island panel: the Permission state. Part 1 is merged.

The design is final: docs/design/island-panel.md, section 5.1, with the motion in section 4 and in
docs/design/island-panel-prototype.html (buildApproval, resolveRow, timerColour). The build plan is
docs/plans/15-island-panel.md: read it, then build "Part 2" only.

Before writing code, read: ApprovalLock.java, HermesService.java (approvalNotification, approveIntent,
answerApproval, tickApproval, phoneDataEvent, unlockFirst), the decisions approval-needs-fingerprint.md,
no-actions-from-locked-phone.md and phone-data-read-only.md, and docs/spec/03-06-approvals-and-questions.md.

Build:
- The timer ring drawn every frame from the real deadline, its colour blend, the rolling seconds, the last-10-seconds
  pulse, one tick when it turns red.
- Deny, Allow once, Allow this session; the fingerprint through ApprovalLock.ask from the panel; the row turning
  into Sending, then Allowed or Denied; a failed send; running out; answered elsewhere; "N more waiting" and moving
  on to the next request; the phone-data variants with no Allow.
- The permission card's body opens the panel. The owner confirmed [yes / no: fill in before running] that the
  card's Allow for an unconfirmed chat opens the panel and asks for the fingerprint there; if yes, build it and
  update the decision file to say what changed and when; if no, leave that path opening the app.

Keep: no path that allows a command without the fingerprint check; a phone-data read is never allowed from the
panel; Deny stays one tap; the buttons that allow ignore touches while another app draws over them.

Finish as in part 1: spec, a changes/ file, the status file, tools/check.sh (test_approval.py and
test_notification_unlock.sh must still pass), the owner's git identity, no AI attribution, the phone checks for
part 2 if a phone is free, an honest report, a pull request with auto-merge on.
```

### Prompt 3

```text
Build part 3 of the island panel: Progress, Done, and the live changes between states. Parts 1 and 2 are merged.

The design is final: docs/design/island-panel.md, sections 5.3, 5.4, 4 ("Changing state") and 6, with the motion
in docs/design/island-panel-prototype.html (buildWorking, buildDone, show). The build plan is
docs/plans/15-island-panel.md: read it, then build "Part 3" only.

Before writing code, read: HermesService.java (workingNotification, stopTurn, doneNotification, setBgApp,
bgForChip, the flash handling in onEvent), hermes-plugin/hermes-mobile/__init__.py (_todo_summary and the status
event), and docs/spec/04-03-notifications.md ("The status notification" and "The Done chip: rules").

Build:
- Progress: the turning arc, the live headline, the rolling clock, the task bar with its finish animation, the
  sweep when there is no task list, other busy chats, the app-in-use row with Watch, Stop with Stopping and Stopped,
  the close after 90 seconds without a touch.
- Done, when the turn ends while the panel is open; Open chat clears the Done chip as the chip's own tap does.
- The panel changing in place when a permission request or a question arrives, or when one is answered and another
  waits.
- The working card's body opens the panel, except while Hermux uses an app for that chat (the live viewer, as
  today). After an answer from a card button, the chip confirms it for two seconds.
- README "Answer from the island" and docs/manual-tests.md.

Keep: the Done chip's rules as they are; nothing animating once the panel is hidden; the app-in-use picture never
on the lock screen.

Finish as in parts 1 and 2 (tools/test_chip.py must still pass). When this merges the work is done: delete
docs/status/island-panel.md and say in the report what still needs a phone.
```
