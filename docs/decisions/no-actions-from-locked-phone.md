# No Hermes actions from a locked phone's notification

**Decided:** 2026-10-30, by the owner.

The owner called acting from a locked phone "very dangerous". Allow, Allow session, Reply and answers in notifications need an unlock first. Talking to Hermes from the lock screen is a Settings option (Settings → Voice → Phone assistant → Talk to Hermes on the lock screen), off by default, and with it on Auto and Full access are off there.

**So:** Don't add notification actions that work while the phone is locked.

**Slash commands (2026-11-21):** over the lock screen the app checks the lock before it sends a slash command, and runs only
a short list of commands that only show something (`/help`, `/status` and a few others, by their exact names, in a chat
with access off). Everything else waits for an unlock, including `/approvals off`, quick commands and aliases (spec 3.4).
