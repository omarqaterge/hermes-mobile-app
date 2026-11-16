# Explicit state machines

Several parts of the app keep their state in loose flags that are set in many places. Each one made explicit gets one
module with named states and steps, unit tests for every step, and a spec entry, so a person or an agent changes the
step instead of hunting for every place a flag is set.

**State (2026-11-16)**

Done in the web page (each: one module, a state table in its header, a unit test per step, a spec entry):

| What | Module | Faults it fixed |
|---|---|---|
| The chat turn | `web/src/turn.ts` | A queued message that could not be sent let the rest of the queue be sent after it; the status line showed the previous reply's speed; an edited or retried message had no timer until Hermes answered; a send that failed after another chat was opened stopped that chat's spinner. |
| Which chat is on screen | `web/src/chatview.ts` | While a chat with no cached copy opened, the header kept the title of the chat being left, and Chat options and the Auto button still acted on that chat (or, at a cold start, the Auto button started a new chat on top of the one opening). |
| Live mode | `web/src/livestate.ts` | None found. |
| The read-aloud player | `web/src/player.ts` | None fixed. |
| Connection retries and liveness | `web/src/conn.ts` | None found. |
| A chat's agent build and model switch | `web/src/agentbuild.ts` | None fixed. |

Done in the Android shell and the plugin:

- The setup install gate (`SetupLines.java` `State`): a failed install no longer reads as installing after the app
  restarts.
- The plugin's "Using an app" state (`_start_use` and `_end_use` in `phone_app.py`): the card ends at once when the
  background host is lost, not after its 130 s timeout.
- The status chip's pending approvals and questions (`PendingAsk.java`): kept per chat and request, so one chat's
  clear no longer drops another's and a second approval no longer overwrites the first; the phone stops being held
  awake once an approval is answered. The chip shows the oldest pending approval first (owner's decision, 2026-11-16).
- The plugin's turn records (`_note_start`, `_pop_start`, `_note_subagent`, `_note_end` in `__init__.py`): bounded, a
  running turn keeps its start time, and a background "Learning" label can no longer replace a live status.
- The helper-app and update installers (`InstallPhase.java`, `MainActivity.java`): one session per install, also after
  the activity is recreated; a prompt that was lost frees the next tap after 15 s. Helper path tried on an emulator.

Left alone on purpose in "which chat is on screen": `phone-data-taint.ts` has its own copy of the same test (security
code: change it only with the owner's say), `BgApp.tsx` prefers the open chat over the opening one (its chip flow is
written around that), and `Composer.tsx` reads `opening` directly (it means "can't send yet", also true during a reload).

**Seen on the way** (2026-11-16)

Fixed since: an installer killed without a FAIL line no longer reads as installing for ever (owner, 2026-11-16: check,
don't time it; the installer beats and the app reads it as `LOST` after 120 s of silence, a copied command never pasted
blocks nothing, and the probe's marker ends a run whose `DONE` was missed: `SetupLines`, spec 4.7); the false "Sent" toast for a message queued offline, two quick model picks reaching Hermes out of order,
and the plain-browser read-aloud seek clearing the player (each with a test that failed first).

Still open:

- A failed or timed-out sub-agent card still shows its last tool line (hidden only for done and completed).
- The helper download thread in `MainActivity.java` catches `Exception`, not `Error`.

**Next in the web page**

| Where | The hidden states | What is loose today |
|---|---|---|
| Access mode (`gateway.ts`, plugin) | Off, Auto, Full, switching | Already named (`Access`), but stored as `info.yolo` + `autoAccess` + `beforeFull` + `accessRuns`. Security code: change only with the owner's say. |

Nothing to do: the offline outbox is one slot with one writer (`saveOutbox`); Setup (`setupflow.ts`) was already explicit
and tested; a sub-agent card's `status` stays free text on purpose (Hermes may send new values and the card prints them).

**Android shell, plugin and phone scripts (surveyed 2026-11-16)**

A read-only pass over the Java, the plugin and the scripts. "Reported" faults were traced in the code by the survey but
not yet re-checked or reproduced with a test; "suspected" ones were not traced. Some files only got a skim
(`bootstrap.sh`, `hm-local`, `plugin_api.py`, `checkpoints.py`, `local_auth.py`).

Every item the survey listed as worth doing is done (see the lists above).

Small things reported on the way: `Voice.java` has a field that is never assigned (`pendingSpeech`); `PluginSync.java`
records a check before the service start that may fail; `ShizukuKeeper.java` sets `P_WD_OURS` before the write that may throw.

Leave alone, or the owner decides first (security or destructive): the local key and access switch (`LocalKey.java`,
already a tested protocol), `ApprovalLock.java`, the bridge key handshake, the phone-data switch flow (suspected: a page
reload does not reset `phoneDataBusy`), `phone_taint.py`, `Uninstall.java`. Already explicit and tested, nothing to do:
`KeeperPlan.java`, `EventsListener.Retry`, `plugin-update.sh`, `cron_ticker.py`.

**Needs a real phone**

- The queue pausing after a refused send was checked against the mock only.
- A failed install staying failed after a restart was checked with `tools/test_setup_lines.sh` only.
- The status chip with two chats each asking for an approval: the first one shows, answering or clearing it shows the second, and the other chat's stays. Checked with `tools/test_pending_ask.sh` only; this is the one to try first.
- The "Using an app" card going away when the background host is lost was checked with `tools/test_phone_app.py` only.
- The app update installer: tap Update, leave Android's prompt, tap Update again (the same prompt, no second download); not tried on any device.
- The helper-app installer was tried on an emulator only.
- The installer's beat (`ALIVE` every 30 s) and the lost state: passed on an emulator (Android 15, 2026-11-16; see `docs/manual-tests.md`). A copied, never-pasted command kept waiting; Termux force-stopped mid-install read as stopped 124 s later, with the notification "Setup stopped: open Hermux"; pasted again, it ran to DONE with the screen off for most of the run and never read as stopped. Two faults it found are fixed: the stopped card's clock kept counting, and a stale git lock from the kill stopped the next run at the Hermes step. Still to try on a real phone (vendor background limits, a restart mid-install), and the step after DONE reaching the model card (the emulator stopped at Shizuku, which it can't authorise).
- Live mode, the read-aloud player and the reconnect rules changed no behaviour, but none was tried on a phone after the change.

**Links**

- `web/src/turn.ts`, `web/src/chatview.ts`, `web/src/livestate.ts`, `web/src/player.ts`, `web/src/conn.ts`, `web/src/agentbuild.ts`, each with a `.test.ts` beside it.
- `tools/web-e2e/checks/08-queue-and-feed.cjs` (step 7), `tools/web-e2e/checks/06-long-chats-and-opening.cjs` (the last block), `tools/test_setup_lines.sh`.
