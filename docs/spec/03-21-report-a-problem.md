### 3.21 Report a problem

**Opens from:** Settings → About → Report a problem (`ReportRow`, under What's new); the "Report a problem" link in a
hub screen's error notice (`ReportLink` in `LoadError`, `components/Screens.tsx`) and under "The installer stopped" in the
setup flow; the Report a problem button of the Backend status sheet while Hermux is offline or has problems (it closes
that sheet first). `openReport()` opens it from anywhere; `ReportHost`, mounted once in `App.tsx`, shows it.
**Closes with:** the grip, backdrop, Back, Cancel or Close, but not while a report is sending (30 seconds at most). **Source files:** `web/src/components/Report.tsx` (the
sheet), `web/src/report.ts` (what is sent, the log scrubber, the GitHub link, sending), `web/src/diagnostics.ts` (the
diagnostic log the sheet shows), `web/src/applog.ts` (what the page itself adds to it), `relay/report/` (the relay, below). Decisions:
[report-a-problem](../decisions/report-a-problem.md), [diagnostic-log](../decisions/diagnostic-log.md).

**The form** ("Report a problem"): a warning first, "Reports are public: anyone can read them on GitHub. Don't write
anything private."; the fields Title (up to `MAX_TITLE`, 120 characters) and What happened (up to `MAX_TEXT`, 6000); a
line naming what is sent with it ("Sent with it: app …, Android …, Hermux agent …. Nothing else about your phone.",
from `reportDetails`: `appVersion()`, the Android version from the WebView's identification, and the Hermux agent version of
the open chat or the health check; "Nothing else about your phone, unless you include the log."); the switch
Include diagnostic log (off every time the app starts; while on, the exact text that will be sent, put together once when switched
on, shows below it, scrolled in a box labelled "Diagnostic log to send" with "Putting the log together…" until it is ready, and
Submit waits for it; a note says where it goes, private through a relay ("The log stays private…", deleted after 30 days) or
public without one ("The log will be public…"), that it never holds chats, what the app takes out and that it can miss
some); and the screenshot row. With a relay in the build, the row Add a screenshot opens the phone's picture
picker (a hidden file input for PNG, JPEG or WebP, the same picker path as the composer's); the picked picture shows
with "The screenshot will be public too. Check it shows nothing private." and Remove screenshot. `prepareScreenshot`
redraws it as a JPEG of at most 1600 px a side, which also drops the photo's metadata (place, time, camera). Without a
relay the row is a note: attach it on the GitHub page that opens. The last line says "This becomes a public issue in
omarqaterge/hermes-mobile-app on GitHub." Buttons: Cancel and Submit ("Continue on GitHub" without a relay; "Sending…"
while it sends). Submit needs a title and a text. Title, text and the log switch stay in memory when the sheet closes
and come back when it opens again, until a report is sent.

**Sending** (`sendReport`): with a relay URL (`relayUrl()`: the build's `__REPORT_URL__`, from `HERMES_REPORT_URL` at
build time, empty by default; outside the Android app also `hm.devReportUrl` in `sessionStorage`, for development and
the browser tests) it POSTs JSON `{installId, title, text, details: {app, android, hermes}, log?, screenshot?: {type,
data}}`, 30 seconds at most. `installId` is `hm.reportId`: 16 random bytes made the first time, only so the relay can
limit how often one install sends; never a phone identifier, and not the usage-stats ID. A created issue (an answer
whose `url` is an issue of this repository) shows "Report sent": "Thanks. Your report is now an issue on GitHub", with
Open the report and Close (and a note when the relay dropped the screenshot).

**The GitHub fallback:** no relay URL, a 429 (this phone or address reached its limit), any other failure or a timeout
open GitHub's new-issue page (`fallbackUrl`: `/issues/new?title=…&body=…` with the same text and versions the relay would
send, `issueText`). The log goes in that link only in a build without a relay, where the sheet said it would be public; in a
build with a relay it was promised private, so it is left out and the sheet says "Your diagnostic log isn't in it: on GitHub
it would be public." The sheet shows "Finish on GitHub": why (limit: "This phone has sent several reports
today…"; failure: "The app couldn't send it."; no relay: "Reports from the app go through GitHub."), that the page has
the report filled in and needs Create, and, with a picked screenshot, that it must be attached there (the issue text
says so too). Buttons Back (to the form, text kept) and Open GitHub again. The link stays under 7500 characters: the
log's oldest lines go first, then the end of the text, marked "(Cut: the rest didn’t fit in the link.)".

**The diagnostic log** (`diagnostics.ts`, decision [diagnostic-log](../decisions/diagnostic-log.md)). `collectDiagnostics`
puts it together on the phone from every layer, and `diagnosticsText` runs all of it through `scrubLog`. The sections, in this
order because a link that is too long loses the top first: **# Agent side** (`GET /diag`, 5 seconds at most; "Not available…"
when Hermux is offline or its plugin is older), **# App events** (`DiagLog`), **# Phone**
(`HermuxApp.phoneFacts`: Android version and API, the phone's maker but never its model, CPU type, WebView, Termux and Shizuku
versions, whether Shizuku runs, battery exemptions, notifications allowed, total memory rounded to a GB, free storage as a
range). Only this sheet reads it (Settings asks the shell only whether it is on, `diagEnabled`), and nothing leaves until Submit. **The rule on every layer:** an event is an area, a
name and short fields, each checked against a fixed shape when written (`logEvent` in `web/src/diaglog.ts`, `DiagLog.java`,
`diag.py`; a value is letters, digits and `_.:+-`, 32 characters at most, or it is written as `?`; only the `at` field may hold
a stack), so a message, a path or an error's words can't get in; `scrubLog` is the second layer. What is logged:

| Layer | Events |
|---|---|
| The page (`applog.ts`, `gateway.ts`, `api.ts`) | `web js_error` and `console_error` (the error's type and script places from the stack's "at" lines, `stackFrames`, never its words), `error_toast` (only that one showed); `conn lost`, `conn open` with `down_s` and `tries`, `conn connect_failed` (`noteConn`: one outage is two lines); `rpc fail` and `rpc slow` (`noteRpc`: the method's name, the time, the error's code; never its parameters; slow means 10 seconds or more); `api fail` for a dashboard call answering 500 or more or not at all (`routeName`: the path's first part only) |
| The Android shell | `crash java` (`DiagLog.crash`: type and root cause's type, our own frames, never the words or a thread's name); `app start`; `app exit` (Android 11+, `getHistoricalProcessExitReasons`: why each earlier run ended, with its status, importance and memory, not the system's description or trace); `app low_memory`; `webview render_gone`; `service app_service_start`, `app_service_stop`, `start_failed`; `setup step`, `fail`, `done` (the installer's step names from `POST /setup`, never a line's words); `shizuku keeper`; `plugin update_failed`; `voice stt_failed` |
| Hermes's side (`__init__.py` → `diag.py`) | `turn start`, `turn end` (seconds, `completed`, `failed`, `interrupted`, the exit reason's name only: `reason_name`, because what follows it can be an error's words), `turn api_error` (status, whether it retries, the reason's name, provider, model, the error's type, never its words), `turn stale`; a chat is `chat=` an alias that means nothing outside its process (`alias`), never its ID; `plugin not_registered`, `hook_failed` |
| The supervisor (`hermes-services`) | `service loop_exit` with the loop's name and exit code, except the loops that end on purpose |
| Hermes's service logs, read only (`diag.py`) | `crash service=… type=… count=… at=…`: `traceback_shapes` keeps only the exception's type (a name Python's way, or `unknown`) and the frames in Hermes, the plugin or an installed package, from the last 256 KB of each `~/logs/<loop>.log`; never the error's words, a code line, a frame in any other file, or any other line. `services` adds each loop's state (`alive`, `log_kb`) |

**Kept on the phone:** on each side two files of 128 KB at most, lines older than 7 days dropped when read and taken out of the files once a day (`prune`), at most 30 events a
minute in the app and 60 a process on Hermes's side (a `log dropped` line says how many went; a crash always gets through).
Times are month, day and UTC time, no year or time zone. `HermuxApp` does this only in the app's main process, not in the speech-model probe's. The app's files are in `getNoBackupFilesDir()/diag`, which no device
backup holds; `HermuxApp.log` is the app's one `DiagLog`. In a plain browser events stay in memory (`memoryEvents`, the last 300).

**The switch and delete button** (`DiagRows` in `web/src/components/DiagRows.tsx`, Settings → About): "Keep a diagnostic log" (on by
default: on the phone only, and a log has to exist before something goes wrong) and, while it is on, "Delete the diagnostic log"
(after `confirmDialog`). Off (`setDiagnosticsEnabled`, bridge `setDiagEnabled`) stops every layer, the supervisor too (the file
`~/.hermes-mobile/diag-off`) and deletes what was kept; a crash is then not recorded either. Delete (`clearDiagnostics`) removes
the app's and Hermes's files and empties the service logs the crash shapes come from. Hermes's side is told at once, or at the
next connection if it is offline (`hm.diagPending`, `flushDiagToPlugin`); `hm.diagOff` keeps the choice in a plain browser. What
was already sent can't be taken back from here: see the relay below.

**The page's part** (`applog.ts`): `startAppLog` (from `main.tsx`) adds `keepError`'s shape of page errors, unhandled promise failures and console errors, and `error_toast`, never their words, which can hold the user's own text. `openChatText` gives the open chat's title and last 300 messages to the scrubber; `removeChatText` takes them out, and `wellFormed` drops half an emoji left by a cut.

**Scrubbing** (`scrubLog`, before the log is shown): any line of the open chat's title or messages (12 characters or
more; spaces evened out, also in JSON form; a long line also by its first 40 characters, to the end of the log line)
becomes `[chat text]`; then the phone model in a browser identification, URL queries, fragments, user names and path
parts of 20 characters or more (`https://host/path?[removed]`), JWTs, Bearer and Basic values, `sk-`/`pk-`/`rk-` keys,
GitHub, Slack, Google, Groq, AWS, Telegram and Hugging Face tokens, `token=`/`client_secret=`/`Authorization:`/
`password=`-style values under any longer name, emails (`[email]`), IPv4 addresses but loopback and IPv6 addresses
(`[ip]`), whole paths in the Termux, Linux and macOS home folders (`~`) and shared storage (`[storage]`), hex IDs of 32
characters or more (`[id]`), long encoded strings (`[data]`) and quoted text of 25 characters or more (`"[text]"`). The result is cut
to the last `MAX_LOG` (60000) characters.

**The relay** (`relay/report/worker.js`, a Cloudflare Worker on the free plan; setup steps in `relay/report/README.md`):
`POST /` checks the report (`readReport`: install ID, title and text lengths, log length, version strings, a JPEG, PNG or
WebP screenshot of at most 3 MB whose bytes match its type), counts it against `LIMITS` (5 reports a day per install
ID, 20 a day per sender address, an IPv6 address by its /64, and 200 a day in all, kept in the KV namespace `REPORTS` with
the address only as a salted SHA-256 hash, the counters expiring after two days; KV isn't atomic, so a burst at the same
moment can pass a little over a limit), stores the screenshot in `REPORTS` and serves it at `GET /s/<random id>.<ext>`,
deleting it again if GitHub refuses the issue, stores a diagnostic log under `log:<random id>` for `LOG_DAYS` (30) days with nothing saying who sent it, deleted again likewise, then creates the issue with the Worker secret `GITHUB_TOKEN` (a fine-grained token that may only create issues on
`REPO`), labelled `LABEL` (`from-app`). The body (`issueBody`) has the text, the versions, the screenshot link and only the private log's name ("Diagnostic log: kept privately as …"), never the log; a log that couldn't be stored stays out too and the report still goes (`log` false, and the sheet says "The diagnostic log didn't go with it."). `@` mentions and code fences in the user's text are defused (with a zero-width space), so a text can't swallow what follows it. `GET /l/<id>` (`privateLog`) answers a log only with the Worker secret `LOG_READ_KEY` as a Bearer key (`keyMatches`, compared as hashes; no key set means nobody reads one through the Worker), with `no-store` and no CORS header; 401 otherwise, 404 for no such log. Answers to `POST /`: 201 `{url, number,
screenshot, log}`, 400 for a bad report, 413 when too large, 429 at a limit, 502 when GitHub refused, 503 when the secret or
the namespace is missing. Any origin may call it (the app's page is a `file://` page). Tests: `relay/report/worker.test.js`
(`node --test`, a stand-in KV and a mocked GitHub API), run by CI's plugin job.
