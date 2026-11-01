## 1. What it is

Hermes Mobile is an Android chat app for the Hermes agent (NousResearch). Hermes runs on the same phone, inside
Termux → proot-distro Debian. The app gives the agent a native-feeling front end: streaming replies, thinking,
tool cards, approvals, chats and profiles, skills, memory, cron, files, projects, a canvas, cards in replies,
voice and Live mode, and notifications that keep working while the app is closed (the pinned status chip, which
Android 16 shows as a Live Update). It aims to match Hermes Desktop's behaviour wherever that makes sense on a
phone.

- **Who it is for:** anyone with an Android phone who runs (or wants to run) Hermes on it. It is built for every
  Android phone, not one maker: public/AOSP APIs come first, and vendor-specific handling (for example the
  Autostart pages in `Autostart.java`, 4.7) sits behind a generic fallback.
- **Android versions:** minimum Android 8.0 (API 26, `--min-sdk-version 26` in `android/build.sh`), target API 35,
  compiled against API 36 so Android 16 Live Update calls can be used when present. Some features need more:
  Wireless debugging (Shizuku restarting by itself) needs Android 11 (API 30), the assistant role needs API 29,
  `POST_NOTIFICATIONS` is asked from API 33, saving pictures needs API 29. The page needs an up-to-date Android
  System WebView (4.2, "Version checks").
- **No root.** Everything runs as normal apps. Hermes's adb-level phone access goes through Shizuku and its `rish`
  shell. A rooted phone may use chroot-distro instead of proot-distro (6.3); nothing in the app needs root.
- **What runs where (one line each):**
  - The **app** (`com.omarqaterge.hermesmobile`): a WebView page (the whole UI, `web/src`, built into one
    `index.html` in the APK's assets) plus a small Java shell (`MainActivity`) and a foreground service
    (`HermesService`).
  - **Termux:** the supervisor script `~/bin/hermes-services` and its restart loops, `sshd` if installed, the
    helper scripts `hm-shizuku` and `rish`.
  - **proot Debian (inside Termux):** Hermes itself: its dashboard server on `127.0.0.1:9119`, the `tui_gateway`
    JSON-RPC WebSocket at `/api/ws`, the Hermes Mobile plugin, the cron ticker and the memory sync.
  - **Shizuku** (a separate app whose server runs as the shell user): `rish` and the background-app host `BgHost`.
  - **Your model provider:** the only thing off the phone; Hermes calls it over HTTPS.

Everything between these parts is loopback (`127.0.0.1`) only. Plain HTTP is allowed to `127.0.0.1` and
`localhost` and nowhere else (`android/res/xml/network_security_config.xml`).
