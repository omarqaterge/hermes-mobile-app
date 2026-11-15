// One turn of the open chat, as an explicit state machine. gateway.ts used to set these fields by hand in eight places,
// each with its own subset, and kept "how did it end" in a loose flag; every change now goes through a step below.
//
//   idle ──turnSent──▶ sent ──turnStarted──▶ streaming ──endTurn──▶ idle
//     └───────────────turnStarted (a turn the page didn't send)──────┘
//
//   state      running  turnStart        status      tps
//   idle       false    null             ''          null
//   sent       true     the send         ''          null       (prompt.submit is on its way; no message.start yet)
//   streaming  true     kept (or start)  live text   live speed
//
// How a turn ended (`TurnEnd`) decides what the queue of follow-ups does next (`queueGoesOn`): only a turn that
// finished normally sends the next one; anything else pauses the queue until Resume.
import type { ActiveSession } from './store'

/** done: the reply finished · failed: `message.complete` came with an error · stopped: the user pressed Stop ·
 *  not-sent: `prompt.submit` itself failed, so there was no turn. */
export type TurnEnd = 'done' | 'failed' | 'stopped' | 'not-sent'

export type TurnFields = Pick<ActiveSession, 'running' | 'status' | 'turnStart' | 'tps' | 'openAssistantId'>

/** idle → sent: the page sent a prompt (a message, a skill, an edit or retry). The clock starts here. */
export function turnSent(now: number = Date.now()): Partial<TurnFields> {
  return { running: true, status: '', tps: null, openAssistantId: null, turnStart: now }
}

/** sent → streaming (or idle → streaming for a turn started elsewhere): Hermes's `message.start`. Hermes may send
 *  several per turn: the first start time is kept. */
export function turnStarted(a: Pick<TurnFields, 'turnStart'>, now: number = Date.now()): Partial<TurnFields> {
  return { running: true, tps: null, turnStart: a.turnStart ?? now }
}

/** Any state → idle. Nothing of the turn's live readout stays behind for the next one. */
export function turnOver(): Partial<TurnFields> {
  return { running: false, status: '', tps: null, turnStart: null }
}

/** Does the queue send its next message after a turn that ended this way? */
export const queueGoesOn = (how: TurnEnd): boolean => how === 'done'

// How the open chat's current turn is ending. Set before the fields go idle (the store tells its listeners at once),
// read exactly once by the listener that sees the turn end.
let ending: TurnEnd = 'done'

/** Record that the running turn will not end normally (Stop now, or an error or failed send as it ends). */
export function noteTurnEnd(how: Exclude<TurnEnd, 'done'>): void {
  ending = how
}

/** How the turn that just ended went; the answer is forgotten once read, so the next turn starts clean. */
export function takeTurnEnd(): TurnEnd {
  const how = ending
  ending = 'done'
  return how
}
