# Security follow-ups (2026-11-16)

What was still open after the security review whose first fixes merged in the `security-fixes` PR (tap-to-load web
media in replies, a page CSP, share and intent checks, the installer checksum).

**State (2026-11-16):** done in one PR, one commit per item:

1. Pictures in OpenUI cards wait for a tap in every chat ("Load images"), held after the card's expressions ran
   (`web/src/openui-hold.ts`). Decision: [card-pictures-wait-for-a-tap](../decisions/card-pictures-wait-for-a-tap.md).
2. The Pairing notification's Enter code field needs an unlocked phone (`HermesService.unlockFirst`, plus a lock
   check for Android 11); `tools/test_notification_unlock.sh` checks every notification text field.
3. The signing password comes from `KEYSTORE_PASS` (a CI secret) instead of the build script; local builds keep the
   old default.
4. Cards read no files: `read_file` and `search_files` left the card tools. Decision:
   [cards-read-no-files](../decisions/cards-read-no-files.md).
5. Found on the way: a card's `web_search` went out with no ask in a chat that had read phone data (its call carries no
   chat, and the shell's filter lets localhost through). The page now refuses it there (`guardedCall`).

Checked: no page CSP `img-src` backstop. An Online canvas page is an `srcdoc` frame that inherits the page's policy and
may load web images, so the card hold and the shell's filter (in chats that have read phone data) are what hold.

**Next (owner):**

- Re-protect the release keystore and set the `KEYSTORE_PASS` repository secret (steps in spec 7.5). Until then
  releases are signed with the old public password and the release run shows a warning.
- Not done, informational (kept by decision or not asked): sshd listens on all interfaces
  ([ssh-on-all-interfaces](../decisions/ssh-on-all-interfaces.md)); the banking-app guard in `phone_app.py` matches
  names only.

**Needs a real phone:**

- The Enter code field asking for the unlock on the lock screen (Android 12+), and "Unlock the phone first" on Android 11.
- "Load images" under a card in the WebView.
- The first release built with `apksigner --ks-pass env:` (no Android SDK where this was written; CI's release job is
  its first run).

**Links:** spec 2.3, 3.9, 4.3, 7.1, 7.5; `docs/decisions/phone-data-read-only.md` (update 2026-11-16).

## Share and install checks (2026-11-17)

**State:** done on the local branch `local/install-share-checks`, not pushed (kept back until the owner says so).
Shares need the sender's own access (spec 2.3, `ShareUri.needsGrant`, the manifest's
`requireContentUriPermissionFromCaller`), install, update and uninstall results carry their run's nonce
(`LocalAuth.Awaited`), and the main frame loads only the app's own page (`MainActivity.ownPage`).

**Needs a real phone:** sharing a photo, a PDF and a contact card into Hermux on Android 15+ and on one older
version (with and without the phone-data switches on); an app update and a helper-app install end to end, on
Android 12 or older if one is at hand; Settings → Uninstall Hermux.
