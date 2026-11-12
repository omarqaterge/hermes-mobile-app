### 6.6 The plugin follows the app (`phone/plugin-update.sh`, `PluginSync`)

An app update brings the Hermux plugin along: the APK carries the plugin, and the app copies it into Debian at a quiet
moment. Before this, only `phone/install.sh` copied the plugin, so a phone updated through the in-app update kept the
plugin of its first install.

**What the APK carries.** `android/build.sh` puts three files in `assets/phone/`: `plugin-update.sh` (a copy of
`phone/plugin-update.sh` with `~/bin/hermes-services` inside it, `plugin-update.sh embed`), `plugin.tgz` (the plugin folder without `__pycache__`, with a `BUILD_STAMP` file and the Termux scripts in
`phone-scripts/`; about 140 KB) and `plugin.txt` (`STAMP HASH SHA256`). STAMP orders versions: the time of the last commit
(`plugin-update.sh source-stamp`), or the build time when the plugin folder or one of the Termux scripts has uncommitted changes. HASH is a hash of
the plugin's files (names and contents, `BUILD_STAMP` and `__pycache__` left out); SHA256 is the bundle's checksum.
`BUILD_STAMP` (in the installed plugin) holds `STAMP HASH SOURCE`, SOURCE being `apk`, `install` (written by
`install.sh` with the clone's commit time) or `adopted`. It is git-ignored. The plugin reports it at `GET /plugin-info`
(5.4); a plugin without one counts as stamp 0, older than any APK.

**When it runs** (`PluginSync`, 4.1). No timer: each step is started by an event.

| Event | What happens |
|---|---|
| The service starts (also right after an app update: `MY_PACKAGE_REPLACED` → `BootReceiver`) | After 30 s, `check` runs once per app version, then at most every 6 h (`CHECK_EVERY_MS`). |
| A check finds the plugin `older` | The update runs at once if everything is quiet (below), else it waits for one of the next events. |
| A turn ends (a `status` event goes from working to not working) | 15 s later: the update, if one is waiting and everything is quiet. |
| The app leaves the screen (`MainActivity.onStop`) | The update, if one is waiting and everything is quiet. |
| The user taps Settings → About → Hermux plugin | The update now, even with the app on screen (`--force` after "Replace" for a copy changed by hand). |

"Quiet" (`maybeApply`): `HermesService.hermesIdle()` (no working beat within `WORKING_TTL_MS`, no approval or question
open), the app not on screen, at least 2 min (`BUSY_GAP_MS`) since the last try, fewer than 3 failed tries for this
APK's version (`MAX_TRIES`; then only a tap tries again), Termux taking commands (`termuxOk`), no setup or uninstall
running, and no other run in flight (12 min at most, `LOST_MS`). The script checks again itself (below).

**How it runs.** The app sends the script to Termux's `bash` with `RUN_COMMAND` and a result PendingIntent (like the
uninstall, 6.5); only fixed words, the APK's STAMP, HASH and SHA256 and a one-time token reach it, as argv.

- `check STAMP HASH` changes nothing (except settling an interrupted run and stamping a copy that already has the APK's
  files) and answers one state: `not-ready` (no plugin in Debian: no Debian yet or setup not done; the installer puts
  it in place), `current`, `adopted` (the same files without a stamp; now stamped, no restart), `newer` (a bigger stamp:
  never replaced), `modified` (its files no longer match its own `BUILD_STAMP`: changed by hand, replaced only with
  `--force`), `held` (`/root/.hermes/hermes-mobile-plugin/hold` exists: a developer testing a plugin), or `older`.
- `apply STAMP HASH SHA TOKEN [--force]`, in order: the same inspection (anything but `older` stops here); stop if
  Hermes's own `GET /activity` lists any work (`BUSY working`); fetch the bundle from the app's loopback port
  (`GET http://127.0.0.1:9121/plugin-bundle/<token>`, served by `HermesService` only to this run's token) and check its
  SHA256; unpack it into `/root/.hermes/hermes-mobile-plugin/new` (outside Hermes's plugins folder), check HASH and that
  `plugin.yaml` is there, and compile its Python with Hermes's own interpreter; look at `/activity` once more; swap:
  write the marker `pending` (the new stamp), move the live plugin to `old/`, move `new/` into place, and point every
  profile's `plugins/hermes-mobile` at it (a stale copy there becomes a link, as `install.sh` does); look at
  `/activity` a third time (a turn that started during the swap puts the old plugin back, no restart, `BUSY working`);
  restart the dashboard (`hermes-debian --restart`; the supervisor loop starts it again), wait up to 300 s for it to
  answer and then up to 60 s for the new plugin's `GET /plugin-info` to report the new stamp. Then: `OK STAMP` (old copy
  and marker removed; the cron ticker is restarted too when no job runs, so it loads the new plugin (`restart_ticker` stops it by `TICKER_RE`, whichever copy runs: the plugin folder's `cron_ticker.py` or an older install's in `/root/.hermes/scripts/`; its loop starts it again); when a job runs it
  keeps the old plugin until its next start), or rollback: the old plugin moved back, Hermes restarted again,
  `FAIL load rolled-back`. When the plugin didn't answer within 20 s before the swap (Hermes stopped, or the plugin
  switched off), nothing can prove it loads: `OK STAMP unverified`.
- The app passes the script as `bash -c TEXT`, so its text is on the process's command line. It therefore never spells
  out the dashboard's command line (`DASH_RE` is a pattern that doesn't match itself): `hermes-debian --restart` kills
  by that command line and would otherwise kill the run along with the dashboard. Every Debian login has a 240 s limit
  (`timeout`, where Termux has it).
- An interrupted run (Termux killed, the phone off) is settled by the next one: no plugin but `old/` → `old/` is put
  back; a `pending` marker matching the live plugin → kept if it serves its stamp within 45 s; rolled back (with a
  restart) only when the dashboard answers without it and has no work, else left for a later run (`BUSY settling`).
  A lock (`~/.hermes-mobile/plugin-update.lock` with the run's PID; a run removes only its own, and one older than
  20 min counts as left by a killed run) keeps runs from overlapping (`BUSY another-run`).
- Every answer line starts with `HMPLUGIN `: `STATE <state> <installed stamp>`, `BUSY <why>`, `OK <stamp> [unverified]`,
  `FAIL <step> <why>` (steps `check`, `fetch`, `stage`, `swap`, `load`). After any FAIL the plugin that was there is in
  place.

**The supervisor script comes along** (`sync_services`). On `check` and `apply`, when the plugin's state is `current`, `adopted` or
`older`, the APK's copy of `phone/hermes-services` replaces `~/bin/hermes-services`, so an existing phone gets a new supervisor even
when its plugin needs nothing. It travels base64 in `SERVICES_B64`: as plain text it would put the dashboard's command line on the
process's command line, which `hermes-debian --restart` kills by. It checks that the copy parses (`bash -n`) and renames it into place, so
a running copy is undisturbed. It keeps the old one as `~/.hermes-mobile/hermes-services.bak`. It never creates the file, and leaves a copy
that no longer matches the last one from an APK (`~/.hermes-mobile/services.sha`, which `install.sh` removes), so a hand-changed script
stays; so do a `newer`, `modified`, `held` or `not-ready` plugin's. Running loops keep the old script: `~/.hermes-mobile/services-new`
makes the next Hermes restart (`restart_loop`) stop the `dashboard` loop too, only if that pid is still a `hermes-services` process, and
start it anew. The other loops follow when the phone restarts. Until then a run of the script still trims the logs (6.2), but only new
loops record `loop_exit`.

**The Termux scripts come along** (`SCRIPTS`: `hm-local`, `hm-shizuku`). `plugin-update.sh pack DIR OUT STAMP PHONE`
(as `android/build.sh` calls it, PHONE = `../phone`) puts them into the bundle as `hermes-mobile/phone-scripts/<name>`;
`plugin-update.sh assemble DIR PHONE OUT` makes the same folder unpacked, for `install.sh`, so an installed plugin and
the APK's copy of the same commit have the same files (`current`). Both fail when a script is missing. After an `apply`
commits (`OK` and `OK unverified`), and on `check` and `apply` whenever the plugin is `current` or `adopted`,
`sync_scripts` asks the Debian half (`scripts`) for each listed script's SHA-256, reads it out through `hermes-debian cat`
(`deb_cat`; under chroot only root can read Debian's files) into `~/bin/<name>.tmp`, checks the SHA-256, makes it
executable and renames it over `~/bin/<name>`, so a running copy is never changed under it. A copy that already matches
is left alone, so a second run changes nothing. Only the names in `SCRIPTS` are ever copied. Unlike `sync_services`,
it creates a script that is missing from `~/bin`, because installs from before this never had `hm-local`. Like
`sync_services`, a copy changed by hand stays: each copy's SHA-256 is recorded in `~/.hermes-mobile/scripts.sha` (`known_sha`, `note_sha`;
`install.sh` removes the record, so its own copies may be replaced), and a `~/bin` copy that matches neither the plugin's
nor the recorded one is left alone; so is a link at `~/bin/<name>` or `<name>.tmp`, or anything that is no plain file
(nothing is written through a link; the temporary file is made with `set -C`). A `held` plugin stops this too. It prints
one line before the run's last line: `HMPLUGIN SCRIPTS ok`, or `HMPLUGIN SCRIPTS fail <why>` with `no-answer` (Debian
didn't list them), `missing` (the installed plugin doesn't carry a script), `copy` (a copy failed or had other bytes;
the old file stays whole) or `changed` (a hand-changed copy or a link was left alone). Cost: one more Debian login per
`check` of a current plugin (the listing), plus one per script that has to be copied. A failure never changes the run's result
line. The cron ticker needs no copy step once it lives in the plugin folder: it is then a plugin file like any other.
The APK's copy of `plugin-update.sh` (with the supervisor inside) is about 30 KB, one `bash -c` argument well under
Linux's 128 KiB limit for one argument; the scripts travel in the bundle, not in it.

**What the app shows.** Settings → About → Hermux plugin (3.15), from `PluginSync.state` through the bridge
(`pluginState`, `pluginUpdate`, 4.5; `web/src/plugin-sync.ts`). The state lives in the `hermes` preferences (2.4).

**Who gets what.**

| User | What happens |
|---|---|
| Updates from a version without this (the first Hermux release) | The new version's service starts after the update and checks within a minute; the old plugin (no `BUILD_STAMP`, so stamp 0) is replaced at the first quiet moment: right away when Hermes is idle and the app isn't open, else when the current turn ends or the app is left. |
| Stays on a version without this | Nothing changes: the plugin is only updated by running `phone/install.sh` again. |
| New install | `bootstrap.sh` → `install.sh` installs the plugin from the clone, stamped `install`; the app then finds it `current` (or `newer` when `main` is ahead of the release). |
| No Debian yet, or setup still running | Nothing runs (`termuxOk` false, setup installing, or `not-ready`). |
| A developer testing a plugin | `install.sh` from a newer clone stamps it newer; a hand-edited copy reads `modified`; the `hold` file stops the app entirely. |

The Hermes patches, the Hermes pin and the other scripts in `~/bin` (`hermes-debian`, `rish`) are not part of this: they still change only with `install.sh` (6.4).
