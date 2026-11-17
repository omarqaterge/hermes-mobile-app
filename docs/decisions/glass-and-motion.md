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
  Animations follows the phone's "Remove animations": Off when it is set, else Full. Glass effects is a switch beside
  it, on until the person turns it off. The phone's memory and cores play no part (changed 2026-11-17, in the review
  of the first glass and motion PR: a first version started small phones with solid surfaces and Reduced).
- **Motion never stands in the way:** nothing delays or blocks a tap, a swipe or a drag, and every state is also
  shown in words or a still mark, so Off loses no information.
- **Left out for now:** a refracting edge on glass (bending what is behind it at the rim): it could not be measured on
  a mid-range phone here, so it waits until it can be.
- **The chat list opens without a row stagger. The side panel steps the chat back (changed 2026-11-17, by the owner,
  in the side panel task).** Sheets and menus keep both the step back and the dim, and so does the side panel, now a
  sheet over the chat ([side-panel-layout.md](side-panel-layout.md)): the chat dims (the scrim) and steps back (`scale`
  0.965 on `.stage`, transform only, laid out once; it follows the finger when the panel is dragged in). The first
  glass round left it out because the step back, done another way, added about half to the list's main-thread work at
  4x CPU (measured 2026-11-17: no animation 218–222 ms and 22–24 ms of work; row stagger 231–236 ms (+6–7%) and 52 ms;
  fading only 228–230 ms and 37–39 ms; the chat stepping back 223–234 ms (+2.5–6%) and 30 ms; both 230–233 ms and
  54–59 ms). Measured again with the panel built as a sheet, the step back adds no measurable work and the panel opens
  12% faster than the full-height drawer did (221 → 196 ms, work 18 → 20 ms; `docs/performance-history.md`). The row
  stagger stays out: a list that shows once can still stagger its rows (`.motion-in` with `stagger()`), the chat list
  opens many times a day.
