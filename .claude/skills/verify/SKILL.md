---
name: verify
description: Run a change in the real app and collect the evidence that it works, before calling it done or committing. Use after any change to web/, android/, hermes-plugin/ or phone/, and when asked to verify, check or prove a change.
---

# Verify a change

The rules are in `docs/verification.md`; this is the order to work in. Stop and report as soon as something fails
that you can't fix in three attempts.

1. **Checks:** `tools/check.sh`. Read every FAIL and fix its cause; never rerun, add a wait or loosen the test.
   SKIP lines are things this machine can't run: name them in the report.
2. **Run the change:**
   - `web/`: start `tools/web-e2e/run.sh --serve` in the background, wait for its `run.sh: page http://…` line, open
     that address in a browser tool and use the feature the way a user would (the mock Hermes answers; no phone).
     Look at it in the light theme too when colours changed. Stop the script when done.
   - `android/`, `hermes-plugin/`, `phone/`: needs a phone or emulator. `adb devices`, then
     `tools/device-lock.sh hold SERIAL WHO` before touching it (exit code 75: someone else has it, don't take it).
     Without a device, say "not tried on a phone" and add the steps to `docs/manual-tests.md`.
3. **Checklist:** read the items `tools/check.sh` printed under "Review checklist" (or
   `python3 tools/review_checklist.py`) and check each against the change.
4. **Record it:** a `Verified:` line in each commit message saying what ran, what you looked at and what you could
   not (`Verified: none` with the reason when nothing could). The same, with the checklist answers, in the pull
   request.

Report plainly: what passed, what you saw when you ran it, what was skipped and why.
