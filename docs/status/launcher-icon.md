# Launcher icon

**State** (2026-11-03): new adaptive icon (gold caduceus and `> <` on near-black), see
[hermux-launcher-icon.md](../decisions/hermux-launcher-icon.md). Source `android/icon/hermux-icon.svg`; the PNGs and the
SVG come from `tools/icon/make-icon.cjs`. The monochrome (themed icon) layer is the same image with transparent gaps.
Nothing else in the app, README images or docs showed the old launcher artwork.

**Next:** decide whether the small notification icon should become a simpler mark that matches (owner has not decided).

**Needs a real phone:** how the icon looks in the phone's own launcher shape and in Android 13+ themed icons. A launcher
may keep showing the old icon until it refreshes (restart the launcher, or reinstall the shortcut).

**Links:** `android/res/mipmap-anydpi-v26/ic_launcher.xml`, `android/res/values/styles.xml` (`icon_bg`).
