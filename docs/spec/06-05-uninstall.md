### 6.5 Uninstall (`phone/uninstall.sh`)

Started by the app (Settings → Danger zone → Uninstall Hermes, through Termux's RUN_COMMAND; the app's `Uninstall` class then asks Android to remove the apps) or by hand: `bash uninstall.sh [--backup [--keys]] [--settings JSON]`. Every line it prints starts with `HMUNINSTALL ` (also sent to Android's log, tag `hmuninstall`): `STEP`, `OK`, `SKIP`, `FAIL`, `RM <path>`, `BACKUP <file>`, `DONE`. Exit 0 done, 3 stopped before removing anything, 1 something could not be removed, 2 usage. Safe to run again.

Safety: it refuses to run unless `HOME` and `PREFIX` look like Termux's (each at least two levels deep, neither inside the other), and it only deletes listed paths inside them; a symlink is removed, never what it points to.

Order:

1. **stop**: kills each `hermes-services` loop from its pid file (only if that pid is still a `hermes-services` loop; freezes it first so it cannot restart its command), then the dashboard by exact command line and any proot process of Hermes's Debian (chroot: `hermes-debian --restart`).
2. **backup** (only with `--backup`): writes `Download/hermes-backup-<date>.tar.gz` with Hermes's folder minus program files, caches and logs (`hermes-agent installs tools node vendor cache ... logs`, `*.lock`, `*.pid`, `*.log`), per profile; API keys and sign-ins (`.env`, `auth.json`, `*token*.json`, `*client_secret*.json`, `*.pem`) are left out unless `--keys`; `--settings` adds the app's `hermes-mobile-settings.json`. Verifies the archive. If anything fails, **nothing is removed** (exit 3).
3. **android**: if Shizuku answers, deletes the phantom-process settings the installer set (back to Android's defaults); otherwise a `SKIP` that says it is harmless.
4. **debian**: `proot-distro remove debian` (a half-installed one without a manifest is removed by path); chroot: `chroot-distro kill debian` then `remove`, never by hand because a chroot can have the phone's folders mounted. Removes proot-distro's cached download.
5. **files**: removes `~/.hermes-mobile`, `~/bin/hermes-services hermes-debian hm-shizuku rish rish_shizuku.dex`, the boot script `~/.termux/boot/10-hermes`, the loops' pid and log files, `hm.sh`, `hm-install.sh`, `hm-phone-access.sh`, the downloaded APK and image, `~/.cache/hermes-open`, and `~/hermes-mobile` only when its git config is this project's.
6. **termux**: last, removes `allow-external-apps = true` from `~/.termux/termux.properties` (skipped after any failure so the app can run the script again).

It does not uninstall any app: the Hermes Mobile app asks Android to remove Termux:API, Termux:Boot, Shizuku, Termux and itself last. Files Hermes saved to shared storage (Downloads, Pictures/Hermes) are kept.
