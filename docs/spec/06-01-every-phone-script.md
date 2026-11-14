### 6.1 Every `phone/` script (12)

| Script | Runs in | Run by | What it does |
|---|---|---|---|
| `bootstrap.sh` | Termux | the user, the app (pasted command), the computer scripts | The whole phone-side install, no questions (steps below). Also `bash hm.sh model <provider> <model> [ENV_NAME=key]` to set a model. |
| `install.sh` | Termux | `bootstrap.sh`, or by hand to repair/refresh | Plugin, supervisor scripts, patches, phone access, enabling the plugin; downloads the APK unless `HM_NO_APK` is set. |
| `phone-access.sh` | Termux | `bootstrap.sh` (early) and `install.sh` | Hermes's access to the phone: files, Termux:API links, Shizuku `rish`. |
| `hermes-services` | Termux | Termux:Boot, the app (`startHermes`), the installer, by hand | The supervisor (6.2). Idempotent. |
| `hermes-debian` | Termux | `hermes-services`, installers, the app | One front for "run something in Debian" that hides proot vs chroot. |
| `hermes-patches.sh` | Debian | `install.sh`, `bootstrap.sh`, `tools/build-image.sh` | Applies, checks or reverts `hermes/patches` (6.4). |
| `hm-shizuku` | Termux | the app (pair, from the code the user typed; start) | Lets Shizuku start again by itself without root. |
| `hm-local` | Termux (or inside Debian when Termux has no `python3`) | not used yet (later: the supervisor, `hm-shizuku`, the plugin update) | Local authentication from the shell: verifies a local Hermux server before anything is sent to it. |
| `cron_ticker.py` (in `hermes-plugin/hermes-mobile/`) | Debian | `hermes-services` loop `cron-ticker` | Runs Hermes's cron scheduler and tells the app when to wake the phone. Ships in the plugin folder, so plugin updates bring it along. |
| `hermes_memory_sync.py` | Debian | `hermes-services` loop `memory-sync` (only if the file exists) | Two-device memory sync through a private git repo. |
| `keep_note.py` | Debian or Termux | the model/skills by hand | Creates a Google Keep note by driving Keep's share sheet. |
| `uninstall.sh` | Termux | the app (Settings → Danger zone → Uninstall Hermux), or by hand | Removes what the installers put on the phone (6.5). |
| `plugin-update.sh` | Termux (its second half in Debian) | the app (`PluginSync`, from the copy in the APK); `android/build.sh` and `install.sh` use its `pack`, `stamp` and `source-stamp` modes | Brings the plugin in Debian up to the APK's copy: `check`, `apply` (checked bundle, staged, swapped, Hermes restarted, rolled back if the new plugin doesn't load), never a downgrade. See 6.6. |

#### `bootstrap.sh` in order

Runs in Termux with `set -eE -o pipefail`. It reports each line with `say` to the screen, to Android's log (tag `hmsetup`, read with `adb logcat -s hmsetup`), and, when `HM_APP_TOKEN` is set, as `POST http://127.0.0.1:9121/setup` with `{token, line, ts}` (2 s timeout, never fails the install). The last line is `HMSETUP DONE` or `HMSETUP FAIL <step> (line N)`. `DONE` also creates `~/.hermes-mobile/installed`, the marker the app's probe reads. Safe to run again: finished steps are skipped.

Inputs: `HM_DISTRO=chroot` (rooted phones; stored in `~/.hermes-mobile/distro`), `HM_NO_APK=1` (a computer route installs the app and lifted the child-process limit already), `HM_APP_TOKEN` (set by the app's copied command), `HM_IMAGE=0` (skip the ready-made image), `HM_IMAGE_URL`, `HM_IMAGE_MB`.

1. **`model` sub-command** (only when the first argument is `model`): `hermes config set` for each `ENV_NAME=value`, then `model.provider` and `model.default`; restarts a running dashboard (exact PIDs, or `hermes-debian --restart`), waits for port 9119, prints `MODEL SET`. The key is never echoed.
2. `termux-wake-lock` (released on success and on failure).
3. **STEP packages**: `apt-get update/upgrade`, then `proot-distro git curl termux-api unzip android-tools` (chroot: `python git curl termux-api unzip android-tools` plus `pip install chroot-distro`). Chroot also has **STEP root**: `su -c id` must say `uid=0` or it fails with a clear message.
4. **STEP access**: runs `phone-access.sh` (from the clone, or downloaded as `~/hm-phone-access.sh`); never fails.
5. **STEP android**: on Android 12+ (SDK 31), if Shizuku answers (`rish -c id` gives `uid=2000`), lifts Android's phantom-process limit with `device_config` and `settings` commands; otherwise prints a hint about Developer options → Disable child process restrictions. Skipped when `HM_NO_APK` is set.
6. **Ready-made image** (`image_restore`, new Debian only; proot only): finds the image by the pin alone (`HERMES_IMAGE_BASE/hermes-image-<first 12 of HERMES_COMMIT>/hermes-debian-<12>-arm64.tar.zst` plus `.sha256`). Any problem (no image for this pin, `HM_IMAGE=0`, chroot, not arm64, less than `HERMES_IMAGE_MB` 5200 MB free, download or sha256 failure, restore failure) logs one line, cleans up and the normal install runs. On success it runs `hermes-patches.sh revert` inside Debian so `install.sh` can apply this installer's own set.
7. **STEP debian**: `proot-distro install debian` (or `chroot-distro install --name debian debian:trixie`) unless the image restored it. Writes `/etc/profile.d/zz-no-termux-path.sh` so Debian's PATH drops Termux's bionic binaries. `apt` installs `curl git ca-certificates xz-utils procps libatomic1` plus the Chromium libraries Hermes's browser needs.
8. **STEP hermes**: removes empty launchers an interrupted install left, moves a half-installed `~/.hermes/hermes-agent` (no `.git`) aside, then, unless `hermes --version` works and `install-stamp.json` exists, downloads the **pinned** installer (`raw.githubusercontent.com/NousResearch/hermes-agent/$HERMES_COMMIT/scripts/install.sh`) to a file and runs it with `--non-interactive --commit $HERMES_COMMIT` (one retry with uv's Python on PATH, a proot workaround). Then checks `hermes --version`, and tries `hermes pm install agent-browser` again if the browser tools are missing (only a TODO line if that fails).
9. **STEP plugin**: runs `install.sh` with `HM_NO_APK=1` (from the clone, or downloaded as `~/hm-install.sh`), then writes `~/.termux/boot/10-hermes` which calls `~/bin/hermes-services` at boot.
10. **STEP start**: runs `~/bin/hermes-services`, waits up to 90 x 4 s for `127.0.0.1:9119`; otherwise `FAIL start`.
11. Prints each line of `~/.hermes-mobile/todo` as `TODO <text>`. If neither `HM_NO_APK` nor `HM_APP_TOKEN` is set (the phone-only route), downloads `releases/latest/download/hermux.apk` (or `hermes-mobile.apk` if the latest release doesn't have that yet) to `~/hermes-mobile.apk` and opens Android's installer with `termux-open`. Then `say DONE`.

#### `install.sh` in order

Its own five numbered steps (it is also the repair script and runs after Hermes exists):

1. Picks the distro (`HM_DISTRO`, the stored choice, or chroot-distro when there is no proot Debian and chroot-distro exists) and stores it. If not run from a clone it clones or updates `~/hermes-mobile` from the public repo.
2. **1/5** adds `allow-external-apps = true` to `~/.termux/termux.properties` (lets the app run commands in Termux) and reloads Termux settings.
3. **2/5** copies `hermes-services`, `hermes-debian`, `hm-shizuku` and `hm-local` into `~/bin` (and removes
   `~/.hermes-mobile/scripts.sha`, so the app's plugin update may replace these copies, 6.6). Dies with a clear message if Debian or `/root/.hermes` is missing.
4. **3/5** builds the plugin folder the way the APK's copy is built (`plugin-update.sh assemble`: the folder plus `hm-local` and `hm-shizuku` in `phone-scripts/`, in `~/.hermes-mobile/plugin-staging`, removed afterwards; if that fails, the install stops with a message), stamps it, copies it to `/root/.hermes/plugins/hermes-mobile` (through `hermes-debian --put`; the cron ticker is in the plugin folder), symlinks the plugin into every existing profile, copies `hermes/patches` to `/root/.hermes/hermes-mobile-patches` and `hermes-patches.sh` to `/root/.hermes/scripts/`, and runs `hermes-patches.sh apply`. A patch that does not fit is skipped, never half-applied, and Hermes runs unchanged.
5. Runs `phone-access.sh` (before the restart below, so a restarted Hermes sees `/sdcard`).
6. **4/5** `hermes plugins enable hermes-mobile` (and for `-p default` when Hermes's active profile is another one), then `hermes-debian --restart` so a running dashboard loads the new plugin and patched files. Adds Debian's `python3-googleapi` packages for Hermes's Google skill (optional).
7. With `HM_NO_APK` set it stops here. Otherwise **5/5** downloads the APK and opens Android's installer.

`hermes_memory_sync.py` and `keep_note.py` are **not** copied by `install.sh` or `bootstrap.sh`; the `memory-sync` loop starts only if someone put `hermes_memory_sync.py` at `/root/.hermes/scripts/`.

#### `phone-access.sh`

Never fails the install; what is missing goes to `~/.hermes-mobile/todo`, one line each (printed at the end by the installers, shown by the app's Setup check).

1. Installs `termux-api`, `unzip`, `android-tools` if missing (refreshes the package index once on failure).
2. **Files**: if `/storage/emulated/0` is not readable, asks for `termux-setup-storage` and waits up to 2 minutes.
3. **Termux:API**: links every `termux-*` command into Debian's `/usr/local/bin` (Debian's PATH drops Termux's dirs); a `termux-battery-status` check decides the TODO.
4. **Shizuku `rish`**: downloads Shizuku 13.6.0's release APK, extracts `assets/rish` (with `"PKG"` replaced by `"com.termux"`) and `rish_shizuku.dex` (read-only, Android 14 refuses a writable dex) into `~/bin`. Calls `rish -c id` up to 3 times (the first call makes Shizuku ask whether Termux may use it).
5. If Shizuku answers: grants Shizuku `WRITE_SECURE_SETTINGS`, takes Shizuku off the battery limits (`dumpsys deviceidle whitelist`), grants the app `WRITE_SECURE_SETTINGS` (so it can turn Wireless debugging on), warns when Shizuku saved its "allow Termux" entry without the package name, and does nothing about pairing Termux's adb (the user does that once in the app after the install; the installer never opens or taps the screen and prints no TODO for it). If Shizuku does not answer it adds a TODO that says how to start it.

#### `hm-shizuku`

`pair PORT CODE`, `start [port]`, `status`. One run at a time (a lock folder). Every `adb` call is bounded (`timeout`) and gets `</dev/null`. No `rish` and no screen code at all.

- `pair PORT CODE` (PORT 1-65535, CODE exactly 6 digits, leading zeros kept; anything else exits 64 without calling adb): needs `adb` and Android 11+; runs `adb start-server`, then `adb pair 127.0.0.1:<port> <code>` (20 s), and records the key in `~/.hermes-mobile/adb-paired`. The user opened Settings → Wireless debugging → "Pair device with pairing code" and typed the code into the app; the app found the port. A bare `pair` (an older app) exits 64 with the detail "update Hermux: pairing is done from the app now".
- `start [port]` connects Termux's adb to `127.0.0.1:<port>` (scans loopback ports 32768-60999 if no port or no answer), checks for the shell user, and starts Shizuku's server with its own `libshizuku.so`. Exit 0 only when `shizuku_server` runs.
- After `pair`/`start` it posts `{"kind":"shizuku-auto","cmd":"pair|start","paired":bool,"result":...,"detail":...}` to the app (`ok`, `no-port`, `failed`, `not-paired`) through `emit`, which pipes it into `~/bin/hm-local post /event` (`LOCAL`; port `EVENT_PORT`, 9121, `HM_EVENT_PORT` in the tests): `hm-local` verifies the app's listener and signs the request, and reads the key file itself, so `hm-shizuku` never reads the key and calls no `curl`. No key file, no `hm-local`, or a listener that doesn't verify: nothing is sent, and one line in the log says so (`hm-local`'s exit code only; nothing for `no_answer`). Exit codes: 0 ok, 2 missing adb or Android 10 and older, 6 pair failed, 7 no port, 8 server did not start, 9 not paired, 10 busy, 64 usage. Log: `~/.hermes-mobile/hm-shizuku.log` (last 300 lines).

#### `hm-local`

Local authentication (`hermux-local-v1`, 2.3) for shell scripts. Its Python is the client half of
`hermes-plugin/hermes-mobile/local_auth.py`, copied unchanged (`tools/test_hm_local.sh` compares the two and runs the
shared vectors through it); the file's first part is shell, which Python reads as a string.

- `hm-local hello ROLE PORT` (ROLE `dashboard` or `events`): the hello on `127.0.0.1:PORT`, then closes; sends nothing else.
- `hm-local token [PORT]`: `dashboard_token` from the copied client: a verified hello to the dashboard (default 9119),
  then `GET /hermux/token` on the same connection with `X-Hermux-Auth: 1 <kid> <ns> <nc> <mac>` (both nonces, as the
  dashboard guard wants); the answer `{"hermux":1,"token","proof"}` must carry a proof (`answer`, `token`, over
  the hello's nonces and the token's SHA-256) before the token is printed. The token must be 1 to 512 printable ASCII characters, as
  the guard hands out.
- `hm-local post PATH [PORT]`: reads the body from stdin first (at most 256 KiB, `MAX_BODY`, all of it within 5 s,
  `BODY_DEADLINE_S`, so a caller that never closes stdin can't hold it), then a verified hello to
  the app's port (default 9121) and `POST PATH` on the same connection; prints the answer's body on a 2xx status.
- `hm-local get /api/PATH [PORT]`: a dashboard REST route (only `/api/`; default port 9119): the session token from
  `dashboard_token`, then a new verified hello and `GET PATH` on that same connection with the token and a fresh
  `X-Hermux-Nonce` (`dashboard_get`); the answer counts only with exactly one `X-Hermux-Proof` over that nonce, the
  address and `rest <status>` (exit 8, `bad_proof`, otherwise); prints its body on a 200 (exit 11 for another status).
- The key comes from `~/.hermes-mobile/key`, read inside the script: never from the command line or the environment.
  The key, key id, nonces and proofs are never printed; errors print only `hm-local: <reason>`, and a closed stderr or
  stdout never changes the exit code.
- Exit: 0 verified (and sent), 3 `no_answer`, 4 `no_hello`, 5 `old_version`, 6 `bad_addr`, 7 `unknown_kid`,
  8 `bad_proof`, 9 `refused`, 10 no key file, 11 the answer after a verified hello was unusable (broken, too large, too
  slow, or not 2xx), 12 no Python, 64 usage, 65 the body was over the limit or not complete in time, 70 an internal
  error, 74 the output could not be written (its reader went away). Python itself exits only 1, 2 or 120 (it could not
  run the file at all), and a failed Debian login passes its own code on: none of these overlap. Nothing is sent after a failed
  hello, and the same bounds as `local_auth.py` apply (no proxy, no redirect followed).
- Python: Termux's `python3 -I`; without it, inside Debian through `~/bin/hermes-debian` (Hermes's own venv Python, else
  Debian's `python3`), with `HOME` set back to Termux's home (Debian sees it at the same path); with neither, exit 12 and
  nothing is sent. `openssl` is never used. On the proot route `bootstrap.sh` installs no Termux `python`, so there it
  runs inside Debian (slower: one Debian login per run).
- Delivered like `hm-shizuku`: `install.sh` copies it to `~/bin`, and each app update brings it along inside the plugin
  (6.6, `phone-scripts/`).

#### `hermes-debian`

Reads `~/.hermes-mobile/distro` (`proot` unless `chroot`). Options: `--which` (prints proot or chroot), `--rootfs` (Debian's root folder as Termux sees it), `--exists PATH`, `--put SRC DEST` (copy into Debian, replacing DEST), `--restart` (kill the dashboard by its command line, `dashboard --host 127.0.0.1 --port 9119` without the word `hermes`, because Hermes's launcher starts Python without it; under proot Python goes first and then proot and its wrappers, since a Python left without its proot gets `ENOSYS` from its system calls and writes tracebacks to `dashboard.log`; the supervisor starts it again; under chroot through `su`), `--open PATH` (open a Debian file in an Android app; `/sdcard` paths map to `/storage/emulated/0`). With a command it runs it as root in Debian; with nothing it opens a shell. Under chroot-distro it binds `/dev/__properties__` and `/dev/socket` and links the binder devices so Termux:API works, and passes the exit code back in a file because chroot-distro 3.2 reports 0 for failures on a terminal.

#### `cron_ticker.py`

The phone runs `hermes dashboard`, not the messaging gateway, so cron jobs would never fire without this. It loads Hermes's launch bootstrap in the main thread (a re-exec from a worker thread kills it under proot), then starts Hermes's own `_start_desktop_cron_ticker` (a tick every 60 s over every served profile). For battery it adds:

- `WakeReporter`: every 60 s it finds the earliest `next_run_at` of runnable jobs in every profile's `cron/jobs.json` and sends `wake_at` (seconds since epoch, or 0) to the app when it changed, plus a resend every 1200 s. The app sets an alarm for it.
- A poke listener on `127.0.0.1:9122` (`poke_listener`, one connection at a time through `serve_one`): when the app's alarm fires it connects, and the ticker runs a cycle at once (Hermes's own timer stops while the phone sleeps). It speaks local authentication's line protocol (2.3, `local_auth.ticker_serve_one`): `HELLO 1 <nc>` (optionally followed by the client's key id as a hint; the ticker holds one key, so its proof is always under the key file's key), answered with `HERMUX 1 ticker <kid> <ns> <addr> <proof>`, then `POKE 1 <mac>`, the client MAC over both nonces, which pokes it. A first line that is the shared key itself still pokes it until `~/.hermes-mobile/enforced` exists (`ENFORCED`); after that it pokes nothing and `note_legacy` reports it at most once a day: the line `local legacy_key port=ticker side=ticker` in `~/logs/loop-events.log` (`_loop_line`, the same rules as `note_port`) and a signed `local_legacy` event to the app (`local_auth.report_legacy`, on a thread), which then replaces the key (2.3). It loads `local_auth.py` from its own folder (`_local_auth`) and reads the key through `local_auth.KeyFile`; run as a script it takes its own folder off Python's path before any other import (`_drop_own_folder`: compared by real path, so a symlinked script or folder and the `''` or `.` entries count), so no plugin module can stand in for a module of the standard library or Hermes. A failing `accept()` (interrupted, a connection aborted first, no file descriptor left) is tried again on the same socket after `ACCEPT_RETRY_S` (0.5 s); only `ACCEPT_GIVE_UP` (20) failures in a row make it open the port again, and it logs only the change to failing and back (`_accept_loop`). When the port is in use it tries again after `BIND_RETRY_FIRST` (5 s), doubling up to `BIND_RETRY_MAX` (5 min), for as long as the ticker runs (a sleeping thread); it logs only a change and `note_port` adds `local port_taken port=ticker` or `local port_ok port=ticker` to `~/logs/loop-events.log` (only to a file already there, and not while the diagnostic log is off).
- `Ticker` (the stop event Hermes's loop waits on): while a job runs it looks every 2 s; once nothing runs after a poke or a job it sends `cron_idle` (with the cycle start time) so the app drops its cron wake lock.
- Its events to the app (`wake_at`, `cron_idle`, and `local_port` with `port` `ticker` and `state` `taken` or `ok` when the poke port's state changes) go through `_post` with local authentication: `local_auth.session("events", EVENTS_PORT, key)` verifies the app's listener, the event is signed on that connection, and the key is never sent. A listener that doesn't verify gets nothing; after any reason but `no_answer` the ticker waits before it tries again (`local_auth.Backoff` in `_client`, 1 s doubling to 5 min) and logs one fixed line per reason (`_say_once`). Without `local_auth.py` next to it, it sends nothing and logs that once.

#### `hermes_memory_sync.py`

Two-way, conflict-free sync of `USER.md` and `MEMORY.md` between devices through a private git repo. One immutable file per entry (`<created_ms>-<sha256[:16]>.md`) under `<home>/<scope>/<target>/` where scope is `shared`, `mac` or `phone`; a three-way merge per file against the last agreed state; entries prefixed `Mac:` or `Phone:` stay on that device. A sync that would delete more than half of a non-trivial memory is refused. Commands: `init --device mac|phone --remote URL`, `sync` (default), `status`. It takes Hermes's own file locks and writes files the way Hermes does.

#### `keep_note.py`

`keep_note.py "title" "body" [account]` creates a Google Keep note (Keep's API is Workspace-only): sends Keep a share intent through `rish`, waits for its Save button via `uiautomator`, picks the account, taps Save, checks the dialog closed and returns to Home. Exit 0 saved, 1 failed (message on stderr).
