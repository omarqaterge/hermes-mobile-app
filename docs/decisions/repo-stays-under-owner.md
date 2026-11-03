# The repository stays under `omarqaterge`; the `hermuxlab` organization is reserved

**Decided:** 2026-11-03, by the owner.

The owner created the empty GitHub organization `hermuxlab` to hold the name for a possible later move. There's no reason
to move now, and each move needs a release that accepts the new address, then a wait, before it can happen without
breaking in-app updates. Accepting the address now costs nothing and keeps the move possible.

**So:**
- The order: release v0.9.6 from `omarqaterge/hermes-mobile-app`, wait about 2 weeks, check the release's download count,
  then rename the repository to `omarqaterge/hermux` ([runbook](../status/repo-rename.md)).
- The repository doesn't move to `hermuxlab` now. `UpdateUrl` and `phone/uninstall.sh` accept `hermuxlab/hermux` only so
  that a later move doesn't break updates; no address the app or scripts fetch points there.
- A move to `hermuxlab` is its own decision for the owner, later, and follows the same runbook.
