# Settings: two sections and short pages

**Decided:** 2026-11-16, by the owner, for the interface redesign (task 06).

The Settings main page had grown into a long list of rows and switches. It becomes a short index: what is about the
agent, and what is about this app, each a few rows that open a page. Things that need attention come first, as cards,
so they are not lost in the list.

**So:**

- **The main page:** Search settings, then the attention cards (Connect a model, Hermux is offline, Update to
  <version>; each only when it applies), then the section **Hermux** (Models, Connectors, Behaviour, Access & privacy)
  and the section **This app** (Appearance, Voice, About & help). Each row shows its current value where it has one
  (the model, the Auto mode, the theme, the app version). **No switch on the main page:** every switch lives on its page.
- **The page names:** Models (Default models, Model providers, All keys), Connectors, **Behaviour** (once "Hermux
  settings": Replies first with Dynamic UI, "See what Hermux remembers", the catalog's groups, Advanced settings last),
  **Access & privacy** (Approvals, Phone data, Background apps, Kept on this phone), Appearance, Voice (the only place
  for Read every reply aloud), **About & help** (Updates, Help, Versions, Developer, Uninstall last and red).
- **Protections move with their rows, unchanged:** the fingerprint or screen lock before turning off "Confirm approvals
  with fingerprint", the confirmations before Full access, Always for a background app, Forget and Delete the log, and
  Android's own permission requests. The rows are the same components in a new place
  ([approval-needs-fingerprint.md](approval-needs-fingerprint.md), [phone-data-read-only.md](phone-data-read-only.md),
  [diagnostic-log.md](diagnostic-log.md)).
- **Back goes up one step:** a page inside a page (Default models, Model providers, All keys, Memory, Advanced
  settings, Speech recognition) goes back to its parent; a page goes back to the main page; the main page closes
  Settings.
- **Words that name a place say the new one** (Settings → Models → Model providers, Settings → About & help, Settings →
  Access & privacy → Phone data), in the app, the plugin's messages and the Android notification text.
- Full pages stay solid ([glass-and-motion.md](glass-and-motion.md)); the cards are solid too.
