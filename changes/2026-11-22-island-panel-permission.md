---
rank: big
---
- **Allow or deny a command from the top of the screen.** Tapping a "Hermux wants to run a command" card now opens
  the dark panel at the top of the screen on that request: what Hermux wants to do, the command, a ring that counts
  down the time left (turning red near the end, with one tick), and Deny, Allow once and Allow this session. Allow
  asks for your fingerprint or screen lock first, every time, while "Confirm approvals with fingerprint" is on; the
  card's own Allow now opens the panel and asks there instead of opening the app. Deny is one tap. The panel shows
  Sending, then Allowed or Denied, and moves on to the next request waiting or closes; it says so when an answer
  could not be sent, when the request runs out, or when it was answered in the app. A request to read your phone's
  data has no Allow in the panel: "Review in Hermux" opens the chat. Checked on Android 15 and Android 8.0 emulators
  without Hermes (so the answer itself was not seen arriving); not yet tried on a phone.
