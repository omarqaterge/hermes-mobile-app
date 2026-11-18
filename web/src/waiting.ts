// The feed's list of open requests (`GET /activity`, `waiting`) as this page should show it. When a request ends here (it
// was answered, or Hermes withdrew it) the plugin hears of it a moment later, so for a few seconds the feed can still count
// it. This works out what is really left, from how many the feed counted and how many ended here: a chat with another
// request open stays listed. After ENDED_HOLD_S the feed is simply believed again, so a wrong guess can't last.
import type { WaitingItem } from './store'

export const ENDED_HOLD_S = 5

/** The one thing the feed may say about who asks. `activity.json` can be edited by an agent running as Hermes's user, so
 *  nothing it holds is ever shown as words: only this exact value counts. */
export const SUB_AGENT = 'A sub-agent'
const FEED_KINDS = new Set(['approval', 'phone_data', 'question'])
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The feed's list, taking only what the plugin writes. A kind it doesn't know becomes empty: the neutral words. */
export function cleanWaiting(raw: unknown): WaitingItem[] {
  if (!Array.isArray(raw)) return []
  const out: WaitingItem[] = []
  for (const w of raw as Array<Partial<WaitingItem> | null>) {
    if (!w || typeof w !== 'object' || typeof w.session !== 'string' || !w.session || !isTime(w.since) || !isTime(w.until)) continue
    out.push({
      session: w.session,
      kind: typeof w.kind === 'string' && FEED_KINDS.has(w.kind) ? w.kind : '',
      who: w.who === SUB_AGENT ? SUB_AGENT : '',
      profile: typeof w.profile === 'string' ? w.profile : '',
      since: w.since,
      until: w.until,
      open: Number.isInteger(w.open) && (w.open as number) > 0 ? w.open : 1,
      last: isTime(w.last) ? w.last : w.since
    })
  }
  return out
}

export interface EndedChat {
  /** When its last request ended here (s). */
  at: number
  /** How many requests the feed counted for the chat when the first ended; null if it listed none. */
  seen: number | null
  /** How many have ended here since. */
  count: number
}

const openIn = (list: WaitingItem[], chat: string) => list.reduce((n, w) => (w.session === chat ? n + (w.open ?? 1) : n), 0)

export function noteEnded(ended: Map<string, EndedChat>, chat: string, listed: WaitingItem[], now: number): void {
  const cur = ended.get(chat)
  if (cur && now - cur.at < ENDED_HOLD_S) {
    cur.at = now
    cur.count++
    return
  }
  ended.set(chat, { at: now, seen: openIn(listed, chat) || null, count: 1 })
}

/** The entries to show: all but those of a chat whose open requests have, as far as this page knows, all ended. */
export function visibleWaiting(list: WaitingItem[], ended: Map<string, EndedChat>, now: number): WaitingItem[] {
  return list.filter(w => {
    const e = ended.get(w.session)
    if (!e || now - e.at >= ENDED_HOLD_S) return true
    const mine = list.filter(x => x.session === w.session)
    if (mine.some(x => (x.last ?? x.since) > e.at)) return true // one began after that: it is new
    const open = openIn(mine, w.session)
    return (e.seen === null ? open - e.count : Math.min(open, e.seen - e.count)) > 0
  })
}

/** Drops what no longer matters: chats the feed stopped listing, and records past their time. */
export function forgetEnded(ended: Map<string, EndedChat>, listed: WaitingItem[], now: number): void {
  for (const [chat, e] of ended) if (now - e.at >= ENDED_HOLD_S || !listed.some(w => w.session === chat)) ended.delete(chat)
}
