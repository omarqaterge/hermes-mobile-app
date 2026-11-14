# The Hermux name reaches people as an in-app update, from the repository's current name

**Decided:** 2026-11-02, by the owner.

Everyone who already has the app must be able to update inside the app, and that update is what changes the app's visible
name to Hermux. Installed versions look for any `.apk` file in the latest release and accept only addresses under
`/omarqaterge/hermes-mobile-app/releases/download/`. A release published from the repository's current name works for all
of them; one published after a repository rename doesn't.

**So:**
- Publish the Hermux release from `omarqaterge/hermes-mobile-app`, with the same package ID
  (`com.omarqaterge.hermesmobile`), the same release signing key, a higher version and an `.apk` release file.
- ~~Keep the file name `hermes-mobile.apk`.~~ Changed 2026-11-03, by the owner: every release carries the same file under
  two names, `hermux.apk` for new downloads and `hermes-mobile.apk` for old scripts and links. ~~Don't remove the old name.~~
  Changed 2026-11-14, by the owner: releases after v0.9.7 carry only `hermux.apk`. Installed versions take any `.apk`, so
  they keep updating; the installers ask for `hermux.apk` first (and still fall back to the old name for older releases).
  What stops working: a script or link saved from before the rename that asks for `releases/latest/download/hermes-mobile.apk`.
- Renaming the repository isn't part of that release. It's a separate step, on the owner's go-ahead, because anyone still
  on a version that doesn't accept the new name would then have to update by hand. The runbook is
  [docs/status/repo-rename.md](../status/repo-rename.md), and the plan for it is in
  [repo-stays-under-owner.md](repo-stays-under-owner.md) (changed 2026-11-03: it was "optional, for much later").
- Keep the code that accepts the repository's names (`UpdateUrl`, `phone/uninstall.sh`), so the later rename stays possible.
