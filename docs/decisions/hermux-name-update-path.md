# The HERMUX name reaches people as an in-app update, from the repository's current name

**Decided:** 2026-11-02, by the owner.

Everyone who already has the app must be able to update inside the app, and that update is what changes the app's visible
name to HERMUX. Installed versions look for any `.apk` file in the latest release and accept only addresses under
`/omarqaterge/hermes-mobile-app/releases/download/`. A release published from the repository's current name works for all
of them; one published after a repository rename doesn't.

**So:**
- Publish the HERMUX release from `omarqaterge/hermes-mobile-app`, with the same package ID
  (`com.omarqaterge.hermesmobile`), the same release signing key, a higher version and an `.apk` release file (keep the
  name `hermes-mobile.apk`).
- Renaming the repository isn't part of that release. It's a separate, optional step for much later, only on the owner's
  explicit go-ahead, because anyone still on a version that doesn't accept both names would then have to update by hand.
  The runbook is [docs/status/repo-rename.md](../status/repo-rename.md).
- Keep the code that accepts both repository names (`UpdateUrl`, `phone/uninstall.sh`), so the later rename stays possible.
