# Privacy

Hermux runs [Hermes Agent](https://github.com/NousResearch/hermes-agent) on your phone. Your chats, memory, files,
canvas documents and keys stay on the phone. What leaves it:

- **Your model calls.** The messages of a chat go to the model provider you picked (over HTTPS), as with any agent.
- **Tools you turn on.** Web search, MCP servers and other connectors talk to their own services when Hermux uses them.
- **Usage stats, only if you say yes** (below).
- **A problem report, only when you send one** (Settings → About → Report a problem). Reports are public GitHub issues;
  they carry only what you write, the app, Android and Hermux versions, and the scrubbed app log or a screenshot if you
  add them.

## Usage stats (off unless you say yes)

The app sends nothing about how you use it unless you opt in, on a card shown once after setup or in Settings → About
→ Share anonymous usage stats. Turning it off stops sending and forgets the ID.

If you opt in, it sends to [Aptabase](https://aptabase.com) a random ID made only for this install, the app version, the
Android version, each app start and screen open, and, if you choose to answer, how you heard about the app (from a fixed
list). It never sends chats, prompts, tool output, file names, model keys, account names or phone numbers.

Like any web request, a report reaches Aptabase with your IP address and the app's browser identification, which names
the phone model. Aptabase says it doesn't store either; it keeps a rough country and region and a one-day anonymous code
worked out from them.
