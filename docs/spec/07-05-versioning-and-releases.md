### 7.5 Versioning and releases

- **Version name** `a.b.c` (for example `0.8.62`) is shown in Settings → About and read by the app with `appVersion`. `web/src/releasenotes.ts` `isNewer` compares dotted numbers part by part (a leading `v` is ignored; non-numbers count as 0).
- **versionCode = a*10000 + b*100 + c**. `0.8.62` gives `862`. The number must stay above every earlier build's code (the rule in this project is that it stays above `821`), because Android refuses to install a lower code over a higher one, and `MainActivity` refuses a downloaded update whose `versionCode` is not higher than the installed one ("You already have this version.").
- **Local builds** pass both values to `android/build.sh` (`VERSION_NAME=… VERSION_CODE=…`) and are signed with the local keystore; a phone can only update from a build signed with the same key.
- **Releases** are made by pushing a tag `v*` (for example `v0.8.62`) to `main`, or on GitHub's website (Releases → Draft a new release, a new `v*` tag on `main`, Publish release). `release.yml` builds and signs the APK and attaches the same file as `hermux.apk` and `hermes-mobile.apk` to the GitHub release. The signing keystore is the repository secret `KEYSTORE_B64` (base64 of the keystore file). `releases/latest` is what the in-app update (Settings → About), `UpdateNotice` and the installers (`phone/install.sh`, `setup-phone.sh`, `setup-phone.ps1`) download: the installers ask for `hermux.apk` and fall back to `hermes-mobile.apk`, while the app takes any `.apk`.
- **Changelog fragments.** A change users notice gets its own file `changes/YYYY-MM-DD-short-name.md` holding its CHANGELOG bullets, each starting with a short bold headline in plain words, and front matter `rank: big|normal|small` saying how much users will notice it (`changes/README.md` says how), not a line at the top of `CHANGELOG.md`: branches worked on in parallel then never conflict over the changelog. Before tagging, the maintainer runs `python3 tools/changelog.py release vX.Y.Z`, which moves the fragments (biggest first: `big`, then `normal`, then `small` ones last under "### Smaller changes and fixes", newest first within each) and anything still under `## Unreleased` into the new release section and deletes the fragments; that commit is the release notes.
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
7. After the release has reached most phones: update the README's privacy and security list.
