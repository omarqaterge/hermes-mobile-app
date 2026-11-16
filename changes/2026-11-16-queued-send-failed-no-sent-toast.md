---
rank: small
---
- **No false "Sent" toast when a queued message could not be sent.** A message queued while offline that then failed to send showed "Sent the message you queued" beside "Send failed". Now only the failure shows, and the text returns to the composer. Checked with a unit test through the real gateway; not tried on a phone.
