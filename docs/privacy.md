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

## Phone data for the agent (off unless you switch it on)

Hermux can let the agent read some of your phone's data. It is off by default. In Settings → "Phone data for the agent"
there is a master switch and one switch each for contacts, calendar, call log, messages (SMS), approximate location and
latest photos. Turning one on asks for your fingerprint or screen lock, then for the Android permission. Without a
screen lock it can't be turned on. Turning it off is instant.

**What can be read.** Contacts (names, numbers, emails), calendar events, call log entries, text messages, one
approximate location (about 1 km) and, for photos, only the date, size and dimensions, never the picture. Reading only:
nothing is changed or sent. A result holds at most 50 rows and 16 KB, and long text is cut.

**Where it goes.** What the agent reads is part of the chat. It goes to the model provider you chose, like any other
message, and it stays in the chat history and in Hermes's own session store and logs on the phone, which are outside
this app and which Hermux doesn't control. Hermux itself never writes names, numbers, message text or coordinates to its
own logs, to the diagnostic log or to a problem report.

**What Hermux does.**
- Every read asks you first, with wording the app writes from what will be read, and you can only Allow once or Deny.
  The first Allow in a chat asks for your fingerprint; later ones in that chat don't.
- Full access (`/yolo`) skips that question. Auto access refuses to read. A locked phone is refused.
- Results are marked as data to read, not as instructions, because a message from a stranger can contain text meant to
  steer the agent.
- After a chat has read phone data, in that chat remote images need a tap, links show their full address before they
  open, HTML previews show as text, web requests from the page are refused, and the plugin asks before commands and tools
  that can send data out (not in Full or Auto access).

**The limits.**
- Hermux requires Shizuku, which lets the agent act as Android's shell user. Switches and questions protect the phone data
  tool, but they can't stop an agent that uses Shizuku to read or tap on its own.
- In Full access nothing asks, so text the agent reads could steer it into reading more.
- The plugin's matching of commands is a list of patterns and a speed bump: the agent can rewrite plugin files, and a
  script file can hide a command. The app's own record, filter and dialogs are what enforce the rules.
- A chat that Hermes compressed on another device, or while the plugin was down, is covered only by the plugin's
  database chain and the page's record of related chats.
- Tested on one phone with Android 16, not yet on older Android.
