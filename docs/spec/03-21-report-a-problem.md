### 3.21 Report a problem

**Opens from:** Settings → About → Report a problem (`ReportRow`, under What's new); the "Report a problem" link in a
hub screen's error notice (`ReportLink` in `LoadError`, `components/Screens.tsx`) and under "The installer stopped" in the
setup flow; the Report a problem button of the Backend status sheet while Hermux is offline or has problems (it closes
that sheet first). `openReport()` opens it from anywhere; `ReportHost`, mounted once in `App.tsx`, shows it.
**Closes with:** the grip, backdrop, Back, Cancel or Close, but not while a report is sending (30 seconds at most). **Source files:** `web/src/components/Report.tsx` (the
sheet), `web/src/report.ts` (what is sent, the log scrubber, the GitHub link, sending), `web/src/applog.ts` (the recent
app log), `relay/report/` (the relay, below). Decision: [report-a-problem](../decisions/report-a-problem.md).

**The form** ("Report a problem"): a warning first, "Reports are public: anyone can read them on GitHub. Don't write
anything private."; the fields Title (up to `MAX_TITLE`, 120 characters) and What happened (up to `MAX_TEXT`, 6000); a
line naming what is sent with it ("Sent with it: app …, Android …, Hermux agent …. Nothing else about your phone.",
from `reportDetails`: `appVersion()`, the Android version from the WebView's identification, and the Hermux agent version of
the open chat or the health check); the switch Include recent app log (off every time the app starts; while on, the
exact text that will be sent, read once when switched on, shows below it, scrolled in a box labelled "App log to send",
with a note on what the app takes out and that it can miss some); and the screenshot row. With a relay in the build, the row Add a screenshot opens the phone's picture
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
open GitHub's new-issue page (`fallbackUrl`: `/issues/new?title=…&body=…` with the same text, versions and log the
relay would send, `issueText`), and the sheet shows "Finish on GitHub": why (limit: "This phone has sent several reports
today…"; failure: "The app couldn't send it."; no relay: "Reports from the app go through GitHub."), that the page has
the report filled in and needs Create, and, with a picked screenshot, that it must be attached there (the issue text
says so too). Buttons Back (to the form, text kept) and Open GitHub again. The link stays under 7500 characters: the
log's oldest lines go first, then the end of the text, marked "(Cut: the rest didn’t fit in the link.)".

**The app log** (`applog.ts`): `startAppLog` (from `main.tsx`) keeps the last 150 lines, in memory only, of page errors,
unhandled promise failures, `console.error` and `console.warn`, connection changes (`conn` and its detail) and error
toasts, each `HH:MM:SS kind message` (UTC time of day), cut to 400 characters. `logLine` adds one, `appLog` reads them.
Nothing reads it but this sheet. Each line loses the open chat's text as it is added, before the cut (`openChatText`,
the title and last 300 messages; `removeChatText`), and an error toast keeps only what failed: its words up to the first
`: `, with quoted names replaced. `wellFormed` drops half an emoji left by a cut.

**Scrubbing** (`scrubLog`, before the log is shown): any line of the open chat's title or messages (12 characters or
more; spaces evened out, also in JSON form; a long line also by its first 40 characters, to the end of the log line)
becomes `[chat text]`; then the phone model in a browser identification, URL queries, fragments, user names and path
parts of 20 characters or more (`https://host/path?[removed]`), JWTs, Bearer and Basic values, `sk-`/`pk-`/`rk-` keys,
GitHub, Slack, Google, Groq, AWS, Telegram and Hugging Face tokens, `token=`/`client_secret=`/`Authorization:`/
`password=`-style values under any longer name, emails (`[email]`), IPv4 addresses but loopback and IPv6 addresses
(`[ip]`), whole paths in the Termux, Linux and macOS home folders (`~`) and shared storage (`[storage]`), hex IDs of 32
characters or more (`[id]`), long encoded strings (`[data]`) and quoted text of 25 characters or more (`"[text]"`). The result is cut
to the last `MAX_LOG` (20000) characters.

**The relay** (`relay/report/worker.js`, a Cloudflare Worker on the free plan; setup steps in `relay/report/README.md`):
`POST /` checks the report (`readReport`: install ID, title and text lengths, log length, version strings, a JPEG, PNG or
WebP screenshot of at most 3 MB whose bytes match its type), counts it against `LIMITS` (5 reports a day per install
ID, 20 a day per sender address, an IPv6 address by its /64, and 200 a day in all, kept in the KV namespace `REPORTS` with
the address only as a salted SHA-256 hash, the counters expiring after two days; KV isn't atomic, so a burst at the same
moment can pass a little over a limit), stores the screenshot in `REPORTS` and serves it at `GET /s/<random id>.<ext>`,
deleting it again if GitHub refuses the issue, then creates the issue with the Worker secret `GITHUB_TOKEN` (a fine-grained token that may only create issues on
`REPO`), labelled `LABEL` (`from-app`). The body (`issueBody`) has the text, the versions, the screenshot link and the
log in a folded block; `@` mentions and code fences in the user's text and log are defused (with a zero-width space), so a text can't swallow what follows it. Answers: 201 `{url, number,
screenshot}`, 400 for a bad report, 413 when too large, 429 at a limit, 502 when GitHub refused, 503 when the secret or
the namespace is missing. Any origin may call it (the app's page is a `file://` page). Tests: `relay/report/worker.test.js`
(`node --test`, a stand-in KV and a mocked GitHub API), run by CI's plugin job.
