# The island panel: what opens from the status chip

**Status:** design final, 2026-11-16. Not built. The build plan and the prompts for it are in
[docs/plans/15-island-panel.md](../plans/15-island-panel.md).

**See it move:** open [island-panel-prototype.html](island-panel-prototype.html) in a browser. It is the reference for
every animation below: tap the island, try each state, switch on Slow motion. Where this file and the prototype
disagree, this file wins. All text in the prototype is made up.

## 1. What this is

When Hermux needs a permission, asks a question or is working, the status chip (the island on phones that have one)
shows it. This design is what the user gets after tapping it: one small panel that grows out of the top of the screen,
over whatever app is open, and changes shape as things happen. It has four states:

| State | When | The user can |
|---|---|---|
| **Permission** | Hermux wants to run a command or read phone data | see the command and the time left, Deny, Allow once, Allow this session |
| **Question** | Hermux asks something | tap a choice, or type an answer |
| **Progress** | Hermux is working | see the current step, the tasks and the time, Stop, open the chat |
| **Done** | the turn ends while the panel is open | read the start of the reply, open the chat |

The panel replaces `AnswerBox` (today's plain answer box) and adds the other three states.

## 2. What Android allows, and what follows

Two things draw what the user sees after a tap, and only one of them is ours.

1. **The system card.** Tapping the chip or island makes the phone show the notification's own expanded card. The
   phone draws it from a fixed template. An app can't animate it and can't put its own views in it: a notification
   with custom views is refused as a Live Update and loses the chip
   ([Android's Live Update rules](https://developer.android.com/develop/ui/views/notifications/live-update)). So this
   card stays as it is: text, the system progress bar, up to three buttons.
2. **The panel.** Tapping the card (or a button on it that needs more than one tap) opens a small window of our own.
   Everything in this file from section 3 on is that window.

So the order is: tap the island → the phone's card → tap the card → the panel. The fast answers stay on the card
(Allow once, Deny, the first two choices, Stop), so nobody has to open the panel to answer quickly.

What was ruled out, and why:

- **Custom views in the notification:** the chip would disappear (rule above).
- **A phone maker's own island API:** works on one maker's phones only; the project rule is public Android first.
- **Drawing our own island over other apps** ("Display over other apps" permission): a heavy permission for a second
  island next to the phone's own.
- **Opening the panel by itself when a request arrives:** Android blocks windows opened from the background.

On Android below 16, and on phones without a chip, the same card is an ordinary pinned notification and the panel opens
from it the same way. The panel itself needs nothing newer than Android 8.0; only the blur behind it needs Android 12.

## 3. Look

**Always dark.** The panel is near-black in every theme, like the island it grows from. It doesn't follow the app's
light theme.

### Colours

| Name | Value | Used for |
|---|---|---|
| ink | `#0B0D10` | the panel |
| ink top | `#151A21` | top of the panel's gradient (fades to ink over the first 120 dp) |
| hairline | white 9 % | the panel's 1 dp border |
| text | `#F2EFE8` | titles, body |
| dim | `#9AA1AB` | the chat title, the clock, counts, text buttons |
| faint | `#5E6570` | hints, "N more waiting" |
| gold | `#D9A441` | the brand: icons, code, the main button, the timer above half |
| gold ink | `#1A1307` | text on gold |
| green | `#3DBE7A` | done tasks, "Allowed", Done |
| amber | `#E8912D` | the timer between a half and a fifth |
| red | `#E5564B` | the timer below a fifth, Deny, Stop |
| fill | white 7 % | quiet buttons, choices, the answer field |
| fill pressed | white 13 % | the same, pressed |
| code | `#07090C` | the command block |
| red wash / red text | red 15 % / `#FF8177` | Deny, Stop, "Denied", "Stopped" |
| green wash / green text | green 17 % / `#6FDCA0` | "Allowed", "Sent" |
| scrim | black 40 % | over the app behind |

Gold, green, red and amber are the notification colours the service already uses.

### Type

The phone's own sans font; monospace for commands and `code`. Sizes in sp, so they follow the phone's font size.

| Text | Size / line | Weight |
|---|---|---|
| Chat title (above the headline) | 12.5 / 16 | regular, dim, one line |
| Headline | 17 / 23 | semibold, one line |
| Body ("what" line, the reply) | 15 / 21 | regular |
| Question | 17 / 24 | medium |
| Command | 12.5 / 18 | monospace |
| Buttons | 15 | semibold |
| Text buttons | 14 | medium, dim |
| Timer number | 15 | semibold, tabular digits |
| Clock, counts | 14 / 13 | regular, dim, tabular digits |

### Layout

- **The panel:** as wide as the screen minus 12 dp each side, at most 420 dp, centred. Its top is 8 dp under the
  status bar. Corners 28 dp. Padding 16 dp (9 dp at the bottom). It is as tall as its content, at most the space above
  the keyboard minus 16 dp; beyond that the body scrolls and the header and buttons stay.
- **Header** (at least 44 dp high): a 40 dp round badge on the left (gold at 14 %, with the caduceus or the shield in
  gold), then the chat title over the headline, then the state's own item on the right (the timer ring, or the clock).
- **Body:** 14 dp under the header.
- **Buttons:** 16 dp under the body. 50 dp high, corners 17 dp. Two side by side split 36 % / 64 % with an 8 dp gap;
  the one that stops things (Deny, Stop) is on the left, the one that moves on is on the right.
- **Grab line:** 36 × 4 dp, white 16 %, centred 10 dp under the last element. It says "this can be pushed away".
- Every touch target is at least 48 dp high (the text buttons are 40 dp tall with 4 dp of room above and below).

## 4. How it moves

Motion has one job here: to show that the panel is the island opening, and that one thing turned into the next.
Nothing bounces for fun.

### Names used below

**Springs** (mass 1; `k` stiffness, `ζ` damping ratio). A spring is done when `e^(−ζ·√k·t) < 0.002`.

| Name | k | ζ | Used for |
|---|---|---|---|
| open-width | 520 | 0.82 | the panel's width, top and corners when it opens |
| open-height | 360 | 0.80 | the panel's height when it opens (so it widens first, then drops) |
| resize | 420 | 0.86 | every later change of height |
| snap | 600 | 0.90 | the panel returning after a drag |

**Curves** (cubic bezier):

| Name | Values | Used for |
|---|---|---|
| out | 0.2, 0.8, 0.2, 1 | things arriving |
| in | 0.4, 0, 1, 1 | things leaving |
| standard | 0.4, 0, 0.2, 1 | fills, strokes being drawn, the scrim |
| back | 0.3, 1.5, 0.5, 1 | a small overshoot: a released button, a growing button, a finished task |

### Opening (about 400 ms)

1. A black pill, 132 × 34 dp, sits where the island is: centred, in the status bar.
2. It grows into the panel: width, top and corners on **open-width**, height on **open-height**. Corners go from 17 to
   28 dp.
3. The content arrives in rows (header, body, buttons, each choice): each fades in over 220 ms on **out**, from 8 dp
   higher and 97 % size. The first starts at 120 ms, each next one 40 ms later.
4. Behind it the screen dims to black 40 % over 240 ms on **standard**, and blurs (20 dp radius) on phones that can
   (Android 12+, and the phone allows blur between windows). No blur: the dim alone.

### Closing (about 250 ms)

Content fades out in 90 ms. The panel shrinks back to the pill in 230 ms, slow first then fast (`p² · (0.4 + 0.6p)`).
The dim and blur fade in 200 ms. Then the window is gone, with no system animation.

The panel closes on: a tap outside it, Back, a drag upward, or by itself after an answer.

### Dragging

- Up: the panel follows the finger. Let go after more than 56 dp, or with a flick faster than 800 dp/s: it closes.
  Otherwise it returns on **snap**.
- Down: it gives a little (22 % of the finger's travel, 26 dp at most) and returns on **snap**. Nothing happens.

### Changing state

When what Hermux is doing changes while the panel is open (a permission request arrives during Progress, the turn
ends), the panel doesn't close and reopen. The old content fades out in 100 ms while shrinking to 98 %; the new content
fades in over 180 ms, starting 80 ms later, from 6 dp lower; the height follows on **resize**. The phone gives one
light tap (haptic) when a Permission or Question arrives this way.

### Small parts

| Part | Motion |
|---|---|
| A line of text that changes (the current step, the task name, a headline) | the old line leaves 6 dp upward in 110 ms on **in**; the new one arrives from 6 dp below in 200 ms on **out** |
| A number that changes (timer, clock, task count) | only the digits that changed move: the new digit rolls in over 240 ms on **out** from 60 % of a line away, the old one rolls out the other way in 180 ms on **in**. Counting down rolls downward; counting up rolls upward. Digits are tabular, so nothing shifts sideways |
| A pressed button | shrinks to 97 % and brightens 12 % in 80 ms; released, it returns in 260 ms on **back**. No ripple |
| A check or a cross | drawn as a stroke from its start to its end in 260 ms on **standard** |
| A spinner | 16 dp ring, one turn every 0.7 s |

### Haptics

Through the phone's own setting (`View.performHapticFeedback`), so users who turned touch feedback off get none.

- A choice, Allow, Deny, Send or Stop tapped: one light tap.
- An answer confirmed ("Allowed", "Sent"): the confirm pattern (Android 11+; older: nothing more).
- An answer that failed, or a request that expired while open: the reject pattern (Android 11+; older: one long tap).
- The timer turning red: one tick. No ticking every second.
- A Permission or Question arriving while the panel is open: one light tap.

### Reduced motion

With the phone's animations switched off (`ValueAnimator.areAnimatorsEnabled()` is false): the panel and every change
fade in or out in 120 ms with no movement or scaling, springs jump to their end, the spinning arc is a still ring, the
shimmer and pulses are off. The timer ring still drains and numbers still change: that is information.

### Battery

Nothing animates unless the panel is on screen. Every loop stops when the panel is no longer visible. The Permission
state ends with its timer. The Question state's pulse runs three times and stops. The Progress state closes by itself
after 90 seconds without a touch.

## 5. The states

The header is the same everywhere: badge, the chat's title (or "Hermux" when it has none; the bot's name is added as
"· name" when it isn't the default bot), and the headline.

### 5.1 Permission

| Part | Content |
|---|---|
| Badge | the shield |
| Headline | "Run a command?" (a phone-data read: "Let Hermux read your phone?"; one that can't be read: "Unreadable phone data request") |
| Right | **the timer**: a 44 dp ring, 3 dp thick, round ends, on a white 10 % track, with the seconds left inside |
| Body | the plain-words line (first letter capitalised), then the command in the code block with a gold `$`. More than four lines of command: the block shows four and scrolls |
| Buttons | "Deny" (red wash) and "Allow once" (gold). Under them the text button "Allow this session", when the request offers it |
| Under the buttons | "1 more waiting" / "N more waiting", when other requests wait |

**The timer.** The ring drains clockwise from full, every frame, from the request's real deadline (not in one-second
steps). Its colour is gold above half the time, amber down to a fifth, red below, blended over ±5 % around each line
so it never snaps. The number rolls each second. In the last 10 seconds the ring pulses with each second (to 109 % and
back, 260 ms). Below a fifth the number takes the ring's colour.

**Fingerprint.** When the chat's first Allow needs the fingerprint (setting "Confirm approvals with fingerprint"),
"Allow once" carries a small fingerprint icon before its label. Tapping it brings up the phone's own fingerprint
sheet; the panel waits behind it. Cancelled: nothing is sent and the panel is as it was.

**Answering.** The other buttons fade out in 120 ms and "Allow this session" gives its room back. The tapped button
grows to the full row in 320 ms on **back** and says "Sending…" with a spinner. The timer ring fades away (160 ms).
Then:

- Sent: the button turns to the green wash with a drawn check and "Allowed" (or "Allowed for this session"), or to the
  red wash with a drawn cross and "Denied". The panel holds for 900 ms and closes. With another request waiting, it
  changes to that one instead (section 4, Changing state).
- Not sent: the row returns to the two buttons with a red line above them: "Couldn't send your answer. Try again, or
  open the chat." and the text button becomes "Open chat".

**Running out.** At zero the headline changes to "This request expired", the body fades to 32 %, the ring to 35 %, the
buttons become one quiet "Open chat". The panel closes after 2.6 s.

**Answered somewhere else** (in the app, or on the card): the headline changes to "Answered in the app", the buttons
fade, and the panel closes after 900 ms.

**Phone data.** Allowing a phone-data read is only possible in the app (a security rule, kept). The buttons are "Deny"
and "Review in Hermux" (opens the chat's own sheet). There is no command block; the body is the app's own wording of
the request. An unreadable request has "Deny" and "Open chat".

### 5.2 Question

| Part | Content |
|---|---|
| Badge | the caduceus, with a gold ring pulsing outward three times (to 155 %, fading, 1.6 s each) |
| Headline | "Hermux asks" |
| Body | the question (scrolls beyond 6 lines) |
| Choices | one row per choice (up to 5): at least 50 dp high, corners 16 dp, fill, text wraps, 8 dp apart |
| Field | a 50 dp rounded field, hint "Type your answer", with a round 40 dp send button inside on the right: quiet while empty, gold with a dark arrow once there is text |
| Under it | the text button "Open chat" (takes the typed text into the chat's composer) |

The keyboard opens by itself only when there are no choices. With choices it stays down until the field is tapped, so
the question and the choices are not covered.

**Tapping a choice:** it turns gold with dark text in 160 ms; the other choices and the field fade to 32 %; a small
spinner appears at its right end, then a drawn check. The panel holds 850 ms and closes.

**Sending typed text:** the choices fade to 32 %, the send button shows the spinner, then the check; hold 850 ms, close.

**Not sent:** a red line under the question: "Couldn't send your answer. Open the chat; your text is kept." and a gold
"Open chat" button.

**No longer open** (answered elsewhere, or 10 minutes passed): the headline changes to "This question is closed", the
choices fade, the panel closes after 900 ms.

A batch of several questions opens the app, as today: the panel shows single questions.

### 5.3 Progress

| Part | Content |
|---|---|
| Badge | the caduceus inside a turning arc: gold, with a tail fading to nothing over the first 22 % of the circle, one turn every 1.4 s |
| Headline | **the current step**, live ("Searching the web", "Running `ls`"), with `code` in gold monospace. "Stopping…" while a stop is on its way |
| Right | the turn's running time ("1:24"), digits rolling |
| Body, with a task list | **the task bar**: one segment per task, 6 dp high, 4 dp apart, round ends. Done: green. Current: gold, with a light band crossing it every 1.6 s. To do: white 12 %. Dropped: white 5 %. Under it the current task's name after a gold dot, and "2 of 5 tasks" on the right |
| Body, without one | a 4 dp line with a soft gold band sweeping across (1.25 s), and "7 steps so far" |
| Other chats | one dim line per other busy chat ("Title: step"), two at most, then "+N more chats" |
| An app in use | when Hermux uses an app for this chat: a row with its live picture (72 dp, corners 12 dp), "Using <app>" and a quiet "Watch" button (opens the live viewer) |
| Buttons | "Stop" with a small square (red wash) and "Open chat" (quiet) |

**A task finishing:** its segment fills green from left to right in 300 ms, then swells to 170 % of its height and
back (420 ms on **back**); 240 ms later the next segment turns gold; the count rolls; the task name changes.

**Stop:** "Open chat" fades, "Stop" grows to the full row and says "Stopping…" with a spinner; the headline says
"Stopping…". When the turn ends: a drawn cross and "Stopped" on the red wash, hold 900 ms, close. If it can't be
stopped: the row returns with a red line "Couldn't stop Hermux. Open the chat to stop it."

**The turn ends** while the panel is open: it changes to Done. If it ended with nothing to show (stopped elsewhere, or
it failed), the panel closes; the failure has its own notification.

### 5.4 Done

| Part | Content |
|---|---|
| Badge | green wash; it pops in from 60 % size (380 ms on **back**), a check draws itself (300 ms), and one green ring expands and fades (to 160 %, 520 ms) |
| Headline | "Done" |
| Body | the start of the reply, three lines at most, then "9 steps · 1m 31s" in dim |
| Button | "Open chat" (gold, full width): opens the chat and clears the Done chip, as tapping the Done chip does |

Done doesn't close by itself: the user is reading.

## 6. What a tap opens

| Tapped | Today | With this design |
|---|---|---|
| Question card, or its Answer button | `AnswerBox` | the panel (Question) |
| Permission card (its body) | the app, on that chat | the panel (Permission) |
| Allow once / Allow session on the card, chat already confirmed by fingerprint | answers at once | the same |
| Allow once / Allow session on the card, chat not yet confirmed | the app, whose sheet asks for the fingerprint | the panel, which asks for the fingerprint at once and then sends that answer |
| Allow on a phone-data card | the app | the same |
| Deny, Stop, a choice button | acts at once | the same |
| Working card (its body) | the app, on that chat | the panel (Progress) |
| Working card while Hermux uses an app for that chat | the chat with the live viewer | the same |
| Done card, idle card, every other notification | as today | the same |

After an answer given with a card button, the chip says so for two seconds ("✓ Allowed", "✕ Denied", "✓ Sent"), so a
card answer gets the same confirmation as a panel answer.

## 7. Rules it keeps

- **Locked phone.** The panel never shows over the lock screen; Android asks for the unlock first
  ([decision](../decisions/no-actions-from-locked-phone.md)).
- **Fingerprint.** A chat's first Allow needs it, wherever it is tapped
  ([decision](../decisions/approval-needs-fingerprint.md)). This design changes one sentence of that decision: the
  card's Allow for an unconfirmed chat opens the panel and asks there, instead of opening the whole app. The check
  itself is unchanged. The decision file is updated in the same change.
- **Phone data.** Never allowed from outside the app.
- **Live state.** The panel shows what the service holds at that moment, never what was in the tap. A request that is
  gone can't be answered.
- **Taps through other windows.** The buttons that allow, answer or send ignore touches while another app draws over
  them.
- **Every Android phone.** Android 8.0 and up, public APIs only, no maker-specific code. The pill always starts at the
  top centre.
- **Accessibility.** Every control has a spoken name. The timer is spoken as "N seconds left" at 30, 10 and 5 seconds.
  A state change is announced. Sizes follow the phone's font size; the body scrolls when it no longer fits.
- **Tablets and landscape.** At most 420 dp wide, centred at the top; in landscape the body scrolls.

## 8. Not part of this

- The sheets inside the app (approvals and questions in the chat).
- The look of the system card itself, beyond section 6.
- The Done, idle and flash chips, and the other notifications.
- A full list of task names in Progress: the plugin sends only the current task's name and each task's state.
