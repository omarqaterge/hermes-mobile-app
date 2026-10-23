// Order of the drawer's Chats list. Activity (a message sent or a reply arriving) never moves a chat:
// the default order is by creation time, newest first; a saved custom order keeps its places and any
// chat missing from it goes on top by creation time. "Sort by recent" is a one-time snapshot.
export interface OrderRow {
  id: string
  started_at?: number
}

const created = (r: OrderRow) => r.started_at || 0

export function orderChats<T extends OrderRow>(rows: T[], manual: string[] | null): T[] {
  const pos = new Map((manual ?? []).map((id, i) => [id, i]))
  // Unplaced chats (new ones) sort before every placed one, newest first.
  const key = (r: T) => (manual ? (pos.get(r.id) ?? -1e12 - created(r)) : -created(r))
  return [...rows].sort((a, b) => key(a) - key(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** The ids sorted by most recent activity right now, to store as a custom order. */
export function recentIds<T extends OrderRow>(rows: T[], activity: (r: T) => number): string[] {
  return [...rows].sort((a, b) => activity(b) - activity(a) || created(b) - created(a)).map(r => r.id)
}
