// When each chat was last on screen (localStorage hm.visit.v1: chat id → ms), so a chat opened after new messages
// arrived can show "New since your last visit" before the first message the user has not seen.
import type { ChatItem } from './store'

const KEY = 'hm.visit.v1'
const MAX = 500

function all(): Record<string, number> {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || '{}')
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {}
  } catch {
    return {}
  }
}

/** When the chat was last on screen (ms), or null when it never was on this phone. */
export function lastVisit(storedId: string): number | null {
  const t = all()[storedId]
  return typeof t === 'number' && Number.isFinite(t) ? t : null
}

/** Record that the chat is being seen now (or at `at`). The oldest entries beyond 500 are dropped. */
export function markVisit(storedId: string, at: number = Date.now()): void {
  if (!storedId) return
  const m = all()
  delete m[storedId] // re-insert last: the oldest visits are dropped first
  m[storedId] = at
  const keys = Object.keys(m)
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) delete m[k]
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* ignore */
  }
}

/** Index of the first user/assistant item newer than `since`, or -1. Never 0 (nothing to separate from). */
export function firstUnseen(items: ChatItem[], since: number | null): number {
  if (since === null) return -1
  const i = items.findIndex(it => (it.kind === 'user' || it.kind === 'assistant') && typeof it.at === 'number' && it.at > since)
  return i > 0 ? i : -1
}
