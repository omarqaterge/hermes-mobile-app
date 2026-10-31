# 08: Motion: animated open/close, effort bars

Read [README.md](README.md) first. Do this plan **after** the others you intend to build: it touches the same
components and is easiest to apply last.

## Goal

Things that open and close in the chat slide open and closed instead of jumping, chevrons rotate instead of swapping
characters, and the reasoning level on the model chip shows as small bars. All motion is off when the phone asks for
reduced motion.

T3 Code: `apps/web/src/components/AnimatedHeight.tsx` (measured height transition with a fallback timer),
`MorphIcon.tsx` (icon morphs via the `morphicons` package), `chat/EffortGlyph.tsx` (reasoning level as bars).

## What exists today

Collapsibles that open instantly today (each renders its body with `{open && …}`):

| Where | Component | Body |
|---|---|---|
| `web/src/components/ChatItems.tsx` | `ToolCard` | `.tool-body` |
| `web/src/components/ChatItems.tsx` | `Reasoning` | `.reasoning-body` |
| `web/src/App.tsx` | `Chat` folded runs (`ToolRunHead` + hidden items) | items of the run |
| `web/src/App.tsx` | `StatusBar` | todo list `<ul>` |
| `web/src/components/Markdown.tsx` | `CodeBlock` | "Show all N lines" (class toggle `collapsed`) |

Chevrons are text: `{open ? '▾' : '▸'}` in `.chev` spans. `styles.css` has a `prefers-reduced-motion` block near the
end. The model chip shows the effort as text (`EFFORT_SHORT` in `Composer.tsx`: `med`, `min`, `off`, or the level).

## Design

1. **`Collapse` component** (`web/src/components/ui.tsx`): `<Collapse open={open}>{children}</Collapse>`.
   - Opening: mount the children, measure `scrollHeight`, animate the wrapper's height from 0 to that height and
     opacity 0 → 1 with the Web Animations API (`el.animate([...], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' })`),
     then clear the inline height so the content can grow (streaming text, images loading).
   - Closing: animate from the current height to 0, then unmount the children (keep them mounted until `finished`).
     If `open` flips back during the animation, cancel it and start from the current height.
   - Reduced motion (`matchMedia('(prefers-reduced-motion: reduce)').matches`): no animation; mount/unmount at once.
   - Fallback: if `finished` never resolves (it should), unmount after `duration + 100` ms anyway (T3 does the same).
   - The wrapper has `overflow: hidden` only while animating (so focus rings and shadows aren't clipped at rest).
2. Use `Collapse` for `ToolCard`'s body, `Reasoning`'s body and the todo list. **Not** for folded tool runs: those
   rely on one child per item for search/jump; leave them instant.
3. **Chevrons**: one `Chevron` component: an inline SVG pointing right, rotated 90° when open with
   `transition: transform .18s` (none under reduced motion). Replace every `.chev` text chevron with it (search
   `'▾' : '▸'`). Keep `aria-expanded` on the buttons as it is.
4. **Effort bars** (`EffortBars` in `Composer.tsx`): for `minimal`, `low`, `medium`, `high`, `xhigh` draw 1–5
   vertical bars of rising height (3 px wide, 2 px gap, filled up to the level, the rest at 30 % opacity) in the chip
   instead of the text. `none`/off: a single hollow bar. Unknown level strings: keep the text. The chip's aria-label
   already names the model; add the level in words: `Model: x, reasoning medium. Change model`. Keep the existing label
   start `Model:` (e2e tests may match it).
5. **Send button face changes** (Send ↔ Stop ↔ Mic ↔ Queue if plan 02 is in): a 120 ms cross-fade/scale of the
   icon via a CSS animation on mount (`@keyframes face-in { from { opacity: 0; transform: scale(.85) } }`), applied to
   the button's SVG. Nothing else.

## Implementation steps

1. Write `Collapse` and `Chevron` in `ui.tsx`. `Collapse` uses `useLayoutEffect` for the measure-then-animate step
   so there's no flash of full height.
2. Swap them into the components listed above. Diff should be small per component.
3. Add `EffortBars` and the face animation; CSS in `styles.css`, and add the new animations to the existing
   `prefers-reduced-motion` block (`animation: none; transition: none`).
4. Look at every chevron and collapsible in both themes (light and dark) in the e2e screenshots (`HM_E2E_SHOTS`).

## Tests

**Unit**: `Collapse` is DOM-heavy; test the effort mapping as a pure function `effortLevel(effort: string): number | null`
(`minimal` 1 … `xhigh` 5, `none` 0, unknown null).

**E2E**:
1. Click a tool card head: `.tool-body` appears; click again: `.tool-body` is still present right after the click and
   gone 400 ms later (the close animation). Then `page.emulateMedia({ reducedMotion: 'reduce' })`, repeat: gone at once
   (within one `requestAnimationFrame`, check after 50 ms).
2. The model chip contains `.effort-bars` with 3 filled bars when the effort is `medium` (the mock's default; check
   what `model.options`/session info return and set `reasoning_effort` if needed).
3. **Run the whole suite**: existing checks that count `.tool:visible` or click twice quickly must still pass. If one
   fails only because the body is still closing, add a short wait in that check; never change what it asserts.

## Spec and changelog

- `docs/SPEC.md`: 3.3 Tool card (opens with a short slide), 3.4 model chip (effort as bars, the new aria-label
  wording), a sentence in the Appearance part of 3.15 or 2.x about reduced motion being honoured.
- `CHANGELOG.md` entry.

## Out of scope

Animating message arrival, page transitions between screens, a motion setting inside the app (the phone's own
"Remove animations" setting is respected through `prefers-reduced-motion`).
