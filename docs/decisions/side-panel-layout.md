# The side panel is a glass sheet over the chat, about chats

**Decided:** 2026-11-16, by the owner, for the interface redesign (built 2026-11-17).

The old panel covered the phone edge to edge and spent a quarter of its height on a menu before the first chat: a bot
switcher, New chat, three tiles (Hermux, Bots, Settings) and a search field. The tile called "Hermux" said nothing about
what was behind it and hid scheduled jobs, skills, memory and files two taps deep; bots appeared twice; Settings held a
top spot though it is rarely opened. The panel should be about chats, with the most used action under the thumb, and it
should not feel like leaving the chat.

**So:**

- **A sheet over the chat.** On a phone the panel is a floating sheet of the glass material
  ([glass-and-motion.md](glass-and-motion.md)): 8 px in from the left edge, 8 px below the top safe area and 8 px above the
  bottom safe area, `min(80vw, 330px)` wide (so a strip of the chat shows on the right on every phone, 256 px on a
  320 px one), corners 24 px. It never fills the screen. The chat stays where it is, dims (the scrim) and, with Full
  animations, steps back a little behind it; it is not blurred as a whole and not hidden. It opens and closes as
  before: the menu button, a swipe right on the chat (the sheet follows the finger and settles with the shared
  spring), a tap or a swipe left beside it or on it, Android Back; opening a chat from it closes it.
- **No glass on glass.** The sheet is the one glass surface; the search field and the bottom bar inside it are faint
  solid tints with a hairline, and the rows are plain. Without glass (Appearance, or no backdrop blur) it is solid
  `--surface` with its border and shadow, in the same place and size.
- **Wide screens:** the docked column is unchanged in place and size and is not a sheet. Hidden by the person and used
  as an overlay, it is the same floating sheet as on a phone.
- **Inside, top to bottom:** the search field alone ("Search chats", pinned; with the docked column the hide button
  beside it); three rows that scroll away with the list (Scheduled with the next run, Skills with "N on", Library),
  hidden while the search has text; the chat list; and a pinned bar with the bot's letter and name (a tap opens the bot
  sheet), a Settings gear, and a gold "New chat" button (the plus icon alone on a very narrow phone).
- **The bot sheet** (a bottom sheet) lists the bots, the current one marked, each with its model; a tap switches. Under
  them: "What <bot> remembers" (Memory) and "Manage bots" (Bots). It opens over the chat after the panel has left, so a
  glass sheet never lies on the glass panel.
- **Gone:** the three tiles, the Hermux hub page (and its summary cards) and the top bot switcher. Files, Projects and
  the canvas gallery are the three parts of one Library page (Canvases, Files, Projects), which remembers the last part.
  Back from Scheduled, Skills, Library, Memory, Bots and Settings goes to the chat.
- **The row values** (Scheduled, Skills) load when the panel opens (docked: at start and when the app returns), at most
  once a minute, with no timer, from the calls the hub cards used; one that has not loaded or failed is left out.
- **Closed, the panel costs nothing:** it is not drawn, its list does not animate, and nothing is read for it.
- **The Hermux mark and title on the empty new-chat screen stay exactly as they are.**
