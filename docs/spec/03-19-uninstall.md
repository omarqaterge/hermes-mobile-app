### 3.19 Uninstall

**Opens from:** Settings → Danger zone → Uninstall Hermes (only inside the Android app with a shell that has the uninstall bridge); also automatically when the app starts after a cleanup already removed something (`UninstallResume`, mounted in `App.tsx`). **Closes with:** the grip, backdrop, Back, or the Cancel / Close button. **Source files:** `web/src/components/Uninstall.tsx` (`UninstallSection`, `UninstallResume`, `UninstallSheet`), `web/src/uninstall.ts` (pure step logic and the shell calls). The Termux half is `phone/uninstall.sh`, run by `Uninstall.java` (parts 4 and 6).

One flow removes Hermes, Debian, the data and chats, the installer's changes, then Termux:API, Termux:Boot, Shizuku, Termux and this app. Android asks once per app.

**Phases** (`phaseOf`):
| Phase | Shown when | Content |
|---|---|---|
| review | Nothing started yet | A list of what will be removed: Hermes with all chats, memory, skills, settings and API keys; Debian; the installer's files in Termux; the phone setting the installer changed (Android's child-process limit goes back to normal, needs Shizuku running); and each of the five apps (marked "(not installed)" when missing). A note says what is kept: files Hermes saved to the phone's storage (Downloads, Pictures/Hermes) and the backup. Section Backup (only when Termux is installed): switch "Save a backup to Downloads" (on by default; a `hermes-backup-<date>.tar.gz` of chats, memory, skills, Hermes settings and this app's settings) and, when it is on, the switch "Include API keys and sign-ins" (off by default: `.env` and `auth.json` stay out because other apps can read Downloads). Buttons: Cancel and Uninstall… |
| running | The cleanup runs in Termux | A spinner, "Removing Hermes…" and a note that the user may leave the app and come back. Button Close |
| lost | It started but never reported back (the app was closed) | A message to run it again, buttons Continue to the apps and Try again |
| failed | The Termux script ended with a non-zero exit | The step list, the reason ("Stopped before removing anything:" for exit 3, "Termux didn’t run the cleanup:" for -1, otherwise "Something could not be removed:"). Buttons: Cancel (exit 3 with nothing removed; it restarts Hermes) or Continue to the apps, and Try again |
| apps | The cleanup finished (or was skipped) | The five apps in the order Termux:API, Termux:Boot, Shizuku, Termux, Hermes Mobile, each with ✓ Removed or a button "Uninstall <name>" ("Uninstall Hermes Mobile" for this app). The next app's button is red |

Pressing Uninstall… opens a prompt: "Uninstall Hermes?", the text says what is deleted (including "(after saving the backup)" when chosen), and the user must type `uninstall`. Only then does the cleanup start (`uninstallStart` bridge call with the backup and keys choices and a settings snapshot). If the app may not run commands in Termux (`no-permission`), the sheet shows why with the buttons Allow and Skip to the apps (uninstalling Termux also deletes Debian and Hermes, but leaves the phone setting changed).

The cleanup steps, in order, as reported by the script's `HMUNINSTALL …` lines (`parseCleanup`): Stop Hermes; Backup to Downloads; Phone settings the installer changed; Debian, Hermes, chats and keys; The installer’s files in Termux; Termux taking commands from this app. Each shows ✓, – (skipped), ✕ or ·; the saved backup file name appears at the end ("Backup saved: Download/<file>"). Removing an app calls `uninstallApp(id)`, which opens Android's own uninstall screen. Uninstalling Termux before its cleanup finished asks "Uninstall Termux anyway?". Removing Termux makes Android close this app, so the last step happens after reopening it (`resumeOnStart`).
**Data:** bridge calls `uninstallStart`, `uninstallState`, `uninstallApp` and the page callback `window.hermesUninstallDone`; the app settings in the backup are the keys in `SETTINGS_KEYS` (`hm.theme`, `hm.oled`, `hm.textScale`, `hm.tts`, `hm.autoread`, `hm.autoread.chats`, `hm.favModels.v1`, `hm.customModels.v1`, `hm.live.pause`, `hm.profile`, `hm.yolo.v1`; no caches, drafts or chat data).

---
