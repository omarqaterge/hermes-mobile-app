# Security policy

Hermux gives an AI agent a Linux shell, your apps and, if you allow it, your messages. Security reports are welcome and
taken seriously. The maintainer is one person, so replies are best effort and there are no fixed response times.

## Which versions

The [latest release](https://github.com/omarqaterge/hermes-mobile-app/releases/latest) and the `main` branch. Older
releases are not patched: update to the newest one.

## Checking a download

Every Hermux release is signed with the same key. Its certificate's SHA-256 fingerprint:

```text
2D:51:19:F7:DE:4B:4D:B3:F4:C1:78:0F:27:E7:6B:CD:72:EB:54:DB:B7:9B:54:9D:CE:3E:11:58:F7:13:3E:8D
```

Check it with `apksigner verify --print-certs hermux.apk` (Android SDK) or `keytool -printcert -jarfile hermux.apk` (any
JDK). Releases after v0.9.8 also carry `hermux.apk.sha256` and a build provenance attestation:
`gh attestation verify hermux.apk -R omarqaterge/hermes-mobile-app` proves the release workflow built it from the
release's tag. An APK with another fingerprint is not from this project; please report where you found it.

## How to report a vulnerability

**Please don't post exploit details, keys or anyone's personal data in a public issue.**

1. If this repository's **Security** tab shows **Report a vulnerability**, use it. That report is private.
2. If it doesn't, open an [issue](https://github.com/omarqaterge/hermes-mobile-app/issues) titled "Security report" that
   says only that you have a report and nothing else (no steps, no details). The maintainer will answer there and move
   the conversation somewhere private.

Please include, once it is private: what you found, the steps to reproduce it, the Hermux version (Settings → About),
your Android version, and what an attacker gains. A short proof of concept helps. If you want credit in the fix's
notes, say so.

## What counts

Hermux's promises are written down in [Privacy and security](docs/security.md),
[docs/privacy.md](docs/privacy.md) and the [security model](docs/spec/02-03-security-model.md). A way around one of them
is a vulnerability. Examples:

- content Hermux shows (a chat reply, a card, a canvas page) calling into the app, or reading its keys, chats or files;
- another app on the phone driving Hermes, reading its token, or sending events to the app;
- phone data (contacts, calendar, call log, messages, location, photos) read without the switch being on, without the
  user's approval of that read, or from a locked phone;
- a change of a chat's access level (Off, Auto, Full) that the user did not make;
- personal data or secrets reaching Hermux's own logs, the diagnostic log or a problem report (Hermes's own files hold chat
  text and are outside this);
- an update or plugin bundle being installed without passing the checks described in the security model.

## What is known and documented

The limits listed under [What Hermux cannot protect you from](docs/security.md#what-hermux-cannot-protect-you-from) are known,
so reporting them as such is not necessary. In short: the model provider sees what you send it; the agent runs as the
Termux user, so it can read its own keys and edit Hermes's and the plugin's files and settings (including its approval
mode), and it can do what Shizuku's shell can do; in Full access nothing asks; text the agent reads can try to steer it;
and some plugin checks are speed bumps. If you find that one of those is worse than documented, or that a protection documented as
holding doesn't, that is worth a report.

## Not in scope

- Problems that need an attacker who already has your unlocked phone, or root.
- Vulnerabilities in Hermes, Termux, Shizuku or Android themselves: please report those to their projects. If Hermux
  makes one of them worse, tell us as well.
- Reports with no demonstrated effect on Hermux's own protections.

Thank you for helping keep Hermux's users safe.
