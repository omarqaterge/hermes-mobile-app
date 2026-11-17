// Order of the side panel's Chats list (spec 3.13). The default order is by last activity, newest first, but from a
// snapshot (chatsnapshot.ts): the activity times are read at a few moments (the panel opens, the bot changes, a chat is
// created, deleted, archived or restored) and frozen in between, so a message that arrives never moves a row while
// someone is looking. A saved custom order keeps its places and any chat missing from it goes on top by creation time.
// "Sort by recent" is a one-time snapshot stored as a custom order.
// The order is of top-level chats only; rows nested under a chat (sub-agents, later) are drawn inside that chat's own
// row container, so they move with it and never need a place of their own here.
export interface OrderRow {
  id: string
  started_at?: number
}

/** When a chat was created, in ms. */
export const createdMs = (r: OrderRow): number => (r.started_at || 0) * 1000

const byId = (a: OrderRow, b: OrderRow) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** The unpinned chats in list order. With no custom order: by `activity` (ms), newest first, then the newer creation;
 *  `activity` defaults to the creation time. With a custom order: its saved places, unplaced (new) chats on top,
 *  newest created first. */
export function orderChats<T extends OrderRow>(rows: T[], manual: string[] | null, activity: (r: T) => number = createdMs): T[] {
  if (manual) {
    const pos = new Map(manual.map((id, i) => [id, i]))
    // Unplaced chats (new ones) sort before every placed one, newest first.
    const key = (r: T) => pos.get(r.id) ?? -1e12 - createdMs(r) / 1000
    return [...rows].sort((a, b) => key(a) - key(b) || byId(a, b))
  }
  return [...rows].sort((a, b) => activity(b) - activity(a) || createdMs(b) - createdMs(a) || byId(a, b))
}

/** The ids sorted by most recent activity right now, to store as a custom order. */
export function recentIds<T extends OrderRow>(rows: T[], activity: (r: T) => number): string[] {
  return [...rows].sort((a, b) => activity(b) - activity(a) || createdMs(b) - createdMs(a)).map(r => r.id)
}

/** The activity times of a snapshot: each listed chat's time now. */
export function activityTimes<T extends OrderRow>(rows: T[], activity: (r: T) => number): Map<string, number> {
  return new Map(rows.map(r => [r.id, activity(r)]))
}

/** Whether two snapshots' times are the same (same chats, same times). */
export function sameTimes(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false
  for (const [id, t] of a) if (b.get(id) !== t) return false
  return true
}

/** A frozen activity: a chat's time from the snapshot, or, for a chat that came after it, its time now. */
export function frozenActivity<T extends OrderRow>(times: Map<string, number>, live: (r: T) => number): (r: T) => number {
  return r => times.get(r.id) ?? live(r)
}

/** The snapshot's times for a new list of chats, without sorting the others again: a chat the snapshot has keeps its
 *  time; a chat it lacks gets its time now when that is no newer than every time in it (a longer page, "Show older
 *  chats": it joins at the bottom), else its creation time (an old chat whose new message brought it into the page is
 *  placed where it was made, out of the way, until the next snapshot puts it on top). Chats no longer listed drop out. */
export function mergeListed<T extends OrderRow>(times: Map<string, number>, rows: T[], live: (r: T) => number): Map<string, number> {
  let oldest = Infinity
  for (const t of times.values()) oldest = Math.min(oldest, t)
  const out = new Map<string, number>()
  for (const r of rows) {
    const t = times.get(r.id)
    if (t !== undefined) out.set(r.id, t)
    else {
      const now = live(r)
      out.set(r.id, now <= oldest ? now : createdMs(r))
    }
  }
  return out
}

/** The date group of a chat's last activity, as seen at `now` (the snapshot's time, so headings stay put too). */
export function dayLabel(ms: number, now: number = Date.now()): string {
  if (!ms) return 'Older'
  const startOf = (x: number) => new Date(new Date(x).toDateString()).getTime()
  const days = Math.round((startOf(now) - startOf(ms)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'This week'
  if (days < 31) return 'This month'
  return 'Older'
}
