# No emoji anywhere in the app

**Decided:** 2026-11-16 (owner).

The app shows no emoji and no glyph used as an icon: not in the interface, notifications, the plugin's messages or the
phone scripts' output. Emoji looked different on every phone maker, clashed with the gold-on-dark look and were read
aloud by screen readers. Icons are drawn (`web/src/components/icons.tsx`).

What counts as content and stays: anything the person or the model wrote in a chat, letters in avatars, ordinary
punctuation in sentences (the arrow in "Settings → Voice", the middle dot, the ellipsis, quotes), and the Hermux mark on
the empty new-chat screen. Data markers the app stores (the branch marker in a chat title) are kept as `\u` escapes in
the code, drawn as an icon.

**So:** use an icon from `icons.tsx` or words, never an emoji or a symbol character. `tools/check-no-emoji.py` fails
the build for the web interface; task 02 extends it to notifications, the plugin and the phone scripts.
