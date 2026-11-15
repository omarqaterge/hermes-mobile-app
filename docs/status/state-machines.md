# Explicit state machines

Several parts of the app keep their state in loose flags that are set in many places. Each one made explicit gets one
module with named states and steps, unit tests for every step, and a spec entry, so a person or an agent changes the
step instead of hunting for every place a flag is set.

**State (2026-11-15)**

- Done: which chat is on screen (`web/src/chatview.ts`, spec 3.2 "While a chat opens"). `App.tsx`, `canvas.ts`,
  `OpenUIBlock.tsx` and `AutoAccess.tsx` read it. It fixed three gaps: while a chat without a cached copy opened, the
  header kept the title of the chat being left; and in that window Chat options and the Auto button still acted on the
  chat being left (or, at a cold start, the Auto button started a new chat on top of the one opening).
  Left alone on purpose: `phone-data-taint.ts` has its own copy of the same test (security code: change it only with
  the owner's say), `BgApp.tsx` prefers the open chat over the opening one (its chip flow is written around that), and
  `Composer.tsx` reads `opening` directly (it means "can't send yet", which is also true during a reload).
- Done: the chat turn (`web/src/turn.ts`, spec 2.6 and 2.2.1). It fixed four gaps the loose flags had: a queued message
  that could not be sent let the rest of the queue be sent after it, the status line showed the previous reply's speed,
  an edited or retried message had no timer until Hermes answered, and a send that failed after another chat was opened
  stopped that chat's spinner.

**Next** (in the order of what users would gain; one branch each, and the first two both change `web/src/gateway.ts`,
so one after the other)

| Where | The hidden states | What is loose today |
|---|---|---|
| Connection (`gateway.ts`) | idle, connecting, open, waiting to retry, starting Hermes | `attempt`, `reconnectTimer`, `started`, `readySeen`, `aliveAt`, `lastBeat`; the banner words come from `attempt`. Covered by `gateway-reconnect.test.ts`, so it can be moved safely. |
| A new chat's agent (`gateway.ts`) | building, ready, switching model, replacing an empty chat | `builds`, `ready`, `switching`, `pendingNew`: four collections that together say whether a send or a model pick must wait. |
| Access mode (`gateway.ts`, plugin) | Off, Auto, Full, switching | Already named (`Access`), but stored as `info.yolo` + `autoAccess` + `beforeFull` + `accessRuns`. Security code: change only with the owner's say. |
| Offline outbox (`gateway.ts`) | empty, held, sending | `queued` in the store plus `hm.outbox.v1`; separate from the follow-up queue. |
| Live mode (`live.ts`) | off, listening, thinking, speaking | `phase` is explicit; `muted`, `over`, `finalWait` and `approval` are side flags that change what a phase means. |
| Read aloud player (`voice.ts`) | idle, speaking, paused, seeking | `playText`, `playFrom`, `reseekUntil`, `nativePausedAt`, `seg`. |
| Tool cards (`store.ts`) | `generating`, `running`, `done`, `error` | Explicit (`ToolStatus`). A sub-agent card's `status` is still a free string. |
| Setup (`setupflow.ts`) | one row per step | Already explicit and tested: the model to copy. |

**Android shell, plugin and phone scripts (surveyed 2026-11-16)**

A read-only pass over the Java, the plugin and the scripts. "Reported" faults were traced in the code by the survey but
not yet re-checked or reproduced with a test; "suspected" ones were not traced. Some files only got a skim
(`bootstrap.sh`, `hm-local`, `plugin_api.py`, `checkpoints.py`, `local_auth.py`).

Worth doing, in this order:

| Where | The hidden states | What is loose, and what the survey reported |
|---|---|---|
| Setup install gate (`SetupLines.java`, `HermesService.java`, `MainActivity.java`) | no command, installing, failed, done | Derived from `token` and `fail`. Reported: only the token is saved and it is removed only on DONE, so a failed or abandoned install followed by a process kill reads as "installing" again, which holds back starting Hermes, plugin updates and the Shizuku keeper. Has a pure class and `tools/test_setup_lines.sh`: the easiest to fix. |
| Status chip and its pending approval or question (`HermesService.java`) | flash, approval, ask, done, working, idle | About twelve fields, precedence decided inside `statusNotification`. Reported: a "clear" event is matched by kind only, so one chat's clear drops another chat's pending approval, and a second approval overwrites the first (one slot). |
| Helper-app install and app update install (`MainActivity.java`) | idle, requested, downloading, committed, prompt pending, prompt shown, finished | Seven `helper*` flags set in about fifteen places. Reported: the receivers are never unregistered and the flags are lost when the activity is recreated, so Retry can start a second installer session. Suspected: the update installer can stack a session the same way. No test. |
| The plugin's "Using an app" state (`phone_app.py`) | closed, open for a chat | Reported: two paths clear `_state` without sending the "done" event, so the app's card stays for up to 130 s. |
| The plugin's turn records (`__init__.py`) | idle, running, review, ended | Spread over `_active`, `_turn_started`, `_last_end`, `_subagents` and a timer. Reported: two of them only grow. Suspected: a background review label can replace a live turn's status. |

Small things reported on the way: `Voice.java` has a field that is never assigned (`pendingSpeech`); `PluginSync.java`
records a check before the service start that may fail; `ShizukuKeeper.java` sets `P_WD_OURS` before the write that may throw.

Leave alone, or the owner decides first (security or destructive): the local key and access switch (`LocalKey.java`,
already a tested protocol), `ApprovalLock.java`, the bridge key handshake, the phone-data switch flow (suspected: a page
reload does not reset `phoneDataBusy`), `phone_taint.py`, `Uninstall.java`. Already explicit and tested, nothing to do:
`KeeperPlan.java`, `EventsListener.Retry`, `plugin-update.sh`, `cron_ticker.py`.

**Needs a real phone**

- The queue pausing after a refused send was checked against the mock only.

**Links**

- `web/src/turn.ts`, `web/src/turn.test.ts`, `tools/web-e2e/checks/08-queue-and-feed.cjs` (step 7).
