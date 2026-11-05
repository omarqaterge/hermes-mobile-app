# Phone data tools

**State (2026-11-05):** launched. `PhoneData.READY` is true, so the Settings section "Phone data for the agent" shows and
the agent can read contacts, calendar, call log, messages (SMS), approximate location and latest-photo details when the
user switches them on (everything starts off). The rules are in the decision
[phone-data-read-only](../decisions/phone-data-read-only.md); the privacy side is in [privacy](../privacy.md). The
protections for chats that have read phone data (remote images, links, HTML previews, web requests, commands that can send
data out) and the record of those chats are in too. Tested on one real phone with Android 16 on 2026-11-05 with the owner
present; the list is in [manual-tests](../manual-tests.md) under "Phone data for the agent".

**Next:** the checks that are still to do on a phone (the same list is in [manual-tests](../manual-tests.md)):

- a read attempted while the phone is locked;
- "Tap to load" and the link address dialog in a protected chat;
- a protected chat that Hermes compresses;
- the Report a problem text after reads;
- the overflow, "Allow more chats" and "Forget" rows in Settings;
- a phone with no screen lock;
- any Android older than 16 (the minimum is 8.0): above all the SMS and call-log permission dialog on a sideloaded
  install, and the Android 13 and 14 photo permissions;
- the case where the model obeys hostile text, so that the native filter is exercised in a real WebView.

**Needs a real phone:** all of the above. Anyone may edit this file; change the contract below only after telling the
other agents working on this feature, because the app and the plugin both build against it.

**Links:** [decision](../decisions/phone-data-read-only.md), [privacy](../privacy.md),
[manual tests](../manual-tests.md), [spec 4.1](../spec/04-01-every-java-class.md).

## The contract

Change this only by first telling the other streams: all of them build against it.

**Kinds:** `contacts`, `calendar`, `calls`, `sms`, `location`, `photos`.

### Arguments (`args`), checked by the plugin and again by the app

| Kind | Args |
|---|---|
| `contacts` | `limit`, `query` (name search) |
| `calendar` | `limit`, `from_ms`, `to_ms` (default now to 7 days ahead; at most 90 days) |
| `calls` | `limit`, `from_ms`, `to_ms` (default the last 7 days; at most 90 days) |
| `sms` | `limit`, `box` (`inbox`, `sent` or `all`; default `all`), `sender` |
| `location` | none |
| `photos` | `limit` |

`limit` is 1 to 50, default 20. `query` and `sender` are at most 64 characters. Unknown keys are refused.

### Rows (`items`)

| Kind | Fields |
|---|---|
| `contacts` | `name`, `numbers` (list), `emails` (list) |
| `calendar` | `title`, `start_ms`, `end_ms`, `all_day`, `place`, `description` (at most 200 characters) |
| `calls` | `number`, `name`, `type` (`incoming`, `outgoing`, `missed`, `rejected`, `blocked` or `other`), `time_ms`, `duration_s` |
| `sms` | `address`, `box` (`inbox` or `sent`), `time_ms`, `body` (at most 300 characters) |
| `location` | one row: `lat`, `lon`, `accuracy_m`, `time_ms`; no rows when there is no fix. Coarse provider only |
| `photos` | `time_ms`, `size_bytes`, `width`, `height`. No file name, path, EXIF, GPS or image |

Other text fields are at most 200 characters (`Caps.MAX_FIELD`). Limits are in `Caps`; a whole result is at most 16 KB, and
`truncated` is true when anything was cut. Rows are newest first, except `calendar`, which is soonest first.

### Approval text

The plugin makes a nonce (12 lowercase hex characters) and the canonical args text:
`json.dumps(args, sort_keys=True, separators=(",", ":"), ensure_ascii=True)`. It then calls:

```
request_tool_approval("phone_data", "phone_data:v1:<kind>:<nonce>:<hex of the args text's UTF-8>", rule_key="phone_data:<nonce>")
```

The args are hex because Hermes masks phone numbers and key-like text in approval descriptions, and a changed text would no
longer match the read. The page sees this text as `req.params.description`, and the service as the `approval` event's
`what`. `body` is cut to 500 characters, so don't use it. The app parses the text and writes its own wording, and offers
only Allow once and Deny. Anything that doesn't parse gets no grant. The nonce's last character is always a letter a-f: Hermes redacts `<8+ digits>:<30+ word characters>` as a bot token, and a nonce ending in digits next to the args hex matched about 2.3% of the time (the app and the plugin still accept any 12 lowercase hex).

### `POST /phonedata` on `127.0.0.1:9121`

Header `X-Hermes-Mobile-Key`, body at most 4 KiB, always a JSON answer.

- `{"op":"status"}` → `{"ok":true,"ready":bool,"master":bool,"kinds":{"contacts":bool,...},"locked":bool}`. Booleans only. `locked` comes from the same keyguard check the read uses; when it is true the plugin says the phone is locked and to try after unlocking, and does not ask. A kind is true
  only with `READY`, the master, its switch and its Android permission.
- `{"op":"read","session":"<chat id>","nonce":"<12 hex>","kind":"<kind>","args":"<the canonical args text>","chats":["<chat id>",...]}` →
  `{"ok":true,"kind":"<kind>","items":[...],"truncated":bool}` or `{"ok":false,"reason":"<token>"}`.
- `{"op":"taint","chats":["<chat id>",...]}` → `{"ok":true}` or `{"ok":false,"reason":"bad_request"}`. Added in round 4. The plugin sends it when a
  chat it already marks as having read turns up under an id it has not seen (Hermes gives a chat a new stored id when it compresses the
  context, and no hook announces that). `chats` has the limits of a read's: up to 16 strings of at most 128 characters (a body with no valid
  id, or no list, is `bad_request`; entries past the sixteenth are ignored). The app records those ids in `PhoneDataChats` exactly like a read
  does and changes nothing else: no grant is made or needed, it works whatever `READY`, the switches and the permissions say, and it can only
  ADD ids (the key is checked first, as for every op). An older app answers 404/204 and the plugin keeps the ids to send with its next report.

`chats` is optional: up to 16 strings of at most 128 characters, the chat id, its ancestors and its compression chain (the plugin sends them; raised from 8 in round 3, so a request adds at most 17 new ids). The app records `session` and every valid `chats` entry as chats that have read, **whatever the outcome** (refused, off, locked, no grant, bad request, failed), in app-private preferences, ids only (no times): **an id is never evicted**. The record starts with a cap of 2000 ids; the first id past the cap sets an overflow flag that makes every chat count as having read, and ids that still arrive are kept (up to 20000, so a real chat that reads while the record is full is not lost). The user clears the flag in Settings → Phone data, behind the screen lock, with "Allow more chats" (the cap grows by 2000, to 20000 at most, nothing is forgotten, and the overflow flag clears once the record fits under the new cap; the separate `lost` flag set when an id had no room even at 20000 never clears this way) or "Forget" (forgets every id; its confirmation says chats that read phone data lose their protection). An invalid entry is ignored, never an error. The page asks the bridge method `phoneDataTainted(id)` before it draws a chat.

Checks, in order: key, `not_ready`, `bad_request`, `off`, `no_permission`, `locked`, then the grant or Full access pass
(`no_grant`). Failures while reading answer `failed`, with no details. A plugin tool that gets no answer, a 404 or an older
app says the feature isn't available.

`session` is the gateway's live session id: `HERMES_UI_SESSION_ID`, which Hermes sets per turn to the gateway `sid` (`prompt_turn.py`), the page's `runtimeId`. The plugin reads it from the context variable and falls back to the tool handler's `session_id` (which a context compression rotates, so it never matches the page's id: Full access then fails closed to `no_grant`). Changed from the tool handler's `session_id` after a security review: compression rotated that id.

### Bridge methods (key first, in `web/src/secure-bridge.ts`)

| Method | What it does |
|---|---|
| `phoneDataState()` | JSON text: `status` plus `perms` (kind → Android permission held) and `secure` (the phone has a screen lock) |
| `phoneDataSet(id, kind, on)` | `kind` is a kind or `master`. Turning on runs `ApprovalLock.askAlways`, then the Android permission dialog. Answers `window.hermesPhoneData(id, result)`, where `result` is `ok`, `cancel`, `nolock`, `denied` or `blocked` (Android won't ask again). Turning off is immediate |
| `phoneDataOpenSettings()` | Opens Android's settings page for this app |
| `phoneDataGrant(description)` | The user tapped Allow on this approval text: `PhoneDataGrants.issue` |
| `phoneDataTainted(id)` | Boolean, synchronous: did a read request for this chat id (or one sent in `chats`) ever reach the app? The page calls it before rendering a chat's items, the cached preview included, and joins it with the item-derived state for `remoteBlock` |
| `phoneDataAnyRead()` | Boolean: has the record anything in it, or has it overflowed? For a saved document whose chat is unknown |
| `phoneDataOverflowed()` | Boolean: did a flood fill the record (past its cap)? Settings shows "Allow more chats" and "Forget" while true |
| `phoneDataLost()` | Boolean: was an id dropped because even 20000 was full? Every chat counts as having read until Forget |
| `phoneDataAllowMore(id)` | Raises the record's cap by 2000 (at most 20000) and clears the overflow flag once the record fits (never the lost flag), forgetting nothing, after the screen lock; answers `window.hermesPhoneData(id, result)`, `full` when the cap is already 20000 |
| `phoneDataForget(id)` | Forgets every id and clears the flag after the screen lock (chats that read lose their protection; the page asks to confirm first); answers `window.hermesPhoneData(id, result)` |
| `phoneDataFullAccess(session, on)` | The user moved this chat (its live session id, `runtimeId`) in or out of Full access: `PhoneDataGrants.fullAccess` |

### Who owns what

| Stream | Files |
|---|---|
| A Redaction | `web/src/report.ts`, `report.test.ts`, `tools/test_diag.py`, `tools/web-e2e/checks/28-report.cjs` |
| B Readers 1 | `phonedata/Contacts`, `CallLog`, `Calendar`, `Sms`, `Caps` |
| C Readers 2 | `phonedata/Location`, `Photos`, README "Android versions" table |
| D Plugin | `hermes-plugin/hermes-mobile/phone_data.py`, `__init__.py`, `tools/test_phone_data.py`, the plugin job in `.github/workflows/ci.yml` |
| E Switches | `PhoneData.java`, `android/AndroidManifest.xml`, `MainActivity.java`, `secure-bridge.ts`, `bridge.ts`, `Settings.tsx`, `settings-search.ts`, `tools/web-e2e/mock.cjs`, `tools/web-e2e/checks/29-phone-data.cjs` |
| F Gate | `PhoneDataGrants.java`, `HermesService.java`, `web/src/gateway.ts`, `RequestSheet.tsx`, `notif-answer.ts`, `tools/web-e2e/checks/05-questions-and-approvals.cjs`, `25-approval-lock.cjs` |
