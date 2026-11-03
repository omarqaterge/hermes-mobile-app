# Report a problem: a relay, GitHub as the fallback, and only what the user chose

**Decided:** 2026-11-02, by the owner.

Users should be able to say what went wrong from inside the app, and it should end up as an issue in
`omarqaterge/hermes-mobile-app`. Issues are public and the repository and app are public too, so no token can ship in
either.

**Sending.** A small Cloudflare Worker the owner deploys (`relay/report/`, free plan) holds a fine-grained token that may
only create issues on that repository, as a Worker secret. It labels issues `from-app`, limits how often each install
(a random per-install ID, never a phone identifier) and each address can send, caps the text size, and answers with
the issue's link. The app reads the relay's address from a build-time value that is empty by default, like the stats
key. With no address, a failed relay or a reached limit, the app opens GitHub's new-issue page with the report filled in
and the user submits it there. The owner creates the token and deploys the relay; agents don't.

**What a report may hold besides the user's words.** Always: the app, Android and Hermes versions; no phone model, no
IDs. The recent app log only if the user switches it on, shown to them first with personal details removed (tokens,
keys, emails, IP addresses, URLs with secrets, home paths, chat text); off by default. A screenshot only one the user
picks, with a warning that it will be public; the relay stores it so the issue can show it; on the GitHub fallback the
user attaches it there. Every report says before Submit that it will be public on GitHub.

**So:** don't add fields to a report, turn the log on by default, send anything before Submit, or put a token, a
deployed relay's address or anything else secret in the repository. The row lives in Settings → About near the update
row, which keeps its own behaviour. Spec 3.21.
