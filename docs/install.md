# Installing Hermes Mobile: the full guide

The [README](../README.md#install) has the short version. This page has every step, the rooted-phone option, fixes for
common problems, and how to uninstall.

- [What you need](#what-you-need)
- [On the phone, no computer (Android 11+)](#on-the-phone-no-computer-android-11)
- [From a computer (Mac, Windows, Linux)](#from-a-computer-mac-windows-linux)
- [Rooted or not](#rooted-or-not)
- [After installing](#after-installing)
- [If something goes wrong](#if-something-goes-wrong)
- [Uninstall](#uninstall)

## What you need

**No root needed.** Hermes Mobile runs on an ordinary phone with a locked bootloader. A rooted phone works too; the
differences are how Shizuku starts and, if you like, running Debian with chroot-distro (see [Rooted or not](#rooted-or-not)).

You need an Android phone (arm64, Android 8+) with about 6 GB free, and access to a model, either of:

- **A subscription you already have:** ChatGPT Plus / Pro (or a Codex plan), Claude Pro / Max, SuperGrok / X Premium+, or a Nous
  Portal account. You sign in from the app.
- **An API key:** for example [OpenRouter](https://openrouter.ai/keys) (one key for every model), Anthropic, OpenAI or Gemini
  (has a free tier).

Sort this out before you start: the install ends by asking for it. A subscription needs only your login. An API key is a long
code you create on the provider's website (sign in, open its *API keys* page, create one and copy it); you pay that provider per use.

These apps get installed. Hermes needs all of them to run and to use your phone:

| App | What it is for |
|---|---|
| [Termux](https://f-droid.org/packages/com.termux/) | Linux on the phone: Hermes runs in Debian inside it |
| [Termux:API](https://f-droid.org/packages/com.termux.api/) | Lets Hermes use the phone: battery, location, clipboard, notifications, SMS, camera… |
| [Termux:Boot](https://f-droid.org/packages/com.termux.boot/) | Starts Hermes again after the phone restarts |
| [Shizuku](https://shizuku.rikka.app/download/) | Gives Hermes the access adb has, without root: screenshots, taps, apps, logs |
| Hermes Mobile | This app |

Get the three Termux apps from **F-Droid**, all three: the Play Store builds are outdated and can't be mixed with F-Droid ones.

The install takes 15-40 minutes, mostly waiting.

## On the phone, no computer (Android 11+)

Install only Hermes Mobile; the app walks you through the rest and picks up wherever you stopped.

1. Download **hermes-mobile.apk** from the [latest release](https://github.com/omarqaterge/hermes-mobile-app/releases/latest) on
   the phone, install it and open it (allow your browser to *install unknown apps* if Android asks).
2. **Get the helper apps:** tap **Install all**. Android first asks you to allow Hermes Mobile to *install unknown apps*: turn
   the switch on and go back. Then tap **Install** on Android's prompt for each app: Termux, Termux:API and Termux:Boot (from
   F-Droid) and Shizuku (from GitHub). Each app row links to its official page (F-Droid or Shizuku's releases) if you prefer to
   install it yourself; the Termux apps must all come from F-Droid. The app checks that each one comes from its maker before
   installing it.
3. **Start Shizuku** (needed, there is no skip): it keeps Android from stopping the long install ("signal 9")
   and gives Hermes the screen, taps and apps. Turn on Developer options (Settings → About phone → tap *Build number* 7 times; on some phones
   it is under *Software information* or called *OS version*), connect to Wi-Fi, which Wireless debugging needs (Shizuku uses
   Android's own wireless debugging to start itself without a computer or root; it is local only), then open Shizuku, tap
   *Pairing* and follow its steps (Developer options → Wireless debugging → *Pair device with pairing code*, then type the code
   into Shizuku's notification), and tap *Start*. Rooted: just tap *Start* in Shizuku. On Android 10 and older there is no
   Wireless debugging: Shizuku is started from a computer (run the Hermes Mobile setup script, or follow
   [Shizuku's guide](https://shizuku.rikka.app/guide/setup/)). If Shizuku was already running before you opened the app, tap
   *Shizuku is running: continue*; Setup check still verifies it after the install.
4. Allow Hermes Mobile to *run commands in Termux* when Android asks.
5. **Run the installer:** tap **Copy the command**, then **Open Termux**. In Termux, long-press, tap **Paste**, then press Enter.
   Stay in Termux and tap **Allow** on what it asks (notifications, running in the background, files; Shizuku: **Allow all the
   time**). The app follows the install step by step; it takes 10-40 minutes, mostly waiting (shorter when a ready-made Debian +
   Hermes is available for this version: the installer downloads it, about 900 MB, and falls back to the normal install by
   itself otherwise). Keep the screen on. If it stops, the app says where: paste the same command again (finished parts are
   skipped).
6. Back in the app: **Connect Hermes to a model**. Sign in with your subscription or paste an API key, then pick the model new
   chats use. You can change all of this later in **Settings → Subscriptions & accounts / API keys / Default models**.

   ChatGPT, Claude, Grok and Nous Portal sign in inside the app. For Claude, tap **Open claude.ai**, approve, and paste the code
   Claude shows back into the app (it runs the same login as `hermes auth add anthropic`; **Use Termux instead** does it there).

### Without the app's help (by hand in Termux)

Install Termux, Termux:API and Termux:Boot from F-Droid (open Termux:Boot once) and Shizuku, start Shizuku as in step 3, then
paste this in Termux:

```bash
curl -fsSL https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/phone/bootstrap.sh -o hm.sh && bash hm.sh
```

Keep Termux open until it prints `HMSETUP DONE`; `HMSETUP TODO` lines just above it say what is still missing. At the end
Android's installer opens for Hermes Mobile: tap **Install** (pick *Package installer* if asked; allow Termux to *install unknown
apps* if it blocks it).

## From a computer (Mac, Windows, Linux)

Also the route for Android 8-10. Turn on **USB debugging** on the phone (Settings → About phone → tap *Build
number* 7 times, then Developer options → USB debugging), plug it in and run:

```bash
# Mac / Linux
curl -fsSL https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/tools/setup-phone.sh -o setup-phone.sh && bash setup-phone.sh
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/tools/setup-phone.ps1 | iex
```

It installs all five apps, gives them their permissions and starts Shizuku over USB. When Shizuku asks whether Termux may use it,
tap **Allow all the time**. At the end it offers to set an API key; press Enter to skip it and connect a subscription or key in the
app instead.

**Stuck, or rather not do it yourself?** Give your AI coding agent (Claude Code, Codex, Cursor…) this prompt. It runs the same
script and fixes what goes wrong:

```text
Read https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/AGENT_INSTALL.md and follow it to set up Hermes on my Android phone.
```

> Tested end to end on a clean Android 15 emulator and piece by piece on a real phone, but not yet on a brand-new real phone.
> If something fails, please [open an issue](https://github.com/omarqaterge/hermes-mobile-app/issues).

## Rooted or not

Everything is the same except Shizuku, which Android stops whenever the phone restarts:

| | Not rooted, Android 11+ (most phones) | Not rooted, Android 8-10 | Rooted |
|---|---|---|---|
| First start | *Start via Wireless debugging* in Shizuku, or the computer route does it over USB | The computer route (over USB) | *Start* in Shizuku |
| After a restart or if Shizuku stops | Hermes Mobile starts it again by itself once the phone is on Wi-Fi (see below) | From a computer, with the command Shizuku shows under *Start by connecting to a computer* | Shizuku starts itself |

How it starts by itself without root: the installer gives Termux its own adb (`android-tools`) and pairs it once with the phone's
Wireless debugging (`~/bin/hm-shizuku pair`, run by the installer: Settings opens for a few seconds and the pairing code is read
from the screen). When Shizuku is down and the phone is on Wi-Fi, Hermes Mobile turns Wireless debugging on (the installer
grants it `WRITE_SECURE_SETTINGS` for this), runs `~/bin/hm-shizuku start` in Termux, which starts Shizuku's server the same
way its own *Start by connecting to a computer* does, and turns Wireless debugging off again if it was off. Everything stays on
the phone. The first time on a new Wi-Fi Android asks *Allow wireless debugging on this network?*: tick *Always allow on this
network* and tap *Allow*. Without Wi-Fi it waits until the phone is on Wi-Fi. If pairing didn't work (no Wi-Fi during the
install, or a Settings screen that looks different from Android's own), Setup check shows *Shizuku starts by itself* with a
*Set up* button that runs the pairing again. Shizuku forgets that Termux may use it each time its server starts again
(seen on the emulator with Shizuku 13.6.0), so it asks *Allow Termux to access Shizuku?* the next time Hermes uses it: tap
*Allow all the time*. Pairing and starting were tested on an Android 15 emulator, not yet on other phone makers' Settings.

Until Shizuku runs, Hermes can still do everything except see and touch the screen and other apps; it tells you when it needs
Shizuku, and the app's **Setup check** shows it too.

**Is it worth rooting a phone for Hermes?** For most people, no. Shizuku already gives Hermes what adb can do: screenshots, taps
and typing, opening and installing apps, logs and most settings. Root adds:

- **Speed:** Debian can run under chroot-distro (below) instead of proot, which slows down every file and process call. Hermes
  starts and runs tools faster and uses a bit less battery (not measured on a real phone yet).
- **No Shizuku restarts:** Shizuku starts itself after a reboot, no Wi-Fi or Wireless debugging needed.
- **Other apps' private data:** Hermes could read what apps keep to themselves (for example a messenger's database).
- **System-level control:** firewall rules, stopping any process, protected settings and system files.

What it costs:

- **Risk:** under chroot, Hermes runs as the phone's real root user. A bad command or a malicious web page that tricks the
  model can read or wipe anything, or break the phone. Without root, the worst it can do is what adb can do.
- **Apps that refuse rooted phones:** banking apps, Google Wallet and some games check for root.
- **Rooting itself:** unlocking the bootloader wipes the phone (some makers, like Xiaomi, also make you wait), and system
  updates get harder.

If your phone is already rooted, chroot-distro is an easy speed-up, with the risk above. Don't root a phone just for Hermes.

**Rooted: Debian with chroot-distro (optional).** By default Debian runs under proot-distro, which needs no root. On a rooted
phone it can run under [chroot-distro](https://github.com/sabamdarif/chroot-distro) instead, at native speed: put
`HM_DISTRO=chroot` in front of the install command (`HM_DISTRO=chroot bash hm.sh` in Termux, or
`HM_DISTRO=chroot bash setup-phone.sh` from a computer) and tap **Grant** when your root manager asks about Termux. The installer
adds chroot-distro (`pip install chroot-distro`) and Debian 13 (`chroot-distro install --name debian debian:trixie`); a
chroot-distro container already named `debian` is used as it is. The choice is remembered, so later runs of `bash hm.sh` and the
app use the same Debian. To get a shell in it yourself, type `~/bin/hermes-debian` in Termux (it works for both).
Shizuku is still needed for the screen and other apps (rooted: *Start* in Shizuku). Moving an existing proot-distro install
over is not automatic.

## After installing

- Set **battery to Unrestricted** for *Hermes Mobile*, *Termux* and *Shizuku* (Xiaomi/HyperOS: also turn on *Autostart*), or
  Android may stop them. The computer setup script and the installer already take Shizuku off the battery limits; Setup check
  has a step for it if that did not work (Shizuku's app info → Battery).
- Keep the Termux notification: Hermes runs inside Termux.
- To update, run the same command again and install the newest APK.

## If something goes wrong

Open **Settings → Setup check** in the app first: it shows what's missing, with a button for each fix.

| What you see | Fix |
|---|---|
| "Hermes is offline" for more than a minute | In Termux run `~/bin/hermes-services`, then tap Reconnect in the app |
| `[Process completed (signal 9)]` in Termux during the install | Android stopped it. Android 14+: Developer options → *Disable child process restrictions* (the computer route does this for you, and so does the phone-only install when Shizuku is running). Then run `bash hm.sh` again |
| The install stops with `HMSETUP FAIL <step>` | Read the error above it, fix it and run `bash hm.sh` again; finished parts are skipped. [AGENT_INSTALL.md](../AGENT_INSTALL.md) lists the usual causes |
| No status chip, canvas or approvals | Run `bash hm.sh` again (it re-enables the plugin) |
| The installer says `No plugin named 'hermes-mobile'` | You switched Hermes to another profile (`hermes profile use`). Update to the newest installer and run it again: it adds the plugin to every profile |
| Everything stops after a while | Battery is restricted, see [After installing](#after-installing) |
| Hermes says Shizuku isn't running | The phone restarted: see [Rooted or not](#rooted-or-not) |
| Shizuku doesn't come back after a restart | The phone must be on Wi-Fi. On a new Wi-Fi, tap *Allow* (with *Always allow on this network*) when Android asks about wireless debugging. Still not: Hermes Mobile → Setup check → *Shizuku starts by itself* → *Set up* (pairs again; Settings opens for a few seconds). In Termux, `~/bin/hm-shizuku status` says `paired` or `unpaired` and `~/.hermes-mobile/hm-shizuku.log` has the last attempts. Android 10 and older: start it from a computer |
| Hermes can't read your files | Setup check → *Hermes can use your files* → Allow, then Restart Hermes |
| Termux:API won't install | Termux and Termux:API come from different stores. Install both from F-Droid |

## Uninstall

In the app: **Settings → Danger zone → Uninstall Hermes**. It lists what goes, offers a backup, asks you to type `uninstall`, then
removes Hermes with all chats, memory, skills, settings and keys, Debian, the installer's files and its phone setting (inside Termux, with
`phone/uninstall.sh`). After that Android asks you to confirm each app: Termux:API, Termux:Boot, Shizuku, Termux, and Hermes Mobile last.
Removing Termux makes Android close the app; open it again and it shows the last step.

**Backup** (on by default): `Download/hermes-backup-<date>.tar.gz` with Hermes's chats (`state.db`), memory, skills, cron jobs, canvas
documents, config, profiles and this app's settings (`hermes-mobile-settings.json`); no program files, caches or logs. API keys (`.env`)
and sign-ins (`auth.json`, `*token*.json`) are left out unless you switch on *Include API keys and sign-ins*: any app that may read your
Downloads could read them. A key typed straight into `config.yaml` is not filtered. To restore on a new install, unpack it into Hermes's
folder in Debian (`~/bin/hermes-debian bash -c 'tar -xzf /sdcard/Download/hermes-backup-<date>.tar.gz -C /root/.hermes'`) and restart Hermes.

Kept: files Hermes saved to your storage (Downloads, Pictures/Hermes). The phone setting needs Shizuku running; without it Android's
child-process limit stays lifted, which is harmless (Android 14+: Developer options → *Disable child process restrictions* → off).

### By hand, without the app

In Termux: `curl -fsSL https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/phone/uninstall.sh -o un.sh && bash un.sh --backup`
(leave out `--backup` to skip the backup; add `--keys` to include keys). It is safe to run again. What it does, step by step, if you'd
rather type it yourself:

1. Stop Hermes: `kill` the PIDs in `~/logs/*.pid` (the supervisor's loops) and the dashboard (`pkill -f 'hermes dashboard --host 127.0.0.1 --port 9119'`).
2. Optional backup: copy what you want out of Debian's `/root/.hermes` (proot: `$PREFIX/var/lib/proot-distro/containers/debian/rootfs/root/.hermes`).
3. With Shizuku running: `~/bin/rish -c 'device_config delete activity_manager max_phantom_processes; device_config set_sync_disabled_for_tests none; settings delete global settings_enable_monitor_phantom_procs'`
   (the computer route did the same over `adb shell`).
4. Remove Debian: `proot-distro remove debian` (rooted, chroot-distro: `chroot-distro kill debian && chroot-distro remove debian`; never
   delete a chroot's folder by hand, it can still have the phone's storage mounted inside).
5. Remove the installer's files: `rm -rf ~/.hermes-mobile ~/bin/hermes-services ~/bin/hermes-debian ~/bin/hm-shizuku ~/bin/rish ~/bin/rish_shizuku.dex
   ~/.termux/boot/10-hermes ~/hermes-mobile ~/hermes-mobile.apk ~/hm.sh`, and the `allow-external-apps = true` line in
   `~/.termux/termux.properties`.
6. Uninstall the apps in Android's settings: Termux:API, Termux:Boot, Shizuku, Termux, Hermes Mobile. Uninstalling Termux alone also
   deletes steps 1-5 (except the phone setting of step 3) with it; on a rooted phone using chroot-distro, restart the phone first.
