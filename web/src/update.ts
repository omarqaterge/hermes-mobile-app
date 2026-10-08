// Settings → App update: asks GitHub for the newest release of this app and, on a tap, has the Android shell
// download and install it (the system installer still asks you to confirm).
import { useSyncExternalStore } from 'react'
import { appVersion, installUpdate } from './bridge'

const REPO = 'omarqaterge/hermes-mobile-app'

export type UpdateState = {
  phase: 'idle' | 'checking' | 'uptodate' | 'available' | 'downloading' | 'installing' | 'permission' | 'error'
  latest: string
  url: string
  pct: number
  msg: string
}

let state: UpdateState = { phase: 'idle', latest: '', url: '', pct: 0, msg: '' }
const subs = new Set<() => void>()
const set = (p: Partial<UpdateState>) => {
  state = { ...state, ...p }
  subs.forEach(f => f())
}

export const useUpdate = () =>
  useSyncExternalStore(
    f => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => state
  )

/** "0.8.21" → [0,8,21]; anything that isn't dotted numbers sorts as 0. */
const parts = (v: string) => v.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest)
  const b = parts(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0)
    if (d) return d > 0
  }
  return false
}

let checkedAt = 0

/** One GitHub request (no polling). Skipped while a download is running or when checked in the last minute. */
export async function checkForUpdate(force = false): Promise<void> {
  if (state.phase === 'downloading' || state.phase === 'installing') return
  if (!force && Date.now() - checkedAt < 60_000 && state.phase !== 'error') return
  checkedAt = Date.now()
  set({ phase: 'checking', msg: '' })
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    if (!r.ok) throw new Error(r.status === 403 ? 'GitHub is limiting requests, try again later.' : `GitHub answered ${r.status}.`)
    const rel = (await r.json()) as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] }
    const latest = String(rel.tag_name || '').replace(/^v/i, '')
    const apk = (rel.assets || []).find(a => /\.apk$/i.test(a.name))
    if (!latest) throw new Error('No release found.')
    if (!isNewer(latest, appVersion())) return set({ phase: 'uptodate', latest, url: '' })
    if (!apk) throw new Error(`Version ${latest} has no app file yet.`)
    set({ phase: 'available', latest, url: apk.browser_download_url })
  } catch (e) {
    set({ phase: 'error', msg: e instanceof TypeError ? "Can't reach GitHub. Check your connection." : (e as Error).message })
  }
}

export function startUpdate(): void {
  if (!state.url) return
  set({ phase: 'downloading', pct: 0, msg: '' })
  if (!installUpdate(state.url)) set({ phase: 'error', msg: 'Updating works inside the Android app only.' })
}

/** Called by the Android shell with progress: window.hermesUpdate(state, percent, message). */
;(window as unknown as { hermesUpdate?: (s: string, p: number, m: string) => void }).hermesUpdate = (s, p, m) => {
  if (s === 'downloading') set({ phase: 'downloading', pct: p })
  else if (s === 'installing') set({ phase: 'installing', pct: 100 })
  else if (s === 'permission') set({ phase: 'permission', msg: m })
  else if (s === 'error') set({ phase: 'error', msg: m || 'Update failed.' })
}
