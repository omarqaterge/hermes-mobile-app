# Diagnostic log

**State (2026-11-03):** built on every layer: page, Android shell, plugin, supervisor, relay (spec 3.21, decision
[diagnostic-log](../decisions/diagnostic-log.md)). Tested with unit tests, plugin and shell tests with planted secrets, a JDK
test of `DiagLog`, a stand-in relay and the browser tests. **Not yet run on a phone.**

**Next (owner):** when deploying the relay ([relay/report/README.md](../../relay/report/README.md), status
[report-a-problem](report-a-problem.md)), also set the secret `LOG_READ_KEY`.

**Needs a real phone:**
- The app starts normally with the new `HermuxApp`, and Settings → About shows the two rows.
- A real crash and a force stop show as `crash java` and `app exit` in the log after the next start.
- `onRenderProcessGone`: killing the renderer brings the page back instead of ending the app, four deaths within a minute
  go back to the launcher with the service still running, and nothing crashes from calls to the destroyed WebView before the
  new activity starts (assumed from Chromium ignoring such calls, not seen).
- The report sheet's box shows all four sections, and `GET /diag` reads `~/logs` under proot and under chroot.
- A phone's plugin check replaces an old `~/bin/hermes-services` (`sync_services`, spec 6.6), and the `dashboard` loop starts anew with
  the next plugin update. The other loops need a phone restart before they record `loop_exit`.
- Off: `diag-off` written from Debian stops `loop_exit` in Termux; on chroot that file belongs to root, so check Termux
  still reads it and the uninstaller removes it.

**Open points:** what a user already sent can't be deleted from the app: it expires after 30 days, or the owner deletes it.
Whether Hermes's `api_request_error` hook passes `provider` and `model` wasn't checked on a phone; the fields are simply left
out if it doesn't.

**Links:** [spec 3.21](../spec/03-21-report-a-problem.md), `web/src/diaglog.ts`, `web/src/diagnostics.ts`,
`android/src/com/omarqaterge/hermesmobile/DiagLog.java`, `hermes-plugin/hermes-mobile/diag.py`.
