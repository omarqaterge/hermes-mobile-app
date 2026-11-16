// Is this chat's agent ready? Hermes builds a chat's agent in the background (about 2 s) after create or resume and
// announces it with the first `session.info`. This file keeps the page's bookkeeping of that, per live chat (runtime
// id), as plain data with no RPCs and no store; gateway.ts asks it when to wait and does the sending itself.
//
//   unknown ──trackBuild──▶ building ──session.info (markBuilt) or 20 s──▶ ready
//      └──────────session.info before the create/resume answer (markBuilt)──────▶ ready
//   any state ──runSwitch──▶ switching ──the switch finishes or fails──▶ back to what it was
//
//   state      meaning                                                         a model pick   a send
//   unknown    never seen                                                      goes now       goes now
//   building   created or resumed, `session.info` not seen yet (20 s cap)      waits          goes now
//   ready      the agent was announced (the last 200 are remembered)           goes now       goes now
//   switching  a model switch is in flight (its `config.set` calls)            see below      waits for it
//
// A warm resume (a chat still live in Hermes) returns the same runtime id and sends no `session.info`: it is already
// `ready`, so it does not wait.
//
// Two bugs the rules exist for: a model switch sent before the build finished was silently lost (the agent was built
// with the profile default and every turn ran on it, although `config.set` answered OK), so a pick waits for the
// build; and a send right after a pick could run on the old model, so a send waits for the switch, and a failed
// switch never blocks it. A second pick while one is in flight replaces the first in `switching` (a send then waits
// for the newest only, which itself starts after the earlier ones settled, so Hermes gets the picks in order); a
// finished switch removes only its own entry.

/** How long a pick waits for `session.info` before going on anyway (never hang a pick on a missed event). */
export const BUILD_CAP_MS = 20_000
/** How many announced runtimes are remembered; the oldest is forgotten past this. */
export const READY_CAP = 200

export type BuildState = 'unknown' | 'building' | 'ready' | 'switching'

export interface AgentBuilds {
  /** A create or resume answered with this runtime id: start waiting for its agent, unless it is already known to be ready or building. */
  trackBuild(runtimeId: string): void
  /** The agent of this runtime was announced (`session.info`, or the 20 s cap): it is ready and anyone waiting goes on. Safe before `trackBuild`. */
  markBuilt(runtimeId: string): void
  /** Resolves when a model pick may touch this runtime: at once unless its agent is still being built. */
  whenBuilt(runtimeId: string): Promise<void>
  /** Resolves when a send may go: at once unless a model switch is in flight; a failed switch counts as finished. */
  whenSwitched(runtimeId: string): Promise<void>
  /** Run a model switch for this runtime and record it as in flight until it settles; its result or error is the caller's. It starts after any earlier switch of the same runtime has settled (failed or not), so the newest pick lands last. */
  runSwitch(runtimeId: string, work: () => Promise<void>): Promise<void>
  /** The state of one runtime, for readers and tests. A switch in flight shows as `switching` whatever the build says. */
  buildState(runtimeId: string): BuildState
}

/** The bookkeeping. `after` is the timer (injected so tests can run the 20 s cap without waiting); it defaults to `setTimeout`. */
export function createAgentBuilds(after: (fn: () => void, ms: number) => void = (fn, ms) => void setTimeout(fn, ms)): AgentBuilds {
  const builds = new Map<string, { done: Promise<void>; resolve: () => void }>()
  const ready = new Set<string>()
  const switching = new Map<string, Promise<void>>()

  function markBuilt(runtimeId: string): void {
    ready.add(runtimeId)
    if (ready.size > READY_CAP) ready.delete(ready.values().next().value!)
    const b = builds.get(runtimeId)
    if (!b) return
    builds.delete(runtimeId)
    b.resolve()
  }

  function trackBuild(runtimeId: string): void {
    if (!runtimeId || ready.has(runtimeId) || builds.has(runtimeId)) return
    let resolve!: () => void
    const done = new Promise<void>(r => (resolve = r))
    builds.set(runtimeId, { done, resolve })
    after(() => markBuilt(runtimeId), BUILD_CAP_MS)
  }

  async function whenBuilt(runtimeId: string): Promise<void> {
    await builds.get(runtimeId)?.done
  }

  async function whenSwitched(runtimeId: string): Promise<void> {
    await switching.get(runtimeId)?.catch(() => {})
  }

  async function runSwitch(runtimeId: string, work: () => Promise<void>): Promise<void> {
    // One after the other: Hermes must receive the picks in the order they were made, so the newest lands last. An
    // earlier switch that failed does not stop this one (its error is its own caller's).
    const earlier = switching.get(runtimeId)
    const run = earlier ? earlier.catch(() => {}).then(work) : work()
    switching.set(runtimeId, run)
    try {
      await run
    } finally {
      if (switching.get(runtimeId) === run) switching.delete(runtimeId)
    }
  }

  function buildState(runtimeId: string): BuildState {
    if (switching.has(runtimeId)) return 'switching'
    if (builds.has(runtimeId)) return 'building'
    return ready.has(runtimeId) ? 'ready' : 'unknown'
  }

  return { trackBuild, markBuilt, whenBuilt, whenSwitched, runSwitch, buildState }
}
