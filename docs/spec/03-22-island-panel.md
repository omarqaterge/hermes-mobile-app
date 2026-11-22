### 3.22 The island panel

**Opens from:** the status chip's question card (tap) and its Answer button, and the permission card (tap) and its
Allow once and Allow session while "Confirm approvals with fingerprint" needs the fingerprint (4.3), outside the app.
It is the Android activity `IslandPanel` (4.1, 4.2), not a page of the web app. The design is
`docs/design/island-panel.md`; its motion follows `docs/design/island-panel-prototype.html`. Built so far: the panel,
its Question state and its Permission state (`IslandPermission`); the Progress and Done states come later (plan 15).

**What it is:** a dark panel that grows out of the top centre of the screen, where the island or the camera is, over
whatever app is open. Behind it the app dims (black at 40 %) and, on Android 12 and later when the phone allows blur
between windows, blurs. It is as wide as the screen less 12 dp each side, 420 dp at most, starts 8 dp under the status
bar and is never taller than the space above the keyboard (or the bottom of the screen) less 16 dp: the question and
the choices scroll inside it, the header and the field stay. Never shown over the lock screen: on a locked phone
Android asks for the unlock first.

**It shows the service's live state.** The panel reads `HermesService.islandState()` (an `IslandState`) when it opens
and after every change of the chip (`IslandPanel.refresh`, from `postStatus`), never what the card's intent carried.
That state is whatever the service still holds, whatever "When Hermux needs me" says (the switch decides only whether
notifications are posted): once the panel is open it follows every waiting question and permission request.
Opened when the question is no longer waiting (answered or expired between the tap and the panel), it opens with the header only, the headline "This question is closed" (design 5.2, No longer open), and closes about 0.9 s later: a question that is gone can't be answered.

#### The Question state

| Part | What it shows |
|---|---|
| Badge | The icon in gold on a dark round badge; a gold ring pulses outward three times when the panel opens. |
| Chat line | The chat's title, or "Hermux"; "· bot" after it for a bot that isn't `default` (`IslandState.chatLine`). |
| Headline | "Hermux asks". |
| Question | The question as Hermux wrote it, or "Hermux has a question" when it is empty; up to six lines, then it scrolls. |
| Choices | One row per choice (five at most, each whole); none when Hermux gave none. A tapped row turns gold with a spinner, then a check; the others fade. |
| Field | "Type your answer", with a round 40 dp Send button inside it (touchable over 48 dp): quiet while the field is empty, gold with an arrow once there is text. The keyboard's Send key sends too. With no choices the field takes the focus and the keyboard opens; with choices the keyboard stays down until the field is tapped. |
| Open chat | A text button drawn 40 dp tall with 4 dp of room above and below, all of it touchable. Opens the chat in the app, with any typed text in the composer, and closes the panel. |
| Grab bar | A short bar at the bottom: the panel can be dragged. |

A batch of questions (`single: false`) does not open the panel: the card opens the app, as before.

**Sending.** A choice or Send hands the answer to the service (`ACTION_ANSWER` with kind `ask`, the same path as the
card's choice buttons). The service records how it went (`HermesService.noteOutcome`, an `IslandState.Outcome`):

- **Sent:** the check is drawn, the phone gives a short confirming buzz, TalkBack says "Sent", and the panel closes
  about 0.85 s later. The chip goes back to the status.
- **Failed** (the app was not running, or the answer was not delivered, or no word in 15 s, `SEND_TIMEOUT_MS`): the
  line "Couldn't send your answer. Open the chat; your text is kept." in red, and a gold Open chat button that opens
  the chat with the typed text. The service has already taken the question off the chip when it handed the answer
  on, as for the card's own buttons, and posts its own "Couldn't send your answer" card, which also opens the chat
  with the text.
- **Closed elsewhere** (answered in the app, expired, or replaced by a newer question while the panel is open): the
  headline changes to "This question is closed", the choices and the field fade, and the panel closes about 0.9 s
  later. Open chat still works. When the question ran out of time (10 minutes, recorded by the service), the phone
  also gives the reject buzz (Android 11+; older: one long tap); answered elsewhere, it stays quiet.

Tapping the card again on a newer question while the panel is open changes the panel in place (`swapTo`): the old content fades out in 100 ms and takes no touch meanwhile, so a late tap can't answer the new question with an old choice.

#### The Permission state

| Part | What it shows |
|---|---|
| Badge | The shield in gold on the dark round badge (no pulse). |
| Chat line | As in the Question state (`IslandState.chatLine`). |
| Headline | "Run a command?"; for a phone-data read "Let Hermux read your phone?"; for one whose text can't be read "Unreadable phone data request". |
| Timer | A 44 dp ring on the right, 3 dp thick with round ends on a faint track, with the seconds left inside. It drains clockwise from the top every frame from the request's real deadline (not in one-second steps); gold above half the time, amber down to a fifth, red below, blended around each line (`IslandMotion.timerColour`). The number rolls each second; in the last 10 seconds the ring pulses with each second (to 109 % and back, 260 ms); below a fifth the number takes the ring's colour and the phone ticks once as it turns red. TalkBack says "30 seconds left", "10 seconds left" and "5 seconds left". |
| Body | The plain-words line with its first letter capitalised (left out when Hermes sent none but a command), then the command in a dark block with a gold `$`: four lines, then the block scrolls. A phone-data read has no command block: its body is the app's own wording of the request. |
| Buttons | "Deny" (red) on the left, "Allow once" (gold) on the right, split 36 % / 64 %. While the fingerprint is needed (`ApprovalLock.needed`), "Allow once" carries a small fingerprint before its label. A phone-data read: "Deny" and "Review in Hermux" (gold; opens the chat, whose own sheet asks for it). One that can't be read: "Deny" and "Open chat" (quiet). |
| Text button | "Allow this session" under the buttons, when the request offers it (never for phone data); drawn 40 dp tall with 4 dp of room above and below, all of it touchable. |
| More waiting | "1 more waiting" / "N more waiting" when other requests wait (`IslandState.moreWaiting`), kept current. |

**Which request.** The panel shows the request tapped (`EXTRA_SESSION`, `EXTRA_REQUEST`) while it still waits,
otherwise the oldest one waiting (`IslandState.approvalToShow`), from the service's live list
(`HermesService.islandApprovals`, carried whatever "When Hermux needs me" says, as the whole state is, so a panel the user opened follows the
live request). Opened with none waiting, it shows the header with "Answered in the app" and closes about 0.9 s later.

**Answering.** Deny is one tap and never asks. Allow once and Allow this session, while the fingerprint is needed, bring
up the phone's own fingerprint or screen-lock prompt ("Allow Hermux to run this?", the command under it, "Confirm it is
you.") every time (`ApprovalLock.askOnce`); the panel waits behind it, its timer still running, and a cancel sends
nothing and leaves the panel as it was. The card's Allow opens the panel with the choice (`EXTRA_CHOICE`) and the
prompt comes up at once, but only when the request on screen is the very one tapped. Before Android 12 that Allow
reaches the service, which also closes the notification shade (`ACTION_CLOSE_SYSTEM_DIALOGS`, refused from Android 12)
so the panel and its PIN screen open in front; the PIN screen's keyboard is put away when its result comes back, and again once the panel has its focus back (`onWindowFocusChanged`; the result comes first, before the keyboard can be hidden from the panel). The
request still runs out while the prompt is up (`deadlineRun`, even when the timer is still because the panel is hidden
behind a PIN screen), and an "ok" that comes after the deadline sends nothing and shows the request as run out. Past the deadline no
Allow is sent at all, with or without the fingerprint: the panel shows it as run out, and `approveFromPanel` refuses it
too. The card's choice is used once (taken off the intent), so a panel made again from it doesn't ask by itself. After
the tap (and an "ok"), the
other button fades out in 120 ms and "Allow this session" gives its room back; the tapped button grows to the full
row in 320 ms on back and says "Sending…" with a spinner (its bounce stays inside the card); the timer ring fades
away. The answer is handed to the service first: a request found run out or gone meanwhile is shown as such and the
row never turns into Sending. The answer goes to
`HermesService.approveFromPanel`, which answers only a request still waiting, with the service's own copy of it, and
never allows a phone-data read, a request that can't be read, or anything on a locked phone; while the fingerprint is
needed, only with the one-use grant the prompt filed for that request and choice. Then:

- **Allowed or Denied:** once the button has finished growing, it turns green with a drawn check and "Allowed" (or
  "Allowed for this session"), or red with a drawn cross and "Denied"; the phone gives the confirming buzz (Android
  11+) and TalkBack reads the label. The panel holds 0.9 s, then changes in place to the next request waiting, or
  closes.
- **Not sent** (the POST failed, the service refused, or no word in 15 s): the two buttons come back with the red line
  "Couldn't send your answer. Try again, or open the chat." above them, and the text button becomes "Open chat" (not
  for a phone-data or unreadable request, whose row already has "Review in Hermux" or "Open chat"). The
  timer runs on; another Allow asks for the fingerprint again. The red line goes as soon as the next answer is sent,
  or when the request is answered elsewhere. The service also posts its own "Couldn't send your answer" card.
- **Run out** (the timer at zero, or the request gone within 1.5 s of its deadline): the headline changes to "This
  request expired", the body fades to 32 %, the ring to 35 %, the buttons become one quiet "Open chat" (fading in
  over 200 ms on out), the phone gives
  the reject buzz, and the panel closes after 2.6 s.
- **Answered somewhere else** (in the app or on the card; it vanished earlier with no answer of the panel's): the
  headline changes to "Answered in the app", the buttons fade, and the panel closes after 0.9 s.

Either of the last two while the prompt is up takes the prompt down (`ApprovalLock.activityGone`); a late "ok" for a
request no longer on screen sends nothing. Every answer button ignores touches while another app draws over it, and on Android 10+ while another app's window
covers any part of the panel's window (`FLAG_WINDOW_IS_PARTIALLY_OBSCURED`).

#### Gestures

- **Back**, a **tap outside** the panel, or a **drag up** of more than 56 dp (or a quick flick up) closes it. Each
  leaves the question open on the chip.
- A shorter drag up springs back. A drag down gives a little (a fifth of the finger's travel, 26 dp at most) and
  springs back.
- Leaving the panel (Home, another app, the screen turning off) closes it at once and stops every movement. The one
  exception is the panel's own fingerprint or screen-lock screen (an activity on Android 8–10, and for the PIN): the
  panel stays behind it with everything still, and its result reaches the very request it was asked for. A panel
  still hidden a second after that prompt ended goes. Home from the PIN screen leaves both in the background
  unanswered; at the request's deadline the panel goes and takes the PIN screen with it. A panel that goes ends its
  prompt as a cancel, so nothing is sent.

#### Motion

Opening: the pill (132 by 34 dp) widens first, then drops to the panel's height, on springs; the rows fade in one
after the other from slightly higher and smaller (in the Permission state: the header, the body, the buttons with
Allow this session, then "N more waiting"); the dim and the blur come in together. Closing: the content fades,
the panel shrinks back to the pill and the dim and blur fade from where they are. Closed before the opening has
started, it simply goes. A pressed choice or button shrinks to 97 % and takes its pressed colour in 80 ms; released,
it springs back in 260 ms and its colour returns in 160 ms (a choice) or 120 ms (a button); the text button only
changes its fill. The system's own window animations are turned off. With the
phone's animations off (Developer options, or Remove animations in Accessibility), the panel only fades in and out,
in 120 ms, with no pulse; in the Permission state the timer still drains and counts, TalkBack still speaks the seconds,
the request still runs out on time, and the card's Allow still brings up the fingerprint at once. Every movement runs on the display's frame clock and only while it runs; nothing moves or
repeats once the panel is hidden.
