---
rank: small
---
- **The Auto button never shows a safer mode after a failed switch.** When switching between Off, Auto access and Full access fails or its answer is lost (a dropped connection, say), Hermux now turns the chat's no-asking mode off, or shows the most permissive mode it might be in, and says so in the chat. A reopened chat whose Auto access can't be set again goes to Off instead of quietly running without its blocks. Checked with unit tests through the real gateway; not tried on a phone.
