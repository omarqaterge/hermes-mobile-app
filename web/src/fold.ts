import type { ChatItem } from './store'
import { runSummary } from './toolsay'

/** A run of tool calls folded into one "Ran N tools" line. Reasoning-only replies between the calls belong to it. */
export interface ToolRun {
  /** Index of the run's first item (the row that shows the header) and one past its last. */
  start: number
  end: number
  tools: number
  /** Summed tool durations, seconds. */
  secs: number
  errors: number
  running: boolean
  /** Distinct tool names, in order of first use. */
  names: string[]
  /** What the calls did, in plain words: "ran 2 commands and read 1 file" (`runSummary`). */
  summary: string
}

/** Fewer calls than this stay as plain cards. */
export const FOLD_MIN = 3

const inRun = (it: ChatItem) => it.kind === 'tool' || (it.kind === 'assistant' && !it.text.trim() && !it.error && !it.warning)

/** Runs of at least FOLD_MIN tool calls with nothing but tool calls and reasoning between them. */
export function toolRuns(items: ChatItem[]): ToolRun[] {
  const runs: ToolRun[] = []
  let i = 0
  while (i < items.length) {
    if (items[i].kind !== 'tool') {
      i++
      continue
    }
    let j = i
    let last = i
    while (j < items.length && inRun(items[j])) {
      if (items[j].kind === 'tool') last = j
      j++
    }
    const end = last + 1 // a reasoning-only reply after the last call belongs to the next text, not the run
    const tools = items.slice(i, end).filter((x): x is Extract<ChatItem, { kind: 'tool' }> => x.kind === 'tool')
    if (tools.length >= FOLD_MIN) {
      runs.push({
        start: i,
        end,
        tools: tools.length,
        secs: tools.reduce((s, t) => s + (t.duration || 0), 0),
        errors: tools.filter(t => t.status === 'error').length,
        running: tools.some(t => t.status === 'running' || t.status === 'generating'),
        names: [...new Set(tools.map(t => t.name))],
        summary: runSummary(tools)
      })
    }
    i = end
  }
  return runs
}

export type Fold = { head: ToolRun; open: boolean; hidden: boolean } | { hidden: true }

/** How each item index draws: the run's first item carries the header; the rest hide while the run is closed.
 * A run still working keeps its last item visible, so the live call shows. */
export function foldMap(items: ChatItem[], open: ReadonlySet<string>): Map<number, Fold> {
  const out = new Map<number, Fold>()
  for (const r of toolRuns(items)) {
    const isOpen = open.has(items[r.start].id)
    for (let k = r.start; k < r.end; k++) {
      const hidden = !isOpen && !(r.running && k === r.end - 1)
      if (k === r.start) out.set(k, { head: r, open: isOpen, hidden })
      else if (hidden) out.set(k, { hidden: true })
    }
  }
  return out
}

/** "Ran 2 commands and read 3 files · 42s", "Running 4 tools…". */
export function runLabel(r: ToolRun): string {
  const n = `${r.tools} tool${r.tools === 1 ? '' : 's'}`
  if (r.running) return `Running ${n}…`
  const t = r.secs >= 60 ? `${Math.floor(r.secs / 60)}m ${Math.round(r.secs % 60)}s` : r.secs >= 1 ? `${Math.round(r.secs)}s` : ''
  const what = r.summary ? r.summary[0].toUpperCase() + r.summary.slice(1) : `Ran ${n}`
  return `${what}${t ? ` · ${t}` : ''}`
}
