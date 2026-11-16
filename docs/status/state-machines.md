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
- In review, waiting for the owner (2026-11-16): the status chip's pending approvals and questions (`PendingAsk.java`).
  It keeps them per chat and request, so one chat's clear no longer drops another's and a second approval no longer
  overwrites the first. Open question: the chip now shows the oldest pending approval first, where it used to show the
  newest. Needs a phone: two chats each asking for an approval.

Left alone on purpose in "which chat is on screen": `phone-data-taint.ts` has its own copy of the same test (security
code: change it only with the owner's say), `BgApp.tsx` prefers the open chat over the opening one (its chip flow is
written around that), and `Composer.tsx` reads `opening` directly (it means "can't send yet", also true during a reload).

**Seen on the way, not changed** (none reproduced with a test yet)

- Offline outbox (`flushOutbox` in `gateway.ts`): `sendPrompt` does not throw when `prompt.submit` fails, so the toast
  "Sent the message you queued" shows beside a "Send failed" notice.
- Model picks (`setModel`): two quick picks on one chat send their `config.set` calls without waiting for each other,
  so the order Hermes sees is not guaranteed.
- Read aloud in a plain browser only (`speechSynthesis` fallback in `voice.ts`): the old utterance's late `onend` after
  a seek or a speed change does not check the re-seek window and may clear the player while the new one speaks.
- Setup: an installer abandoned without a FAIL line reads as installing for ever; an expiry can't be told apart from a
  slow install without a clock. Needs a decision.

**Next in the web page**

| Where | The hidden states | What is loose today |
|---|---|---|
| Access mode (`gateway.ts`, plugin) | Off, Auto, Full, switching | Already named (`Access`), but stored as `info.yolo` + `autoAccess` + `beforeFull` + `accessRuns`. Security code: change only with the owner's say. |
| Sub-agent cards (`store.ts`) | free text | A tool card's status is explicit (`ToolStatus`); a sub-agent card's `status` is still a free string. Small. |

Nothing to do: the offline outbox is one slot with one writer (`saveOutbox`); Setup (`setupflow.ts`) was already explicit
and tested.

**Android shell, plugin and phone scripts (surveyed 2026-11-16)**

A read-only pass over the Java, the plugin and the scripts. "Reported" faults were traced in the code by the survey but
not yet re-checked or reproduced with a test; "suspected" ones were not traced. Some files only got a skim
(`bootstrap.sh`, `hm-local`, `plugin_api.py`, `checkpoints.py`, `local_auth.py`).

Worth doing, in this order:

| Where | The hidden states | What is loose, and what the survey reported |
|---|---|---|
| Helper-app install and app update install (`MainActivity.java`) | idle, requested, downloading, committed, prompt pending, prompt shown, finished | Seven `helper*` flags set in about fifteen places. Reported: the receivers are never unregistered and the flags are lost when the activity is recreated, so Retry can start a second installer session. Suspected: the update installer can stack a session the same way. No test. |
| The plugin's turn records (`__init__.py`) | idle, running, review, ended | Spread over `_active`, `_turn_started`, `_last_end`, `_subagents` and a timer. Reported: two of them only grow. Suspected: a background review label can replace a live turn's status. |

Small things reported on the way: `Voice.java` has a field that is never assigned (`pendingSpeech`); `PluginSync.java`
records a check before the service start that may fail; `ShizukuKeeper.java` sets `P_WD_OURS` before the write that may throw.

Leave alone, or the owner decides first (security or destructive): the local key and access switch (`LocalKey.java`,
already a tested protocol), `ApprovalLock.java`, the bridge key handshake, the phone-data switch flow (suspected: a page
reload does not reset `phoneDataBusy`), `phone_taint.py`, `Uninstall.java`. Already explicit and tested, nothing to do:
`KeeperPlan.java`, `EventsListener.Retry`, `plugin-update.sh`, `cron_ticker.py`.

**Needs a real phone**

- The queue pausing after a refused send was checked against the mock only.
- A failed install staying failed after a restart was checked with `tools/test_setup_lines.sh` only.
- Live mode, the read-aloud player and the reconnect rules changed no behaviour, but none was tried on a phone after the change.

**Links**

- `web/src/turn.ts`, `web/src/chatview.ts`, `web/src/livestate.ts`, `web/src/player.ts`, `web/src/conn.ts`, `web/src/agentbuild.ts`, each with a `.test.ts` beside it.
- `tools/web-e2e/checks/08-queue-and-feed.cjs` (step 7), `tools/web-e2e/checks/06-long-chats-and-opening.cjs` (the last block), `tools/test_setup_lines.sh`.
