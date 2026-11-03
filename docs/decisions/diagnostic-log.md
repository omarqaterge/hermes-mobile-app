# Diagnostic log: what happened, never what was said

**Decided:** 2026-11-03, by the owner.

Debugging a problem on someone's phone needs more than the page's own last 150 lines in memory, which a crash wipes. But
Hermux holds people's chats, files and keys, so the log must be safe to keep and safe to send.

**What it holds.** Fixed events on every layer: crashes, why Android ended the app, failed or slow calls, installer steps,
the agent's turns, service restarts, Python tracebacks' types and frames. Plus the phone's **maker** (not its model),
because battery savers differ by maker; this is what changed from the [report decision](report-a-problem.md). Never
messages, tool data, file names or paths, app names, IDs, network details, or another app's data (no logcat).

**How that's enforced.** Every event part is checked against a fixed shape when it's written, so free text can't get in;
the scrubber is the second layer, because a scrubber only removes what it recognises. Tests plant a key and chat text
everywhere the log reads from and fail if they come out.

**Where it goes.** Kept on the phone for 7 days at most, in two small files on each side, on by default (a log has to exist
before something goes wrong), with a switch and a delete button in Settings → About. It leaves only inside a report: the
report sheet's switch stays off by default and shows the exact text first. Through the relay it's **private**: not in the
public issue, kept 30 days, readable only with the owner's key, and not tied to who sent it. A failed relay doesn't quietly
make it public. In a build without a relay the sheet says first that it will be public.

**So:** don't log free text "just this once", add a field to the Phone section, send it automatically, turn the report's
switch on by default, or put the log back in the public issue without asking. A new event goes through `logEvent`, `DiagLog`
or `diag.py`, whose checks stay. Spec 3.21.
