- **No more "Auxiliary title generation failed: HTTP 429" while Hermes works.** When the model that names your chats
  is rate limited, the chat keeps the name taken from your first message, the status line keeps saying what Hermes is
  doing, and Hermes waits (one minute, doubling up to half an hour) before asking for a title again instead of trying
  with every new chat; a later message in the chat gets it its proper name. The status line part comes with the app
  update; the waiting comes with the Hermes fix applied by `phone/install.sh` or a new Debian image. Checked with
  Hermes's own tests and the browser tests; not yet seen on a phone with a real rate-limited provider.
