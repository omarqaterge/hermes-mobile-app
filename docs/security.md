# Privacy and security, in detail

The [README](../README.md#privacy-and-security) has the summary. This page has all of it.

An agent with a Linux shell, your apps and, if you allow it, your messages deserves hard questions. This page answers
them in plain words first and then in detail for people who want to check. It also lists what Hermux does **not**
protect you from, because a safety claim with no limits is not one. Everything here comes from the code and the
[spec](SPEC.md); CI fails when the code has a name the spec doesn't mention.

## The short version

| You might ask | The answer |
|---|---|
| Where is my data? | On your phone. Hermes keeps your chats, memory, files and keys inside Termux's private storage, and the app keeps its own data in the app's private storage; other apps can't read either. There is no Hermux account and no Hermux server that sees your chats. Android's cloud backup is off for the app (`allowBackup="false"`); Termux has its own backup setting, which Hermux doesn't control. |
| What leaves the phone? | Your messages, and whatever the agent reads in that chat, go to **the model provider you chose**. A few other things connect to the internet too: [the full list is below](#everything-the-phone-connects-to). |
| Does it track me? | The app has no analytics or crash-reporting library. The one stats call (to Aptabase) is off until you say yes and never carries chats, prompts, files, names or phone numbers; you can read it in `web/src/stats.ts`. |
| Can it read my messages, contacts or location? | Not unless you switch it on in Settings → Phone data for the agent. Everything starts off, turning a kind on asks for your fingerprint or screen lock, and every read asks first (not in Full access, and Auto access refuses to read). [More below](#phone-data-off-until-you-switch-it-on). |
| Can other apps on my phone talk to it? | Hermes, the app's event port and the Shizuku helper listen on the phone's loopback address (`127.0.0.1`) only, but any app can connect to loopback, so each needs a secret. Hermes's dashboard gives out its token only to a caller holding the key in `~/.hermes-mobile/key`, a file only Termux's user can read; the app's event port takes the same key; the Shizuku helper has its own token. The limits of this are listed [below](#what-hermux-cannot-protect-you-from). |
| Can I check this? | Yes. The source is MIT-licensed, and the spec lists every permission, port, bridge call and route. [Check it yourself](#check-it-yourself). |

## Everything the phone connects to

- **Your model provider,** over HTTPS (unless you add a plain-`http` custom endpoint yourself, such as a model on your
  own network). Hermes inside Termux makes these calls, and they carry your messages and what the agent reads in that chat.
- **Tools you switch on:** web search, MCP servers and other connectors talk to their own services. The agent's
  terminal and web tools can reach any host if you let them.
- **GitHub:** a check for a new release, and the update download if you tap install. Like any web request, it shows your
  IP address.
- **Setup downloads:** the helper apps from F-Droid and GitHub, the Debian system, Python and npm packages, and the
  speech models if you choose offline dictation (from Hugging Face).
- **What replies point to:** an image, video or sound from the web that a reply links to is not fetched until you tap
  it, in every chat (a web address can carry out what the agent has read, and a web page the agent reads could tell it
  to write one). YouTube thumbnails load before you tap play. Pictures drawn by cards wait for a tap on "Load images"
  under the card, and in a chat that has read phone data they don't load at all.
- **Dictation** can use Android's own speech recogniser, which may be cloud-based, if you don't use the offline models.
- **Usage stats,** only if you opt in, to Aptabase. **A problem report,** only when you send one; reports are public GitHub
  issues.

[docs/privacy.md](privacy.md) has the wording for each.

## What the agent can do on your phone

| | What it means | Who decides |
|---|---|---|
| **Run commands** | Hermes works in a Linux (Debian) system inside Termux, as the Termux user. It can read and change what Termux can: its own files and keys, and shared storage if you gave Termux that. | You, per chat: **Off** holds commands Hermes recognises as risky (recursive deletes, overwriting system or config files, force-killing processes, piping downloads into a shell…) for your approval; **Auto access** blocks that list and runs the rest; **Full access** asks nothing. New chats start in Off unless you changed "Auto for all chats". |
| **Use your other apps** | It opens an app on a hidden screen, reads it, taps and types, and you can watch or take over. Needs Android 14+ and Shizuku. | In Off mode it asks once per app per chat. Apps whose names look like banking, payment, password or 2FA apps are blocked until you allow them (a best-effort name match), and changing that setting asks for your fingerprint or screen lock each time. |
| **Read phone data** | Contacts, calendar, call log, messages, approximate location, photo details. Read only. | You: every kind is off until you switch it on, and every read asks first (not in Full access). |
| **Act as `adb shell`** | With Shizuku it can capture the screen, tap in any app, change settings, install and inspect apps, grant permissions and read logs, as `adb shell` can. That is not root, but it is far more than a normal app. **Shizuku is required** by Hermux. | You, when you set Shizuku up; after that Hermux keeps it running, restarting it after a reboot by switching Wireless debugging on. It is the largest thing you are trusting. |

## Phone data (off until you switch it on)

- **Off by default,** one switch per kind (contacts, calendar, call log, messages, approximate location, latest photos)
  and a master switch. Turning one on asks for your fingerprint or screen lock, then for the Android permission, which
  Hermux asks for only at that moment. A phone with no screen lock can't turn it on. Turning it off is instant.
- **Read only.** The app declares no permission to send messages, write contacts or calendar, or use precise location.
  Photos give date, size and dimensions, never the picture. Location is about 1 km coarse.
- **Every read asks.** A card says in the app's own words what will be read, with only **Allow once** or **Deny**. The
  agent can't write that wording. The first Allow in a chat asks for your fingerprint or screen lock (a setting that is
  on by default). A locked phone is refused. **Full access skips the question by design,** and Auto access refuses to read.
- **Capped and labelled.** At most 50 rows and 16 KB per read; the result is marked as data, not instructions.
- **Extra care after a read.** Web images need a tap in every chat; in a chat that has read your data, cards' pictures
  are held back too, links show their full address first, and the agent's commands and tools that could send data out ask first (not in Full or Auto access, where
  Hermes's own gate approves without asking).
- **Where it goes.** What the agent reads becomes part of the chat: it goes to your model provider, and stays in the
  chat history and in Hermes's own session files on the phone. Hermux never writes names, numbers, message text or
  coordinates to its own logs or reports.

[Privacy](privacy.md) has the full text and its limits.

## Guard rails, and where to see them

- **Content can't call the app.** Every call from the page into Android needs a key that changes on each page load.
  Canvas pages run in a sandboxed frame with no access to the app, offline unless you switch them online. Cards are
  drawn by the app and can only call read-only tools ([security model](spec/02-03-security-model.md)).
- **Chat text is sanitised.** Markdown from the model passes `rehype-sanitize`.
- **Remote debugging is off by default.** Turning it on needs Android's Developer options and your screen lock, and it
  switches itself off after an hour.
- **Local servers prove who they are.** Hermux, the plugin and the phone's helper scripts check that the local server they
  talk to holds the shared key before they send it anything, and sign every request; the key itself is never sent. The
  background app host takes a new port each time it starts and answers only signed requests
  ([security model](spec/02-03-security-model.md)).
- **Approvals follow you.** A locked phone asks you to unlock before it allows anything, and, by default, the first Allow
  in a chat asks for your fingerprint or screen lock.
- **Updates are checked.** Release APKs are built by the public workflow in `.github/workflows/release.yml` and signed
  with a key held as a repository secret. Android asks you to confirm each install. The plugin that updates with the app
  is checked against a SHA-256 inside the signed APK before anything is unpacked.
- **Its own logs stay clean.** The diagnostic log is checked against a fixed shape when written, so messages, tool data,
  paths and chat IDs can't get in; it leaves the phone only in a report you submit.
- **Few permissions, all explained.** The app declares no accessibility service, no device admin, no "draw over other
  apps" permission, and no permission to send SMS, write contacts, use the camera or use precise location:

| What | Permissions | Why |
|---|---|---|
| Notifications and the service | `POST_NOTIFICATIONS`, `POST_PROMOTED_NOTIFICATIONS`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`, `RECEIVE_BOOT_COMPLETED`, `VIBRATE` | Approvals, questions and replies with the app closed; the service restarts after a reboot. |
| Talk to Termux | `com.termux.permission.RUN_COMMAND` | Start Hermes in Termux. Termux must also allow external apps. |
| Fingerprint | `USE_BIOMETRIC` | Confirm the first Allow in a chat. |
| Voice | `RECORD_AUDIO` | Dictation and Live mode; asked on first use. |
| Battery | `WAKE_LOCK` (held only while it works, while an approval waits and around a due job), `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `USE_EXACT_ALARM` | Scheduled jobs and the setup prompt for background running. |
| Install and remove | `REQUEST_INSTALL_PACKAGES`, `REQUEST_DELETE_PACKAGES` | Updates and the helper apps; Android shows its own dialog each time. |
| Shizuku support | `ACCESS_NETWORK_STATE`, `WRITE_SECURE_SETTINGS`, `moe.shizuku.manager.permission.API_V23` | Restart Shizuku after a reboot by switching Wireless debugging on. `WRITE_SECURE_SETTINGS` is never asked for in a dialog: only adb or Shizuku can grant it. `API_V23` is only listed so Shizuku can find the app. |
| Network | `INTERNET` | Loopback to Hermes and everything in [the list above](#everything-the-phone-connects-to) that the app itself does. Model calls are made by Hermes inside Termux. |
| Phone data | `READ_CONTACTS`, `READ_CALENDAR`, `READ_CALL_LOG`, `READ_SMS`, `ACCESS_COARSE_LOCATION`, `READ_MEDIA_IMAGES` (`READ_EXTERNAL_STORAGE` before Android 13) | Only when you switch the matching kind on, never at start-up. |

The full table, with the code that uses each one, is in [spec 4.2](spec/04-02-manifest-components-and-permissions.md).

## What Hermux cannot protect you from

- **Your model provider sees what you send it,** including anything the agent reads in that chat. Choose a provider you
  trust. Hermux can't make that call private, and it has no offline model yet.
- **Approvals guard against a careless agent, not against code already running as Termux.** The agent runs as the
  Termux user, so it can read the keys Hermes uses, including the app's event key, and edit Hermes's settings, including
  its approval mode. Even in Off mode only commands Hermes recognises as risky are held for approval; the rest run. In
  Full access nothing asks.
- **Text it reads can try to steer it.** A web page, a file or a message from a stranger can contain instructions
  (prompt injection). Hermux marks phone data as untrusted, limits it and adds extra care after a read, but no one can
  make a model immune.
- **Shizuku is a wide door.** The switches and questions protect the phone data tool; they can't stop an agent that
  uses its Shizuku access to read, tap Allow or change settings on its own. To restart Shizuku, Hermux keeps Wireless
  debugging paired with `adb` on the phone, which the phone itself can reach.
- **Termux:API acts under its own permissions.** Setup installs it. What its commands can do (send an SMS, take a
  photo, read the location) depends on the Android permissions you give *Termux:API*, which Hermux's switches don't
  control. Give it only what you want the agent to have.
- **The sensitive-app block is a list,** a best-effort match on app names for the tool that drives apps, kept in a
  file the agent could edit.
- **Some protections are speed bumps.** The plugin's checks of commands are patterns, and the agent can rewrite plugin
  files; for phone data, the app's own record, filter and dialogs are what enforce the rules.
- **Other apps on the phone.** The token and key protections above can be missing on an old plugin (it still hands out the
  token until it is updated). If you install OpenSSH in Termux, its server listens on all interfaces
  ([decision](decisions/ssh-on-all-interfaces.md)). Pictures you save to `Pictures/Hermux` can be seen by other apps that
  may read your photos, and files in `Download` (such as an uninstall backup) by apps you have allowed to see all files.
- **Notifications can show text on the lock screen.** Approval and reply notifications can, except approvals for phone
  data, which show nothing. Use Android's lock-screen notification setting to hide content.
- **The install command trusts what it downloads.** It fetches a script from this repository's `main` branch, which is
  not pinned or verified, and installs Debian, Python and npm packages. Read it before you run it
  ([install guide](install.md)); you can also [build the app yourself](../README.md#build-from-source).
- **Hermes's own files are outside Hermux.** Chat history, session files and logs kept by Hermes hold chat text.
  They are protected by Android's app sandbox and your phone's storage encryption.
- **It is a community project.** Hermux is unofficial and has a single maintainer, and no independent security audit is
  published for it. The newest features have been tested on one real phone (Android 16); older Android is not yet
  tested (see [Android versions](android-versions.md)).

## Check it yourself

```bash
# what the app asks Android for
aapt2 dump permissions hermux.apk
# what the installed app holds right now
adb shell dumpsys package com.omarqaterge.hermesmobile | grep -E "permission|granted"
```

- Every process, port and who may talk to it: [spec 2.1](spec/02-01-processes-and-ports.md). The security model
  and its reasons: [spec 2.3](spec/02-03-security-model.md). Where each decision came from:
  [docs/decisions](decisions/README.md).
- Plain `http` is allowed to loopback only, for the app itself; it is one short file:
  `android/res/xml/network_security_config.xml`.
- Build it yourself instead of trusting the release: [Build the app yourself](../README.md#build-from-source).
- Found a vulnerability? Please read [SECURITY.md](../SECURITY.md) before posting details in public.
