// Hermes on the phone vs this app. Two jobs:
//  1. compatibility: the app talks to Hermes through a vendored client pinned to one Hermes build (__HERMES_TESTED__).
//     If the phone's Hermes is a different build, say so (Settings, and a one-time toast), and point at the app update.
//  2. updating Hermes itself from Settings, through the dashboard's own endpoints (/api/hermes/update*), which run
//     `hermes update` on the phone. The dashboard restarts during an update, so polling tolerates a gap.
import { useSyncExternalStore } from 'react'
import { api, qs } from './api'
import { reconnectNow } from './gateway'
import { toast } from './store'

/** "0.21.5+4582.gb8a8be1" → commits since the release tag + short sha (null when it isn't a git-describe string). */
export function parseBuild(v: string | undefined | null): { count: number; sha: string } | null {
  const m = /\+(\d+)\.g([0-9a-f]{4,40})/i.exec(String(v || ''))
  return m ? { count: parseInt(m[1], 10), sha: m[2].toLowerCase() } : null
}

export type Compat = 'same' | 'newer' | 'older' | 'unknown'

/** How the phone's Hermes build relates to the one this app was written against. */
export function compat(current: string | undefined | null, tested: string = __HERMES_TESTED__): Compat {
  const c = parseBuild(current)
  const t = parseBuild(tested)
  if (!c || !t) return 'unknown'
  const n = Math.min(c.sha.length, t.sha.length)
  if (c.sha.slice(0, n) === t.sha.slice(0, n)) return 'same'
  return c.count >= t.count ? 'newer' : 'older'
}

export type HermesUpdate = {
  phase: 'idle' | 'checking' | 'ready' | 'updating' | 'done' | 'error'
  current: string // derived version of the phone's Hermes
  behind: number | null // commits behind upstream; null = couldn't check, -1 = behind by an unknown number
  canApply: boolean
  msg: string
  log: string // last line of the update's output
}

let state: HermesUpdate = { phase: 'idle', current: '', behind: null, canApply: false, msg: '', log: '' }
const subs = new Set<() => void>()
const set = (p: Partial<HermesUpdate>) => {
  state = { ...state, ...p }
  subs.forEach(f => f())
}
export const useHermesUpdate = () =>
  useSyncExternalStore(
    f => (subs.add(f), () => subs.delete(f)),
    () => state
  )

type CheckResult = { current_version?: string; behind?: number | null; update_available?: boolean; can_apply?: boolean; message?: string | null }

export async function checkHermes(force = false): Promise<void> {
  if (state.phase === 'updating' || state.phase === 'checking') return
  set({ phase: 'checking', msg: '' })
  try {
    const r = await api<CheckResult>('GET', `/api/hermes/update/check?${qs(force ? { force: 'true' } : {})}`, undefined, { profile: false })
    set({
      phase: 'ready',
      current: r.current_version || state.current,
      behind: r.behind ?? null,
      canApply: Boolean(r.can_apply && r.update_available),
      msg: r.message || ''
    })
    noteCompat()
  } catch {
    set({ phase: 'idle', msg: "Couldn't ask Hermes about updates." })
  }
}

const SEEN = 'hm.hermesSeen'
/** One toast per Hermes build that differs from the tested one (a Hermes updated outside the app, say). */
function noteCompat(): void {
  const c = compat(state.current)
  if (c === 'same' || c === 'unknown') return
  try {
    if (localStorage.getItem(SEEN) === state.current) return
    localStorage.setItem(SEEN, state.current)
  } catch {
    /* show it anyway */
  }
  toast('This Hermes is a different version than the app was made for. If something breaks, update the app in Settings → About.', 'info', 9000)
}

const MAX_MS = 30 * 60_000
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

type ActionStatus = { running?: boolean; exit_code?: number | null; lines?: string[]; receipt?: { outcome?: string; post_version?: string } | null }

/** Starts `hermes update` on the phone and follows it (bounded to 30 min) until it ends or Hermes is back. */
export async function startHermesUpdate(): Promise<void> {
  if (state.phase === 'updating') return
  set({ phase: 'updating', msg: '', log: 'Starting…' })
  try {
    const r = await api<{ ok?: boolean; message?: string; error?: string }>('POST', '/api/hermes/update', {}, { profile: false })
    if (r.ok === false) return set({ phase: 'error', msg: r.message || 'Hermes refused to update.' })
  } catch (e) {
    return set({ phase: 'error', msg: (e as Error).message || "Couldn't start the update." })
  }
  const t0 = Date.now()
  let sawRunning = false
  let down = 0
  let ended = false
  while (Date.now() - t0 < MAX_MS) {
    await sleep(3000)
    try {
      const s = await api<ActionStatus>('GET', '/api/actions/hermes-update/status?lines=4', undefined, { profile: false })
      down = 0
      if (s.running) sawRunning = true
      const last = (s.lines || []).map(l => l.trim()).filter(Boolean).pop()
      if (last) set({ log: last.slice(0, 140) })
      if (!s.running && (sawRunning || s.exit_code != null)) {
        const ok = s.exit_code === 0 || s.receipt?.outcome === 'success'
        if (!ok) return set({ phase: 'error', msg: 'The update did not finish. Hermes may need a look in Termux.' })
        ended = true
        break
      }
    } catch {
      // Hermes restarts itself in the middle of an update: expected for a while, not an error.
      sawRunning = true
      down++
      set({ log: 'Hermes is restarting…' })
      if (down > 60) return set({ phase: 'error', msg: "Hermes didn't come back after the update. Open Termux to check it." })
    }
  }
  if (!ended) return set({ phase: 'error', msg: 'The update is taking very long. Check Termux.' })
  reconnectNow()
  // The version string changed: look again (this also raises the "app is older than Hermes" notice).
  set({ phase: 'idle' })
  await checkHermes(true)
  set({ phase: 'done', msg: 'Hermes is updated.' })
}
