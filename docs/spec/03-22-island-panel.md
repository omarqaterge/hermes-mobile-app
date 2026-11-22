### 3.22 The island panel

**Opens from:** the status chip's question card (tap) and its Answer button, the permission card (tap) and its
Allow once and Allow session while "Confirm approvals with fingerprint" needs the fingerprint, and the working card
(tap; while Hermux uses an app for that chat the tap opens the chat with the live viewer instead, as before) (4.3),
outside the app. It is the Android activity `IslandPanel` (4.1, 4.2), not a page of the web app. The design is
`docs/design/island-panel.md`; its motion follows `docs/design/island-panel-prototype.html`. It has four states: Question,
Permission (`IslandPermission`), Progress and Done (`IslandProgress`).

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
The working card opens Progress, but a permission request or a question already waiting comes first (the chip's
order; with "When Hermux needs me" off the chip can show the work while one waits). Opened when that chat's turn has
already ended, it shows Done when its reply came in the last 10 minutes, and otherwise opens the chat in the app.
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
up the phone's own fingerprint or screen-lock prompt every time (`ApprovalLock.askOnce`): "Allow Hermux to run this?"
for Allow once (`ASK_ONCE_TITLE`) and "Allow Hermux to run this for this session?" for Allow this session
(`ASK_SESSION_TITLE`), the command under it, "Confirm it is you."; the panel waits behind it, its timer still running, and a cancel sends
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
request no longer on screen sends nothing. Every answer button (Deny, Allow once, Allow this session, Review in Hermux,
Open chat) ignores a touch that passes through another app's window (`setFilterTouchesWhenObscured`). Allow once and
Allow this session also ignore every touch while another app's window covers any part of the panel's window (Android
10+, `FLAG_WINDOW_IS_PARTIALLY_OBSCURED`), but only while the fingerprint is not asked (`ApprovalLock.needed` false):
when it is asked, the system prompt, drawn above other apps and showing the command, is what confirms. Deny, Review in
Hermux and Open chat never have that second rule, so a chat bubble or a screen filter can't stop them. A panel Android
recreates from its saved intent does not ask for the card's choice again.

#### The Progress state

| Part | What it shows |
|---|---|
| Badge | The caduceus in gold on the dark round badge, inside a turning gold arc: empty over the first 22 % of the circle, then fading in to its head, one turn every 1.4 s. |
| Chat line | The chat's title (or "Hermux"), "· bot" for a bot that isn't `default`. |
| Headline | The current step, live, as the chip has it ("Searching the web", "Running `ls`"), with `code` in gold monospace; "Working…" before Hermes says; "Stopping…" while a stop is on its way (the panel's or the card's). A new step replaces the old one: it leaves 6 dp upward, the new one arrives from below. |
| Clock | On the right: the turn's running time from its start ("0:07", "1:24", then "1:02:03"), in dim tabular digits; the digits that change roll upward. Counted each second by a handler, so it also counts with animations off. |
| Body, with a task list | The task bar: one segment per task, 6 dp high, 4 dp apart, round ends; done green, current gold with a light band crossing it every 1.6 s, to do white 12 %, dropped white 5 %. Under it the current task's name after a gold dot, and "2 of 5 tasks" on the right (`IslandState.tasks`), the number rolling. A task finishing fills green from the left in 300 ms, swells to 170 % of its height and back, and the next segment turns gold 240 ms after the fill starts; the count rolls and the name changes. |
| Body, without one | A 4 dp line with a soft gold band sweeping across it every 1.25 s, and "7 steps so far" ("1 step so far"; nothing before the first step). |
| Other chats | One dim line per other busy chat ("Title: step", backticks dropped; "Another chat" with no title), two at most, then "+N more chats" ("+1 more chat") for the rest the plugin counts. |
| App in use | While Hermux uses an app for this chat: its latest picture (72 dp, corners 12 dp, the one the working card shows), "Using <app>", and a quiet "Watch" button (92 dp wide, wider when a large font needs it) that opens the chat with the live viewer (`MainActivity.EXTRA_BG_VIEW`, 3.10). The panel never shows over the lock screen, so neither does the picture. |
| Buttons | "Stop" with a small square (red) on the left and "Open chat" (quiet) on the right, split 36 % / 64 %. Both ignore a touch through another app's window. |

When the panel can't fit everything (landscape, a large font), the body, the app row and the stop failure line scroll
together and the header and the buttons stay on screen; the scrolled part keeps room for the task bar's swell. While
it scrolls, its content is cut at its edges (`MaxScroll` clips in `dispatchDraw`), so nothing in it draws over the
buttons. When the failure line appears it is scrolled into view.

**Stop** is the card's Stop: `ACTION_STOP` to the service (`HermesService.stopTurn`), nothing more, and the panel is
never over the lock screen. "Open chat" fades, "Stop" grows to the full row and says "Stopping…" with a spinner, and
the headline says "Stopping…". The card's own Stop, tapped while the panel is open, shows the same, and a panel
opened while the card's Stop is already on its way opens that way (Open chat already gone). All three enter Stopping
by one path (`IslandProgress.enterStopping`), so each waits for the same outcome and no request breaks in meanwhile.
A stop counts from when the service sent it (`HermesService.stoppingAt`, carried as `IslandState.Progress.stopAt`),
not from when the panel opened, so the outcome of a card's Stop that came before the panel opened still counts.
Then
(`IslandState.stopFate`): when the turn is over, a drawn cross and "Stopped" on the red wash, hold 0.9 s, close; when
the service couldn't stop it, or nothing came of it in 15 s (`IslandState.stopUnheard`: no outcome since it was sent,
and the plugin didn't accept it, `HermesService.stopAccepted`, carried as `Progress.stopOk`), the two buttons come back
with the red line "Couldn't stop Hermux. Open the chat to stop it." and the reject buzz (the service also posts its own
"Couldn't stop Hermux" card). A stop the plugin accepted is never shown as failed: the panel stays on "Stopping…"
until the turn ends, however long it takes to wind down. A stop the panel already took in (`stopSeen`,
`IslandState.newStop`) doesn't start Stopping again after its failure.

**The turn ends** while the panel is open (`IslandState.turnFate`): when its reply arrives (the plugin's `flash` with
`done`, recorded as an `IslandState.Done` whatever the Done chip's rules say, 4.3), the panel changes to Done, even if
the status hasn't said the turn is over yet. When the chat stops working with no reply, the panel waits 2 s
(`DONE_GRACE_MS`) for it, then closes: it was stopped elsewhere or it failed, and a failure has its own notification.

**Battery.** The arc, the band and the sweep run on the frame clock only while the panel is on screen; the clock's
handler, the arc and the loops stop when the panel closes, goes or changes state. Progress closes by itself after 90 s
without a touch (`PROGRESS_IDLE_MS`, started again by every touch on the window).

#### The Done state

| Part | What it shows |
|---|---|
| Badge | The green wash (17 %, `GREEN_WASH`) with a green check: it pops in from 60 % (380 ms on back), the check draws itself (300 ms), one green ring expands to 160 % and fades (520 ms). |
| Headline | "Done". |
| Body | The start of the reply (three lines at most), then "9 steps · 1m 31s" in dim (`IslandState.doneStats`; a part Hermes didn't send is left out). It scrolls when the panel can't fit it. |
| Button | "Open chat", gold, across the row: opens the chat and clears the Done chip, as tapping the Done chip does (`clearDone`). |

Done doesn't close by itself: the user is reading. Each chat keeps its own last reply (`IslandState.dones`, at most
`MAX_DONE`, the newest first; `doneOf`), so two chats finishing one after the other each keep their Done. The working card of a new turn, tapped while Done is open, changes
it to that turn's Progress.

#### Changing state

While the panel is open it follows what Hermux does, in place (the old content fades out in 100 ms while shrinking to
98 % and takes no touch; the new one fades in from 6 dp lower; the height follows). The new content takes no touch
until its fade-in ends, 260 ms after the change (`IslandMotion.STATE_TOUCH_HOLD_MS`, `Fit.holdTouches`), the same
with the phone's animations off: a tap meant for Progress's or Done's Open chat can't land on Allow once or "Allow this
session" that has just appeared under the finger; the touch goes to the panel, which only moves on a drag. A permission request or a single
question arriving during Progress or Done changes it to that state, with one light tap (`IslandState.arrived`;
during a stop on its way it waits); the turn ending changes Progress to Done. After an answer sent from the panel (a
choice or text, Allowed or Denied), it changes to the next permission request waiting, else to a question waiting,
else it closes (`IslandPanel.nextOrClose`, `IslandState.nextAfter`). A request or question answered elsewhere, or run
out, still closes as described above. A change right after another stops the earlier content's fade-in where it is
(`swapIn`), and that content leaves from where it was, its offset kept (`leavingDy`). Changing to Progress is spoken by TalkBack (the chat and the step); changing to a question with no choices
puts the cursor in its field and opens the keyboard (`keyboardIfTyped`), as opening on it does.

**Pop-ups while the panel is open.** The service's pop-up for a request or question, and a request's 20 s / 40 s
re-alerts, come as they do with the panel closed (4.3): the panel doesn't change them. The pop-up can drop over the
panel's header; whether it should is an open question for the owner (`docs/status/island-panel.md`).

**A card answer is confirmed on the chip.** After an answer from a card button (Allow once, Allow session, Deny, a
choice, the Answer field of the pop-up), the chip says "Allowed", "Denied" or "Sent" for two seconds beside a drawn check or cross (4.3); an
answer from the panel shows its own check instead.

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
the request still runs out on time, and the card's Allow still brings up the fingerprint at once. In Progress the arc is a still ring, the band crossing the current task is off and the sweep's band stands still in
the middle; the clock still counts and a finished task still turns green. Done's check draws in 120 ms with no pop
and no ring. Every movement runs on the display's frame clock and only while it runs; nothing moves or
repeats once the panel is hidden.

#### Known limits

The service keeps waiting requests and the last turn's reply in memory, so a restart (an app update) drops them from
the chip and the panel. A failed answer leaves the question off the chip, as for the card's own buttons. The service's
own "Couldn't send your answer" card drops down over the panel when a send fails. The panel follows waiting requests
even with "When Hermux needs me" off (the chip still respects it). Home from the PIN screen (Android 8-10, or the PIN
fallback) leaves the panel and that screen in the background until the request's deadline, when both go; nothing is
sent. A turn that ends with no reply heard (the plugin's reply came before the panel opened, or none came) closes the
Progress state 2 s later instead of showing Done.
