// What only the sub-agent rows and sheet need (part of the lazy bundle, subagents-ui-entry.tsx): the words for a model and a
// level, the numbers line and the order of the rows.
import { EFFORT_WORD, isLive, type SubAgent } from './subagents'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const MODEL_SHOWN = 18
const EFFORT_SHORT = new Map([
  ['medium', 'med'],
  ['minimal', 'min'],
  ['none', 'off']
])

/** The level in words; undefined while it isn't known. */
export function effortWord(e: string | undefined): string | undefined {
  if (e === undefined) return undefined
  return e === '' ? 'Model default' : EFFORT_WORD.get(e)
}

/** The text after the last `/`, as the composer's model chip shows it. */
export const modelShort = (m: string): string => m.slice(m.lastIndexOf('/') + 1)

/** "haiku · low"; the level is left out until it is known. */
export function runsOn(a: Pick<SubAgent, 'model' | 'effort'>, shown = MODEL_SHOWN): string {
  const level = a.effort ? EFFORT_SHORT.get(a.effort) ?? (EFFORT_WORD.has(a.effort) ? a.effort : '') : ''
  const m = modelShort(a.model)
  // A long name gives way first, so the level stays readable on a narrow row.
  return [level && m.length > shown ? `${m.slice(0, shown - 1)}…` : m, level].filter(Boolean).join(' · ')
}

/** Does the level follow the chat that started it? Only when no level is set for sub-agents and the two agree. */
export function followsChat(effort: string | undefined, configured: unknown, chatEffort: string | undefined): boolean {
  if (effort === undefined || !chatEffort) return false
  const set = configured === false ? 'none' : str(configured).trim().toLowerCase()
  return !(set === 'none' || EFFORT_WORD.has(set)) && effort === chatEffort
}

const compact = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))

/** "12 steps · 4.1k in · 300 out · 3 read · 1 written", each part only when there is something to say. */
export function numbersLine(a: SubAgent): string {
  const steps = a.steps || a.tools
  return [
    steps ? `${steps} step${steps === 1 ? '' : 's'}` : '',
    a.tokensIn ? `${compact(a.tokensIn)} in` : '',
    a.tokensOut ? `${compact(a.tokensOut)} out` : '',
    a.filesRead ? `${a.filesRead} read` : '',
    a.filesWritten ? `${a.filesWritten} written` : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

type TreeNode = Pick<SubAgent, 'key' | 'parent' | 'parentChild' | 'child' | 'depth' | 'order'>

/** Parents before their own sub-agents, each with its level: by `parent_id` or the stored chat, else by its `depth`. */
export function inTreeOrder<T extends TreeNode>(list: readonly T[]): Array<{ agent: T; level: number }> {
  const byKey = new Map(list.map(a => [a.key, a]))
  const byChild = new Map(list.flatMap(a => (a.child ? [[a.child, a] as const] : [])))
  const parentOf = (a: T) => (a.parent ? byKey.get(a.parent) : undefined) ?? (a.parentChild ? byChild.get(a.parentChild) : undefined)
  const kids = new Map<string, T[]>()
  const roots: T[] = []
  for (const a of [...list].sort((x, y) => x.order - y.order)) {
    const p = parentOf(a)
    if (p && p !== a) kids.set(p.key, [...(kids.get(p.key) ?? []), a])
    else roots.push(a)
  }
  const out: Array<{ agent: T; level: number }> = []
  const seen = new Set<string>()
  const walk = (a: T, level: number) => {
    if (seen.has(a.key)) return
    seen.add(a.key)
    out.push({ agent: a, level: Math.min(level, 8) })
    for (const k of kids.get(a.key) ?? []) walk(k, level + 1)
  }
  for (const r of roots) walk(r, r.depth)
  for (const a of list) walk(a, a.depth) // a damaged chain (two that name each other) still shows
  return out
}

/** At most `max` rows, the running ones first, each keeping its order; nested ones stay after their parents among equals. */
export function firstRows<T extends { agent: Pick<SubAgent, 'state'> }>(rows: readonly T[], max: number): T[] {
  return [...rows.filter(r => isLive(r.agent.state)), ...rows.filter(r => !isLive(r.agent.state))].slice(0, max)
}

