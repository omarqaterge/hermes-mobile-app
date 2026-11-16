# 14: Push for a Hermes that runs elsewhere

Read [README.md](README.md) first. **This design depends on the connections work, which is not designed yet.** It
settles one question that work needs answered early: how does the phone hear that a Hermes on a server needs the
user, while the app is closed, without a Hermux server and without a loop that never ends?

**Effort:** L. **Areas:** Java, plugin (the portable half), web. **Depends on:** connections.

## Goal

A turn on the user's server asks for an approval at 3 pm; the phone is in a pocket with Hermux closed. Within
seconds the phone shows the same approval notification it shows for the on-phone agent today.

## What exists today

- On the phone, the plugin tells the app about approvals, questions and finished turns over a local connection
  (`_post` to the listener on 9121). That path does not exist for a server.
- At the pinned build Hermes has **outbound webhooks** (`agent/outbound_webhooks.py`): entries under `hooks.outbound`
  in the config, each with `url`, `events`, an optional `secret` (HMAC-SHA256 in `X-Hermes-Signature-256`) and a
  timeout. Events available: `pre_approval_request`, `post_approval_response`, `on_session_start`, `on_session_end`,
  `pre_tool_call`, `post_tool_call`, `pre_llm_call`, `post_llm_call`, `subagent_start`, `subagent_stop`. Delivery is
  fire-and-forget with two attempts; it never blocks the agent.
- The project's rules: no Hermux-run server, no unbounded loop or wake lock, data stays under the user's control.

## The options, and the one this design picks

| Route | Works with app closed | Needs | Verdict |
|---|---|---|---|
| Keep a socket open from the phone to the server | only with a permanent connection and wake-ups | nothing extra | **No.** It is the unbounded loop the battery rule forbids, and Android cuts it in doze anyway. |
| The phone maker's cloud messaging | yes | a Hermux-run sender service and a cloud project | **No.** It is a Hermux server. |
| **An open push standard with a distributor app the user picks** | yes | the user installs a distributor app (it keeps the one connection for all apps that use it) and points it at a push server: a public one or their own | **Yes.** No Hermux server; the user chooses who carries the ping. |
| Polling on a timer | late and costly | nothing | **No.** |

The open standard here means the UnifiedPush scheme: a distributor app hands Hermux an **endpoint address**; anything
that POSTs to that address makes the distributor wake Hermux with the posted bytes.

## Owner decisions needed

1. **Accept a helper app for remote push?** Without one, a remote Hermes can't reach a closed app. Recommended: yes,
   optional, offered in the connection's setup: "To hear from this Hermes while Hermux is closed, install a push
   app." Without it Hermux says plainly: "You'll see what happened when you open Hermux."
2. **What may travel in a ping.** Recommended: **nothing readable.** A ping carries only an opaque connection id and
   a counter, and it is signed. The command to approve, the chat's title and the reply text are fetched by the phone
   from the server over the paired connection. A third-party push server then learns only "something happened, at
   this time".
3. **Servers without the Hermux plugin.** Hermes's own outbound webhooks could post straight to the endpoint, but
   their bodies contain tool inputs and chat ids in clear. Recommended: not offered in the app. The docs describe it
   as a do-it-yourself route for someone whose push server is their own.

## Design

### Server side (the plugin's portable half)

- A new module `push.py`. State per paired phone: `{ phone_id, endpoint, key, counter }` in
  `~/.hermes/mobile/push.json`. The endpoint and a fresh 32-byte key are registered by the phone over the paired
  connection (`PUT /push` under the plugin's routes); the key never travels through the push server.
- It hooks the same places that feed today's events: an approval or question appears, a turn ends, a scheduled job
  ends, an error ends a turn. For each it sends one **ping**: `POST <endpoint>` with body
  `v1.<phone_id>.<counter>.<mac>`, where `mac` is HMAC-SHA256 over `v1.<phone_id>.<counter>` under the key, base64url,
  cut to 16 bytes. About 60 bytes. The counter only grows.
- Sending is fire-and-forget on one worker thread with a bounded queue (64), a 10-second timeout and two attempts,
  the same shape Hermes uses for its webhooks. Pings for the same phone within 2 seconds are merged into one. A send
  never delays the agent.
- The endpoint must be `https`. Private and loopback addresses are refused unless the user's config allows them (a
  self-hosted push server on the home network).

### Phone side

- Registration with the distributor uses its broadcast intents directly (no library: the app has no dependencies):
  Hermux sends the register broadcast with a per-connection token and receives the endpoint in a manifest receiver
  `PushReceiver`. A new plain-Java class `Push` holds, per connection, the endpoint, the key and the highest counter
  seen, in the app's own preferences.
- On a message broadcast, `PushReceiver`: checks the format, the `mac` and that the counter is higher than the last
  (anything else is dropped silently and counted in the diagnostic log as `push dropped why=<reason>`), then starts
  `HermesService` with "fetch connection N".
- **The fetch is bounded:** one authenticated request to that connection's "what is pending" route (part of the
  connections design: pending approvals and questions, turns finished since a given time), at most 20 seconds, under
  the service's working wake lock for that long. Its answer drives exactly the notification code paths the local
  events drive today (`approval`, `ask`, `reply`, `error`, `cron`), with the connection's name in the title. No
  socket is left open.
- At most one fetch per connection every 5 seconds; pings that arrive meanwhile set a flag for one more fetch after.
- Answering from the notification (Allow, Deny, a reply) sends one request to that connection, with the fingerprint
  and locked-phone rules unchanged.

### Settings (in the connection's page, once connections exist)

- **Hear from this Hermes while Hermux is closed:** a `Toggle`. Turning it on: no distributor installed → a sheet
  explaining what a push app is and that the user picks which one and which server; one installed → register, send
  the endpoint and key to the server, and run **Send a test** (the server pings, the phone shows "Push works").
- A line of state: "Working: last heard 2 min ago" / "The push app is not running" / "Off".
- A note: "The push server sees only that something happened and when. It never sees your chats."

## Build steps

1. Connections first (pairing, the authenticated per-connection client, the "pending" route).
2. `push.py` with `tools/test_push.py` (format, mac, merge window, refusal of plain `http` and private addresses,
   the queue bound).
3. `Push.java` (pure verification and counter logic) with `tools/test_push.sh`; `PushReceiver`, manifest entries,
   the bounded fetch in `HermesService`.
4. The toggle, the explanation sheet and the test button.
5. Shared test vectors for the ping format in `tools/push-vectors.json`, checked by both tests, as the local
   authentication vectors are.

Shared files touched: `AndroidManifest.xml`, `HermesService.java`, the plugin's `__init__.py`, `Settings.tsx`.

## Tests

- Both sides against the vectors: a good ping, a replayed counter, a wrong mac, a ping for another phone id, an
  oversized body.
- Java: the 5-second rule, the 20-second cap, a fetch that fails (no notification, one retry on the next ping).
- Phone: a real distributor with a public push server and with a self-hosted one; a ping in deep doze; the battery
  cost of 50 pings a day; the distributor uninstalled while registered (state line changes, no crash).

## Spec and changes

Spec 2.1 (a new outward connection and who starts it), 2.2 (the flow), 2.3 (the ping format, what a push server
can and can't learn, replay protection), 2.5 (the bounded fetch), 4.1, 4.2, 4.3, 5.x for the portable half,
`docs/privacy.md`, `docs/security.md`, the README's "No server" wording. Decision files for the three decisions.

## Check first

- The distributor's intent contract as it is today (action names, the token extra, how the endpoint and messages
  arrive, the size limit of a message), and whether registering needs anything a library normally does.
- That a manifest receiver may start a foreground service from a push broadcast on Android 12 and later (the
  distributor grants a short background-start allowance in the common case; confirm).
- How reliably two popular distributors deliver in doze on phones with aggressive background limits.

## Out of scope

Encrypted readable content in pings, push for the on-phone agent (the local path works), a Hermux-run push server.
