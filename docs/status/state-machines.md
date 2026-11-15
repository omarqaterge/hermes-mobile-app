# Explicit state machines

Several parts of the app keep their state in loose flags that are set in many places. Each one made explicit gets one
module with named states and steps, unit tests for every step, and a spec entry, so a person or an agent changes the
step instead of hunting for every place a flag is set.

**State (2026-11-15)**

- Done: the chat turn (`web/src/turn.ts`, spec 2.6 and 2.2.1). It fixed four gaps the loose flags had: a queued message
  that could not be sent let the rest of the queue be sent after it, the status line showed the previous reply's speed,
  an edited or retried message had no timer until Hermes answered, and a send that failed after another chat was opened
  stopped that chat's spinner.

**Next** (in the order of what users would gain; one branch each, and the first three all change `web/src/gateway.ts`,
so one after the other)

| Where | The hidden states | What is loose today |
|---|---|---|
| Which chat is on screen (`gateway.ts`, `App.tsx`, `Composer.tsx`) | home, opening, opening with a preview, open | Worked out again in each component from `opening`, `preview`, `active` and `conn` (the same test four times in `App.tsx`); `openSeq`, `shownChat` and `visitedChat` live beside it. One `chatView(state)` selector would do. |
| Connection (`gateway.ts`) | idle, connecting, open, waiting to retry, starting Hermes | `attempt`, `reconnectTimer`, `started`, `readySeen`, `aliveAt`, `lastBeat`; the banner words come from `attempt`. Covered by `gateway-reconnect.test.ts`, so it can be moved safely. |
| A new chat's agent (`gateway.ts`) | building, ready, switching model, replacing an empty chat | `builds`, `ready`, `switching`, `pendingNew`: four collections that together say whether a send or a model pick must wait. |
| Access mode (`gateway.ts`, plugin) | Off, Auto, Full, switching | Already named (`Access`), but stored as `info.yolo` + `autoAccess` + `beforeFull` + `accessRuns`. Security code: change only with the owner's say. |
| Offline outbox (`gateway.ts`) | empty, held, sending | `queued` in the store plus `hm.outbox.v1`; separate from the follow-up queue. |
| Live mode (`live.ts`) | off, listening, thinking, speaking | `phase` is explicit; `muted`, `over`, `finalWait` and `approval` are side flags that change what a phase means. |
| Read aloud player (`voice.ts`) | idle, speaking, paused, seeking | `playText`, `playFrom`, `reseekUntil`, `nativePausedAt`, `seg`. |
| Tool cards (`store.ts`) | `generating`, `running`, `done`, `error` | Explicit (`ToolStatus`). A sub-agent card's `status` is still a free string. |
| Setup (`setupflow.ts`) | one row per step | Already explicit and tested: the model to copy. |
| Android shell (`HermesService.java`, `MainActivity.java`) | not mapped yet | Only the flag names were listed (`localAlert`, `phoneDataBusy`, `phoneDataAskedBefore`, `devtoolsPending`, `keyTaken`); the Java, the plugin and the phone scripts still need a proper read. |

**Needs a real phone**

- The queue pausing after a refused send was checked against the mock only.

**Links**

- `web/src/turn.ts`, `web/src/turn.test.ts`, `tools/web-e2e/checks/08-queue-and-feed.cjs` (step 7).
