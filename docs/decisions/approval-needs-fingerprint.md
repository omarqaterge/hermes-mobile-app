# Allowing a command needs the fingerprint, once per chat session

**Decided:** 2026-11-02, by the owner.

With approvals on (the chat's Auto is Off), anyone holding the unlocked phone could tap Allow on a command Hermes wants
to run.

**So:** The first Allow in a chat session needs the phone's biometric (or its PIN, pattern or password). After one
success, that chat's later approvals don't ask again until the session ends: the app restarts, or the app closes the
chat's live Hermes session (spec 3.6 defines it). Deny never asks. On by default, with a Settings switch "Confirm
approvals with fingerprint" under Permissions; turning it off asks too. A phone with no screen lock approves as before
and shows a one-time hint. The notification's Allow follows the same rule: until the chat is confirmed it opens the app
instead of answering. Don't add a path that allows a command without this check.

**How it is kept (2026-11-21):** a confirmation is filed under the chat's live Hermes session (its runtime id), not the
stored chat, so a new live session always asks and nothing has to be forgotten when one ends. The notification never
names the live session, so its Allow always opens the app while this is on (spec 3.6).

**Changed (2026-11-22, by the owner):** the notification's Allow for a chat that isn't confirmed now opens the island
panel on that request instead of the app, and the panel asks for the fingerprint (or the screen lock) there, every
time, before it sends that one answer. The panel's own Allow asks the same way. What the panel sends is checked again
by the service against the request still waiting, and an Allow goes through only with the one-use grant the prompt
filed for that very request and choice. The check itself is unchanged: no Allow without it, Deny stays one tap, a
phone-data read is never allowed from the panel or the notification, and nothing allows from a locked phone (spec
3.6, 3.22).
