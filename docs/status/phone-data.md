# Phone data tools

**State (2026-11-04):** the contract below and placeholders that refuse everything are in. Six streams build on it side by
side: redaction, two groups of readers, the plugin tool, the Settings switches, and the approval gate. Nothing is live
until `PhoneData.READY` is set to true in the feature's final pull request, so their pull requests can merge in any order.
The rules are in the decision [phone-data-read-only](../decisions/phone-data-read-only.md). Only the coordinating session edits this file.

**Next:** finish the six streams; then a full test run, an attack review and a real-phone test; then docs and the
final pull request.

**Needs a real phone:** the biometric then permission flow, a read refused on a locked phone, permission revoked in Android
settings, Full access on and off, real data from each kind, and location when the app isn't on screen (Android 10+ may
give an old fix or none).

**Links:** [decision](../decisions/phone-data-read-only.md), [spec 4.1](../spec/04-01-every-java-class.md).

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
only Allow once and Deny. Anything that doesn't parse gets no grant.

### `POST /phonedata` on `127.0.0.1:9121`

Header `X-Hermes-Mobile-Key`, body at most 4 KiB, always a JSON answer.

- `{"op":"status"}` → `{"ok":true,"ready":bool,"master":bool,"kinds":{"contacts":bool,...}}`. Booleans only. A kind is true
  only with `READY`, the master, its switch and its Android permission.
- `{"op":"read","session":"<chat id>","nonce":"<12 hex>","kind":"<kind>","args":"<the canonical args text>"}` →
  `{"ok":true,"kind":"<kind>","items":[...],"truncated":bool}` or `{"ok":false,"reason":"<token>"}`.

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
