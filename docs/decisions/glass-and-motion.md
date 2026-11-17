# Glass on floating controls, and motion that shows what is happening

**Decided:** 2026-11-16, by the owner, for the interface redesign.

The app gets a material and a way of moving that every redesigned screen uses. Things that float over the chat are a
translucent, frosted material: the chat shows through them, softly blurred, so the screen reads as one surface with
controls resting on it. Movement says what happened: a sheet comes up from where it lives and the screen behind steps
back, a pressed button gives under the finger, a choice settles into place. It must stay light (see
[redesign-costs-no-speed-or-battery.md](redesign-costs-no-speed-or-battery.md)).

**So:**

- **Where glass goes:** only on things that float: the chat screen's top and bottom bars, sheets, menus, pickers,
  dialogs, toasts, the slash-command menu, the find bar and banners inside the bars, the read-aloud player and the
  scrubber's label. **Never on content:** messages, cards, the chat list, full-screen pages and lists stay solid. Never
  glass on glass: a group inside a glass surface gets a faint solid tint, not a second blur. The chat scrolls under
  the bars with the same layout and heights ([chat-height-belongs-to-content.md](chat-height-belongs-to-content.md)).
- **Readable over anything:** text on glass keeps at least 4.5:1 contrast over a white and over a black picture behind
  it, in Default, OLED black and Light (a browser check measures it). OLED black's glass is darker and quieter; Light's
  is a frosted white. Warnings keep their solid colour. Where glass cannot be drawn (Glass effects off, or a WebView
  without backdrop blur) the same surfaces are solid, in the same place and size.
- **Tokens, not values:** the material (`web/src/glass.css`) and the motion (`web/src/motion.css`, `web/src/motion.ts`)
  are tokens every later task uses: three springs (settle, bounce, gentle), a fade curve, a few lengths, a stagger
  step. A new animation uses them instead of its own curve.
- **Three levels of motion,** chosen in Settings → Appearance → Effects → Animations: **Full** (springs with weight),
  **Reduced** (no travel, short fades, nothing repeats), **Off** (every change is instant). Until the person chooses,
  the phone decides: Off when it asks for no animations, Reduced on a phone with little memory or few cores, else
  Full. Glass effects is a switch beside it, on by default except on such a phone.
- **Motion never stands in the way:** nothing delays or blocks a tap, a swipe or a drag, and every state is also
  shown in words or a still mark, so Off loses no information.
- **Left out for now:** a refracting edge on glass (bending what is behind it at the rim): it could not be measured on
  a mid-range phone here, so it waits until it can be. The chat list neither staggers its rows nor steps the chat
  back when it opens: both added about half to its work, and the list opens many times a day.
