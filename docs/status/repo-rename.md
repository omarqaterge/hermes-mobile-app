# Renaming the repository to `omarqaterge/hermux`

Renaming this GitHub repository from `omarqaterge/hermes-mobile-app` to `omarqaterge/hermux` is optional and for much
later, only on the owner's explicit go-ahead ([decision](../decisions/hermux-name-update-path.md)). This file is the
runbook for that day. The package ID (`com.omarqaterge.hermesmobile`), the app's visible name (Hermux), the phone folder
`~/hermes-mobile`, the plugin name `hermes-mobile`, the release file `hermes-mobile.apk` and the `v*` and `hermes-image-*`
tags are separate names, and the rename changes none of them.

**State (2026-11-02):** the repository is not renamed. The app's visible name is now Hermux in the code, which is the separate step the decision describes; it reaches people with the next release, and no address, package ID or file name changed with it. The code also accepts both repository names: `UpdateUrl.ok` (in-app update) and
`phone/uninstall.sh`. Every address the app and scripts fetch stays on the old name, because the new one answers 404
until the rename. No release has shipped this yet.

**Next:** nothing here until the owner gives the go-ahead. The Hermux release doesn't wait for this and doesn't include
it: see the first rule of [The order](#the-order).

**Needs a real phone:**
- Before the rename, on a test build: call `installUpdate` with a `hermux` release address. Expected: "Download failed
  (HTTP 404)", not "That isn't an official Hermux download." Allow it to install unknown apps first, or it asks for
  that instead.
- After the rename, on the kept phone (steps 1 and 6): the check in Settings, the notification, and a real update to the
  next release, the first one with a `hermux` address. A local test build can't do this: its signing key differs, so the
  installer refuses the release.
- So far the redirects were only tested on a desktop JDK and desktop Chromium, not with Android's `HttpURLConnection` or
  WebView.

**Links:** [GitHub: renaming a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository),
`android/src/com/omarqaterge/hermesmobile/UpdateUrl.java`, `tools/test_update_url.sh`, `tools/test_uninstall.sh`,
spec 2.2.10, 4.5, 6.5.

## What happens to anyone still on an old version

**A version from before this change can't update itself inside the app after the rename.** GitHub's API then returns
`https://github.com/omarqaterge/hermux/releases/download/….apk`, and the old check accepts only the old name, so:

- Settings still finds the new version and shows Update. Tapping it shows "That isn't an official Hermes Mobile
  download."
- The notification still appears, once per version. Tapping it opens the app and fails the same way.
- Nothing else breaks: the app, Hermes and their data are untouched. Uninstall still works, except that it may leave
  `~/hermes-mobile` behind (see the table).
- The way out is to install by hand. Download `hermes-mobile.apk` from the Releases page and open it. It has the same
  signature, so it updates in place and keeps everything. The old `github.com/omarqaterge/hermes-mobile-app/releases`
  link redirects there.

No change on GitHub's side can avoid this, because the API only reports the current name. That is why the release that
accepts both names has to go out, and people have to update, before the rename.

## The order

**First rule: the Hermux release comes from the current name, and the repository rename isn't part of it.** The update
that changes the app's visible name to Hermux is published from `omarqaterge/hermes-mobile-app`, with the same package ID,
the same release signing key, a higher version and an `.apk` release file (keep `hermes-mobile.apk`). Installed versions
look for any `.apk` file in the latest release and accept only old-name addresses, so everyone can update inside the app.
Everything below happens later, only on the owner's explicit go-ahead.

1. **Release a version that accepts both names.** Only the maintainer creates `v*` tags. Check the published file:
   ```bash
   gh release download -R omarqaterge/hermes-mobile-app -p hermes-mobile.apk -D /tmp/hm-rel --clobber
   ```
   ```bash
   unzip -p /tmp/hm-rel/hermes-mobile.apk 'classes*.dex' | strings | grep -c 'omarqaterge/hermux/releases/download/'
   ```
   ```bash
   unzip -p /tmp/hm-rel/hermes-mobile.apk assets/phone/uninstall.sh | grep -c 'hermes-mobile-app|hermux'
   ```
   Both counts must be at least 1. Then run the test-build check under "Needs a real phone": no rename until it passes.
   Keep one phone on this release, without updating it, for step 6.
2. **Wait for people to update.** The app has no usage reporting, so nobody can see who is still on an old version. The
   only signal is download counts per release. A suggested rule, not a measured one: at least two weeks, and until the
   new version's downloads have levelled off.
   ```bash
   gh api repos/omarqaterge/hermes-mobile-app/releases --jq '.[] | select(.assets | length > 0) | [.tag_name, (.assets[] | select(.name == "hermes-mobile.apk") | .download_count)] | @tsv'
   ```
3. **Rename, once the owner says so.** Settings → Repository name → exactly `hermux`, all lower case: the check is case-sensitive, and `Hermux`
   would make GitHub return links the app refuses. Pick a moment with no release workflow running. Before you do, the
   name must still be free:
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://github.com/omarqaterge/hermux
   ```
   Expected: 404.
4. **Check it** with [the list below](#checks-after-the-rename), on the day.
5. **Follow-up PR moving addresses to the new name** (never before the rename: until then they answer 404). Everything
   marked "move" in the table. Keep both names in `UpdateUrl` and `uninstall.sh` for good: a notification posted before
   the rename still holds an old-name address, and existing clones keep their old remote forever. Update the local
   remotes too: `git remote set-url origin https://github.com/omarqaterge/hermux.git`.
6. **Update the kept phone to the next release.** It's the first release with a `hermux` address, and only this proves
   an in-app update works across the rename: check Settings, the notification and the install.
7. **Never reuse the old name.** GitHub warns that creating a repository called `hermes-mobile-app` under this account
   ends the redirects. Every installed copy, copied command and old clone depends on them. That includes a fork or
   template made under that name. Renaming again later would need this whole runbook again, starting with a release.

## Checks after the rename

Each anonymous API call counts against GitHub's limit of 60 an hour per address, and a redirected one costs two.

| Check | Command | Expected |
|---|---|---|
| New home | `curl -s -o /dev/null -w '%{http_code}\n' https://github.com/omarqaterge/hermux` | 200 |
| Old web address | `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://github.com/omarqaterge/hermes-mobile-app/releases` | 301 to the `hermux` address |
| API, as the app calls it | `curl -sL https://api.github.com/repos/omarqaterge/hermes-mobile-app/releases/latest \| python3 -c "import json,sys; print([a['browser_download_url'] for a in json.load(sys.stdin)['assets']])"` | a `…/omarqaterge/hermux/releases/download/…/hermes-mobile.apk` address |
| APK for setup scripts | `curl -fsSL -o /dev/null -r 0-0 -w '%{http_code} %{num_redirects}\n' https://github.com/omarqaterge/hermes-mobile-app/releases/latest/download/hermes-mobile.apk` | 206, 3 redirects |
| Installer | `curl -fsSL https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/phone/bootstrap.sh \| head -1` | the script's first line |
| Git, old address | `git ls-remote https://github.com/omarqaterge/hermes-mobile-app.git HEAD` | the same commit as `main` under the new address |
| CI and releases | A small PR runs and merges; the next `v*` tag publishes | as before |
| Phone | On the kept phone: Settings finds the current version or says it's up to date, with no error | |

## How to undo it

- **Before the follow-up PR:** rename back to `hermes-mobile-app` in Settings. Every address in the code uses that name,
  and builds that accept both keep working. Old versions can update inside the app again.
- **After the follow-up PR:** do the same and revert that PR. Builds released with `hermux` addresses then depend on the
  redirect from `hermux`, so that name must stay unused.
- **Not tested:** renaming back. It would mean renaming a real repository. GitHub's docs describe a rename, not a rename
  back, so run the checks above with the names swapped.

## What was tested (2026-11-02)

Read-only, against public repositories known to have been renamed: `sharkdp/fnd` → `sharkdp/fd` and `astral-sh/puffin` →
`astral-sh/uv`. Both gave the same results.

| Request to the old name | Client | Result |
|---|---|---|
| `github.com/<old>`, `/releases` | curl | 301 to the new name |
| `api.github.com/repos/<old>/releases/latest` | curl | 301 to `api.github.com/repositories/<id>/releases/latest`, with `access-control-allow-origin: *` |
| The same, followed | curl, JDK `HttpURLConnection` with default redirects | 200. **`browser_download_url` has the new name** (`…/sharkdp/fd/releases/download/…`) |
| `raw.githubusercontent.com/<old>/<branch>/README.md` | curl | **200 or 206 with no redirect at all**; the same bytes as under the new name, and a file named after the new name (`uv.lock`) is there too |
| `<old>/releases/download/<tag>/<file>` | curl | 301, 302 to `release-assets.githubusercontent.com`, 200 |
| `<old>/releases/latest/download/<file>` | curl, JDK with the `MainActivity.download` loop and `githubHost` | 301, 302, 302, 200: 3 redirects, under its limit of 6, every host allowed |
| `git ls-remote`, `git clone --depth 1`, `git pull --ff-only` | git | all work; the clone's `.git/config` keeps the **old** address |
| `api.github.com/repos/<old>/…` when the limit is used up | curl, Chromium | 403 from the first request, with no redirect |

`phone/uninstall.sh` and `UpdateUrl` have tests. One-off: `UpdateUrl.ok` also ran with the real `android.net.Uri` from the
`android-all` jar, on the JVM (both names accepted; `hermux-evil`, `hermuxx`, another owner, http, `github.com@evil.com`,
`evil.com\@github.com` and an encoded `..` refused).

**Page `fetch`:** desktop Chromium, from a `file://` page like the app's, made both of `web/src/update.ts`'s requests to
the old name. Each followed the redirect with no CORS error and no preflight. `releases/latest` returned 200 with the new
name in `browser_download_url`, and `contents/…?ref=<tag>` returned the raw text, so the `Accept` header survives the
redirect. The anonymous limit was used up by then, so this run added a token at the network layer, which the page's
JavaScript and CORS don't see. Anonymous curl confirmed `access-control-allow-origin: *` on the 301 itself.

**Couldn't confirm:**
- Android's own `HttpURLConnection` and WebView (see "Needs a real phone"). Android's docs say the connection follows up
  to five redirects, but never between https and http, and WebView is Chromium; neither was run.
- A freshly renamed repository. Both test subjects were renamed well before this test, so a short delay right after a
  rename can't be ruled out. Hence the checks on the day.
- How long the redirects last. GitHub's docs give no end date and say they stop if the old name is reused. The docs don't
  mention `raw.githubusercontent.com` or release files, so those rest on these measurements alone.
- That the Actions secrets, signing key and auto-merge settings survive unchanged: not tested. The first PR and release
  after the rename show it.

## Audit: every use of the name

"Installed" = versions already on phones. "After" = behaviour once the repository is renamed. "Move" = change to the new
name in the follow-up PR.

| Where | What it does | Installed | After the rename |
|---|---|---|---|
| `MainActivity.updateUrlOk`, now `UpdateUrl.ok` | The only check of the repository name in the app: the address must be a release file of this project | Old name only | **Old versions refuse every update.** Both-name builds accept. Keep both for good |
| `MainActivity.download`, `githubHost` | Manual redirects for the APK download; checks https and the host, not the repository name | Same | Works, no change needed: the new name's address goes straight to `release-assets.githubusercontent.com` |
| `MainActivity.BOOTSTRAP_URL` | The command Setup copies to the clipboard; the app doesn't fetch it | Old name | Works through raw. Move |
| `UpdateNotice` `API` | 12-hourly release check, default redirects | Old name | Works, one more API request each time. Move |
| `web/src/update.ts` `REPO` | Settings update check and What's new (page `fetch`) | Old name | Works, one more API request per fetch. Move |
| `web/src/components/Setup.tsx` `INSTALL` | Command the user copies | Old name | Works through raw. Move |
| `phone/uninstall.sh`, grep of `.git/config` | Removes `~/hermes-mobile` only if it is this project's clone. **Packed inside the APK** (`assets/phone/uninstall.sh`), so an installed copy can't get a fix without an update | Old name only | Clones keep their old remote, so they still match. A clone made after the follow-up PR holds `hermux`: an old version's uninstall leaves that folder behind (harmless). Keep both for good. The match is also tighter now: no longer any address that merely contains the old name |
| `phone/bootstrap.sh` `RAW`, `HERMES_IMAGE_BASE`, APK download | New installs: scripts, ready-made image (`curl -fL`), APK (`curl -fsL`). `HERMES_IMAGE_BASE` feeds `tools/test_bootstrap_image.sh` | Fetched from `main` | All follow redirects. Move |
| `phone/install.sh` `REPO` | `git clone` or `git pull --ff-only`, then APK download | Fetched from `main` | Works; existing clones keep the old remote, which depends on the redirect. Move (new clones only) |
| `tools/setup-phone.sh`, `tools/setup-phone.ps1` `RAW`, `APK_URL` | Computer install routes (`curl -fsSL`, `irm`) | Fetched from `main` | Work. `irm` not tested, but it follows redirects by default and raw has none. Move |
| `tools/stats.sh` default repo | Read-only stats through `gh api` | n/a | Not tested with a renamed repository (traffic needs admin rights). Move |
| `.github/workflows/*` | `GITHUB_REPOSITORY` and `github.repository` only, and no action from this repository | n/a | Update by themselves. GitHub doesn't redirect actions in a renamed repository, but none are used |
| `tools/test_uninstall.sh`, `tools/web-e2e/checks/22-whats-new.cjs` | Fixtures with the address | n/a | Pass as they are. Move the what's-new fixture; the uninstall test covers both names |
| `README.md`, `AGENT_INSTALL.md`, `docs/install.md` | Install commands, links. `README.md` also has `cd hermes-mobile-app`, which becomes `cd hermux` | n/a | Work through redirects. Move |
| `docs/spec/*`, `docs/app-setup-design.md` | Describe the addresses | n/a | Move what describes current behaviour |
| `CHANGELOG.md` | A link in an old entry | n/a | Redirects. Leave it: history |

Not affected: `network_security_config.xml` (no GitHub rule), `web/index.html` (no CSP), `web/src/htmlframe.ts` (CSP for
previews only), `hermes-plugin/` and `hermes/` (no address of this repository), the repository has no GitHub Pages site
(GitHub doesn't redirect those).

**Cost of the redirect:** each old-name API call uses two of the 60 anonymous requests an hour (measured: the 301 alone
lowers the count), so the follow-up PR also saves requests. Running out shows "GitHub is limiting requests, try again
later." in Settings, and `UpdateNotice` tries again later.
