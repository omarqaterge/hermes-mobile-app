# Session list gestures

**Decided:** by the owner, over app 0.7.x (dragging to pin: 0.7.70); no exact date was recorded.

Swipe right = Archive (`session.set_hidden`, as in Desktop); swipe left = Delete, with a confirm. Each row has a visible ⋮ button for Pin/Unpin, Archive and Delete. Reorder = long-press, drag, let go: no rearrange mode, Done button or drag handles. Pin by dragging a chat into the Pinned section; drag it out to unpin. Never reorder the DOM mid-gesture (Android loses the touch).

**So:** Rejected and not to come back: pin by swipe (one direction doing two things), options hidden behind a long-press, any rearrange mode.
