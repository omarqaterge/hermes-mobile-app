### 7.2 Every `tools/` file

`tools/` holds the plain files below (plus the folders `tools/web-e2e`, `tools/battery`, `tools/fixtures`, described after the table). "Phone needed" means it uses `adb` and a connected device or emulator. Tests that say "CI" run in `.github/workflows/ci.yml` (see 7.4). Every Python test prints `[PASS]`/`[FAIL]` lines and exits 1 on any failure; the shell tests print `PASS`/`FAIL` lines and `ALL PASSED`.

**Developer setup and checks (for people and coding agents)**

| File | What it is for |
|---|---|
| `setup.sh` | Gets a fresh checkout or worktree ready: reports Node (22+), Python, JDK 21 and the Android SDK, installs `web/` and `tools/web-e2e/` packages (copying a sibling git worktree's `node_modules` when its `package-lock.json` is identical, as a copy-on-write clone on macOS or hard links on Linux, else `npm ci`; a symlink would not do, Vite refuses files whose real path is outside the checkout), `pip install fastapi httpx`, and finds a browser for the e2e tests (`$CHROMIUM`, Playwright's Chromium, or Google Chrome on a Mac; installs Playwright's Chromium otherwise). On Linux it starts Playwright's Chromium once (`pw_launches`): when it can't (a bare image lacks libraries such as `libnspr4`), it runs `npx playwright install-deps chromium` as root, or reports the command to run with `sudo` (`pw_libs`). `--check` only reports. Safe to rerun; usable as a cloud agent environment's setup script. |
| `check.sh` | One command for the checks a change needs, with one PASS/FAIL/SKIP summary. No argument: the groups the branch's changes since `origin/main` need (uncommitted files included); `--all`: every group; or name groups (`web`, `plugin`, `patches`, `android`). `check_spec.py`, `changelog.py check` and `check-attribution.sh` always run. `web` runs the typecheck, unit tests, one build and then `tools/web-e2e/run.sh` once per shard of CI's `web-e2e` matrix, in parallel on free ports; `plugin`, `patches` and `android` run the commands of the CI jobs `plugin`, `hermes-patches` and `android`, read from `ci.yml` so the two never drift. Missing JDK, Android SDK or the plugin tests' `fastapi`/`httpx`, and `test_battery.py` without Linux `/proc`, are a SKIP (CI still runs them); the contract check is CI-only. |

**Install and setup**

| File | What it is for |
|---|---|
| `setup-phone.sh` | Mac/Linux install route over `adb`: installs Termux, Termux:Boot and Termux:API from F-Droid and Shizuku from GitHub, sets Android settings, types the bootstrap into Termux, installs the APK, optionally sets a model key (`HM_PROVIDER`, `HM_MODEL`, `HM_KEY_NAME`, `HM_KEY`, `HM_SKIP_MODEL`), `-s <serial>` picks a device, `HM_DISTRO=chroot` for rooted phones. Safe to run again. Details in 6.3. |
| `setup-phone.ps1` | The same route for Windows PowerShell, in 9 numbered steps (adb, connect, Termux, Android settings, open Termux, install Debian + Hermes, model, app, check). `HM_SERIAL` picks a device. |
| `build-image.sh` | Builds the ready-made Debian + Hermes image that `phone/bootstrap.sh` restores on new installs. Runs in an arm64 `debian:trixie` Docker container (`--inside` is its in-container half), applies the same apt line / profile file / Hermes installer call read out of `bootstrap.sh` so they cannot drift, adds browser tools and `hermes/patches`, packs with `pack_image.py`, compresses with `zstd -19 --long=27`, writes `<name>` and `<name>.sha256` (name `hermes-debian-<first 12 of the pin>-arm64.tar.zst`). `--name` only prints the name; `HM_KEEP=1` keeps a failed container. Prints the free space a restore needs, which `HERMES_IMAGE_MB` in `bootstrap.sh` must cover. |
| `pack_image.py` | Helper of `build-image.sh`. `pack --manifest FILE` turns a `docker export` tar on stdin into proot-distro's backup layout (`debian/manifest.json`, `debian/rootfs/…`), scrubs secrets/ids/logs/caches/history, sets owners to root and drops PAX path headers. `check` reads the packed tar and exits 1 if it is not exactly one container named `debian`, a scrubbed path is inside, or a file the restore needs is missing. |

**Talking to a real phone (developer helpers; need `adb`)**

| File | What it is for |
|---|---|
| `phone` | Shell script: `ssh` into Termux on the phone (key-only sshd on port 8022, reached through `adb forward`). `tools/phone '<cmd>'` runs a Termux command; wrap in `proot-distro login debian -- bash -lc '…'` for Debian. |
| `api` | `tools/api GET /api/profiles` calls the phone's Hermes dashboard REST API (same as the app's `httpAsync`): forwards port 9119 over `adb`, scrapes the session token from the dashboard page, sends it in `X-Hermes-Session-Token`. Writes change the real Hermes setup. |
| `gw` | `tools/gw <method> ['<json>']` makes one `tui_gateway` JSON-RPC call on the phone: pipes `gw_rpc.py` into Debian through `phone`. |
| `gw_rpc.py` | The part of `gw` that runs inside Debian: reads the dashboard token, opens `ws://127.0.0.1:9119/api/ws`, sends one request, prints the result or error. |
| `gw-time` | `tools/gw-time [session id] [runs]` times the app's start-up requests on the phone's Hermes: force-stops the app (so it never closes a chat the app has open), then pipes `gw_time.py` into Debian through `phone`, like `gw`. |
| `gw_time.py` | The part of `gw-time` that runs inside Debian (`HM_GW_URL` picks another dashboard, `HM_GW_SETTLE` the pause between runs, 4 s). For the newest chat (or the one given) it times `session.list` (limit 80 and 20) and `session.resume` (as the app sends it, and with `inline_images: false`), each alone and the two together as the app sends them at start-up, each run on a fresh socket; it closes the chats it resumed. Prints medians, every run's time, reply sizes, and how many resumed messages carry an inline `data:image/` URL; never titles or chat text. |
| `e2e.py` | End-to-end checks on the real phone through `adb`, the app's loopback event service (`127.0.0.1:9121/event`) and the plugin API. Groups: event listener (good key 204, bad key 403), status chip (appears when working, clears on Ready, expires in ≤65 s unless `--quick`), review feed + replay, canvas, approval, and with `--live` one real tiny Hermes turn that drops the WebSocket mid-turn (creates one "e2e" chat and deletes it). Sends the app to the background for the run and brings it back. |
| `e2e_review_replay.py` | Runs on the phone (fed over stdin by `e2e.py`): loads the installed plugin and replays real background-work event sequences (memory/skills review after a reply, `/btw` side questions) with turn ids as Hermes logs them, each hook under the write origin Hermes binds for that turn kind. |
| `probe_model_switch.py` | Live check of `hermes/patches/0002` on a phone: throwaway chat, model picked before the first message, two switches, an edit, then asks the model for each code word. Spends a little model quota; deletes the chat. |
| `hermes_repro_model_switch.py` | Offline repro of the same bug on any Hermes checkout: a fake OpenAI-compatible server plus `python -m tui_gateway.entry` over stdio. Prints `LOST: ['PROMPT-2']` without patch 0002 and `LOST: nothing` with it. No network or key. |
| `device-lock.sh` | One session at a time per phone or emulator: `hold SERIAL WHO [MINUTES]` takes or extends the device's lock (default 30, at most 240 minutes; exit 75 and who holds it when busy), `release SERIAL WHO` gives it back (only the holder), `run SERIAL WHO CMD...` holds, runs and releases even when the command fails, `status` lists held locks. A lock is a directory in `HM_DEVICE_LOCKS` (default `~/.cache/hermes-mobile/device-locks`) holding who has it and until when; it expires by itself, so a session that died never blocks the device for long. `AGENTS.md` tells every agent to use it. |
| `stats.sh` | Read-only `gh api` snapshot of the public repo: APK download total, 14-day clones/views, stars, forks, as one CSV line. `--append DIR` also keeps `stats.csv` and a merged `traffic-daily.csv`. `HM_REPO` overrides the repo. |

**Test fixtures and generators**

| File | What it is for |
|---|---|
| `hermes-provider-fixture.py` | Writes `tools/web-e2e/fixtures/hermes-providers.json` from a real Hermes source tree (empty `HERMES_HOME`): the `GET /api/env` provider rows and `GET /api/providers/oauth`, with sign-ins reset to signed-out. The web-e2e mock and the unit tests answer with it. Regenerate after moving the Hermes pin. |
| `check-attribution.sh` | Fails when a commit credits an AI tool: an author or committer that is Claude/Anthropic or another AI tool, or a `Co-Authored-By:` / "Generated with" line naming one. Checks a git range (default `origin/main..HEAD`) or, with `--stdin`, tab-separated commit records (how CI's `changes` job feeds it the PR's commits from the GitHub API). `check.sh` runs it every time. |
| `ci-changes.sh` | Which slow CI groups a change needs: reads changed paths (or `all`) on stdin and prints `web=true\|false`, `contract=true\|false` and `patches=true\|false`. `web`: anything in `web/` or `tools/web-e2e/`; `contract`: `tools/hermes-contract/`, `hermes/`, `web/vendor/`, the mock and its fixtures; `patches` (the `hermes-patches` job): `hermes/`, `phone/`, the Hermes pin (`.hermes-commit`), and the shell scripts and helpers directly in `tools/` (`*.sh`, `*.ps1`, `pack_image.py`), not those in its subfolders; the workflow file and this script turn on all three. Used by CI's `changes` job and by `check.sh` to pick its `web` and `patches` groups. |
| `test_ci_changes.sh` | Tests `ci-changes.sh` on typical changes (docs, plugin, Android, web, a check file, the mock, vendored types, the contract tool, patches, a phone script, a `tools/` shell script, the e2e runner, the workflow, nothing). Run in CI. |
| `check_spec.py` | The spec checker. `inventory(root)` pulls names out of the code (files, bridge methods, plugin routes/hooks/tools/prompt sections, gateway RPCs, `localStorage` keys, screens, Settings section and row titles, aria-labels, service events, notification channels, permissions); `spec_text(root)` joins the index `docs/SPEC.md` and every `docs/spec/*.md` file; `missing(spec, inv)` lists the names that text lacks (identifiers must be in backticks, UI copy as plain text); `main` prints the gaps and exits 1. Run `python3 tools/check_spec.py` before every commit that adds a name. |
| `test_check_spec.py` | Unit test of the checker on a tiny fake repo: reads each kind, complete spec passes, missing items are listed, identifiers need backticks, a route prefix is not enough, names may sit in any `docs/spec/` file, missing `docs/SPEC.md` fails. Run in CI. |
| `changelog.py` | CHANGELOG fragments (7.5). `check` fails on a file in `changes/` that is not named `YYYY-MM-DD-short-name.md` or is not CHANGELOG bullets; `show` prints the next release's notes (fragments newest first, then the `## Unreleased` section of `CHANGELOG.md`); `release vX.Y.Z [date]` writes them as a new `## vX.Y.Z (date)` section under an emptied `## Unreleased` and deletes the fragments. |
| `test_changelog.py` | Unit test of `changelog.py` on a tiny fake repo: bad fragment names and contents are listed, newest fragments come first, a release folds fragments and old Unreleased entries into one section and removes the fragments, refuses a bad or existing version or an empty release, and the real `changes/` passes. |

**Plugin tests (Python, no phone; CI job `plugin` unless noted)**

| File | What it covers |
|---|---|
| `test_canvas.py` | `hermes-plugin/hermes-mobile/canvas.py`: document storage and the `canvas` tool in a temp `HOME`. |
| `test_library.py` | `library.py`: the old Library storage (categories, items). |
| `test_gallery.py` | `gallery.py`: the canvas gallery listing across chats, with a fake chat database. |
| `test_media.py` | The `/media` endpoint of `dashboard/plugin_api.py`: byte ranges for the app's players. Needs `fastapi`, `httpx`. |
| `test_chat_search.py` | `chat_search.py`, the `find_chats` tool, on a fake `~/.hermes`. |
| `test_checkpoints.py` | `checkpoints.py`: per-chat file checkpoints over a shadow git store built the way Hermes builds it. |
| `test_battery.py` | Battery behaviour: cron ticker next-wake calculation, status loop asleep while idle, long-tool stale window, dashboard watcher slow-down, `bots.py off`. |
| `test_approval.py` | The approval event carries the id of the exact request, so a notification button cannot answer a different waiting approval. |
| `test_chip.py` | What the plugin tells the app about a running turn (title, steps, task list, other busy chats, how it ended) and the `/stop` endpoint behind the chip's Stop button. |
| `test_phone_app.py` | The `phone_app` tool (`phone_app.py`) against a fake background host. |
| `test_auto_mode.py` | `auto_mode.py` (Auto access) with Hermes's approval modules faked. |
| `test_openui.py` | `openui.py` and its wiring in `__init__.py` (cards in replies). |
| `test_openui_query.py` | `openui_query.py`: the read-only allow-list and `call_tool` behind `POST /openui/call`. |
| `test_claude_login.py` | `claude_login.py`, the in-app Claude sign-in. Part 1 fakes Hermes; part 2 runs only when Hermes is importable and uses its real credential pool on a throwaway `HERMES_HOME`. |
| `test_phone_access.py` | The phone-access probe (`phone_access_now`): one retry so a sleeping Termux:API app does not flash red. Skipped without `fastapi`. |
| `test_profile_link.py` | `link_profiles`: the plugin is linked into every Hermes profile. Skipped without `fastapi`. |

**Phone-script and install tests (shell, no phone unless noted; CI job `hermes-patches` unless noted)**

| File | What it covers |
|---|---|
| `test_hermes_patches.sh` | `hermes/patches` apply to the pinned Hermes (`web/vendor/hermes-shared/.hermes-commit`) and revert cleanly; reports how they fare on upstream `main` (information only). Clones Hermes unless given a checkout. |
| `test_hermes_debian.sh` | `phone/hermes-debian` (the proot-distro / chroot-distro switch) with fake `proot-distro`, `chroot-distro`, `su`: `--which`, `--rootfs`, `--put`, `--exists`, `--restart`, exit codes. |
| `test_bootstrap_pin.sh` | The Hermes commit in `phone/bootstrap.sh` equals the app's vendored pin, and the installer is called with `--commit`. |
| `test_bootstrap_image.sh` | The ready-made-image path of `bootstrap.sh` with fake `curl`, `proot-distro`, `uname`, `df`; the image name matches `build-image.sh --name`; the packer's scrub. |
| `test_say_hook.sh` | `say()` in `bootstrap.sh` and `phone-access.sh`: posts each line to `127.0.0.1:9121/setup` only when `HM_APP_TOKEN` is set, JSON escaping, 2 s timeout, failing `curl` never fails the install, `DONE` writes `~/.hermes-mobile/installed`. |
| `test_install_routes.sh` | Static check that every install route takes Shizuku off battery limits (`dumpsys deviceidle whitelist +moe.shizuku.privileged.api`) after installing it, and that the phone-side installer does it through `rish` without failing. |
| `test_uninstall.sh` | `phone/uninstall.sh` on a fake Termux: deletes exactly the installer's paths, safe to repeat, failed backup removes nothing, backup leaves keys out unless asked, stops loops by exact PID, refuses a non-Termux `HOME`, partial states still finish. |
| `test_hm_shizuku.sh` | `phone/hm-shizuku` with fake `adb`, `curl`, `getprop` and a `rish` that fails the test if called. Covers `pair PORT CODE` (adb call, no screen, usage errors, wrong code, Android 10, no adb), start with port / scan / not paired, exit codes, the `shizuku-auto` event JSON, and that the installer has no pairing code. |
| `test_device_lock.sh` | `tools/device-lock.sh` in a temp lock folder: hold, busy (exit 75 with the holder's name), extend, only the holder releases, an expired lock is taken over, `run` releases afterwards even on failure and passes the exit code on, serials with `:`, bad arguments. |
| `test_bghost.sh` | Needs `adb`: smoke test of the background host `bg/BgHost` on an emulator or phone (token check, status, display lifecycle). Not in CI. |

**Android tests (plain JDK, no Android SDK)**

| File | What it covers |
|---|---|
| `test_devtools_guard.sh` | `android/build.sh` refuses `KEYSTORE` together with `HM_DEVTOOLS` (any value) with exit 1 before any SDK check, lets `HM_DEVTOOLS` alone through the guard, and `release.yml` has the `hm_devtools` APK check and never sets the variable. CI job `android`. No SDK needed. |
| `java-check.sh` | Compiles all of `android/src` with `javac` against Robolectric's `android-all-16.jar` (downloaded from Maven Central and cached in `~/.cache/hermes-mobile`) and a stub `R.java` generated from `res/`. Proves it compiles; builds no APK. Needs JDK 21+. Then runs `test_shizuku_keeper.sh`. CI job `android`. |
| `api-check.sh` | Runs Android lint's `NewApi`/`InlinedApi` checks on `android/src` (a copy with `<uses-sdk>` set to the minimum from `android/build.sh`, since the build passes it to `aapt2` instead of the manifest). Fails when a call above that minimum has no `Build.VERSION.SDK_INT` check. Needs the Android SDK's command-line tools (`ANDROID_HOME` or the Homebrew path). |
| `test_shizuku_keeper.sh` | `KeeperPlan.java` decisions: when the app may restart Shizuku, the notice text when it cannot, the bounded attempt schedule, the NsdManager port choice, the Termux command. |
| `test_setup_lines.sh` | `SetupLines.java`: token check, line filter, 50-line buffer, FAIL/DONE handling and the JSON that `say()` posts. CI job `android`. |
| `test_autostart.sh` | `Autostart.java`: which makers get the step, every maker has a page list, every package the table opens is in the manifest `<queries>` (Android 11+ hides other packages otherwise). CI job `android`. |

**Battery tools (`tools/battery/`, a folder)**: `bench.py` (idle / chat / cron benchmarks and a `report` mode; method in `docs/battery-report.md`), `hmsamp.sh` (sampler run as the adb shell user: wake lock and `/proc` ticks per process and thread), `hmreport.py` (summarises a sampler capture), `hmnet.sh` (network bytes per UID), `reqcost.py` (CPU cost of one request to the dashboard), `wschat.py` (one benchmark chat turn over the gateway WebSocket, then deletes the chat).
