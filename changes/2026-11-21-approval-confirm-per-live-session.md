---
rank: small
---
- **Allow on an approval notification now always opens the app first.** With "Confirm approvals with fingerprint" on, Allow once and Allow session on the notification open Hermux on that chat instead of answering; the sheet asks for your fingerprint only if this chat session hasn't been confirmed yet, so a confirmed chat needs one more tap. The confirmation now belongs to the chat's live session, so a chat that comes back in a new session (after a reconnect, or when it was closed) always asks again. Checked with unit and browser tests on a computer; not tried on a phone.
