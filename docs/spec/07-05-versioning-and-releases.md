### 7.5 Versioning and releases

- **Version name** `a.b.c` (for example `0.8.62`) is shown in Settings → About and read by the app with `appVersion`. `web/src/releasenotes.ts` `isNewer` compares dotted numbers part by part (a leading `v` is ignored; non-numbers count as 0).
- **versionCode = a*1000000 + b*1000 + c** from v0.9.9 on, computed by `tools/version-code.sh` (`0.9.9` gives `9009`, `1.2.3` gives `1002003`). Releases up to v0.9.8 used a*10000 + b*100 + c (`0.9.8` gave `908`), which ran into the next minor version once a part reached 100 (`0.9.100` and `0.10.0` would both be `1000`, and the update between them refused). The script refuses a version whose middle or last part is above 999, a first part above 2099 (Android's codes end at 2100000000), anything that isn't `a.b` or `a.b.c`, and any code not above `908`, so the release fails instead of publishing an app that can't update; `tools/test_version_code.sh` tests it. Android refuses to install a lower code over a higher one; the in-app update decides with `UpdateVersion.refusal` (4.1): a higher code installs, and so does the same code with a newer version name (a test build that took the next release's code); otherwise it shows "You already have this version.", or, for a newer name with a lower code, says the installed copy is probably a test build to uninstall first.
- **Test builds put on a phone** reuse the installed release's own name and code (or lower), never a higher code: a higher one blocks the next real update.
- **Local builds** pass both values to `android/build.sh` (`VERSION_NAME=… VERSION_CODE=…`) and are signed with the local keystore; a phone can only update from a build signed with the same key.
- **Releases** are made by pushing a tag `v*` (for example `v0.8.62`) to `main`, or on GitHub's website (Releases → Draft a new release, a new `v*` tag on `main`, Publish release). `release.yml` first checks that the tagged commit is on `main` and that CI passed on it (`tools/release-gate.sh`, 7.4; a tag on a branch commit, or on a commit whose CI failed, publishes nothing), then builds and signs the APK and attaches the APK as `hermux.apk` to the GitHub release (releases up to v0.9.7 also carried the same file as `hermes-mobile.apk`). The signing keystore is the repository secret `KEYSTORE_B64` (base64 of the keystore file); its password is the secret `KEYSTORE_PASS` (and `KEYSTORE_KEY_PASS` when the key's differs). Until `KEYSTORE_PASS` is set, releases are signed with the old default password, which is written in this public repository, and the run shows a warning. To re-protect the release keystore without changing the key (phones only update from the same key): `keytool -storepasswd -keystore release.keystore` (old password: the default), and for a JKS keystore also `keytool -keypasswd -alias <alias> -keystore release.keystore` (a PKCS12 keystore has one password for both); then store the new base64 in `KEYSTORE_B64` and the password in `KEYSTORE_PASS`. The certificate, and so the signature phones check, stays the same. `releases/latest` is what the in-app update (Settings → About), `UpdateNotice` and the installers (`phone/install.sh`, `setup-phone.sh`, `setup-phone.ps1`) download: the installers ask for `hermux.apk` and fall back to `hermes-mobile.apk` (for releases up to v0.9.7), while the app takes any `.apk`.
- **Changelog fragments.** A change users notice gets its own file `changes/YYYY-MM-DD-short-name.md` holding its CHANGELOG bullets, each starting with a short bold headline in plain words, and front matter `rank: big|normal|small` saying how much users will notice it (`changes/README.md` says how), not a line at the top of `CHANGELOG.md`: branches worked on in parallel then never conflict over the changelog. Before tagging, the maintainer runs `python3 tools/changelog.py release vX.Y.Z`, which moves the fragments (biggest first: `big`, then `normal`, then `small` ones last under "### Smaller changes and fixes", newest first within each) and anything still under `## Unreleased` into the new release section and deletes the fragments; that commit is the release notes. The release workflow copies that section to the top of the GitHub release page ("What's new"); the app's What's new reads it from `CHANGELOG.md` at the tag (3.15).
- **`CHANGELOG.md`** has an `## Unreleased` section on top (entries written before the fragments, until the next release folds them); each release section `## vX.Y.Z (date)` collects what shipped since the previous tag, user-facing wording, with a line saying what was tested on which device. Released versions are not always consecutive tags (some build numbers were never tagged). The app's Settings → About → What's new reads these sections from `CHANGELOG.md` at the new release's tag (3.15), so a release's section must be in the tagged commit.
- The ready-made Debian image has its own release tag, `hermes-image-<pin12>` (7.4), never "latest".

**Release checklist: the first release with local authentication** (2.3; the same list is the `RELEASE-CHECKLIST`
comment next to `LocalKey.ENFORCE`, and `LocalDashboard.P_HELLO` has its own note). Before that release:
1. Set `LocalDashboard.P_HELLO` to the commit time (`git log -1 --format=%ct`) of the merge that brings local
   authentication into `main`. Leaving it at 0 is safe, only stricter.
2. Ship the app and the plugin together (the APK carries the plugin; `PluginSync`), with no release between the first
   merge of local authentication and the switch.
3. The background host: the plugin starts it with `HM_AUTH=mac`, and only an app with local authentication can drive
   it (an older app's live view gets nothing); both halves are in the same release.
4. Check that the new plugin loads on the oldest Hermes the app still supports, not only on the current pin: after the
   switch an app sends a Hermes whose plugin can't update nothing at all. Run `tools/hermes-contract/run.sh` with that
   Hermes commit in `web/vendor/hermes-shared/.hermes-commit` (a throwaway branch), and the plugin update test
   (`tools/test_plugin_update.sh`) as usual.
5. On a real phone: battery with the keeper's hello (`tools/battery`), the viewer's frame rate with a hello per request,
   and the upgrade path in `docs/manual-tests.md`.
6. The owner's open decisions (`docs/decisions/local-authentication.md`): a scheduled key replacement and a "Reset" row
   in Settings, a line in Settings while the window lasts, how often the keeper says hello.
7. After the release has reached most phones: update the privacy and security lists (`docs/security.md`, and the summary in the README).

**Proving a download is the real APK** (done 2026-11-21 for the releases after v0.9.8; decision
`docs/decisions/release-integrity.md`). Updates were already safe (Android installs an update only when it is signed with
the same key); these let a first install be checked too:
1. The release certificate's SHA-256 fingerprint, `2D:51:19:F7:DE:4B:4D:B3:F4:C1:78:0F:27:E7:6B:CD:72:EB:54:DB:B7:9B:54:9D:CE:3E:11:58:F7:13:3E:8D`
   (read from the v0.9.7 and v0.9.8 `hermux.apk`: their v1, v2 and v3 signatures all name it), is published in the README
   (Install, "Check that your download is the real Hermux") and `SECURITY.md` ("Checking a download"), with the commands
   that print it (`apksigner verify --print-certs`, `keytool -printcert -jarfile`). It never changes between releases (same
   key), so it is written once.
2. `release.yml`'s `apk` job attests the APK (`actions/attest-build-provenance`, 7.4), so `gh attestation verify hermux.apk
   -R <owner>/<repo>` proves it was built by that workflow from the tagged commit. Someone who can only edit the release
   can't fake that.
3. `hermux.apk.sha256` (`sha256sum` form, like the Debian image's `.sha256`, 7.4) is uploaded with the APK and the hash is
   in the release notes. It catches a broken download; it does not prove who made the file.
4. Not done (optional in the decision): `phone/install.sh` checking the `.sha256` or the fingerprint before installing.
   The app's update and the installers pick files by name (`hermux.apk`, or a name ending in `.apk`), so the `.sha256`
   file is never taken for the APK.
