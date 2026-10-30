// Chat scrubber (components/Scrubber.tsx): one tick per message the user sent, positioned by message order.
import type { ChatItem } from './store'

export interface Mark {
  /** Index in the chat's items. */
  idx: number
  /** First line of the message (max 80 chars), or the first attachment's name. */
  text: string
}

/** The rail shows from this many user messages. */
export const SCRUB_MIN = 6
const MAX_TEXT = 80

const baseName = (p: string) => p.split(/[\\/]/).pop() || p

/** One mark per user item, in order. */
export function userMarks(items: ChatItem[]): Mark[] {
  const out: Mark[] = []
  items.forEach((it, idx) => {
    if (it.kind !== 'user') return
    let text = (it.text || '').split('\n').map(l => l.trim()).find(Boolean) || ''
    if (!text) {
      const file = it.files?.[0]
      const img = it.imagePaths?.[0]
      if (file) text = `📎 ${baseName(file)}`
      else if (img) text = `🖼 ${baseName(img)}`
      else if (it.images?.length || it.imageUrls?.length) text = '🖼 photo'
    }
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT - 1).trimEnd() + '…'
    out.push({ idx, text })
  })
  return out
}

/** The mark nearest to a finger position (0 = top of the rail, 1 = bottom); an index into `marks`. */
export function nearestMark(marks: Mark[], fraction: number): number {
  if (marks.length <= 1) return 0
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  return Math.round(f * (marks.length - 1))
}

/** The last mark at or above the item at the top of the screen (0 when none is). */
export function currentMark(marks: Mark[], topIdx: number): number {
  let cur = 0
  for (let k = 0; k < marks.length; k++) {
    if (marks[k].idx <= topIdx) cur = k
    else break
  }
  return cur
}
