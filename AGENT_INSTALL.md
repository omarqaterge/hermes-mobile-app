# Install Hermes on an Android phone: instructions for an AI agent

**Human:** plug your phone into your computer and give your coding agent (Claude Code, Codex, Cursor, Gemini CLI…) this prompt:

```text
Read https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/AGENT_INSTALL.md and follow it to set up Hermes on my Android phone.
```

Everything below is for the agent.

---

## Your job

Set up, on the user's Android phone, from their computer (macOS, Windows or Linux) over `adb`:

1. **Termux** (a Linux terminal app) with **Debian** inside it (proot-distro).
2. **Hermes Agent** (github.com/NousResearch/hermes-agent) inside Debian, with a model the user chooses.
3. **Hermes Mobile** (this repo): the Hermes plugin, a supervisor script, and the Android app.

You drive the phone with `adb`: install apps, change a few settings, and type commands into Termux with
`adb shell input text`. The phone-side work is one script, [`phone/bootstrap.sh`](phone/bootstrap.sh), which reports its
progress to Android's log, so you can follow it with `adb logcat` without seeing the screen.

**Total time:** 20-45 minutes, mostly waiting for downloads and builds on the phone.

### Rules

- Tell the user what you are about to do before each numbered step, in one line. Don't ask "continue?" between steps.
- **Ask first** before: uninstalling anything, changing an existing Termux install, or anything not in this file.
- **API keys:** ask the user for the key in chat, use it only in the one command in step 7, and never repeat it, write it to a
  file on the computer, or put it in a URL.
- The phone must stay **unlocked with Termux in front** while you type into it. If a typed command doesn't show up in the log,
  check the screen first (`adb shell dumpsys window | grep mCurrentFocus`) before retrying.
- On **Windows**, run the commands in PowerShell; they work as written (use `curl.exe`, not `curl`, which is an alias there).
- When something fails, read the log (step 6 says how), fix the cause, and re-run: every step is safe to repeat.

## 1. Get `adb` on the computer

Check `adb version`. If it is missing:

| OS | Install |
|---|---|
| macOS | `brew install android-platform-tools` (or the zip below) |
| Linux | `sudo apt install adb` / `sudo dnf install android-tools` / `sudo pacman -S android-tools` (or the zip) |
| Windows | `winget install Google.PlatformTools` (or the zip) |
| Any | Download https://dl.google.com/android/repository/platform-tools-latest-{darwin,linux,windows}.zip, unzip, use `platform-tools/adb` |

## 2. Connect the phone

Ask the user to:

1. Open **Settings → About phone** and tap **Build number** 7 times (on Xiaomi: **MIUI/OS version**) to unlock Developer options.
2. In **Developer options** turn on **USB debugging**. On **Xiaomi/HyperOS** also turn on **Install via USB** and
   **USB debugging (Security settings)**; without the latter, typing into Termux fails with `INJECT_EVENTS` errors.
3. Plug the phone in and tap **Allow** on the "Allow USB debugging?" prompt (tick "Always allow").

Then `adb devices` must show one device as `device` (`unauthorized` = the prompt wasn't accepted yet; nothing listed = try another
cable/port). If several are listed, pick one and pass `-s <serial>` to every adb command (or set `ANDROID_SERIAL`).

No cable? Android 11+: Developer options → **Wireless debugging** → *Pair device with pairing code*, then
`adb pair <ip:port> <code>` and `adb connect <ip:port>` (the port on the Wireless debugging screen, not the pairing one).

Check the phone fits:

```bash
adb shell getprop ro.product.cpu.abi
adb shell getprop ro.build.version.sdk
adb shell df -h /data
```

Needs `arm64-v8a`, SDK ≥ 26 (Android 8), and at least **6 GB** free. Stop and tell the user if not.

## 3. Install Termux (and Termux:Boot)

Check what is there: `adb shell pm list packages com.termux`.

- **Not installed:** download the current builds from F-Droid and install them. Find the version code with
  `https://f-droid.org/api/v1/packages/com.termux` (field `suggestedVersionCode`), then:

  ```bash
  curl -fL -o termux.apk https://f-droid.org/repo/com.termux_<suggestedVersionCode>.apk
  curl -fL -o termux-boot.apk https://f-droid.org/repo/com.termux.boot_<its suggestedVersionCode>.apk
  adb install termux.apk
  adb install termux-boot.apk
  ```

  (Termux is ~110 MB.) Termux:Boot is optional: it restarts Hermes after a phone reboot. Android only lets it do that
  after it was opened once: `adb shell am start -n com.termux.boot/.BootActivity`.
- **Already installed:** check `adb shell dumpsys package com.termux | grep versionName`. 0.118 or newer is fine, use it as is.
  Older (e.g. 0.101 from the Play Store) is broken: ask the user before uninstalling it, because that deletes everything in it.
  Termux:Boot must come from the same source as Termux (F-Droid with F-Droid).

## 4. Prepare Android

```bash
adb shell svc power stayon true
adb shell cmd appops set com.termux RUN_ANY_IN_BACKGROUND allow
adb shell dumpsys deviceidle whitelist +com.termux
```

Keeps the screen on during the install (undone in step 9) and stops Android from killing Termux in the background.

Android 12+ also kills apps with "too many" child processes ("[Process completed (signal 9)]" in Termux), which breaks the
install. Turn that off (SDK ≥ 31):

```bash
adb shell device_config set_sync_disabled_for_tests persistent
adb shell device_config put activity_manager max_phantom_processes 2147483647
adb shell settings put global settings_enable_monitor_phantom_procs false
```

(The last line only exists on Android 14+; an error from it on older versions is fine.)

## 5. Start Termux and run the installer

Open Termux once so it unpacks itself (~30 s, needs internet):

```bash
adb shell am start -n com.termux/.app.TermuxActivity
```

**How to type into Termux.** `adb shell input text` types into whatever is in front. Spaces must be written as `%s`, and the
whole text goes in single quotes inside double quotes so the phone's shell passes `&&`, `|`, `$` through untouched. Avoid `'`
and `%` in typed text. Press Enter with `adb shell input keyevent 66`. Example:

```bash
adb shell "input text 'echo%shello%s&&%sls'"
adb shell input keyevent 66
```

**Wait until Termux is ready**: clear the log, type a probe, and check it arrived; repeat every 10 s for up to 3 minutes:

```bash
adb logcat -c
adb shell "input text '/system/bin/log%s-t%shmsetup%sready'"
adb shell input keyevent 66
adb logcat -d -s 'hmsetup:*'
```

Once `ready` shows up, type the installer (one line):

```bash
adb shell "input text 'curl%s-fsSL%shttps://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/phone/bootstrap.sh%s-o%shm.sh%s&&%sbash%shm.sh'"
adb shell input keyevent 66
```

## 6. Follow the installer

```bash
adb logcat -d -s 'hmsetup:*'
```

Run that every 30-60 s (`-d` prints and exits; don't leave `adb logcat` streaming). Lines look like `HMSETUP STEP <name> …`.
Steps: `packages` → `debian` → `hermes` (the long one, 10-30 min) → `plugin` → `start`, then **`HMSETUP DONE`**.

**`HMSETUP FAIL <step> (line N)`:** the real error is on the Termux screen. Read it with a screenshot
(`adb exec-out screencap -p > screen.png`), or scroll back in Termux. Common causes:

| Failure | Fix |
|---|---|
| any step, "Could not resolve host" / timeouts | Phone has no internet, or a flaky mirror: type `termux-change-repo`, pick another mirror, re-run `bash hm.sh` |
| `[Process completed (signal 9)]` | Phantom process killer: do the step 4 commands, open a new Termux session (`exit`, reopen), re-run `bash hm.sh` |
| `hermes` | Hermes's own installer failed. The output above names the stage; fix it inside Debian (`proot-distro login debian`), then re-run `bash hm.sh` |
| `start` (dashboard not answering) | Look at `~/logs/dashboard.log` in Termux (`tail -50 ~/logs/dashboard.log`) |

To re-run, type `bash hm.sh` + Enter. It skips what is done.

## 7. Choose the model

Ask the user which provider they want and for its API key. Easy default: **OpenRouter** (one key, every model,
https://openrouter.ai/keys). Others: `anthropic` (`ANTHROPIC_API_KEY`), `openai` (`OPENAI_API_KEY`), `gemini`
(`GEMINI_API_KEY`, has a free tier), `deepseek` (`DEEPSEEK_API_KEY`). Model ids are the provider's own, e.g.
`anthropic/claude-sonnet-5-5` on OpenRouter. Then type (with the real values):

```bash
adb logcat -c
adb shell "input text 'bash%shm.sh%smodel%sopenrouter%santhropic/claude-sonnet-5-5%sOPENROUTER_API_KEY=<key>'"
adb shell input keyevent 66
```

Wait for `HMSETUP MODEL SET` in the log. Then wipe the key from the screen and Termux's history:

```bash
adb shell "input text 'history%s-c%s&&%sclear'"
adb shell input keyevent 66
```

The user can change models and keys later in the app (Settings → Default models / API keys), or sign in with an account-based
provider instead (inside Debian: `hermes model`).

## 8. Install the app

```bash
curl -fL -o hermes-mobile.apk https://github.com/omarqaterge/hermes-mobile-app/releases/latest/download/hermes-mobile.apk
adb install -r hermes-mobile.apk
adb shell pm grant com.omarqaterge.hermesmobile com.termux.permission.RUN_COMMAND
adb shell pm grant com.omarqaterge.hermesmobile android.permission.POST_NOTIFICATIONS
adb shell dumpsys deviceidle whitelist +com.omarqaterge.hermesmobile
adb shell am start -n com.omarqaterge.hermesmobile/.MainActivity
```

`INSTALL_FAILED_UPDATE_INCOMPATIBLE` means an older self-built copy is installed: ask the user before uninstalling it
(`adb uninstall com.omarqaterge.hermesmobile`).

## 9. Check it works, then clean up

1. The app should show the chat screen within a minute, not "Hermes is offline". If it does show offline, it opens a
   **Setup check** screen by itself: take a screenshot and fix what it marks red.
2. Ask the user to send "hi" in the app. A streamed answer means the install is complete.
3. Put the phone back:

   ```bash
   adb shell svc power stayon false
   ```

4. Tell the user, briefly:
   - On **Xiaomi/HyperOS** also turn on **Autostart** for Termux and Hermes Mobile (Settings → Apps), or Android may still stop them.
   - The **Termux notification must stay**: Hermes runs inside Termux.
   - Hermes Mobile can be the phone's assistant (long-press power opens voice chat): Settings → Default apps → Digital assistant app.
   - Updating later: in Termux, `bash hm.sh` (phone side) and install the newer APK from the Releases page.
5. Delete the downloaded `.apk` files from the computer.

Report to the user what was installed, the model, and anything you skipped or that didn't work.
