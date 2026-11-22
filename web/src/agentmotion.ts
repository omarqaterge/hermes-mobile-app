// The states the agent's animations are tied to (agent-motion.css draws them; components/AgentMotion.tsx holds the
// shared marks). Each animation starts with its state and stops the moment the state is over; none of them needs a
// timer, a poll or JavaScript on each frame (docs/decisions/redesign-costs-no-speed-or-battery.md).
//
// - The composer's light: a light travels round the text box while Hermux works on this chat, and stands still in
//   amber while it waits for the person (`composerLight`).
// - A step's end: a step seen running that ends draws its tick (or its cross) once (`stepEnd`).
// - A sent message lifts out of the composer once (`noteSent`, `justSent`).
// - The finished turn's one light tick on the phone (`turnTick`).
// - The running step that moves (`liveStep`): one at a time, so at most the text box's light, the handle's shimmer and
//   one step move while a turn runs.
import type { ChatItem } from './store'

export type Light = 'working' | 'waiting' | null

/** The composer's light: working while a turn or the chat's sub-agents run, waiting (amber, still) while Hermux waits
 *  for an answer from the person, otherwise none. */
export function composerLight(running: boolean, subAgentsRun: boolean, waiting: boolean): Light {
  if (waiting && (running || subAgentsRun)) return 'waiting'
  return running || subAgentsRun ? 'working' : null
}

export type StepEnd = 'done' | 'failed' | null

/** How a step that was seen running ended: `done`, `failed`, or null while it runs (or if it was never seen running, so a
 *  step read from history never animates). */
export function stepEnd(wasLive: boolean, live: boolean, failed: boolean): StepEnd {
  if (!wasLive || live) return null
  return failed ? 'failed' : 'done'
}

/** A step runs while its tool streams its arguments or runs. */
export const toolLive = (status: string): boolean => status === 'running' || status === 'generating'

// ── a sent message ──
let sentAt = 0
/** How long after a send the new message still counts as just sent (it mounts within a frame or two). */
export const SENT_WINDOW_MS = 1500

/** The composer sent a message now (Composer.tsx `send`). */
export function noteSent(now = Date.now()): void {
  sentAt = now
}

/** True for the message the composer just sent: it lifts out of the composer once. A message from history, or one shown
 *  after reopening the chat, does not move. */
export function justSent(at: number | undefined, now = Date.now()): boolean {
  if (!sentAt || now - sentAt > SENT_WINDOW_MS) return false
  return at === undefined || at >= sentAt - SENT_WINDOW_MS
}

// ── the finished turn's tick ──
/** One light tick on the phone when a turn finishes on screen: the chat stayed the same, the app is on screen, the phone
 *  is not locked, and the turn ended with an answer (the last item is a reply with text). Never for steps, never twice
 *  for one turn (the caller asks only on the change from running to not running). */
export function turnTick(o: { wasRunning: boolean; running: boolean; sameChat: boolean; visible: boolean; locked: boolean; last?: ChatItem }): boolean {
  if (!o.wasRunning || o.running || !o.sameChat || !o.visible || o.locked) return false
  return o.last?.kind === 'assistant' && Boolean(o.last.text.trim()) && !o.last.streaming
}

// ── the running step that moves ──
/** The index of the one running step whose words shimmer: the newest running tool card. None while a sub-agent group's
 *  line shimmers (`groupShimmers`), so a turn never has two shimmering lines. */
export function liveStep(items: readonly ChatItem[], groupShimmers: boolean): number {
  if (groupShimmers) return -1
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'user') return -1 // only the running turn
    if (it.kind === 'tool' && toolLive(it.status)) return i
  }
  return -1
}
