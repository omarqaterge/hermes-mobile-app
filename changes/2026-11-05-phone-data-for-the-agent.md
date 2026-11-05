---
rank: big
---
- **The agent can read your phone data, only if you switch it on.** Settings → "Phone data for
  the agent" has a master switch and one switch each for contacts, calendar, call log, messages (SMS), approximate
  location and latest photos. All of them are off until you turn them on. Turning one on asks for your fingerprint or
  screen lock every time (a phone with no screen lock can't turn them on), and then for the Android permission; turning
  one off is instant. The agent can only read: it cannot change or send anything.
  Every read asks first. A card in the chat says in the app's own words what will be read, with only Allow once and
  Deny. Your fingerprint is asked on the first Allow in a chat, not on the later ones. Full access (`/yolo`) skips the
  question, Auto access refuses to read, and a locked phone is refused.
  Results are limited (50 rows, 16 KB, long text cut) and marked as data to read, not instructions. They go to the
  model provider you chose and stay in the chat history. Location is approximate (about 1 km), and photos give only the
  date, size and dimensions, never the picture.
  After a chat has read phone data, that chat gets extra care: pictures from the web need a tap, links show their full
  address first, HTML previews show as text, the page can't make web requests, and Hermux asks before commands and tools
  that can send data out (not in Full or Auto access).
  The limits, plainly: with Shizuku the agent can act as Android's shell user, which this cannot stop; in Full access
  nothing asks; the plugin's check of commands is a speed bump, because the agent can rewrite plugin files; and a script
  file can hide a command. See Privacy for the details. Needs Android 8.0 or newer (photos use another permission from
  Android 13). Tested on one phone with Android 16; not yet on older Android.
