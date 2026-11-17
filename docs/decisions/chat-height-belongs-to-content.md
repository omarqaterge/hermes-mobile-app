# The chat screen's height belongs to the messages

**Decided:** 2026-11-16, by the owner, for the interface redesign.

Reading the text is what the chat screen is for. A new look may change what the bars are made of, never how much room
they take from the messages.

**So:**

- The header and the composer area are never taller than they were when the redesign started (57 px and 102 px at
  360 x 740), to within 2 px, in every state: idle, while a turn runs, with attachments, with the keyboard open. Glass
  changes what they are made of, not how tall they are. Once the composer's tray can close (task 02b), the composer is
  shorter while it is closed, and no later change gives that height back.
- **The tray (decided 2026-11-16, by the owner; built in task 02b).** The model row and the live status line sit in a tray
  above the text box. It is open on a new chat, so the model can be seen and changed before the first message, and
  closes by itself when that first message is sent; a chat opened from the list starts closed; opened or closed by hand,
  it stays so while that chat is on screen. Settings → Appearance → Model bar: "Tucked away" (the default) or "Always
  open" (the layout from before the tray). At 360 x 740 with the tray closed the composer area is 69 px (was 102) and
  the messages 614 px idle and while a turn runs (were 581 and 553), 314 px with the keyboard open (was 281); open, the
  composer is 101 px idle and 122 px while a turn runs (was 130), so open is no taller than before. `31-fixed-points.cjs`
  holds the closed heights, `34-model-bar-tray.cjs` the open and closed ones in every state.
- No change adds a permanent row, bar, chip or banner to the chat screen. New information goes into a line that
  already exists, or into a sheet that the person opens.
- Anything new inside the chat is one line while closed: a sub-agent group, a background task, a folded turn.
- The bars may let the chat scroll under them. That may only show more of the chat, never hide the first or the last
  message.
- Every PR that touches the chat screen measures the messages' visible height at 360 x 740, keyboard closed and open,
  before and after, and reports both numbers. A loss of more than 2 px is a bug. The browser checks hold the recorded
  values: `tools/web-e2e/checks/31-fixed-points.cjs` (idle and keyboard) and `33-glass-and-motion.cjs` (also while a
  turn runs and with a photo attached).
