// What a chat's sub-agents are doing (spec 3.3, 3.13; docs/decisions/nested-chats.md). Three sources, all read as untrusted:
//   - the `subagent.*` events of the chats this page is attached to, and `subagent.list` when one is opened;
//   - the plugin's `GET /nested` (a chat's sub-agents as Hermes stored them: the true reasoning level, finished ones);
//   - the plugin's `nested` list in `GET /activity`: only how many run in each chat, on the feed's own schedule.
// Every value is checked by type. A goal is written by the model: it is plain text everywhere, and `quotedGoal` is the only
// form in which it may stand next to the app's own words. `activity.json` can be edited by an agent, so nothing but a
// count comes from there.
//
// One sub-agent's event changes its own record and tells only what shows that record; the chat's list hears of it only
// when its membership or counts change, so ten busy sub-agents don't redraw the chat list.
import { useSyncExternalStore } from 'react'
import { api } from './api'
import { chatListHeld, onChatListFree } from './chatsnapshot'
import { setState, type ChatItem } from './store'

export type SubState = 'waiting' | 'working' | 'done' | 'failed' | 'timeout' | 'stopped' | 'ended'
export type SubItem = Extract<ChatItem, { kind: 'subagent' }>

export const STATE_WORD: Record<SubState, string> = {
  waiting: 'Waiting',
  working: 'Working',
  done: 'Done',
  failed: 'Failed',
  timeout: 'Timed out',
  stopped: 'Stopped',
  ended: 'Finished'
}

export interface SubAgent {
  /** The sub-agent's id when known, else `c:<stored chat>` (known only from what Hermes stored). */
  key: string
  /** What `subagent.tail`, `.steer` and `.interrupt` take; absent for one known only from the stored chats. */
  id?: string
  parent?: string
  /** The stored chat of the sub-agent that started this one. */
  parentChild?: string
  child?: string
  depth: number
  goal: string
  model: string
  /** The level Hermes gave it: a level, 'none' (off), '' (the model's default). Undefined until read: never guessed. */
  effort?: string
  state: SubState
  step: string
  /** The latest command it ran, whole: how an approval is matched to the sub-agent that asks (`askerOf`). */
  command: string
  tools: number
  steps: number
  tokensIn: number
  tokensOut: number
  filesRead: number
  filesWritten: number
  summary: string
  /** ms */
  startedAt: number
  secs: number
  accepting: boolean
  phoneData: boolean
  seenAt: number
  order: number
}

const GOAL_MAX = 300
const STEP_MAX = 200
const COMMAND_MAX = 20_000
const SUMMARY_MAX = 20_000
export const QUOTED_MAX = 60
const MAX_CHATS = 40
const MAX_PER_CHAT = 200

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)
const seconds = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
const listLength = (v: unknown): number => (Array.isArray(v) ? v.length : 0)

// Control characters, and the ones that turn text around or hide it: a goal must read as what it is.
// eslint-disable-next-line no-control-regex
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]+/g

/** Text from the model or a feed as one plain line. */
export function plainLine(v: unknown, max = GOAL_MAX): string {
  const t = str(v).replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

/** A goal as it may stand beside the app's own words: short, one line, in quotation marks it can't close itself. */
export function quotedGoal(goal: unknown): string {
  const t = plainLine(goal, GOAL_MAX).replace(/["“”„‟«»]/g, "'")
  return `“${t.length > QUOTED_MAX ? `${t.slice(0, QUOTED_MAX - 1).trimEnd()}…` : t}”`
}

export function stateOf(status: unknown, finished: boolean): SubState {
  switch (str(status).toLowerCase()) {
    case 'queued':
    case 'waiting':
      return 'waiting'
    case 'running':
    case 'working':
      return finished ? 'done' : 'working'
    case 'completed':
    case 'done':
      return 'done'
    case 'failed':
    case 'error':
      return 'failed'
    case 'timeout':
      return 'timeout'
    case 'interrupted':
    case 'stopped':
      return 'stopped'
    case 'ended':
      return 'ended'
    case '':
      return finished ? 'done' : 'working'
    default:
      return finished ? 'failed' : 'working'
  }
}

export const isLive = (s: SubState): boolean => s === 'waiting' || s === 'working'
export const wentWrong = (s: SubState): boolean => s === 'failed' || s === 'timeout'

const EFFORT_WORD: Record<string, string> = {
  none: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
  ultra: 'Ultra'
}
const MODEL_SHOWN = 18
const EFFORT_SHORT: Record<string, string> = { medium: 'med', minimal: 'min', none: 'off' }

/** The level in words; undefined while it isn't known. */
export function effortWord(e: string | undefined): string | undefined {
  if (e === undefined) return undefined
  return e === '' ? 'Model default' : EFFORT_WORD[e]
}

/** The text after the last `/`, as the composer's model chip shows it. */
export const modelShort = (m: string): string => m.slice(m.lastIndexOf('/') + 1)

/** "haiku · low"; the level is left out until it is known. */
export function runsOn(a: Pick<SubAgent, 'model' | 'effort'>, shown = MODEL_SHOWN): string {
  const level = a.effort ? EFFORT_SHORT[a.effort] ?? (EFFORT_WORD[a.effort] ? a.effort : '') : ''
  const m = modelShort(a.model)
  // A long name gives way first, so the level stays readable on a narrow row.
  return [level && m.length > shown ? `${m.slice(0, shown - 1)}…` : m, level].filter(Boolean).join(' · ')
}

/** Does the level follow the chat that started it? Only when no level is set for sub-agents and the two agree. */
export function followsChat(effort: string | undefined, configured: unknown, chatEffort: string | undefined): boolean {
  if (effort === undefined || !chatEffort) return false
  const set = configured === false ? 'none' : str(configured).trim().toLowerCase()
  return !(set === 'none' || set in EFFORT_WORD) && effort === chatEffort
}

export function shortTime(secs: number): string {
  if (secs < 60) return `${Math.max(1, Math.round(secs))} s`
  const m = Math.round(secs / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
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

// ── one event ──
let orderSeq = 0

export function keyOfEvent(p: Record<string, unknown>): string {
  return plainLine(p.subagent_id, 120) || `t${count(p.task_index)}`
}

/** The record after one `subagent.*` event. Whatever the event holds, the result has the right types. */
export function mergeEvent(prev: SubAgent | undefined, type: string, raw: unknown, now: number): SubAgent {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const finished = type === 'subagent.complete'
  const id = plainLine(p.subagent_id, 120)
  const tool = plainLine(p.tool_name, 80)
  const preview = str(p.tool_preview) || (type === 'subagent.tool' ? str(p.text) : '')
  const state = finished || p.status != null ? stateOf(p.status, finished) : prev?.state ?? 'working'
  return {
    key: prev?.key ?? keyOfEvent(p),
    ...(id ? { id } : prev?.id ? { id: prev.id } : {}),
    ...(plainLine(p.parent_id, 120) ? { parent: plainLine(p.parent_id, 120) } : prev?.parent ? { parent: prev.parent } : {}),
    ...(prev?.parentChild ? { parentChild: prev.parentChild } : {}),
    ...(plainLine(p.child_session_id, 200) ? { child: plainLine(p.child_session_id, 200) } : prev?.child ? { child: prev.child } : {}),
    depth: Math.min(count(p.depth) || prev?.depth || 0, 8),
    goal: plainLine(p.goal) || prev?.goal || '',
    model: plainLine(p.model, 160) || prev?.model || '',
    ...(prev?.effort !== undefined ? { effort: prev.effort } : {}),
    state,
    step: type === 'subagent.tool' ? plainLine(preview || tool, STEP_MAX) : prev?.step ?? '',
    command: type === 'subagent.tool' ? preview.slice(0, COMMAND_MAX) : prev?.command ?? '',
    tools: count(p.tool_count) || prev?.tools || 0,
    steps: count(p.api_calls) || prev?.steps || 0,
    tokensIn: count(p.input_tokens) || prev?.tokensIn || 0,
    tokensOut: count(p.output_tokens) || prev?.tokensOut || 0,
    filesRead: listLength(p.files_read) || prev?.filesRead || 0,
    filesWritten: listLength(p.files_written) || prev?.filesWritten || 0,
    summary: str(p.summary).slice(0, SUMMARY_MAX) || prev?.summary || '',
    startedAt: prev?.startedAt ?? now,
    secs: seconds(p.duration_seconds) || prev?.secs || 0,
    accepting: !finished && (prev?.accepting ?? true),
    phoneData: prev?.phoneData === true || tool === 'phone_data',
    seenAt: now,
    order: prev?.order ?? ++orderSeq
  }
}

/** What the chat's own item keeps: enough to draw its group after a reload, and to export it. */
export function itemFields(a: SubAgent): Omit<SubItem, 'kind' | 'id'> {
  return {
    goal: a.goal,
    status: a.state,
    summary: a.summary || undefined,
    tools: a.tools,
    agent: a.key,
    ...(a.parent ? { parent: a.parent } : {}),
    depth: a.depth,
    ...(a.model ? { model: a.model } : {}),
    ...(a.child ? { child: a.child } : {}),
    started: a.startedAt,
    secs: a.secs,
    ...(a.phoneData ? { phoneData: true } : {})
  }
}

/** Whether the item must change for this record (the current step and the counters don't touch it). */
export function itemChanged(it: SubItem, a: SubAgent): boolean {
  const f = itemFields(a)
  return (
    it.status !== f.status ||
    it.goal !== f.goal ||
    (it.summary ?? undefined) !== f.summary ||
    it.phoneData !== f.phoneData ||
    it.secs !== f.secs ||
    it.child !== f.child ||
    it.model !== f.model ||
    it.parent !== f.parent
  )
}

function fromItem(it: SubItem, at: number): SubAgent {
  return {
    key: it.agent || it.id.replace(/^sub-/, ''),
    ...(it.agent && !it.agent.startsWith('c:') ? { id: it.agent } : {}),
    ...(it.parent ? { parent: it.parent } : {}),
    ...(it.child ? { child: it.child } : {}),
    depth: Math.min(count(it.depth), 8),
    goal: plainLine(it.goal),
    model: plainLine(it.model, 160),
    state: stateOf(it.status, false),
    step: '',
    command: '',
    tools: count(it.tools),
    steps: 0,
    tokensIn: 0,
    tokensOut: 0,
    filesRead: 0,
    filesWritten: 0,
    summary: str(it.summary),
    startedAt: count(it.started),
    secs: seconds(it.secs),
    accepting: false,
    phoneData: it.phoneData === true,
    seenAt: at,
    order: ++orderSeq
  }
}

// ── groups in the chat ──
export interface SubGroup {
  /** Index of the first item: the one that draws the group. */
  start: number
  /** Every item index in the group. */
  members: number[]
  keys: string[]
  total: number
  running: number
  done: number
  failed: number
  /** From the first start to the last end, seconds; 0 when unknown. */
  secs: number
}

const itemState = (it: SubItem): SubState => stateOf(it.status, false)
const itemKey = (it: SubItem): string => it.agent || it.id.replace(/^sub-/, '')

/** Sub-agent items next to each other form a group, and one started by a member joins its group wherever it stands: a
 *  nested one can start after the parent's reply has gone on. */
export function subGroups(items: readonly ChatItem[]): SubGroup[] {
  const groups: SubGroup[] = []
  const byAgent = new Map<string, SubGroup>()
  let open: SubGroup | null = null
  items.forEach((it, i) => {
    if (it.kind !== 'subagent') {
      open = null
      return
    }
    const key = itemKey(it)
    const g: SubGroup =
      (it.parent ? byAgent.get(it.parent) : undefined) ??
      open ?? { start: i, members: [], keys: [], total: 0, running: 0, done: 0, failed: 0, secs: 0 }
    if (!g.members.length) groups.push(g)
    g.members.push(i)
    g.keys.push(key)
    g.total++
    const s = itemState(it)
    if (isLive(s)) g.running++
    else if (s === 'done' || s === 'ended') g.done++
    if (wentWrong(s)) g.failed++
    byAgent.set(key, g)
    open = g
  })
  for (const g of groups) {
    let from = Infinity
    let to = 0
    for (const i of g.members) {
      const it = items[i] as SubItem
      if (!it.started) continue
      from = Math.min(from, it.started)
      to = Math.max(to, it.started + (it.secs || 0) * 1000)
    }
    g.secs = to > from ? (to - from) / 1000 : 0
  }
  return groups
}

export type SubFold = { head: SubGroup } | { hidden: true }

/** How each item index draws: the group's first item carries the line, the others take no room. */
export function subFoldMap(items: readonly ChatItem[]): Map<number, SubFold> {
  const out = new Map<number, SubFold>()
  for (const g of subGroups(items)) for (const i of g.members) out.set(i, i === g.start ? { head: g } : { hidden: true })
  return out
}

const agents = (n: number) => `${n} sub-agent${n === 1 ? '' : 's'}`

/** "3 sub-agents · 1 done", "Used 3 sub-agents · 2 min". The failed count is apart: it is marked. */
export function groupWords(g: Pick<SubGroup, 'total' | 'running' | 'done' | 'secs'>): string {
  if (g.running) return `${agents(g.total)}${g.done ? ` · ${g.done} done` : ''}`
  return `Used ${agents(g.total)}${g.secs ? ` · ${shortTime(g.secs)}` : ''}`
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

/** A chat reopened from Hermes has its `delegate_task` calls but no sub-agent items: each known sub-agent goes back after
 *  the call that names its goal. One no call names stays out of the chat (it still has its row in the chat list). */
export function withSubItems(items: ChatItem[], list: readonly SubAgent[]): ChatItem[] {
  const have = new Set(items.flatMap(i => (i.kind === 'subagent' ? [itemKey(i)] : [])))
  const add = new Map<number, SubItem[]>()
  const byKey = new Map(list.map(a => [a.key, a]))
  for (const a of [...list].sort((x, y) => x.order - y.order)) {
    if (have.has(a.key) || !a.goal) continue
    let at = -1
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (it.kind === 'tool' && it.name === 'delegate_task' && JSON.stringify(it.args ?? '').includes(JSON.stringify(a.goal).slice(1, -1))) {
        at = i
        break
      }
    }
    // A nested one is named by its parent's own call, which isn't in this chat: it goes with its parent.
    let up = a.parent ? byKey.get(a.parent) : undefined
    if (at < 0 && up) {
      const goal = JSON.stringify(up.goal).slice(1, -1)
      at = items.findLastIndex(it => it.kind === 'tool' && it.name === 'delegate_task' && JSON.stringify(it.args ?? '').includes(goal))
      up = undefined
    }
    if (at < 0) continue
    add.set(at, [...(add.get(at) ?? []), { kind: 'subagent', id: `sub-${a.key}`, ...itemFields(a) }])
  }
  if (!add.size) return items
  return items.flatMap((it, i) => [it, ...(add.get(i) ?? [])])
}

// ── the records ──
export interface NestedSummary {
  keys: string[]
  total: number
  running: number
  failed: number
}
const NO_NESTED: NestedSummary = { keys: [], total: 0, running: 0, failed: 0 }

const chats = new Map<string, Map<string, SubAgent>>()
const feed = new Map<string, number>()
const counts = new Map<string, number>()
const summaries = new Map<string, NestedSummary>()
const recordSubs = new Map<string, Set<() => void>>()
const chatSubs = new Map<string, Set<() => void>>()
const runningSubs = new Set<() => void>()
const withAgentsSubs = new Set<() => void>()
let feedKnown = false
let running: string[] = []
let withAgents: ReadonlySet<string> = new Set()

const recordId = (chat: string, key: string) => `${chat}\n${key}`
const tell = (set: Set<() => void> | undefined) => set?.forEach(f => f())

function computeSummary(chat: string): NestedSummary {
  const m = chats.get(chat)
  const list = m ? [...m.values()] : []
  const live = list.filter(a => isLive(a.state)).length
  const total = Math.max(list.length, counts.get(chat) ?? 0, feed.get(chat) ?? 0)
  const next: NestedSummary = {
    keys: list.map(a => a.key),
    total,
    running: Math.max(live, feed.get(chat) ?? 0),
    failed: list.filter(a => wentWrong(a.state)).length
  }
  const cur = summaries.get(chat)
  return cur && cur.total === next.total && cur.running === next.running && cur.failed === next.failed && cur.keys.join('\n') === next.keys.join('\n') ? cur : next
}

function chatChanged(chat: string): void {
  const before = summaries.get(chat)
  const next = computeSummary(chat)
  if (next === before) return
  summaries.set(chat, next)
  tell(chatSubs.get(chat))
  const all = [...summaries].filter(([, v]) => v.running > 0).map(([k]) => k)
  if (all.join('\n') !== running.join('\n')) {
    running = all
    runningSubs.forEach(f => f())
  }
  if (next.total > 0 !== withAgents.has(chat)) {
    const n = new Set(withAgents)
    if (next.total > 0) n.add(chat)
    else n.delete(chat)
    withAgents = n
    withAgentsSubs.forEach(f => f())
  }
}

function put(chat: string, a: SubAgent): void {
  let m = chats.get(chat)
  if (m) chats.delete(chat)
  else m = new Map()
  chats.set(chat, m) // newest last
  while (chats.size > MAX_CHATS) forgetChat(chats.keys().next().value as string)
  if (a.key !== a.child && a.child) {
    // Known so far only from the stored chats: the event's record takes its place.
    const stored = `c:${a.child}`
    if (a.key !== stored && m.has(stored)) {
      const old = m.get(stored)!
      m.delete(stored)
      if (a.effort === undefined && old.effort !== undefined) a = { ...a, effort: old.effort }
      if (!a.parent && !a.parentChild && old.parentChild) a = { ...a, parentChild: old.parentChild }
      tell(recordSubs.get(recordId(chat, stored)))
    }
  }
  m.set(a.key, a)
  if (m.size > MAX_PER_CHAT) {
    const drop = [...m.values()].find(x => !isLive(x.state))
    if (drop) m.delete(drop.key)
  }
  tell(recordSubs.get(recordId(chat, a.key)))
}

export const getSubAgent = (chat: string, key: string): SubAgent | undefined => chats.get(chat)?.get(key)
export const subAgentsOf = (chat: string): SubAgent[] => [...(chats.get(chat)?.values() ?? [])]
export const nestedOf = (chat: string): NestedSummary => summaries.get(chat) ?? NO_NESTED

/** A `subagent.*` event of this chat. */
export function noteEvent(chat: string, type: string, payload: unknown, now = Date.now()): SubAgent {
  const key = keyOfEvent((payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>)
  const a = mergeEvent(getSubAgent(chat, key), type, payload, now)
  put(chat, a)
  chatChanged(chat)
  return a
}

/** The chat's items when its group is opened: a chat reloaded from the phone's cache has no records yet. */
export function noteItems(chat: string, items: readonly SubItem[], now = Date.now()): void {
  let changed = false
  for (const it of items) {
    const a = fromItem(it, now)
    if (!getSubAgent(chat, a.key)) {
      put(chat, a)
      changed = true
    }
  }
  if (changed) chatChanged(chat)
}

const ROSTER_GRACE_MS = 5000

/** `subagent.list` for a chat just opened: what runs now. A running one it no longer lists has ended while the page wasn't told. */
export function noteRoster(chat: string, raw: unknown, now = Date.now()): void {
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  for (const r of list) {
    if (!r || typeof r !== 'object') continue
    const p = r as Record<string, unknown>
    const key = keyOfEvent(p)
    if (!plainLine(p.subagent_id, 120)) continue
    seen.add(key)
    const cur = getSubAgent(chat, key)
    const merged = mergeEvent(cur, 'subagent.progress', p, now)
    // The roster doesn't name the stored chat: a row known only from there is the same sub-agent when the goal is the same.
    const stored = cur ? undefined : subAgentsOf(chat).find(x => x.key.startsWith('c:') && x.goal === merged.goal)
    const next = stored ? { ...merged, child: stored.child, effort: stored.effort, parentChild: stored.parentChild } : merged
    const started = seconds(p.started_at)
    put(chat, {
      ...next,
      step: next.step || plainLine(p.last_tool, STEP_MAX),
      accepting: p.accepting_steer === false ? false : isLive(next.state),
      startedAt: cur?.startedAt || (started ? started * 1000 : now)
    })
  }
  for (const a of subAgentsOf(chat)) if (isLive(a.state) && !seen.has(a.key) && now - a.seenAt > ROSTER_GRACE_MS) put(chat, { ...a, state: 'ended', accepting: false })
  chatChanged(chat)
}

export interface StoredChild {
  id: string
  parent: string
  goal: string
  model: string
  effort?: string
  started: number
  ended: number
  reason: string
  steps: number
}

/** The plugin's answer for one chat, only what has the right types. */
export function cleanStored(raw: unknown): StoredChild[] {
  if (!Array.isArray(raw)) return []
  const out: StoredChild[] = []
  for (const r of raw.slice(0, MAX_PER_CHAT)) {
    if (!r || typeof r !== 'object') continue
    const c = r as Record<string, unknown>
    const id = plainLine(c.id, 200)
    if (!id) continue
    const effort = typeof c.effort === 'string' && (c.effort === '' || c.effort in EFFORT_WORD) ? c.effort : undefined
    out.push({ id, parent: plainLine(c.parent, 200), goal: plainLine(c.goal), model: plainLine(c.model, 160), ...(effort !== undefined ? { effort } : {}), started: seconds(c.started), ended: seconds(c.ended), reason: plainLine(c.reason, 40), steps: count(c.messages) })
  }
  return out
}

export function noteStored(chat: string, rows: readonly StoredChild[], now = Date.now()): void {
  const known = new Map(subAgentsOf(chat).flatMap(a => (a.child ? [[a.child, a] as const] : [])))
  for (const r of rows) {
    const cur = known.get(r.id)
    if (cur) {
      if (r.effort !== undefined && cur.effort !== r.effort) put(chat, { ...cur, effort: r.effort, ...(cur.parent || cur.parentChild || !r.parent || r.parent === chat ? {} : { parentChild: r.parent }) })
      continue
    }
    const secs = r.ended && r.started ? r.ended - r.started : 0
    put(chat, {
      key: `c:${r.id}`,
      ...(r.parent && r.parent !== chat ? { parentChild: r.parent } : {}),
      child: r.id,
      depth: 0,
      goal: r.goal,
      model: r.model,
      ...(r.effort !== undefined ? { effort: r.effort } : {}),
      state: r.ended ? 'ended' : (feed.get(chat) ?? 0) > 0 ? 'working' : 'ended',
      step: '',
      command: '',
      tools: 0,
      steps: 0,
      tokensIn: 0,
      tokensOut: 0,
      filesRead: 0,
      filesWritten: 0,
      summary: '',
      startedAt: r.started * 1000,
      secs,
      accepting: false,
      phoneData: false,
      seenAt: now,
      order: r.started ? -1e12 + r.started : ++orderSeq
    })
  }
  chatChanged(chat)
}

/** The running counts of the activity feed. Only numbers: the feed's file can be edited by an agent. */
export function cleanNestedFeed(raw: unknown): Map<string, number> {
  const out = new Map<string, number>()
  if (!Array.isArray(raw)) return out
  for (const r of raw.slice(0, MAX_CHATS * 4)) {
    if (!r || typeof r !== 'object') continue
    const session = plainLine((r as { session?: unknown }).session, 200)
    const n = count((r as { running?: unknown }).running)
    if (session && n) out.set(session, Math.min(n, 999))
  }
  return out
}

const FEED_GRACE_MS = 15_000

/** The feed's latest counts. Once the plugin is known to send them, a chat it no longer counts has nothing running. */
export function setNestedFeed(next: Map<string, number>, now = Date.now()): void {
  const touched = new Set([...feed.keys(), ...next.keys()])
  feed.clear()
  for (const [k, v] of next) feed.set(k, v)
  if (feedKnown)
    for (const [chat, m] of chats)
      if (!next.has(chat))
        for (const a of [...m.values()])
          if (isLive(a.state) && now - a.seenAt > FEED_GRACE_MS) {
            put(chat, { ...a, state: 'ended', accepting: false })
            touched.add(chat)
          }
  touched.forEach(chatChanged)
}

/** A context compression gave the chat a new stored id. */
export function moveChat(from: string, to: string): void {
  const m = chats.get(from)
  if (!m || from === to) return
  chats.delete(from)
  chats.set(to, m)
  const n = counts.get(from)
  if (n !== undefined) {
    counts.delete(from)
    counts.set(to, n)
  }
  summaries.delete(from)
  tell(chatSubs.get(from))
  chatChanged(to)
}

export function forgetChat(chat: string): void {
  chats.delete(chat)
  counts.delete(chat)
  chatChanged(chat)
}

/** The sub-agent an approval comes from: the one running whose latest command is exactly the one asked about. Nothing when
 *  none or several match: then the sheet stays with fixed words rather than name the wrong one. */
export function askerOf(chat: string, command: unknown): SubAgent | null {
  const c = str(command)
  if (!c) return null
  const found = subAgentsOf(chat).filter(a => isLive(a.state) && a.command === c)
  return found.length === 1 ? found[0] : null
}

// ── reading what Hermes stored (plugin routes; nothing on a timer) ──
const NESTED_API = '/api/plugins/hermes-mobile'
const profileQuery = (profile: string) => (profile && profile !== 'default' ? `&profile=${encodeURIComponent(profile)}` : '')
const reading = new Set<string>()

/** One chat's sub-agents as stored. Called when something is about to show them; one call at a time per chat. */
export async function loadStored(chat: string, profile: string): Promise<boolean> {
  if (reading.has(chat)) return false
  reading.add(chat)
  try {
    const r = await api<{ children?: unknown }>('GET', `${NESTED_API}/nested?session=${encodeURIComponent(chat)}${profileQuery(profile)}`)
    noteStored(chat, cleanStored(r?.children))
    return true
  } catch {
    return false // a plugin older than the app: rows show what the events said
  } finally {
    reading.delete(chat)
  }
}

export const COUNTS_TTL_MS = 60_000
let countsAt = 0
let countsFor = ''

/** How many sub-agents each chat has had: when the list opens, at most once a minute per bot. */
export async function loadNestedCounts(profile: string, force = false): Promise<void> {
  const now = Date.now()
  if (!force && profile === countsFor && now - countsAt < COUNTS_TTL_MS) return
  countsAt = now
  countsFor = profile
  try {
    const r = await api<{ counts?: unknown }>('GET', `${NESTED_API}/nested-counts?x=1${profileQuery(profile)}`)
    const raw = r?.counts
    if (!raw || typeof raw !== 'object') return
    feedKnown = true
    const touched = new Set(counts.keys())
    counts.clear()
    for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 2000)) {
      const n = count(v)
      if (n) {
        counts.set(k, n)
        touched.add(k)
      }
    }
    touched.forEach(chatChanged)
  } catch {
    countsAt = 0 // an older plugin, or offline: the rows still come from events
  }
}

export interface NestedHit {
  chat: string
  child: string
  goal: string
}

/** Stored sub-agents whose goal holds these words, for the chat list's search. */
export async function searchNested(q: string, profile: string): Promise<NestedHit[]> {
  const r = await api<{ hits?: unknown }>('GET', `${NESTED_API}/nested-search?q=${encodeURIComponent(q)}${profileQuery(profile)}`)
  if (!Array.isArray(r?.hits)) return []
  return r.hits.flatMap(h => {
    const v = (h && typeof h === 'object' ? h : {}) as Record<string, unknown>
    const chat = plainLine(v.chat, 200)
    const child = plainLine(v.child, 200)
    return chat && child ? [{ chat, child, goal: plainLine(v.goal) }] : []
  })
}

// ── React ──
const addTo = (map: Map<string, Set<() => void>>, id: string, f: () => void) => {
  let set = map.get(id)
  if (!set) map.set(id, (set = new Set()))
  set.add(f)
  return () => {
    set!.delete(f)
    if (!set!.size) map.delete(id)
  }
}

export const useSubAgent = (chat: string, key: string): SubAgent | undefined =>
  useSyncExternalStore(
    f => addTo(recordSubs, recordId(chat, key), f),
    () => getSubAgent(chat, key)
  )

export const useNested = (chat: string): NestedSummary =>
  useSyncExternalStore(
    f => addTo(chatSubs, chat, f),
    () => nestedOf(chat)
  )

/** What a row in the chat list shows of a sub-agent. A new step or token count doesn't change it, so it doesn't redraw. */
const rowText = (a: SubAgent | undefined): string => (a ? [a.state, a.goal, a.model, a.effort ?? '?'].join('\n') : '')
export const useSubAgentRow = (chat: string, key: string): string =>
  useSyncExternalStore(
    f => addTo(recordSubs, recordId(chat, key), f),
    () => rowText(getSubAgent(chat, key))
  )

/** The chats that have sub-agents: all the chat list has to know until it draws one. Most rows then cost nothing. */
export const useChatsWithAgents = (): ReadonlySet<string> =>
  useSyncExternalStore(
    f => {
      withAgentsSubs.add(f)
      return () => withAgentsSubs.delete(f)
    },
    () => withAgents
  )

/** The chats with something running, in no particular order. Changes only when that set changes. */
export const useRunningChats = (): string[] =>
  useSyncExternalStore(
    f => {
      runningSubs.add(f)
      return () => runningSubs.delete(f)
    },
    () => running
  )

// ── open and closed rows under a chat, kept while the app runs ──
const chosen = new Map<string, boolean>()
const chosenSubs = new Set<() => void>()
let chosenVersion = 0

export const nestedIsOpen = (chat: string, s: NestedSummary): boolean => chosen.get(chat) ?? s.running > 0
export function setNestedOpen(chat: string, open: boolean): void {
  chosen.set(chat, open)
  chosenVersion++
  chosenSubs.forEach(f => f())
}
export const useNestedChoice = (): number =>
  useSyncExternalStore(
    f => {
      chosenSubs.add(f)
      return () => chosenSubs.delete(f)
    },
    () => chosenVersion
  )

// Rows that came or went while a finger is on the list wait until it lifts (chatsnapshot.ts); what a row says may change.
let held = 0
const heldSubs = new Set<() => void>()
onChatListFree(() => {
  held++
  heldSubs.forEach(f => f())
})
export const useListFree = (): number =>
  useSyncExternalStore(
    f => {
      heldSubs.add(f)
      return () => heldSubs.delete(f)
    },
    () => held
  )
export const listHeld = chatListHeld

// ── the sheet ──
let target: { chat: string; key: string } | null = null
const targetSubs = new Set<() => void>()

export function openSubSheet(chat: string, key: string): void {
  target = { chat, key }
  targetSubs.forEach(f => f())
  setState({ sheet: 'subagent', drawer: false })
}
export const useSubTarget = () =>
  useSyncExternalStore(
    f => {
      targetSubs.add(f)
      return () => targetSubs.delete(f)
    },
    () => target
  )

/** For tests. */
export function resetSubAgents(): void {
  chats.clear()
  feed.clear()
  counts.clear()
  summaries.clear()
  chosen.clear()
  running = []
  withAgents = new Set()
  feedKnown = false
  countsAt = 0
  countsFor = ''
  target = null
}
export const setFeedKnownForTest = (v: boolean): void => {
  feedKnown = v
}
