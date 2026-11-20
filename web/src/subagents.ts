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
  /** Known only from the stored chats, which record no end yet: the list may show it as running while the feed counts some. */
  noEndStored?: boolean
  seenAt: number
  order: number
}

const GOAL_MAX = 300
const STEP_MAX = 200
const COMMAND_MAX = 20_000
const SUMMARY_MAX = 20_000
export const QUOTED_MAX = 60
const APPROVING_TOOL = 'terminal'
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

const NOT_SHOWN = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu
const TOO_MANY_MARKS = /(\p{M}{2})\p{M}+/gu
// Every kind of quotation mark, so the text can't seem to close the one the app puts around it.
const QUOTE_LIKE = new RegExp(`[\\p{Pi}\\p{Pf}"'\`${String.fromCodePoint(0xb4, 0x2b9, 0x2ba, 0x2bb, 0x2bc, 0x2bd, 0x2c8, 0x2ca, 0x2cb, 0x2032, 0x2033, 0x2034, 0x2035, 0x2036, 0x2dd, 0x2ee, 0x5f3, 0x5f4, 0x3003, 0xa78c, 0x2e42, 0x1f676, 0x1f677, 0x201a, 0x201e, 0x275b, 0x275c, 0x275d, 0x275e, 0x301d, 0x301e, 0x301f, 0xff02, 0xff07, 0xff40, 0x300c, 0x300d, 0x300e, 0x300f, 0xfe41, 0xfe42, 0xfe43, 0xfe44, 0xff62, 0xff63)}]`, 'gu')

/** A goal as it may stand beside the app's own words: one short line in quotation marks it can't close itself, with nothing
 *  invisible in it and no pile of combining marks. Counted in characters, so a cut never splits one. Show it inside <bdi>. */
export function quotedGoal(goal: unknown): string {
  const t = plainLine(str(goal).replace(NOT_SHOWN, ''), GOAL_MAX).replace(TOO_MANY_MARKS, '$1').replace(QUOTE_LIKE, "'").trim()
  const chars = Array.from(t)
  return `“${chars.length > QUOTED_MAX ? `${chars.slice(0, QUOTED_MAX - 1).join('').trimEnd()}…` : t}”`
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

// Maps, not objects: these are looked up with values from outside, and `__proto__` is a key of every object.
export const EFFORT_WORD = new Map([
  ['none', 'Off'],
  ['minimal', 'Minimal'],
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['xhigh', 'Extra high'],
  ['max', 'Max'],
  ['ultra', 'Ultra']
])
export function shortTime(secs: number): string {
  if (secs < 60) return `${Math.max(1, Math.round(secs))} s`
  const m = Math.round(secs / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
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
  // Only `terminal` raises an approval whose text is its preview, and Hermes reports no end of a tool: the next thing the
  // sub-agent reports means the command is over. A list of who runs says nothing about that.
  const command = type === 'subagent.tool' && tool === APPROVING_TOOL ? preview.slice(0, COMMAND_MAX) : type === 'subagent.list' || type === 'subagent.start' ? prev?.command ?? '' : ''
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
    command,
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
    // A saved item is old news: whether it still runs is for Hermes to say (`subagent.*`, `subagent.list`).
    state: isLive(stateOf(it.status, false)) ? 'ended' : stateOf(it.status, false),
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

/** A chat reopened from Hermes has its `delegate_task` calls but no sub-agent items: each known sub-agent goes back after
 *  the call that names its goal. One no call names stays out of the chat (it still has its row in the chat list). */
export function withSubItems(original: ChatItem[], list: readonly SubAgent[]): ChatItem[] {
  let items = original
  // Items already there follow their records, so one whose end the page missed stops showing as running.
  const records = new Map(list.map(a => [a.key, a]))
  let changed = false
  items = items.map(it => {
    const a = it.kind === 'subagent' ? records.get(itemKey(it)) : undefined
    if (it.kind !== 'subagent' || !a || !itemChanged(it, a)) return it
    changed = true
    return { ...it, ...itemFields(a) }
  })
  const updated = items
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
  if (!add.size) return changed ? updated : original
  return items.flatMap((it, i) => [it, ...(add.get(i) ?? [])])
}

// ── the records ──
export interface NestedSummary {
  keys: string[]
  total: number
  /** How many the chat list may show as running: the feed's count, a hint that an edited file can change. */
  running: number
  /** How many Hermes has told this page run: what the composer's Stop and keeping the chat open go by. */
  live: number
  failed: number
}
const NO_NESTED: NestedSummary = { keys: [], total: 0, running: 0, live: 0, failed: 0 }

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

// A context compression gives a chat a new stored id (`moveChat`), while the page keeps the one it opened. The records go
// to the new id, and the old one leads there: whatever asks by either id (the composer's Stop, leaving the chat, an event
// filed under the id the page knew, the rows) gets the same records, and Hermes is asked by the newest.
const movedTo = new Map<string, string>()
const movedFrom = new Map<string, Set<string>>()
const MAX_MOVES = 200

/** The id this chat's sub-agents are kept under now. */
export function resolveChat(chat: string): string {
  let c = chat
  for (let i = 0; i < 16; i++) {
    const next = movedTo.get(c)
    if (!next || next === chat) break
    c = next
  }
  return c
}

/** Every id that leads to this one, itself included: who listens by an older id is told too. */
function idsOf(chat: string): string[] {
  const out = [chat]
  for (let i = 0; i < out.length && out.length < 32; i++) for (const f of movedFrom.get(out[i]) ?? []) if (!out.includes(f)) out.push(f)
  return out
}

function computeSummary(chat: string, now = Date.now()): NestedSummary {
  const m = chats.get(chat)
  const list = m ? [...m.values()] : []
  const running = list.filter(a => isLive(a.state))
  // For the list: what the feed counts, and what was heard of a moment ago, which the feed may not have reached yet. With a
  // plugin that sends no counts, all that the page knows of.
  const heard = feedKnown ? running.filter(a => now - a.seenAt < FEED_GRACE_MS).length : running.length
  const total = Math.max(list.length, counts.get(chat) ?? 0, feed.get(chat) ?? 0)
  const next: NestedSummary = {
    keys: list.map(a => a.key),
    total,
    running: Math.max(heard, feed.get(chat) ?? 0),
    live: running.length,
    failed: list.filter(a => wentWrong(a.state)).length
  }
  const cur = summaries.get(chat)
  return cur && cur.total === next.total && cur.running === next.running && cur.live === next.live && cur.failed === next.failed && cur.keys.join('\n') === next.keys.join('\n') ? cur : next
}

/** What a row in the chat list shows. The record decides, except that the feed, a hint, says whether a chat this page gets no
 *  events from still has something running. It changes only this row's look, never a record. */
export function listState(a: Pick<SubAgent, 'state' | 'noEndStored'>, chatRunning: boolean): SubState {
  if (isLive(a.state)) return chatRunning ? a.state : 'ended'
  return a.noEndStored && chatRunning ? 'working' : a.state
}

function chatChanged(chat: string): void {
  const before = summaries.get(chat)
  const next = computeSummary(chat)
  if (next === before) return
  summaries.set(chat, next)
  const ids = idsOf(chat)
  for (const id of ids) tell(chatSubs.get(id))
  nestedListeners.forEach(f => f(chat))
  // The chat list knows a chat by whichever id it listed: every id that leads to the records counts.
  const all = [...summaries].filter(([k, v]) => v.running > 0 && resolveChat(k) === k).flatMap(([k]) => idsOf(k))
  if (all.join('\n') !== running.join('\n')) {
    running = all
    runningSubs.forEach(f => f())
  }
  const has = next.total > 0
  if (ids.some(id => has !== withAgents.has(id))) {
    const n = new Set(withAgents)
    for (const id of ids) {
      if (has) n.add(id)
      else n.delete(id)
    }
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
      for (const id of idsOf(chat)) tell(recordSubs.get(recordId(id, stored)))
    }
  }
  m.set(a.key, a)
  if (m.size > MAX_PER_CHAT) {
    const drop = [...m.values()].find(x => !isLive(x.state))
    if (drop) m.delete(drop.key)
  }
  for (const id of idsOf(chat)) tell(recordSubs.get(recordId(id, a.key)))
}

export const getSubAgent = (chat: string, key: string): SubAgent | undefined => chats.get(resolveChat(chat))?.get(key)
export const subAgentsOf = (chat: string): SubAgent[] => [...(chats.get(resolveChat(chat))?.values() ?? [])]
export const nestedOf = (chat: string): NestedSummary => summaries.get(resolveChat(chat)) ?? NO_NESTED

const nestedListeners = new Set<(chat: string) => void>()
/** Runs `fn` with a chat's id (the one its records are under) each time what is known of its sub-agents changes. */
export function onNestedChange(fn: (chat: string) => void): () => void {
  nestedListeners.add(fn)
  return () => nestedListeners.delete(fn)
}

/** A `subagent.*` event of this chat. */
export function noteEvent(chat: string, type: string, payload: unknown, now = Date.now()): SubAgent {
  chat = resolveChat(chat)
  const key = keyOfEvent((payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>)
  const a = mergeEvent(getSubAgent(chat, key), type, payload, now)
  put(chat, a)
  chatChanged(chat)
  return a
}

/** The chat's items when its group is opened: a chat reloaded from the phone's cache has no records yet. */
export function noteItems(chat: string, items: readonly SubItem[], now = Date.now()): void {
  chat = resolveChat(chat)
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
const FEED_GRACE_MS = 15_000

/** `subagent.list` for a chat just opened: what runs now. A running one it no longer lists has ended while the page wasn't told. */
export function noteRoster(chat: string, raw: unknown, now = Date.now()): void {
  chat = resolveChat(chat)
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  for (const r of list) {
    if (!r || typeof r !== 'object') continue
    const p = r as Record<string, unknown>
    const key = keyOfEvent(p)
    if (!plainLine(p.subagent_id, 120)) continue
    seen.add(key)
    const cur = getSubAgent(chat, key)
    const merged = mergeEvent(cur, 'subagent.list', p, now)
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
    const effort = typeof c.effort === 'string' && (c.effort === '' || EFFORT_WORD.has(c.effort)) ? c.effort : undefined
    out.push({ id, parent: plainLine(c.parent, 200), goal: plainLine(c.goal), model: plainLine(c.model, 160), ...(effort !== undefined ? { effort } : {}), started: seconds(c.started), ended: seconds(c.ended), reason: plainLine(c.reason, 40), steps: count(c.messages) })
  }
  return out
}

export function noteStored(chat: string, rows: readonly StoredChild[], now = Date.now()): void {
  chat = resolveChat(chat)
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
      state: 'ended', // only Hermes's events or its list say that one runs
      ...(r.ended ? {} : { noEndStored: true }),
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

/** The feed's latest counts: hints for the chat list. They end no record and never reach the composer's Stop: only
 *  `subagent.complete` or a `subagent.list` that leaves one out do that. */
export function setNestedFeed(next: Map<string, number>): void {
  const touched = new Set([...feed.keys(), ...next.keys(), ...chats.keys()])
  feed.clear()
  for (const [k, v] of next) feed.set(k, v)
  touched.forEach(chatChanged)
}

/** A context compression gave the chat a new stored id. */
/** A context compression gave the chat `from` the stored id `to`. Its records go there, merged with any already there (an
 *  event that reached the new id first): for one sub-agent the record heard of last stays. The old id leads to the new one
 *  from now on (`resolveChat`). */
export function moveChat(from: string, to: string): void {
  from = resolveChat(from)
  to = resolveChat(to)
  if (!from || !to || from === to) return
  const m = chats.get(from)
  if (m) {
    chats.delete(from)
    const into = chats.get(to) ?? new Map<string, SubAgent>()
    for (const [k, a] of m) {
      const cur = into.get(k)
      into.set(k, cur && cur.seenAt >= a.seenAt ? cur : a)
    }
    chats.delete(to)
    chats.set(to, into) // newest last
  }
  const n = counts.get(from)
  if (n !== undefined) {
    counts.delete(from)
    counts.set(to, Math.max(n, counts.get(to) ?? 0))
  }
  if (chosen.has(from) && !chosen.has(to)) chosen.set(to, chosen.get(from)!)
  movedTo.set(from, to)
  movedFrom.set(to, new Set([...(movedFrom.get(to) ?? []), from]))
  while (movedTo.size > MAX_MOVES) {
    const [old, next] = movedTo.entries().next().value as [string, string]
    movedTo.delete(old)
    movedFrom.get(next)?.delete(old)
  }
  summaries.delete(from)
  summaries.delete(to) // worked out again below, for every id that now leads to it
  for (const id of idsOf(to)) {
    tell(chatSubs.get(id))
    for (const a of chats.get(to)?.values() ?? []) tell(recordSubs.get(recordId(id, a.key)))
  }
  chatChanged(to)
}

export function forgetChat(chat: string): void {
  chat = resolveChat(chat)
  chats.delete(chat)
  counts.delete(chat)
  chatChanged(chat)
}

/** The sub-agent an approval may come from: the only one running in the chat, when its latest command is exactly the one
 *  asked about. Nothing when none runs or several do (two could have run the same command): then the sheet keeps the fixed
 *  words rather than name the wrong one. The caller also needs the feed to say a sub-agent asks (waiting.ts subAgentAsks). */
export function askerOf(chat: string, command: unknown): SubAgent | null {
  const c = str(command)
  if (!c) return null
  const live = subAgentsOf(chat).filter(a => isLive(a.state))
  return live.length === 1 && live[0].command === c ? live[0] : null
}

// ── reading what Hermes stored (plugin routes; nothing on a timer) ──
const NESTED_API = '/api/plugins/hermes-mobile'
const profileQuery = (profile: string) => (profile && profile !== 'default' ? `&profile=${encodeURIComponent(profile)}` : '')
const reading = new Set<string>()

/** One chat's sub-agents as stored. Called when something is about to show them; one call at a time per chat. */
export async function loadStored(chat: string, profile: string): Promise<boolean> {
  chat = resolveChat(chat) // Hermes is asked by the newest id: it follows a compression back, not forward
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

/** The stored chats of this chat's sub-agents, at every depth, as Hermes's own record has them now (the plugin follows each
 *  one's parent up to the chat, across a compression). Null when it can't be told: then nothing may count as the chat's. */
export async function storedChildIds(chat: string, profile: string): Promise<Set<string> | null> {
  try {
    const r = await api<{ children?: unknown }>('GET', `${NESTED_API}/nested?session=${encodeURIComponent(resolveChat(chat))}${profileQuery(profile)}`)
    return new Set(cleanStored(r?.children).map(c => c.id))
  } catch {
    return null
  }
}

/** The stored ids from a sub-agent up through its real parent chain (parent sub-agents and the chat's verified compression
 *  segments), from `GET /nested`. Null when ownership cannot be confirmed (error, missing, broken parent link or cycle). */
export async function storedParentChain(chat: string, child: string, profile: string): Promise<string[] | null> {
  const root = resolveChat(chat)
  if (!root || !child) return null
  try {
    const r = await api<{ children?: unknown; segments?: unknown }>(
      'GET',
      `${NESTED_API}/nested?session=${encodeURIComponent(root)}${profileQuery(profile)}`
    )
    const kids = cleanStored(r?.children)
    const byId = new Map(kids.map(c => [c.id, c]))
    if (!byId.has(child)) return null
    const segments = Array.isArray(r?.segments)
      ? r.segments.map(s => plainLine(s, 200)).filter(Boolean)
      : []
    const rootIds = new Set(segments.length ? segments : [root])
    rootIds.add(root)
    const chain: string[] = []
    const seen = new Set<string>()
    let cur = child
    let reached = false
    for (let i = 0; i <= 8; i++) {
      if (rootIds.has(cur)) {
        reached = true
        break
      }
      if (seen.has(cur)) return null
      seen.add(cur)
      chain.push(cur)
      const row = byId.get(cur)
      if (!row || !row.parent) return null
      cur = row.parent
    }
    if (!reached) return null
    for (const seg of segments.length ? segments : [root]) {
      if (!seen.has(seg)) {
        seen.add(seg)
        chain.push(seg)
      }
    }
    if (!seen.has(root)) chain.push(root)
    return chain
  } catch {
    return null
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
  movedTo.clear()
  movedFrom.clear()
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
