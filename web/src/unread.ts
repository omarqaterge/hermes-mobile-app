// Unread chats and "time ago" for the drawer. session.list only has message counts and a start time, so this
// keeps, per profile, the count you last saw in each chat and when its count last changed (localStorage
// hm.seen.v1.<profile>). A chat is unread when it has more messages than you saw; the open chat is always read.
import type { SessionListRow } from '@hermes/shared/gateway-contract.generated'
import { setUnseen } from './bridge'
import { getState, setState } from './store'

interface Seen {
  n: number // messages you have seen
  c: number // messages last listed
  t: number // ms: when the count last changed (or the chat started)
}

const KEY = (p: string) => `hm.seen.v1.${p}`
const SINCE = '#since' // when tracking began (no chat id starts with #)
let cache: { profile: string; map: Record<string, Seen> } | null = null

function load(): Record<string, Seen> {
  const profile = getState().profile
  if (cache?.profile === profile) return cache.map
  let map: Record<string, Seen> = {}
  try {
    map = JSON.parse(localStorage.getItem(KEY(profile)) || '{}') || {}
  } catch {
    /* start fresh */
  }
  cache = { profile, map }
  return map
}

function save(map: Record<string, Seen>): void {
  try {
    const ids = Object.keys(map)
    if (ids.length > 1500) for (const id of ids.slice(0, ids.length - 1500)) if (id !== SINCE) delete map[id]
    localStorage.setItem(KEY(getState().profile), JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

function publish(map: Record<string, Seen>): void {
  const listed = new Set(getState().sessions.map(s => s.id))
  const unread = Object.keys(map).filter(id => id !== SINCE && listed.has(id) && map[id].c > map[id].n)
  const cur = getState().unread
  if (unread.length !== cur.length || unread.some((id, i) => id !== cur[i])) {
    setState({ unread })
    // the Android service mirrors this list as its sticky Done chip and the app-icon badge
    const { profile, sessions } = getState()
    setUnseen(profile, unread.map(id => ({ id, title: sessions.find(s => s.id === id)?.title || '' })))
  }
}

/** After every session.list: note new counts; the first list ever is the baseline (nothing unread). */
export function noteSessions(rows: SessionListRow[]): void {
  const map = load()
  const now = Date.now()
  if (!map[SINCE]) map[SINCE] = { n: 0, c: 0, t: now }
  const since = map[SINCE].t
  const open = getState().active?.storedId
  for (const r of rows) {
    const c = r.message_count ?? 0
    const e = map[r.id]
    if (!e) {
      // A chat that started after we began tracking was made elsewhere (a scheduled job, another device): unread
      // if it has messages. Older ones (first list, "Show older chats") are simply read.
      const started = (r.started_at || 0) * 1000
      map[r.id] = { n: started > since && r.id !== open ? 0 : c, c, t: started || now }
      continue
    }
    if (e.c !== c) {
      e.c = c
      e.t = now
    }
    if (r.id === open) e.n = c
  }
  save(map)
  publish(map)
}

/** Opening a chat reads it. */
export function markSeen(id: string | undefined | null): void {
  if (!id) return
  const map = load()
  const e = map[id]
  if (!e || e.n === e.c) return
  e.n = e.c
  save(map)
  publish(map)
}

/** When the chat last changed (ms), for "5 min ago". */
export function lastActive(row: SessionListRow): number {
  return load()[row.id]?.t ?? (row.started_at || 0) * 1000
}

export function ago(ms: number, now = Date.now()): string {
  if (!ms) return ''
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h`
  const d = Math.round(h / 24)
  if (d < 7) return `${d} d`
  if (d < 60) return `${Math.round(d / 7)} wk`
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
