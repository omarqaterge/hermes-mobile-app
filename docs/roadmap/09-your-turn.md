# 09: "Your turn" steps

Read [README.md](README.md) first, and the decision
[no-hidden-display-app-driving](../decisions/no-hidden-display-app-driving.md).

**Effort:** M. **Areas:** plugin, Java, web. **Depends on:** none. **Android:** 14 and later (as `phone_app`).

## Goal

When Hermux uses an app on the hidden screen and reaches the step that commits the user (Pay, Place order, Send to a
person, Delete, Post), it **stops and hands the step to the user**: "Your turn: press Pay in <app>". The user looks,
presses it or doesn't, and tells Hermux to carry on. Today nothing makes that pause happen; it depends on the model
choosing to.

## What exists today

- `phone_app` has `hand_over` (puts the app on the real screen and ends Hermux's use of it) and the viewer has
  **Take over** and **Stop** (spec 3.10, 5.2).
- Asked once per app per chat; banking, payment, password and 2FA apps are refused unless allowed in Settings
  (`SENSITIVE`, `bgapps.json`).
- No rule about *which step* is the user's, and after a hand-over the turn simply goes on without knowing what the
  user did.

## Owner decisions needed

1. **Which steps are the user's.** Recommended two groups:
   - **Always the user's, in every access mode:** money and irreversible account steps (pay, buy, order, transfer,
     subscribe, confirm purchase, delete account).
   - **Asks first, unless the chat is in Full access:** speaking as the user to other people (send, post, reply,
     publish, share to a person).
2. **Wait how long.** Recommended: 10 minutes, then the tool answers "the user didn't respond" and the turn goes on
   without the step.

## Design

### The guard (plugin, `phone_app.py`)

- A new pattern list `COMMIT_WORDS`, built like `SENSITIVE`: generic words in several languages, two groups (`money`
  and `speak`). Best effort and named so in the docs: it is a guard rail, not a wall.
- Before `tap`, `long_press`, `submit` and each of those inside `steps`, the tool takes the name of the element the
  host resolved (the element list already names buttons with the words inside them) and, for `submit`, the field's
  keyboard action label. If it matches:
  - group `money`: refused with "This step is the user's. Call `your_turn` with what they should press." Always.
  - group `speak`: the same refusal, unless the chat is in Full access (`auto_mode.py` knows the chat's mode).
- A tap by `coordinate` has no element name: the host is asked which element is at that point first (the list from
  the last capture; no name found means no match, and that gap is stated in the security docs).
- In `steps`, a match stops the sequence at that step, like a failure, with the screen as it is.

### The new action `your_turn`

`phone_app(action="your_turn", text="Press Pay to buy the two tickets (€48)")`, `text` at most 200 characters.

1. The tool sends a `bgapp` event with `state: "your_turn"` and the text, then **waits** for the user, up to 10
   minutes. The wait is on a `threading.Event` set by a new plugin route; nothing polls.
2. The app (`HermesService`) treats it like a question: the status chip says "Your turn in <app>", a notification on
   the approvals channel says "Your turn: <text>" (it opens the viewer; it has **no action buttons**, so nothing
   happens from the lock screen), and the wake lock is held as for an approval (its deadline plus 5 s; spec 2.5).
3. The viewer (`BgViewer` in `BgApp.tsx`) shows a banner with the text and three buttons in place of the usual two:
   - **Do it here**: `bgAction('take_over')`; the app comes to the real screen. Hermux's card changes to "Waiting for
     you in <app>" with **Done, carry on** and **I didn't do it**.
   - **Skip this step**: answers `skipped` without showing the app.
   - **Stop**: as today.
4. The answer goes to the plugin through `POST /bgapps/turn` (`{ session, answer: "done" | "not_done" | "skipped" }`,
   over the page's normal authenticated route). The tool returns `{"user": "<answer>"}` plus the fixed sentence
   "Don't repeat the step yourself."
5. After **Do it here** the hidden screen no longer holds the app. If the model needs to check the result it opens
   the app again (same approval, already given for this chat).

The prompt section `hermes-mobile.phone` gains one sentence: "Steps that pay, order, send to a person or delete are
the user's: call `your_turn`."

### Locked phone

`your_turn` while the phone is locked: the notification is posted, and tapping it asks for the unlock first, like
every notification that opens the app (`MainActivity.EXTRA_UNLOCK`). Nothing is done from the lock screen.

## Build steps

1. `phone_app.py`: `COMMIT_WORDS`, `_commit_group(name)`, the guard in the action paths, the `your_turn` action and
   its wait, the `bgapp` state; the route in the plugin's dashboard routes. `tools/test_phone_app.py` gets a section.
2. `HermesService` (`bgapp` event: the new state, chip text, notification), `PendingAsk`-style pure logic for the
   deadline if needed (`tools/test_pending_ask.sh` neighbour).
3. `bgapp.ts` (state `your_turn`, the waiting card), `BgApp.tsx` (banner, buttons), `toolsay.ts` ("Waiting for you in
   <app>").
4. Mock: a `bgapp` state `your_turn`; e2e at the end of `09-chat-tools.cjs` (where the background-app checks are; if
   they live elsewhere, there).

Shared files touched: `HermesService.java`, `styles.css`, `mock.cjs`.

## Tests

- Plugin: each group in three languages; a row named "Pay, €48" matches; "Payment methods" (a settings row) matches
  too and is accepted as a false positive the user resolves with one tap; Full access lets `speak` through but not
  `money`; a match inside `steps` stops there; the wait ends on answer, on timeout and when the turn is stopped.
- E2E: the banner and three buttons; Done, I didn't do it and Skip each call the route; the viewer closes on Stop.
- Phone: a real purchase flow up to the Pay button in a shopping app's test or cart screen (stop there); the
  notification with the app closed; the locked-phone path; one app with a secure (black) screen.

## Spec and changes

Spec 5.2 (`your_turn`, the guard, `COMMIT_WORDS`), 5.3, 5.4, 3.10 (banner, card state), 4.3 (notification), 4.4
(`bgapp` state), 2.3 (the guard's limits). `docs/security.md`. A decision file for decision 1. `changes/`, `rank: big`.

## Check first

- That the host's answer for `tap` by `target` and by `element` includes the resolved element's name before the tap
  happens (the guard needs it before, not after; today the host resolves and taps in one request, so a
  resolve-only request may be needed in `BgHost`).
- That holding a tool call for 10 minutes does not trip Hermes's own tool or inactivity timeouts.
- How `/yolo` and Full access are told apart in the plugin today (`auto_mode.py`).

## Out of scope

Recognising commit steps from a screenshot, a per-app list of "safe" buttons, steps in apps started on the real
screen through `rish` (there is no hidden screen and no guard there).
