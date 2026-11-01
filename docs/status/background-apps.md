# Background apps: faster, fewer model steps

**State** (2026-11-01): on branch `feat/phone-app-easier`. `BgHost` waits for the hidden screen to settle (it subscribes
only to screen-change events and counts those of the hidden display), hides the keyboard there, caches the live view's JPEG, numbers
a shorter element list (rows named with their text, roles, keyboard windows left out), refuses stale element numbers,
and has new endpoints: `/resolve`, `/long_press`, `/swipe`, `/submit`, `/toggle`, `/scroll_to`, `/wait_for`, marks on
`som` captures. `phone_app.py` adds `target`, `steps`, `url`/`share_text`/`intent` on `open`, `wait_after`, `note`,
`capture_after` on by default and "nothing changed" answers. Plugin tests and the Java compile check pass.

**Next:** run `tools/test_bghost.sh` on an Android 14+ emulator or phone; tune `QUIET_MS`/`NO_CHANGE_MS` if real apps
answer slower than 200/500 ms; see whether models use `target` and `steps` without more prompting.

**Needs a real phone:** the keyboard really stays hidden with the hide policy on every maker's build (falls back to
local); settle timing on slow apps; tap by text and `toggle` in a real Settings screen; `submit` in a search field;
`share_text` into a notes app; marks on a `som` screenshot; that the owner's own apps feel no slower while the host
runs (fewer events).

**Links:** spec 5.2 (`phone_app`), 4.1 (`BgHost`), 2.2.8; decision `docs/decisions/no-hidden-display-app-driving.md`.
