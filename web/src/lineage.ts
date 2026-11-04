// Which chat ids are the same chat. A context compression gives a chat a new stored id; a restart or a resume gives it a new
// live (runtime) id. The app's record of chats that read phone data (PhoneDataChats.java) holds the ids a read named, so the
// page must ask about EVERY id a chat has had, not only today's (docs/decisions/phone-data-read-only.md, "Chats that have read
// phone data"). This module keeps the page's own memory of those links: every pair it sees from Hermes (a resume's requested
// and stored ids, the session list's id and resolved id or parent, a compression's old and new id, a session.info that names
// another stored id) lands in one group, kept in localStorage so it survives a restart. Ids only.
//
// Limits: only links the page has seen are known. A chat compressed on another device, or whose page storage was cleared, has
// none, and then only its own ids and what the app recorded for them are asked about (the plugin sends the compression chain
// of a read, which covers a read made after the compression).

const KEY = 'hm.lineage.v1'
const MAX_GROUPS = 300
const MAX_STORED = 24 // stored ids per chat; the oldest go
const MAX_LIVE = 8 // live ids per chat; the oldest go

interface Group {
  s: string[] // stored ids, oldest first
  r: string[] // live (runtime) ids, oldest first
}

let groups: Group[] | null = null

function load(): Group[] {
  if (groups) return groups
  groups = []
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (Array.isArray(raw))
      for (const g of raw) {
        const s = Array.isArray(g?.s) ? g.s.filter(ok) : []
        const r = Array.isArray(g?.r) ? g.r.filter(ok) : []
        if (s.length + r.length > 1) groups.push({ s, r })
      }
  } catch {
    /* storage unavailable or damaged: start with what this run learns */
  }
  return groups
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(groups))
  } catch {
    /* storage unavailable: kept for this run */
  }
}

const ok = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128

const uniq = (a: string[]): string[] => [...new Set(a)]

/** These ids belong to one chat (stored ids, and optionally its live id). Merges any groups they touch. */
export function noteLineage(stored: readonly unknown[], live?: unknown): void {
  const s = uniq(stored.filter(ok))
  const r = ok(live) ? [live] : []
  if (s.length + r.length < 2) return
  const all = load()
  const mine = new Set([...s, ...r])
  const hit = all.filter(g => g.s.some(x => mine.has(x)) || g.r.some(x => mine.has(x)))
  const merged: Group = { s: [], r: [] }
  for (const g of hit) {
    merged.s.push(...g.s)
    merged.r.push(...g.r)
  }
  merged.s = uniq([...merged.s, ...s])
  merged.r = uniq([...merged.r, ...r])
  const before = JSON.stringify(hit.length === 1 ? hit[0] : null)
  merged.s = merged.s.slice(-MAX_STORED)
  merged.r = merged.r.slice(-MAX_LIVE)
  if (hit.length === 1 && JSON.stringify(merged) === before) return // nothing new
  const rest = all.filter(g => !hit.includes(g))
  rest.push(merged)
  groups = rest.slice(-MAX_GROUPS)
  save()
}

/** Every other id this page knows for the same chat as `id` (stored and live). Empty when it knows none. */
export function lineageOf(id: string | null | undefined): string[] {
  if (!id) return []
  const g = load().find(x => x.s.includes(id) || x.r.includes(id))
  return g ? [...g.s, ...g.r].filter(x => x !== id) : []
}

/** A session list row's links: its id, the id it resolves to, and a parent or lineage when the row says so. */
export function noteListRow(row: unknown): void {
  const r = row as { id?: unknown; resolved_id?: unknown; parent_session_id?: unknown; _lineage_ids?: unknown } | null
  if (!r) return
  const ids: unknown[] = [r.id, r.resolved_id, r.parent_session_id]
  if (Array.isArray(r._lineage_ids)) ids.push(...r._lineage_ids.slice(0, 24))
  noteLineage(ids)
}

/** Test hook: forget everything held in memory. */
export function resetLineageForTests(): void {
  groups = null
}
