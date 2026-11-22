### 3.22 The island panel

**Opens from:** the status chip's question card (tap) and its Answer button (4.3), outside the app. It is the Android
activity `IslandPanel` (4.1, 4.2), not a page of the web app. The design is `docs/design/island-panel.md`; its motion
follows `docs/design/island-panel-prototype.html`. This part builds the panel and its Question state; the Permission,
Progress and Done states come later (plan 15).

**What it is:** a dark panel that grows out of the top centre of the screen, where the island or the camera is, over
whatever app is open. Behind it the app dims (black at 40 %) and, on Android 12 and later when the phone allows blur
between windows, blurs. It is as wide as the screen less 12 dp each side, 420 dp at most, starts 8 dp under the status
bar and is never taller than the space above the keyboard (or the bottom of the screen) less 16 dp: the question and
the choices scroll inside it, the header and the field stay. Never shown over the lock screen: on a locked phone
Android asks for the unlock first.

**It shows the service's live state.** The panel reads `HermesService.islandState()` (an `IslandState`) when it opens
and after every change of the chip (`IslandPanel.refresh`, from `postStatus`), never what the card's intent carried.
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

#### Gestures

- **Back**, a **tap outside** the panel, or a **drag up** of more than 56 dp (or a quick flick up) closes it. Each
  leaves the question open on the chip.
- A shorter drag up springs back. A drag down gives a little (a fifth of the finger's travel, 26 dp at most) and
  springs back.
- Leaving the panel (Home, another app, the screen turning off) closes it at once and stops every movement.

#### Motion

Opening: the pill (132 by 34 dp) widens first, then drops to the panel's height, on springs; the rows fade in one
after the other from slightly higher and smaller; the dim and the blur come in together. Closing: the content fades,
the panel shrinks back to the pill and the dim and blur fade from where they are. Closed before the opening has
started, it simply goes. A pressed choice or button shrinks to 97 % and takes its pressed colour in 80 ms; released,
it springs back in 260 ms and its colour returns in 160 ms (a choice) or 120 ms (a button); the text button only
changes its fill. The system's own window animations are turned off. With the
phone's animations off (Developer options, or Remove animations in Accessibility), the panel only fades in and out,
in 120 ms, with no pulse. Every movement runs on the display's frame clock and only while it runs; nothing moves or
repeats once the panel is hidden.
