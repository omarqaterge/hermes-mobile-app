// The one-time "What's new" sheet after an update: on the first start of a newer version it reads that version's
// CHANGELOG.md (at its tag, like update.ts) and lists every release since the one the user last saw. One request per
// start at most, started only after the chat has opened; dismissing it stores the version so it never comes back.
import { useSyncExternalStore } from 'react'
import { appVersion } from './bridge'
import { afterUpdatePlan, notesSince, type ReleaseNotes } from './releasenotes'

const REPO = 'omarqaterge/hermes-mobile-app'
/** localStorage: the last app version whose What's new was shown (or silently noted on a fresh install). */
export const WHATS_NEW_SEEN_KEY = 'hm.whatsNewSeen.v1'

function readSeen(): string | null {
  try {
    return localStorage.getItem(WHATS_NEW_SEEN_KEY)
  } catch {
    return null
  }
}
function writeSeen(v: string): void {
  try {
    localStorage.setItem(WHATS_NEW_SEEN_KEY, v)
  } catch {
    // no storage: the sheet may show again next start, nothing breaks
  }
}

let notes: ReleaseNotes[] = []
const subs = new Set<() => void>()
const set = (n: ReleaseNotes[]) => {
  notes = n
  subs.forEach(f => f())
}

/** The versions the after-update sheet lists, newest first; empty while there is nothing to show. */
export const useWhatsNewAfterUpdate = () =>
  useSyncExternalStore(
    f => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => notes
  )

let started = false

/** Called once after the chat opens. A fresh install only stores the version; an update reads the changelog. A read
 *  that fails (offline, rate limit, no file) or finds no section shows nothing and leaves the version unseen, so the
 *  next start tries again. */
export async function startWhatsNewAfterUpdate(): Promise<void> {
  if (started) return
  started = true
  const installed = appVersion().replace(/^v/i, '')
  const seen = readSeen()
  const plan = afterUpdatePlan(seen, installed)
  if (plan === 'remember') return writeSeen(installed)
  if (plan !== 'show' || !seen) return
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/CHANGELOG.md?ref=${encodeURIComponent('v' + installed)}`, { headers: { Accept: 'application/vnd.github.raw+json' } })
    if (!r.ok) return
    set(notesSince(await r.text(), seen, installed))
  } catch {
    // offline or rate-limited: try again next start
  }
}

/** "Got it" or ✕: the installed version is seen and the sheet goes away for good. */
export function dismissWhatsNewAfterUpdate(): void {
  writeSeen(appVersion().replace(/^v/i, ''))
  set([])
}
