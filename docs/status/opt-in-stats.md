# Opt-in usage stats

**State (2026-11-02):** built and off. Needs the owner's Aptabase key: until a build has one, nothing is offered and
nothing is sent (`web/src/stats.ts`, spec 2.3).

**Next (owner):**
1. Create an Aptabase account and app (pick the EU or US region), and copy the app key (`A-EU-…` or `A-US-…`).
2. Add it as the repository variable (not a secret) `APTABASE_APP_KEY`: Settings → Secrets and variables → Actions →
   Variables. `release.yml` builds the app with it from the next release on. For a local build:
   `HERMES_STATS_KEY=<key> npx vite build` in `web/`.
3. Before step 2, decide whether these two findings are acceptable:
   - Aptabase's published server code stores a country code and a region worked out from the IP address, and a one-day
     hash of the IP address and browser identification. The app can't switch this off; only a relay we run could.
     The card, README and spec say so.
   - The WebView's `User-Agent` header names the phone model on every web request. The event body has no model and
     Aptabase says it doesn't store the header, but it does receive it. A page can't change that header. Fixing it takes
     one line in `MainActivity.java` (`setUserAgentString` without the model), or sending from the shell. Left out here
     because another branch was editing that file. Until then the card doesn't promise "never the phone model".

**Needs a real phone:** with a key in the build: the request succeeds from the app's `file://` page (browser checks
only saw a stand-in server); events appear on Aptabase's dashboard; its "sessions" count installs as intended (read from
its server code, not seen on the hosted service).

**Links:** [spec 2.3](../spec/02-03-security-model.md), [card](../spec/03-18-setup-flow-setup-check-welcome.md),
[decision](../decisions/usage-stats-opt-in.md).
