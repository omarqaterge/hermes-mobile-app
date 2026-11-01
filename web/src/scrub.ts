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

/** The line read against the marks, in the list's content (px): just under the top of the screen, sliding down to the
 * end of the list over the last screenful so that the end of the chat reaches the last mark. */
export function readLine(scrollTop: number, clientHeight: number, scrollHeight: number): number {
  const left = Math.max(0, scrollHeight - clientHeight - scrollTop)
  const slide = clientHeight > 0 && left < clientHeight ? 1 - left / clientHeight : 0
  return scrollTop + 10 + slide * Math.max(0, clientHeight - 10)
}

/** Where the screen is along the rail, counted in marks: 2 is on your third message, 2.5 halfway from it to the
 * fourth. `tops` are the marks' tops in the list's content (px, in order), `line` comes from `readLine`. */
export function railPosition(tops: number[], line: number): number {
  const n = tops.length
  if (!n || !(line >= tops[0])) return 0
  let k = 0
  while (k + 1 < n && tops[k + 1] <= line) k++
  if (k === n - 1) return k
  const gap = tops[k + 1] - tops[k]
  return gap > 0 ? k + Math.min(1, (line - tops[k]) / gap) : k
}
