# The redesign costs no speed and no battery

**Decided:** 2026-11-16, by the owner, for the interface redesign.

The new look must cost nothing a person can feel, or see on the phone's battery screen. Every redesign task holds to
these rules; a task that cannot meet one stops and says so.

**So:**

1. **Nothing gets slower.** Start-up, opening a chat, the first words of a streamed reply, scrolling a long chat and
   opening the chat list are measured before and after in a desktop browser at 4x CPU slowdown
   (`tools/web-e2e/uicost.cjs`, `streamcost.cjs`, `coldstart.cjs`) and the numbers go in
   `docs/performance-history.md`. Slower by more than 5% is a bug.
2. **An idle screen does no work.** One second after the last change no animation is running, no timer of the new code
   is pending and nothing repaints. A browser check proves it (`expectIdle` in `tools/web-e2e/lib.cjs`:
   `document.getAnimations()` holds no running animation).
3. **A hidden app does nothing new.** Every repeating animation and every reading loop stops on `hermesPause` and while
   its element is off screen, and resumes cleanly (`setAppAway`, `pauseWhenHidden` in `web/src/motion.ts`).
4. **Repeating animations run on the compositor only:** transform and opacity of a layer that already exists. Never an
   animated gradient, background position, blur radius, shadow, width or height in a loop: those repaint on every
   frame. A travelling light is a layer that turns under a mask; a shimmer keeps the frame limit the chat list's
   shimmer has.
5. **At most two repeating animations on screen at once,** none bigger than a bar. No large blurred shape that moves:
   a glow behind a working chat is a still gradient that fades in and out.
6. **Blur is the costly part of glass.** At most three blurred surfaces at once, each a bar or a sheet. A blurred
   surface does not change size on every frame: it is laid out once and moved. Nothing blurred scrolls with the content.
7. **One-off movements are short** (under half a second) and change only transform and opacity; layout changes once, at
   the start or the end.
8. **No new polling.** New information rides on calls and events the app already makes. Bounded exceptions are named
   in their tasks (a sub-agent's live output while its sheet is open, at most every 3 s).
9. **Hidden things cost nothing:** a closed tray, folded steps, closed nested rows and closed sheets are not updated
   and, where it is simple, not rendered. Streaming must not re-render earlier messages.
10. **The person decides the look; the phone only asks for no animations.** Glass effects starts on and Animations
    follows the phone's "Remove animations" (Off when set, else Full); both are in Settings → Appearance → Effects.
    Glass off and Animations Off make the app at least as light as it was. Changed 2026-11-17, in the review of the
    first glass and motion PR: the brief first said a phone reporting little memory or few cores (or battery saver,
    where the shell can tell) starts with solid surfaces and Reduced; the owner dropped that, so the defaults do not
    depend on the machine.
11. **What cannot be measured in a browser** (heat and battery on a real phone) goes to `docs/manual-tests.md` as a
    ten-minute working session with glass and animations on and then off, comparing the battery drop.

Found while building the glass and motion (2026-11-17), and kept as rules for the CSS: a selector whose last part is an
`:is()` list, `*` or a bare `:nth-child()` is tested against every element at every restyle; an inherited custom
property that changes restyles every element under it (register it with `@property … inherits: false`); a `:has()`
over the whole app is re-checked at each word a streamed reply adds (look only at direct children, `:has(> …)`, or set
an attribute from the code that knows).
