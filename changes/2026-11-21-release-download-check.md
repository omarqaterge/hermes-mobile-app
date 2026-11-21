---
rank: small
---
- **You can check that a Hermux download is the real one.** The README and SECURITY.md now show the fingerprint of the
  key every release is signed with, and how to compare it. Each release also comes with a checksum file and a proof
  from GitHub that it was built from this repository's code (`gh attestation verify`). Updates inside the app were
  already protected by Android, which installs an update only when it is signed with the same key. The new release
  steps were tried with a stand-in for GitHub's tool; their first real run is this release.
