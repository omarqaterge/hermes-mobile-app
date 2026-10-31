// Files a turn changed, for the card at the end of the turn (components/Changes.tsx).
import type { ChatItem } from './store'
import { stripAnsi } from './components/Diff'

export interface FileChange {
  path: string
  added: number
  removed: number
  /** The edits' diffs in order (empty when none was recorded). */
  diffs: string[]
  /** A `write_file` was used: the file was created or rewritten. */
  rewritten: boolean
}
export interface TurnChanges {
  files: FileChange[]
  added: number
  removed: number
}

/** Hermes tools that write files. */
export const EDIT_TOOLS = new Set(['write_file', 'patch'])
/** Longest diff text kept per file. */
export const MAX_DIFF = 200000

/** Count added and removed lines of a unified diff (file headers and hunk headers do not count). */
export function diffCounts(diff: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const l of stripAnsi(diff).split('\n')) {
    if (/^(\+\+\+|---)( |$)/.test(l)) continue
    if (l.startsWith('+')) added++
    else if (l.startsWith('-')) removed++
  }
  return { added, removed }
}

const lines = (v: unknown) => (typeof v === 'string' && v ? v.split('\n').length : 0)

/** `+N −M` of one finished edit tool, from its diff or, without one, from its arguments. */
function toolCounts(it: Extract<ChatItem, { kind: 'tool' }>): { added: number; removed: number } {
  if (it.inlineDiff) return diffCounts(it.inlineDiff)
  const a = it.args ?? {}
  if (it.name === 'write_file') return { added: lines(a.content), removed: 0 }
  return { added: lines(a.new_string), removed: lines(a.old_string) }
}

/** Map from the index of each finished turn's last item to that turn's changes (only turns with changes). */
export function turnChanges(items: ChatItem[], running: boolean): Map<number, TurnChanges> {
  const out = new Map<number, TurnChanges>()
  let files = new Map<string, FileChange>()
  const close = (last: number) => {
    if (last >= 0 && files.size) {
      const list = [...files.values()]
      out.set(last, { files: list, added: list.reduce((n, f) => n + f.added, 0), removed: list.reduce((n, f) => n + f.removed, 0) })
    }
    files = new Map()
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind === 'user' && i > 0) close(i - 1)
    if (it.kind !== 'tool' || !EDIT_TOOLS.has(it.name) || it.status !== 'done') continue
    const path = it.args?.path
    if (typeof path !== 'string' || !path) continue
    const c = toolCounts(it)
    const f = files.get(path) ?? { path, added: 0, removed: 0, diffs: [], rewritten: false }
    f.added += c.added
    f.removed += c.removed
    if (it.name === 'write_file') f.rewritten = true
    if (it.inlineDiff && !f.diffs.includes(MAX_DIFF_MARK)) {
      const sofar = f.diffs.reduce((n, d) => n + d.length, 0)
      if (sofar + it.inlineDiff.length > MAX_DIFF) f.diffs.push(it.inlineDiff.slice(0, Math.max(0, MAX_DIFF - sofar)), MAX_DIFF_MARK)
      else f.diffs.push(it.inlineDiff)
    }
    files.set(path, f)
  }
  if (!(running && items.length)) close(items.length - 1)
  return out
}
const MAX_DIFF_MARK = '\n… (truncated)'

/** A long path shortened for a row: `~/…/dir/name.ext`. */
export function shortPath(p: string): string {
  const q = p.replace(/^\/(root|home\/[^/]+)\//, '~/')
  if (q.length <= 36) return q
  const parts = q.split('/')
  if (parts.length <= 3) return q
  return `${parts[0]}/…/${parts.slice(-2).join('/')}`
}
