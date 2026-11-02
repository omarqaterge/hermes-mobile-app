---
rank: small
---
- **No more title errors while Hermux works.** "Auxiliary title generation failed: HTTP 429" no longer shows. When the model that names your chats
  is rate limited, the chat keeps the name taken from your first message, the status line keeps saying what Hermux is
  doing, and Hermux waits (one minute, doubling up to half an hour) before asking for a title again instead of trying
  with every new chat; a later message in the chat gets it its proper name. The status line part comes with the app
  update; the waiting comes with the agent fix applied by `phone/install.sh` or a new Debian image. Checked with
  the agent's own tests and the browser tests; not yet seen on a phone with a real rate-limited provider.
