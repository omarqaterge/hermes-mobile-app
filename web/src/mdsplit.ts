// A reply that arrives in pieces was read as Markdown from its first character on every update, and every code block
// coloured again: two thirds of the page's work during a long answer. splitStream cuts the text into parts at the
// start of a top-level block (a paragraph, list, table, code block…); a finished part never changes again, so the
// page draws it once and only reads the last, still growing part on each update.
//
// Where a cut may go is decided by the Markdown parser itself, never by guessing from blank lines, and each cut is
// checked: the two sides read alone must give the same blocks as the text read as one.
// - only whole lines are looked at (a line still arriving can turn out to be something else: `***` a rule, `***bold***`
//   text), and only a block that another block already follows is finished;
// - a block with raw HTML, a task box or a video link stays with everything after it in the last part: HTML is read
//   again as one document after Markdown (a tag may close paragraphs later), task boxes are numbered and video players
//   counted per reply;
// - a link or footnote definition (`[1]: https://…`) changes text anywhere in the reply, so such a reply is one part.
// The parts drawn one after another give the same elements as the whole text drawn at once.
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { Nodes, RootContent } from 'mdast'
import { embedOf } from './videoembed'

/** The Markdown extensions of every reply; the splitter and the drawing must read the same language. */
export const REMARK = [remarkGfm, [remarkMath, { singleDollarTextMath: true }]] as const

/** A finished part is at least this long: every part costs a parser of its own when the reply completes. */
export const MIN_PART = 300
/** Look for the next cut only after this many new characters of whole lines. */
const LOOK_EVERY = 100

export type Split = {
  /** The text in parts, in order; all but the last are finished. */
  parts: string[]
  /** The finished parts joined: the text must still start with it. */
  head: string
  /** How far whole lines have been looked at. */
  seen: number
  /** False once the rest of the reply has to stay in one part. */
  open: boolean
}

let parser: ReturnType<typeof makeParser> | null = null
const makeParser = () => unified().use(remarkParse).use(remarkGfm).use(remarkMath, { singleDollarTextMath: true }).freeze()

const read = (md: string): RootContent[] => (parser ??= makeParser()).parse(md).children
// Blocks without their positions, to compare a part read alone with the same blocks read inside the text.
const plain = (nodes: RootContent[]): string => JSON.stringify(nodes, (k, v) => (k === 'position' ? undefined : v))

const kidsOf = (n: Nodes): Nodes[] => ('children' in n ? (n.children as Nodes[]) : [])
const some = (n: Nodes, test: (n: Nodes) => boolean): boolean => test(n) || kidsOf(n).some(c => some(c, test))

const isDefinition = (n: Nodes) => n.type === 'definition' || n.type === 'footnoteDefinition' || n.type === 'footnoteReference' || n.type === 'linkReference' || n.type === 'imageReference'
// `<br>` is the one tag models write all the time (in table cells) that cannot reach past itself.
const staysWithRest = (n: Nodes) =>
  (n.type === 'html' && !/^<br\s*\/?>$/i.test(n.value.trim())) ||
  (n.type === 'listItem' && typeof n.checked === 'boolean') ||
  ((n.type === 'link' || n.type === 'image') && embedOf(n.url) !== null)

const FENCE = /^ {0,3}(?:```|~~~)/
// The start of the line a block begins on (its leading spaces belong to it: an indented code block needs them).
const lineStart = (piece: string, n: RootContent): number => piece.lastIndexOf('\n', (n.position?.start.offset ?? 0) - 1) + 1

/** The split for `text`, continuing `prev` (the split of an earlier, shorter version of the same reply) when it can.
 *  `minPart` and `lookEvery` are for tests, which cut at every place a cut may go. */
export function splitStream(prev: Split | null, text: string, minPart = MIN_PART, lookEvery = LOOK_EVERY): Split {
  const s: Split = prev && text.startsWith(prev.head) ? prev : { parts: [text], head: '', seen: 0, open: true }
  const finished = s.parts.slice(0, -1)
  const rest = text.slice(s.head.length)
  const keep = (seen: number, open: boolean): Split => ({ parts: [...finished, rest], head: s.head, seen, open })
  if (!s.open) return keep(s.seen, false)
  const end = text.lastIndexOf('\n') + 1 // whole lines only
  if (end - s.head.length < minPart || end - s.seen < lookEvery) return keep(s.seen, true)
  const piece = text.slice(s.head.length, end)
  const kids = read(piece)
  if (kids.some(k => some(k, isDefinition))) return { parts: [text], head: '', seen: end, open: false }
  const stop = kids.findIndex(k => some(k, staysWithRest))
  let last = stop >= 0 ? stop : kids.length - 1 // the first block that is not finished, or must stay with the rest
  // No part starts with an indented code block: the parser reads a list after one differently at the start of a text.
  while (last > 0 && kids[last].type === 'code' && !FENCE.test(piece.slice(lineStart(piece, kids[last])))) last--
  const cut = last > 0 ? lineStart(piece, kids[last]) : 0
  // Worth a part: enough text before the cut, or a long block after it (which would otherwise hold the text before it back).
  if (cut > 0 && (stop >= 0 || cut >= minPart || piece.length - cut >= minPart)) {
    const part = piece.slice(0, cut)
    // The parser has the last word: each side read alone must give the blocks it has in the text read as one. (It
    // doesn't always: a lone `-` after an indented code block is a list on its own and plain text after the code.)
    if (plain(read(part)) === plain(kids.slice(0, last)) && plain(read(piece.slice(cut))) === plain(kids.slice(last)))
      return { parts: [...finished, part, rest.slice(cut)], head: s.head + part, seen: end, open: stop < 0 }
  }
  return keep(end, stop < 0)
}
