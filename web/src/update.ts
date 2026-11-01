// Settings → App update: asks GitHub for the newest release of this app and, on a tap, has the Android shell
// download and install it (the system installer still asks you to confirm). When a newer release is there it also reads
// that release's CHANGELOG.md, so "What's new" can list every version between the installed one and the newest.
import { useSyncExternalStore } from 'react'
import { appVersion, installUpdate } from './bridge'
import { isNewer, notesSince, type ReleaseNotes } from './releasenotes'

export { isNewer }

const REPO = 'omarqaterge/hermes-mobile-app'

export type UpdateState = {
  phase: 'idle' | 'checking' | 'uptodate' | 'available' | 'downloading' | 'installing' | 'permission' | 'error'
  latest: string
  url: string
  pct: number
  msg: string
  /** What's new: the CHANGELOG.md sections newer than the installed version, newest first; empty until read. */
  notes: ReleaseNotes[]
}

let state: UpdateState = { phase: 'idle', latest: '', url: '', pct: 0, msg: '', notes: [] }
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

/** Reads CHANGELOG.md as it is at the release's tag (one request, same host as the release check). A failure only
 *  leaves "What's new" out: the update itself still works. */
async function loadNotes(tag: string, latest: string): Promise<void> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/CHANGELOG.md?ref=${encodeURIComponent(tag)}`, { headers: { Accept: 'application/vnd.github.raw+json' } })
    if (!r.ok) return
    const notes = notesSince(await r.text(), appVersion(), latest)
    if (state.latest === latest) set({ notes })
  } catch {
    // offline or rate-limited: no notes this time
  }
}

let checkedAt = 0

/** One GitHub request (no polling), plus one for the changelog when a new version is found. Skipped while a download is running or when checked in the last minute. */
export async function checkForUpdate(force = false): Promise<void> {
  if (state.phase === 'downloading' || state.phase === 'installing') return
  if (!force && Date.now() - checkedAt < 60_000 && state.phase !== 'error') return
  checkedAt = Date.now()
  set({ phase: 'checking', msg: '' })
  const before = state.latest
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    if (!r.ok) throw new Error(r.status === 403 ? 'GitHub is limiting requests, try again later.' : `GitHub answered ${r.status}.`)
    const rel = (await r.json()) as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] }
    const latest = String(rel.tag_name || '').replace(/^v/i, '')
    const apk = (rel.assets || []).find(a => /\.apk$/i.test(a.name))
    if (!latest) throw new Error('No release found.')
    if (!isNewer(latest, appVersion())) return set({ phase: 'uptodate', latest, url: '', notes: [] })
    if (!apk) throw new Error(`Version ${latest} has no app file yet.`)
    const known = latest === before && state.notes.length > 0
    set({ phase: 'available', latest, url: apk.browser_download_url, notes: known ? state.notes : [] })
    if (!known) void loadNotes(String(rel.tag_name), latest)
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
