---
rank: big
---
- **Hermux now verifies the local Hermes connection and replaces its internal key.** Hermux, the Hermes plugin and the
  phone's helper scripts now check that the Hermes they talk to on the phone is the real one before they send it
  anything, and they no longer send the internal key itself. Once the plugin update that comes with this version has
  finished, Hermux replaces that key once, by itself; it does so again after later app updates.
  What you may notice: the Hermes plugin updates itself after you install this version, as usual. If Hermux can't
  verify Hermes, it sends nothing and shows a one-time notification saying so ("Hermux stopped talking to Hermes"); a
  restart of the phone fixes it. If the plugin is held or was changed by hand, Settings → About → Plugin offers
  "Update anyway", and after two weeks the setup check may show "Phone scripts out of date" until it is updated.
  Not yet tested on a real phone.
