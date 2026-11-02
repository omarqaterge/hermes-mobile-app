# Connectors (Hermes's integrations in the app)

The owner asked for "connectors like calendar and email and all others that Hermes supports", using Hermes's own
integrations (not the phone's Android calendar or contacts).

**State** (2026-11-02)
- Settings → Connectors (spec 3.15) covers what the pinned Hermes's dashboard already has routes for: MCP servers (list,
  add by address or command, Hermes's catalog, on/off, test, OAuth sign-in in the browser, remove), the toolsets that
  need a key or an account (web, browser, image and video generation, TTS, X search, Home Assistant, Spotify) and the
  `.env` keys bundled skills read. No plugin routes were needed for this part.
- Browser tests (`tools/web-e2e/checks/25-connectors.cjs`) and contract cases for the new Hermes routes.

**Next**
- Google Workspace (Gmail, Calendar, Drive, Docs, Sheets): Hermes sets it up only with its skill's script
  (`skills/productivity/google-workspace/scripts/setup.py`: `--client-secret`, `--auth-url`, `--auth-code`, `--check`,
  `--revoke`; token in `HERMES_HOME/google_token.json`) and has no dashboard route. Plan: plugin routes under
  `/api/plugins/hermes-mobile/google` that run that script for the bot's home (status, upload the client secret, start,
  finish with the pasted redirect URL, revoke), and a Google row on the Connectors page.
- Messaging platforms (Slack, email IMAP/SMTP, Telegram…) are Hermes front ends (`/api/messaging/platforms`), not tools;
  the app keeps hiding them unless the owner decides otherwise.

**Needs a real phone**
- MCP OAuth: the service redirects the phone's browser to Hermes's callback on the dashboard's local address; check it
  arrives and the sheet reads "Signed in.".
- A command (stdio) server needs its program (npx, uvx) inside Debian.

**Links**
- Hermes routes: `hermes_cli/web_routers/mcp.py`, `hermes_cli/web_routers/tools.py`, `hermes_cli/web_routers/config_env.py`.
