---
rank: small
---
- **Less battery use when a second copy of Hermes was already running.** If the app's background loop found Hermes
  already serving, it kept starting Debian about every 14 seconds until that copy stopped. Now it starts nothing and checks once a minute, and
  starts Hermes when that copy stops. A Hermes that ran a while and died
  still comes back after 10 seconds. Tested with stand-ins for Hermes; not yet run in full on a phone.
