// The gateway connection, as an explicit state machine. The decisions live here as pure functions; gateway.ts keeps
// the timers and the side effects (sockets, the shell's calls, the banner) and asks this file what to do.
//
//   idle ──connect──▶ connecting ──socket opens──▶ open ──socket closes or errors──▶ waiting ──timer / Hermes answers──▶ connecting
//                        └──────────connect fails (no token, refused)───────────────▶ waiting
//
//   state       what the page does                                          attempt
//   idle        nothing yet (`started` is false)                            0
//   connecting  a socket is being opened (or its token fetched)             unchanged
//   open        a beat every `BEAT_MS` checks the socket (`beatDecision`)   0 (reset when the socket opens)
//   waiting     one retry timer runs (`retryDelayMs`), the banner is up     counts the tries of this outage
//
// A retry first asks `retryDelayMs` how long to wait, then counts the try; `retryBanner` and `retryHermesSteps` read
// the count after it. While open, each beat asks `beatDecision`: ping, give a frozen page's socket a fresh window, or
// drop a socket that has been silent too long.

/** How often the liveness beat runs. */
export const BEAT_MS = 15_000
/** A socket silent for this long (and not just thawed from a frozen page) is dropped. */
export const DEADLINE_MS = 45_000
/** First retry delay; it doubles each try. */
export const BACKOFF_BASE_MS = 600
/** The longest a retry waits. */
export const BACKOFF_CAP_MS = 15_000

/** Wait before the next try. `attempt` is the number of tries already made in this outage (0 before the first retry).
 *  Zero when Hermes was seen answering during the try that just failed; otherwise 0.6 s doubling to the 15 s cap. */
export function retryDelayMs(attempt: number, readySeen: boolean): number {
  return readySeen ? 0 : Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.min(attempt, 5))
}

/** The header detail while waiting. `tries` is the count after this retry was counted (1 for the first). */
export function retryBanner(tries: number): string {
  return tries > 2 ? 'Starting Hermux…' : 'Reconnecting…'
}

/** What the shell is asked on this retry (`tries` counted as for `retryBanner`): watch for Hermes on the first try of
 *  an outage, start it on the 2nd and every 6th. */
export function retryHermesSteps(tries: number): { watch: boolean; start: boolean } {
  return { watch: tries === 1, start: tries === 2 || tries % 6 === 0 }
}

/** One liveness beat of an open socket. `fresh-window`: the page was frozen since the last beat (more than two beats
 *  apart), so the silence means nothing and the socket gets a new window, then a ping. `dead`: nothing arrived for
 *  `DEADLINE_MS`, so drop the socket. `ping`: all well, ping it. */
export type BeatDecision = 'ping' | 'fresh-window' | 'dead'

/** Decide one beat from the time now, the last beat's time and the time of the last frame or answered ping. */
export function beatDecision(now: number, lastBeat: number, aliveAt: number): BeatDecision {
  if (now - lastBeat > BEAT_MS * 2) return 'fresh-window'
  if (now - aliveAt >= DEADLINE_MS) return 'dead'
  return 'ping'
}
