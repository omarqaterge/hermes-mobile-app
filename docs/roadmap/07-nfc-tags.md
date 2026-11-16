# 07: Tags you tap (NFC)

Read [README.md](README.md) first (device triggers).

**Effort:** M. **Areas:** Java, web. **Depends on:** none.

## Goal

The user sticks a cheap NFC tag somewhere (the desk, the car, the front door), and tapping the phone on it starts a
saved request: "what's on today and how's the traffic", "log that I took my medicine", "start my focus routine". It
is the safe form of an automation hook: it works only with the unlocked phone in the user's hand, and a tag carries
no instructions.

## What exists today

- App shortcuts (`res/xml/shortcuts.xml`) and notifications open a chat with a draft; `IntentGate` strips the
  `session` and `draft` extras from any intent that doesn't carry the app's secret.
- No NFC code or permission.
- The research note on automation hooks (`docs/research/phone-agent-landscape.md`, gap 3) rejects an open intent API
  because any app could start the agent.

## Owner decisions needed

1. **Send on tap, or fill the composer?** Recommended: a tag fills the composer of a new chat and the user taps Send
   (what Share does). A per-tag switch "Send right away" exists, off by default, and turning it on asks for the
   fingerprint. With it on the chat still starts with approvals on (access Off): a tag never raises access.
2. **How many tags.** Recommended: 20.

## Design

### What is on the tag

One NDEF message with two records:

1. A MIME record of type `application/vnd.hermux.tag` whose payload is a random 16-byte id (32 hex characters).
2. An Android Application Record naming the app's package, so the phone goes straight to Hermux with no chooser.

**No request text is on the tag.** The text lives in the app, keyed by the id. Someone who copies or rewrites a tag
can at most start a request the user already saved; a tag with an unknown id does nothing but show a toast.

### Reading a tag

- Manifest: `android.permission.NFC` (normal), `<uses-feature android:name="android.hardware.nfc"
  android:required="false" />`, and a new activity `TagActivity` (exported, no window content, `noHistory`) with an
  `NDEF_DISCOVERED` filter for the MIME type.
- Android only dispatches tags while the screen is on and the phone unlocked. `TagActivity` checks the keyguard
  again itself and does nothing when locked.
- It reads the id, looks it up in `Tags` (below), and starts `MainActivity` with an intent marked by `IntentGate`:
  extras `tag` (the id) and nothing else. Unknown id: toast "This tag isn't set up on this phone", finish.
- `MainActivity` hands the page `window.hermesTag(title, text, sendNow)`. The page starts a new chat (default
  profile unless the tag names one), sets the text, and sends only if `sendNow`. A "send right away" tag is ignored
  when the same tag fired less than 10 seconds ago (a phone left lying on a tag re-reads it).

### Storing tags (native)

A plain-Java class `Tags` in the app's `SharedPreferences`: `[{ id, title (40), text (2,000), profile, sendNow,
made, lastUsed }]`. Kept on the app's side for the reason in the README: the agent can't add or rewrite a tag's
request.

Bridge: `tagsList(key)`, `tagSave(key, json)` (changing `sendNow` to true makes the app ask for the fingerprint
through `ApprovalLock` before saving), `tagDelete(key, id)`, `tagWriteStart(key, id)`, `tagWriteStop(key)`,
`nfcState(key)` (`none`, `off`, `on`).

### Writing a tag

- The settings page opens a sheet "Hold a tag to the back of the phone". `tagWriteStart` turns on reader mode in
  `MainActivity` (`NfcAdapter.enableReaderMode` with the NDEF flags); on a tag it writes the message with `Ndef`, or
  formats first with `NdefFormatable`; then calls `window.__hmTagWritten(id, ok, why)`.
- Failures in plain words: "This tag is read-only", "This tag is too small" (the message needs about 90 bytes),
  "Lost the tag: hold it still".
- Reader mode is on only while the sheet is open and the app is in front; `onPause` and closing the sheet turn it
  off. That is the bound.

### Screen

Settings → a new page **Tags** (`web/src/components/Tags.tsx`), shown only when `nfcState` is not `none`:

- "NFC is off" notice with **Open settings** when `off` (`Settings.ACTION_NFC_SETTINGS`).
- Rows: title, the first line of the request, "used 3 days ago". Tap to edit.
- ＋ New tag: Title, "What should Hermux do?" (text area), Profile (`PickerSheet`), "Send right away" (`Toggle`, with
  the note "Without this, tapping the tag fills the message and you press Send"), then **Write to a tag**.
- Edit sheet: the same fields, **Write to another tag** (same id: several stickers for one request), **Delete**.

## Build steps

1. `Tags.java` (store, limits, the 10-second repeat rule as pure logic), `tools/test_tags.sh`.
2. `TagActivity`, manifest entries, `MainActivity` (the `tag` extra through `IntentGate.strip`'s list, reader mode,
   the bridge methods), `secure-bridge.ts`.
3. `web/src/tags.ts`, `Tags.tsx`, the Settings row, `window.hermesTag` next to `hermesShared` in `share.ts`.
4. E2E in a new `34-tags.cjs` with a fake bridge; calling `window.hermesTag` directly.

Shared files touched: `AndroidManifest.xml`, `MainActivity.java`, `Settings.tsx`, `styles.css`.

## Tests

- Java: unknown id; the limit of 20; repeat within 10 s; an intent with a `tag` extra but no gate secret is stripped
  (extend `tools/test_share_uri.sh`'s neighbour for `IntentGate`, or add `test_intent_gate.sh`).
- E2E: the page hidden when `nfcState` is `none`; create, edit, delete; `hermesTag` with and without `sendNow`.
- Phone: write and read with two common tag types (small and larger memory); a tap while locked does nothing; a tap
  with Hermux closed cold-starts it into the new chat; a phone without NFC shows no Tags row.

## Spec and changes

Spec 4.1 (`Tags`, `TagActivity`), 4.2 (permission, feature, component), 4.5 (bridge and the call from Java), 3.15
(the page), 2.3 (why a tag holds only an id; why the store is native), 3.1. `docs/android-versions.md` (NFC needed;
all supported Android versions). `changes/` file, `rank: big`.

## Check first

- That an Application Record alone starts `TagActivity` when the MIME filter matches (it should prefer the
  matching activity of that package).
- Reader mode and tag dispatch behaviour on Android 8 and on the newest Android, on a phone whose NFC antenna is
  near the camera.
- That `ApprovalLock` can be asked from a settings action (it is used for the phone-data switches the same way).

## Out of scope

QR codes as triggers, tags that carry a different request per time of day, reading other people's tags as content
for the agent.
