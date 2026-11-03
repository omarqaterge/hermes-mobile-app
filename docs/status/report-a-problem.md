# Report a problem

**State (2026-11-02):** built. Settings → About → Report a problem, plus links from error states (spec 3.21). Every
build until the owner sets the relay up sends reports through GitHub's filled-in new-issue page. The relay
(`relay/report/`) is written and tested with a stand-in KV and GitHub, not deployed.

**Next (owner):** the steps in [relay/report/README.md](../../relay/report/README.md):
1. Create a fine-grained GitHub token: only `omarqaterge/hermes-mobile-app`, Issues read and write. Optionally the
   `from-app` label.
2. `npx wrangler login`, `npx wrangler kv namespace create REPORTS`, put its ID in `relay/report/wrangler.toml`.
3. `npx wrangler secret put GITHUB_TOKEN` (and optionally `IP_SALT`), then `npx wrangler deploy`.
4. Add the Worker's address as the repository variable `REPORT_RELAY_URL` (Actions → Variables). The next release
   sends through the relay.

**Needs a real phone:** the picture picker from the sheet; GitHub's page opening in the phone's browser with the text
filled in (and the user signed in there); with a relay, a report from the app's `file://` page reaching it (CORS) and
the screenshot showing in the issue.

**Open points:** the app log is the web page's own (errors, warnings, connection changes, error toasts). The Android
shell's own log isn't included; that would need a bridge method.

**Links:** [spec 3.21](../spec/03-21-report-a-problem.md), [decision](../decisions/report-a-problem.md).
