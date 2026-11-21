# Releases

**State:** v0.9.8 (2026-11-14) is the latest published release, the second one called Hermux, carrying only
`hermux.apk`. The repo rename waits for a look at the download count ([repo-rename.md](repo-rename.md)).

**Next:** a release when the owner decides. Only the owner creates `v*` tags (they publish the app); agents propose.
A tag only publishes when its commit is on `main` and CI passed on it (`tools/release-gate.sh`, since 2026-11-15): tag the
merge commit, and if CI failed there, re-run its failed jobs and then the Release workflow.
**Proof of the real APK** (decision 2026-11-17, done 2026-11-21): the signing certificate's fingerprint is in the
README and `SECURITY.md`; from the release after v0.9.8 on, `release.yml` attests the APK and uploads
`hermux.apk.sha256`, with the hash in the notes (spec 7.5). The first release with them is their first real run: check
that the release has both files and that `gh attestation verify hermux.apk -R omarqaterge/hermes-mobile-app` passes.
**Still open (owner):** the `KEYSTORE_PASS` secret is not set, so releases are signed with the old default keystore
password (the run warns); see [security-followups.md](security-followups.md).
How a release is made: `docs/spec/07-05-versioning-and-releases.md` and `python3 tools/changelog.py release`.

**Needs a real phone:** everything marked `web ✓` (not yet tried on a phone) in [docs/improvements.md](../improvements.md).

**Links:** [CHANGELOG.md](../../CHANGELOG.md), [changes/](../../changes/README.md), `.github/workflows/release.yml`.
