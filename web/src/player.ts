// The read-aloud player as an explicit state machine. voice.ts used to decide these things inline, from module
// variables (`reseekUntil`, `nativePausedAt`, `seg`, `cps`) and the store's `player`; the decisions now live here as
// pure functions, and voice.ts keeps the bridge calls, the timers and the store.
//
//   idle ──speak──▶ speaking ──pause──▶ paused ──resume──▶ speaking
//                    │  ▲  └──seek / speed (re-speak)──▶ seeking ──(300 ms)──▶ speaking
//                    │  └──────────── seek while paused: stays paused, only the place moves
//                    └─ tts-done / stop / error / startListening ──▶ idle (finished)
//
//   phase      store `player`        `reseekUntil`   what it means
//   idle       null                  -               nothing is read (the Live mode and the Settings test have no player)
//   speaking   { paused: false }     passed or 0     the engine reads; the place moves with `tts-seg` and the pace
//   seeking    { paused: false }     in the future   a re-speak was just sent; the engine's `tts-done` for the speech it
//                                                    replaced may still arrive and is ignored (`isStaleDone`)
//   paused     { paused: true }      -               the place is kept; a `tts-done` from our own stop is ignored
//
// "Finished" is not a phase that lasts: a real `tts-done` goes straight to idle.
import type { Player } from './voice'

export type PlayerPhase = 'idle' | 'speaking' | 'seeking' | 'paused'

/** How long after a re-speak (seek, speed, resume) the replaced speech's late `tts-done` is still ignored. */
export const RESEEK_MS = 300

/** The phase the player is in: `idle` without a player, `paused` when paused, `seeking` inside the re-speak window. */
export function phaseOf(p: Pick<Player, 'paused'> | null, reseekUntil: number, now: number): PlayerPhase {
  if (!p) return 'idle'
  if (p.paused) return 'paused'
  return now < reseekUntil ? 'seeking' : 'speaking'
}

/** When the re-speak window ends: `RESEEK_MS` from now for a seek / speed / resume re-speak, 0 (no window) for a fresh speech. */
export const reseekDeadline = (reseek: boolean, now: number): number => (reseek ? now + RESEEK_MS : 0)

/** Is this `tts-done` one to ignore? `text` is the event's argument: 'stop' (the notification's ✕ or a headset stop) is
 *  always final. Otherwise it is stale while paused (we stopped the speech ourselves) or inside the re-speak window
 *  (the speech we just replaced reports that it ended). */
export function isStaleDone(text: string, paused: boolean, reseekUntil: number, now: number): boolean {
  if (text === 'stop') return false
  return paused || now < reseekUntil
}

/** Parse a `tts-seg` argument `at,length`; null when either is not a number. `at` is relative to where this speech began. */
export function parseSeg(text: string): { at: number; len: number } | null {
  const [at, len] = text.split(',').map(n => parseInt(n, 10))
  return Number.isFinite(at) && Number.isFinite(len) ? { at, len } : null
}

/** A `tts-pace` argument (characters per second), or null when it is not a number from 2 to 120. */
export function parsePace(text: string): number | null {
  const v = Number(text)
  return Number.isFinite(v) && v >= 2 && v <= 120 ? v : null
}

/** The pace to use: the measured one, else a typical 14 characters per second scaled by the speed. */
export const paceOf = (cps: number, rate: number): number => (cps > 0 ? cps : 14 * (rate || 1))

/** The pace after a stretch ended: the measurement of the finished stretch averaged with the old pace (the first
 *  measurement stands alone). A stretch with no elapsed time measures nothing. */
export function nextPace(cps: number, seg: { len: number; t0: number } | null, now: number): number {
  if (!seg || now <= seg.t0) return cps
  const measured = (seg.len / (now - seg.t0)) * 1000
  return cps ? cps * 0.5 + measured * 0.5 : measured
}

/** Where the reading is now: the stretch's start plus the time since it began at the pace, never past its end. */
export function estimatePos(seg: { at: number; len: number; t0: number }, now: number, pace: number): number {
  return Math.min(seg.at + seg.len, seg.at + ((now - seg.t0) / 1000) * pace)
}

/** The place `tts-paused` reports (relative to where the speech began) as an absolute place in the text. */
export const pausedPlace = (playFrom: number, at: number, textLength: number): number => Math.min(textLength, playFrom + at)

/** Does the shell still hold the paused place, so 'play' / 'rew' / 'ff' can be left to it? True when it has the control,
 *  has a place, and the page's place is the same (a seek while paused moved it). */
export function shellHoldsPlace(hasControl: boolean, nativePausedAt: number | null, pos: number): boolean {
  return hasControl && nativePausedAt !== null && Math.abs(pos - nativePausedAt) < 1
}

/** Back / forward jumps go to the shell's own path when it is playing or still holds the paused place. */
export const jumpIsShared = (hasControl: boolean, paused: boolean, nativePausedAt: number | null, pos: number): boolean =>
  hasControl && (!paused || shellHoldsPlace(true, nativePausedAt, pos))

/** Where a re-spoken resume starts: the place, kept inside the text. */
export const resumeFrom = (pos: number, total: number): number => Math.min(pos, Math.max(0, total - 1))

/** A seek target: rounded and kept inside the text. */
export const seekTarget = (pos: number, total: number): number => Math.max(0, Math.min(total - 1, Math.round(pos)))
