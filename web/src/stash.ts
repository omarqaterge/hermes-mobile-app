// Drafts put aside from the composer (localStorage hm.stash.v1): newest first, at most STASH_MAX.
export interface Stash {
  id: string
  text: string
  at: number
  /** The stored id of the chat the draft was written in, or null for the new-chat screen. */
  chat: string | null
}

const KEY = 'hm.stash.v1'
export const STASH_MAX = 20

export function stashes(): Stash[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(v)) return []
    return v.filter((s): s is Stash => !!s && typeof s.id === 'string' && typeof s.text === 'string' && typeof s.at === 'number')
  } catch {
    return []
  }
}

function save(list: Stash[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

let seq = 0
export function pushStash(text: string, chat: string | null): Stash {
  const s: Stash = { id: `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`, text, at: Date.now(), chat }
  save([s, ...stashes()].slice(0, STASH_MAX))
  return s
}

/** Removes and returns the stash with this id (null when there is none). */
export function takeStash(id: string): Stash | null {
  const list = stashes()
  const s = list.find(x => x.id === id)
  if (!s) return null
  save(list.filter(x => x.id !== id))
  return s
}

export function clearStashes(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
