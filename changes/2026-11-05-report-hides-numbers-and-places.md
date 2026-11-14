---
rank: normal
---
- **Problem reports hide phone numbers and coordinates.** Before a report leaves your phone, phone numbers in it
  become `[number]`, coordinates become `[place]`, and long quoted text becomes `"[text]"` even when it holds a link or
  an email address. Bare strings of digits are left alone so the log stays readable. Checked with the report's unit
  and browser tests; not yet seen on a phone.
