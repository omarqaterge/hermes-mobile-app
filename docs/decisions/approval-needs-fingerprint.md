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
