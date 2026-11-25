---
rank: small
---
- **Leaving a chat ends Live mode and releases the microphone.** Opening another full-screen page such as Setup check or Settings while Live conversation or dictation is active now ends listening immediately and stops the phone's microphone recorder without waiting for a timeout. Checked in automated unit, browser and Java source tests; not yet tried on a real phone.
- **Chats that read phone data keep their HTML and image guards.** Fenced HTML snippets of any length now show the plain note that HTML previews are off in that chat (with no Preview button), and a held remote image placeholder ignores scroll drags and returns to its hold notice if a tapped image fails to load instead of collapsing into a file chip. Checked in automated unit and browser tests; not yet tried on a real phone.
