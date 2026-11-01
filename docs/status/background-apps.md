# Background apps: faster, fewer model steps

**State** (2026-11-01): on branch `feat/phone-app-easier`. `BgHost` waits for the hidden screen to settle (it subscribes
only to screen-change events and counts those of the hidden display), hides the keyboard there, caches the live view's JPEG, numbers
a shorter element list (rows named with their text, roles, keyboard windows left out), refuses stale element numbers,
and has new endpoints: `/resolve`, `/long_press`, `/swipe`, `/submit`, `/toggle`, `/scroll_to`, `/wait_for`, marks on
`som` captures. `phone_app.py` adds `target`, `steps`, `url`/`share_text`/`intent` on `open`, `wait_after`, `note`,
`capture_after` on by default and "nothing changed" answers. Plugin tests and the Java compile check pass.

On an Android 16 phone (2026-11-01, the host as a dex through adb, Settings): `tools/test_bghost.sh` all passed; rows
read as one element with their status ("Bluetooth, Off"); marks drawn; `scroll_to` both ways; tap by text 0.56 s and
back 0.36 s including settling; search field filled with `set_text` and run with `submit`; no keyboard shown. Found
and fixed there: `drawText` crashes `app_process` (no font loaded), so the numbers are drawn with lines; that
phone's Settings list accepts the scroll-up action without moving, so a scroll that changes nothing is retried as a
swipe.

**Next:** run `tools/test_bghost.sh` on another maker's Android 14+ phone; tune `QUIET_MS`/`NO_CHANGE_MS` if real apps
answer slower than 200/500 ms; see whether models use `target` and `steps` without more prompting.

**Needs a real phone:** the keyboard staying hidden on other makers' builds (falls back to local); settle timing on
slow apps; `toggle` on a real switch; `share_text` into a notes app; the whole tool through Hermes (only the host was
driven directly); that the owner's own apps feel no slower while the host
runs (fewer events).

**Links:** spec 5.2 (`phone_app`), 4.1 (`BgHost`), 2.2.8; decision `docs/decisions/no-hidden-display-app-driving.md`.
