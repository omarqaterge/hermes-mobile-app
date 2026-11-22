import type { ChatItem } from './store'
import { isLive, stateOf, wentWrong } from './subagents'

/** A finished turn's work, folded into one line ("Worked 1m 20s · 14 steps") above its final answer. */
export interface TurnWork {
  /** The turn's key: the id of its user message (else of its first work item). The open or closed choice is kept under it. */
  key: string
  /** Index of the first work item: its element carries the line. */
  head: number
  /** Every index that hides while the turn is closed (the head included). */
  members: number[]
  /** Index of the final answer (the turn's last reply with text). */
  final: number
  /** Tool calls and sub-agents in the work. */
  steps: number
  failed: number
  /** Index of the first failed step, -1 when none failed. */
  firstFailed: number
  /** How long the turn took, seconds; 0 when nothing says. */
  secs: number
  /** Distinct tool names in the work, in order of first use (the line's icons). */
  names: string[]
}

type Tool = Extract<ChatItem, { kind: 'tool' }>

/** Tools whose card is something a person acts on (a canvas document, a picture made): they stay outside the fold. */
const KEEP_TOOLS = new Set(['canvas', 'image_generate'])
/** A reply part with a card, a picture, a file or a media path in it stays outside the fold too. */
const KEEPS = /```\s*openui|!\[|\bMEDIA:|\]\((?:file:|\/|~\/)/

const toolLive = (t: Tool) => t.status === 'running' || t.status === 'generating'

/** Whether the item is work (it folds) or stays visible: notices and things a person acts on stay out. */
function isWork(it: ChatItem): boolean {
  if (it.kind === 'tool') return !KEEP_TOOLS.has(it.name)
  if (it.kind === 'subagent') return true
  if (it.kind === 'assistant') return !it.error && !it.warning && !KEEPS.test(it.text)
  return false
}

/** The duration at the end of a reply's stats ("~41 tok/s · 1m 23s"), seconds, or 0. */
export function metaSecs(meta?: string): number {
  const last = (meta || '').split(' · ').pop()?.trim() || ''
  const m = /^(?:(\d+)m )?(\d+(?:\.\d+)?)(ms|s)$/.exec(last)
  if (!m) return 0
  return m[3] === 'ms' ? Number(m[2]) / 1000 : Number(m[1] || 0) * 60 + Number(m[2])
}

/** The finished turns that fold. The turn still running (`running` and last) never does, nor one with a step still
 *  live (a detached sub-agent), one without a final answer, or one whose work would be a single line anyway. */
export function turnWorks(items: readonly ChatItem[], running: boolean): TurnWork[] {
  const out: TurnWork[] = []
  let from = 0
  const close = (to: number, user: Extract<ChatItem, { kind: 'user' }> | null) => {
    let final = -1
    for (let k = to - 1; k >= from; k--) {
      const it = items[k]
      if (it.kind === 'assistant' && it.text.trim()) {
        final = k
        break
      }
    }
    if (final < 0) return
    const members: number[] = []
    const names: string[] = []
    let steps = 0
    let failed = 0
    let firstFailed = -1
    let toolSecs = 0
    for (let k = from; k < final; k++) {
      const it = items[k]
      if (!isWork(it)) continue
      if (it.kind === 'tool') {
        if (toolLive(it)) return
        steps++
        toolSecs += it.duration || 0
        if (!names.includes(it.name)) names.push(it.name)
        if (it.status === 'error') {
          failed++
          if (firstFailed < 0) firstFailed = k
        }
      } else if (it.kind === 'subagent') {
        const s = stateOf(it.status, false)
        if (isLive(s)) return
        steps++
        if (wentWrong(s)) {
          failed++
          if (firstFailed < 0) firstFailed = k
        }
      }
      members.push(k)
    }
    const fin = items[final] as Extract<ChatItem, { kind: 'assistant' }>
    // Nothing to gain: one line of work and no thought on the answer folds into one line.
    if (!steps || (members.length < 2 && !fin.reasoning.trim())) return
    const tail = items.slice(final + 1, to)
    if (tail.some(it => (it.kind === 'tool' && toolLive(it)) || (it.kind === 'subagent' && isLive(stateOf(it.status, false))))) return
    const fromMeta = metaSecs(fin.meta)
    const fromClock = user?.at && fin.at && fin.at > user.at ? (fin.at - user.at) / 1000 : 0
    out.push({
      key: user?.id ?? items[members[0]].id,
      head: members[0],
      members,
      final,
      steps,
      failed,
      firstFailed,
      secs: fromMeta || fromClock || toolSecs,
      names
    })
  }
  let user: Extract<ChatItem, { kind: 'user' }> | null = null
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind !== 'user') continue
    close(i, user)
    from = i + 1
    user = it
  }
  if (!running) close(items.length, user)
  return out
}

export interface TurnFolds {
  /** The line's index → its turn and whether it is open. */
  heads: Map<number, { work: TurnWork; open: boolean }>
  /** Indexes drawn as empty placeholders (their turn is closed). */
  hidden: Set<number>
  /** Final answers whose thought is part of a closed fold, so it is not drawn. */
  quiet: Set<number>
  /** Any index of a turn's work (head, members or final) → that turn. */
  byIndex: Map<number, TurnWork>
}

/** A turn's state while the chat is open: opened or closed by a tap, or `later`: it finished on screen where folding
 *  would have moved what the reader sees, so it draws as it did while it ran until the chat is next opened. */
export type TurnChoice = boolean | 'later'

/** How each index draws. A turn is closed unless `open` says otherwise. One `settling` (it has just finished on screen,
 *  and the chat decides once it is drawn) and one `later` draw as they did while running: no line, nothing hidden. */
export function turnFoldMap(works: readonly TurnWork[], open: ReadonlyMap<string, TurnChoice>, settling: string | null): TurnFolds {
  const heads = new Map<number, { work: TurnWork; open: boolean }>()
  const hidden = new Set<number>()
  const quiet = new Set<number>()
  const byIndex = new Map<number, TurnWork>()
  for (const w of works) {
    const choice = open.get(w.key)
    if (w.key === settling || choice === 'later') continue // drawn as it was while it ran
    const isOpen = choice === true
    heads.set(w.head, { work: w, open: isOpen })
    for (const k of w.members) byIndex.set(k, w)
    byIndex.set(w.final, w)
    if (isOpen) continue
    for (const k of w.members) hidden.add(k)
    quiet.add(w.final)
  }
  return { heads, hidden, quiet, byIndex }
}

/** "12s", "1m 20s": whole seconds, the way the line under a reply writes a turn's length. */
export function wholeTime(secs: number): string {
  const s = Math.max(1, Math.round(secs))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

/** "Worked 1m 20s · 14 steps"; "Worked through 3 steps" when nothing says how long. The failed count is apart: it is marked. */
export function workLabel(w: Pick<TurnWork, 'secs' | 'steps'>): string {
  const n = `${w.steps} step${w.steps === 1 ? '' : 's'}`
  return w.secs > 0 ? `Worked ${wholeTime(w.secs)} · ${n}` : `Worked through ${n}`
}

// How long each reply thought, measured while it streams on screen (no stored record holds it), by item id.
const thoughtStart = new Map<string, number>()
const thought = new Map<string, number>()
const THOUGHT_MAX = 400

/** Note when the streaming reply's thought starts and ends. Called with the chat's items whenever they change; looks
 *  only at the last item and at the one thought still open, so a long chat costs nothing more. */
export function trackThought(items: readonly ChatItem[], now: number = Date.now()): void {
  const last = items[items.length - 1]
  if (last?.kind === 'assistant' && last.streaming && last.reasoning && !last.text && !thoughtStart.has(last.id) && !thought.has(last.id))
    thoughtStart.set(last.id, now)
  for (const [id, t0] of thoughtStart) {
    let it: ChatItem | undefined
    for (let k = items.length - 1; k >= 0 && k >= items.length - 50; k--) if (items[k].id === id) it = items[k]
    if (!it || it.kind !== 'assistant') {
      if (!items.some(x => x.id === id)) thoughtStart.delete(id)
      continue
    }
    if (it.text.trim() || !it.streaming) {
      thoughtStart.delete(id)
      thought.set(id, (now - t0) / 1000)
      if (thought.size > THOUGHT_MAX) thought.delete(thought.keys().next().value as string)
    }
  }
}

/** Seconds the reply thought, when it was watched streaming; undefined otherwise (a chat opened from history). */
export const thoughtSecs = (id: string): number | undefined => thought.get(id)
