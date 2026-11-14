---
rank: big
---
- **Hermux checks it is talking to the real Hermes, and never sends its key.**
  Hermux, the Hermes plugin and the phone's helper scripts used to hand one internal key to whatever answered on a
  local port. Now each side first asks the other to prove it holds the key, and sends nothing if the answer is wrong;
  every request after that is signed, and the key itself is never sent. Another app on the phone can no longer pass
  itself off as one of these local servers, or get the key by listening on a port. The background app host (what
  Hermux uses to work in an app on a hidden screen) no longer sits on a fixed port: the phone picks a new one each
  time it starts, and the host only answers signed requests.
  What you may notice: the Hermes plugin updates itself after you install this version, as usual, and Hermux then
  replaces its internal key once by itself (and again after later app updates). If Hermux can't verify a local server,
  it sends nothing and shows a one-time notification, "Hermux stopped talking to Hermes"; restarting the phone fixes
  it. If the plugin is held or was changed by hand, Settings → About → Plugin offers "Update anyway", and after two
  weeks the setup check may show "Phone scripts out of date" until it is updated.
  Tried on two Android 16 phones, one updated from 0.8.67 with its chats and settings kept: the old key is refused
  everywhere, fake listeners on the old ports received nothing, chats, phone data, the background app host and a
  restart of the phone all worked, and the logs and a problem report held no key or token. Not tried: airplane mode on
  its own, Live mode, an interrupted update or a downgrade.
