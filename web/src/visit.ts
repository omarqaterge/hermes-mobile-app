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

// ── away and back with the same chat open ───────────────────
// Leaving the app (Home, another app, screen off) with a chat open and coming back keeps that chat on screen, so
// nothing reopens it. The shell says when the app goes away (window.hermesPause) and comes back (window.hermesResume);
// the page's own visibilitychange says the same where the WebView reports it. Whichever comes first counts.

let away: { chat: string; at: number } | null = null
let back: { chat: string; at: number; back: number } | null = null
const backListeners = new Set<() => void>()

/** The app went to the background with `chat` open: it was seen until now. A second call before noteBack is ignored. */
export function noteAway(chat: string | undefined): void {
  if (away) return
  const at = Date.now()
  if (chat) markVisit(chat, at)
  away = { chat: chat || '', at }
}

/** The app is back on screen. Tells the chat view, which looks for messages that arrived meanwhile. */
export function noteBack(): void {
  if (!away) return
  back = { ...away, back: Date.now() }
  away = null
  backListeners.forEach(l => l())
}

/** True between noteAway and noteBack: nothing is being watched. */
export function isAway(): boolean {
  return away !== null
}

/** The last time the app came back: which chat was open, when it left and when it came back. */
export function lastBack(): { chat: string; at: number; back: number } | null {
  return back
}

export function onBack(fn: () => void): () => void {
  backListeners.add(fn)
  return () => backListeners.delete(fn)
}

/** Messages that arrive with the backlog right after coming back are stamped when they are processed, not when Hermes
 * wrote them, so they count as "while away" for this long after the return. */
export const BACK_GRACE_MS = 5000

/** Index of the first user/assistant item stamped after `awayAt` and no later than `backAt` + BACK_GRACE_MS, or -1.
 * Never 0 (nothing to separate from). */
export function newWhileAway(items: ChatItem[], awayAt: number, backAt: number): number {
  const i = items.findIndex(
    it => (it.kind === 'user' || it.kind === 'assistant') && typeof it.at === 'number' && it.at > awayAt && it.at <= backAt + BACK_GRACE_MS
  )
  return i > 0 ? i : -1
}
