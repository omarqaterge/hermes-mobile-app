// Hermes on the phone vs this app. Two jobs:
// The app talks to Hermes through a vendored client pinned to one Hermes build (__HERMES_TESTED__).
//     If the phone's Hermes is a different build, say so (Settings, and a one-time toast), and point at the app update.
// Deliberately NO "update Hermes" button: Hermes updates ship with an app release, after the app has been adapted to them.
import { useSyncExternalStore } from 'react'
import { api } from './api'
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

export type HermesBuild = {
  checking: boolean
  current: string // build string of the phone's Hermes, e.g. 0.21.5+4582.gb8a8be1 ('' until known)
}

let state: HermesBuild = { checking: false, current: '' }
const subs = new Set<() => void>()
const set = (p: Partial<HermesBuild>) => {
  state = { ...state, ...p }
  subs.forEach(f => f())
}
export const useHermesBuild = () =>
  useSyncExternalStore(
    f => (subs.add(f), () => subs.delete(f)),
    () => state
  )

/** Reads the phone's Hermes build (the dashboard's update check also reports it; its update fields are ignored). */
export async function checkHermes(): Promise<void> {
  if (state.checking) return
  set({ checking: true })
  try {
    const r = await api<{ current_version?: string }>('GET', '/api/hermes/update/check', undefined, { profile: false })
    set({ checking: false, current: r.current_version || state.current })
    noteCompat()
  } catch {
    set({ checking: false })
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
