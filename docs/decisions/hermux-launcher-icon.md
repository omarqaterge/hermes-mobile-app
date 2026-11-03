# The Hermux launcher icon

**Decided:** 2026-11-03, by the owner, after several rounds of drafts.

Hermux's launcher icon is a gold caduceus between two thick arrows pointing at the staff (`> <`), on a near-black
background. It replaces the first picture-style icon. The owner chose: gold on dark (not black and white, and not the
reverse), the full caduceus with a smooth helix and small layered wings, and thick chevron arrows (the code-tag
thickness, stroke 9) with their tips toward the staff, at the closest-to-the-staff position that still leaves a gap.

**So:**
- The colours are the app's own: gold `#d9a441` on `icon_bg` `#0E1115` (the same as the app's `bg`).
- The source is `android/icon/hermux-icon.svg`, drawn by `tools/icon/make-icon.cjs`, which also renders the five
  `ic_launcher_fg.png` sizes. Change the design there and re-render; don't edit the PNGs by hand.
- Keep the whole mark inside the central 66 dp of the 108 dp adaptive icon.
- The caduceus in the icon is drawn for it and is not the ☤ glyph that the empty chat shows (that one comes from the
  phone's system font). The small notification icon (`ic_stat_hermes.xml`) is a separate drawing and was not changed.
