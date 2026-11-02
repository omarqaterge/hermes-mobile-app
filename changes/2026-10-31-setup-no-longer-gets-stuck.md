---
rank: small
---
- **Setup no longer gets stuck on the screen access step.** At "Hermes can see and use the screen (Shizuku)", after you started Shizuku the page
  said it would move on by itself but never checked again, so it stayed there. It now re-checks every few seconds while
  that step is on screen (up to 10 minutes per visit), and when Shizuku runs but Termux isn't allowed yet it says so
  (tap Allow all the time on Shizuku's prompt) instead of "Shizuku isn't running". The Status sheet's Shizuku row says
  "Termux not allowed" in that case too. Browser and plugin tests only; not yet on a real phone.
