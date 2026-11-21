# Every release proves its APK is the real one

**Decided:** 2026-11-17. **Done:** 2026-11-21, for every release after v0.9.8 (items 1 to 3; the optional installer check is not done).

A release today carries only `hermux.apk`. Updates are protected by Android itself (an update must be signed with the
same key), but someone installing for the first time has nothing to check the file against. A bare checksum next to the
APK is not enough on its own: whoever can replace the APK on the release can replace the checksum too.

**So:** whoever prepares the next release first adds, in this order of value:

1. the release certificate's SHA-256 fingerprint, published once in the README and `SECURITY.md` (it never changes);
2. a build provenance attestation for `hermux.apk` in `release.yml` (`gh attestation verify` checks it);
3. `hermux.apk.sha256` uploaded with the APK, and the hash in the release notes.

The steps and details are the "Release checklist: proving a download is the real APK" in
`docs/spec/07-05-versioning-and-releases.md`. Don't drop any of them without asking the owner.
