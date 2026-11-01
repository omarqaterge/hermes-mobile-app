# Colours come from CSS variables

**Decided:** by the owner, with app 0.7.53.

There is a light theme (`:root[data-theme='light']` in `web/src/styles.css`, chosen in Settings → App → Themes). A hard-coded hex colour breaks it.

**So:** Every new colour uses a CSS variable (`--code-bg`, `--warn-bg`, `--press`, …).
