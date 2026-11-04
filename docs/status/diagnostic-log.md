# Diagnostic log

**State (2026-11-04):** built on every layer (spec 3.21, decision [diagnostic-log](../decisions/diagnostic-log.md)). First phone
pass done on an Android 16 phone under proot, on a build from before the plugin update installed the supervisor script.

**Seen working on that phone:** start-up with `HermuxApp`; `app exit` reasons after a force stop and a crash; `crash java`; planted text
staying out of the page's events and of `GET /diag`; traceback shapes from real service logs; the report sheet's sections; the
switch and delete on every layer, with the flag readable in Termux; a dead renderer bringing the page back in the same process; four deaths
going back to the launcher with the service alive and no fatal exception; `loop_exit`; `turn start` and `turn end`; `diag.log` being
owner-only.

**That pass found, fixed after it:** script places were always `none` in the app (the page is `index.html`, one file); `reason=?` on
every `turn end`; two exit reasons without a name; and a dashboard left running outside its loop made the new loop start Debian
every 14 s (now it waits up to 5 min).

**Next (owner):** when deploying the relay ([relay/report/README.md](../../relay/report/README.md), status
[report-a-problem](report-a-problem.md)), also set the secret `LOG_READ_KEY`.

**Needs a real phone:**
- A phone's plugin check replacing an old `~/bin/hermes-services` (`sync_services`, spec 6.6), and the `dashboard` loop starting anew with
  the next plugin update, without leaving the old dashboard running. The other loops need a phone restart before they record `loop_exit`.
- `at=index.html:…` on a real page error, our own frames in a real `crash java` line (the test crash has none), and a real `reason=` name.
- The page looking right after a renderer death (the pass confirmed its script runs, not how it looks).
- `hermes-debian --restart` leaving no new `OSError` crash in `dashboard.log` (the pattern was checked against a running dashboard, the restart was not run). Chroot installs: that it stops Python.
- `turn api_error`: whether Hermes's hook passes `provider` and `model`. Chroot installs. Android 8-10 (no exit reasons there).

**Open points:** what a user already sent can't be deleted from the app: it expires after 30 days, or the owner deletes it. An exit code
under proot can say 0 for a killed program (`loop_exit name=cron-ticker code=0` after `pkill`), so the line says it ended, not why.

**Links:** [spec 3.21](../spec/03-21-report-a-problem.md), `web/src/diaglog.ts`, `web/src/diagnostics.ts`,
`android/src/com/omarqaterge/hermesmobile/DiagLog.java`, `hermes-plugin/hermes-mobile/diag.py`.
