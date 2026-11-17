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
the build for the web interface, notification code and resources in `android/`, the plugin's strings in `hermes-plugin/`
and the phone scripts in `phone/` (tests excluded).

**What counts as content outside the web interface (settled 2026-11-17):** only what a person or the model wrote. The
plugin's own words (status text, tool descriptions, notices, messages it puts into a chat) and the app's notification
titles, buttons and channel names are interface, so they use words (notification actions that need a picture use a
vector drawable). Two characters stay as `\u` escapes because they are data, not interface: U+2387, the branch mark
stored at the front of a branched chat's title (the plugin and the Android shell strip it, the web app writes it), and
U+200D, the joiner the phone-data wording strips from request text. A notification's state is said in words ("Done",
"Skill", "Memory", "Allow once", "Deny").
