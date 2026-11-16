# Android versions

The app installs on Android 8.0 and newer (arm64). Some parts need a newer Android:

| Android | What you get |
|---|---|
| 8.0 - 10 | The app and the agent. Set up from a computer, and start Shizuku from a computer again after every restart (Wireless debugging, which lets the phone start it by itself, only exists from Android 11). |
| 10+ | Save pictures from a chat to Pictures/Hermux (on 8-9 only Share) |
| 10+ | The agent reading your location while the app isn't on screen can get an old position or none |
| 11+ | Setup on the phone itself, no computer needed; Shizuku starts again by itself after a restart (on Wi-Fi); pictures saved before the rename move from Pictures/Hermes to Pictures/Hermux |
| 11+ | The diagnostic log also says why Android ended the app (memory, a crash, battery limits); on older Android it has everything else |
| 12+ | Allowing a command or answering Hermux from a notification on the lock screen asks for your unlock right there (on 8-11 the tap opens the app, which asks for the unlock) |
| 13+ | The app asks for the notification permission (older Android allows notifications from the start) |
| 13+ | Letting the agent read your photo details asks for a different permission (older Android: storage); on 14+, if you only share selected photos, the agent sees just what Android allows |
| 14+ | Hermux using your apps in the background, without taking your screen |
| 16 | The status chip as an Android Live Update (on older Android it is a normal pinned notification) |

**Android System WebView must be up to date** (Chrome 100 or newer). The app draws its screens with it. Phones with the
Play Store update it by themselves. If it was never updated, the app says "Hermux can't start": update
*Android System WebView* (or *Chrome*) from your app store and reopen the app.

> Tested end to end on a clean Android 15 emulator and on a real Android 16 phone, but not yet on a brand-new real phone.
> On Android 8.0 (emulator) only the start-up was checked: the app opens and its background service runs. Android 9-14:
> not tested yet; reports are welcome.
