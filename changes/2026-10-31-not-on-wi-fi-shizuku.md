---
rank: small
---
- **"Not on Wi-Fi" Shizuku notice after a restart with Wi-Fi off.** The check that Shizuku came back runs 90 s after
  the app starts, but that wait only counted time the phone was awake, so a phone left asleep after the restart showed
  the notice late or not at all. It now counts real time: the notice ("Shizuku isn't running … Not on Wi-Fi") is there
  as soon as the phone is awake, without waking it. Seen on an Android 15 emulator; not yet on a real phone.
