// Sub-agents on screen (spec 3.3, 3.13): the opened group's rows, the rows under a chat in the list, and the sheet that shows
// one of them. This file is in the lazy bundle `hm-subagents` (subagents-ui-entry.tsx): it costs nothing until a chat has
// sub-agents, and what it imports from the app reaches it through `subAgentHost` in SubAgentsCore.tsx. Goals, steps and output are the model's words: plain text only, never Markdown or HTML. Nothing
// here can approve anything: approvals stay on the request sheet of the parent chat.
import { Component, memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { haptic } from '../bridge'
import { useBackHandler } from '../backstack'
import { confirmDialog } from '../dialog'
import { continueSubAgent, errText, resumeSession, steerSubAgent, stopSubAgent, subAgentTail } from '../gateway'
import { askUnlock, lockView } from '../lockview'
import { useLockView } from '../needsyou'
import { GuardCtx, chatTainted, idsReadState } from '../phone-data-taint'
import { openSettingsOn } from '../settings-open'
import { getState, setState, toast, useStore } from '../store'
import {
  STATE_WORD,
  cleanStored,
  getSubAgent,
  isLive,
  listHeld,
  listState,
  loadStored,
  nestedIsOpen,
  noteItems,
  noteStored,
  openSubSheet,
  plainLine,
  quotedGoal,
  resolveChat,
  shortTime,
  subAgentsOf,
  useListFree,
  useNested,
  useNestedChoice,
  useSubAgent,
  useSubAgentRow,
  useSubTarget,
  wentWrong,
  type SubAgent,
  type SubItem,
  type SubState
} from '../subagents'
import { effortWord, firstRows, followsChat, inTreeOrder, numbersLine, runsOn } from '../subagents-view'
import { useListShown } from './SubAgentsCore'
import { Icon } from './icons'
import { DrawnMark, useStepEnd } from './AgentMotion'
import { pauseWhenHidden, stagger } from '../motion'
import { Linked } from './Linked'
import { plainTitle } from './Title'

export const TAIL_EVERY_MS = 3000
export const NESTED_SHOWN = 6

const profileOf = () => getState().profile
const sameChat = (a: string | undefined, b: string): boolean => Boolean(a && (a === b || resolveChat(a) === resolveChat(b)))

/** What state a sub-agent is in, as a mark: a ring while it works, a tick, a cross for what went wrong. */
function StateMark({ state, turning }: { state: SubState; turning?: boolean }) {
  // Seen working and then finished or failed: the ring becomes a tick (or a cross) that draws itself once.
  const ended = useStepEnd(isLive(state), wentWrong(state))
  if (state === 'working') return <span className={`sub-ring${turning ? ' turning' : ''}`} aria-hidden="true" />
  if (ended && (state === 'done' || wentWrong(state)))
    return <span className={`sub-mark sub-mark-${wentWrong(state) ? 'bad' : 'ok'}`}><DrawnMark kind={wentWrong(state) ? 'failed' : 'done'} draw /></span>
  const icon = state === 'waiting' ? 'clock' : wentWrong(state) ? 'failed' : state === 'stopped' ? 'square' : 'check'
  return <span className={`sub-mark sub-mark-${wentWrong(state) ? 'bad' : 'ok'}`}><Icon n={icon} size={14} /></span>
}

/** A sub-agent's lane under its row: a hairline that carries a travelling light while it runs (only the one that moves,
 *  `moving`) and fills once it is done (red when it went wrong). It never shows how far a sub-agent is. */
function Lane({ state, moving }: { state: SubState; moving: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => (moving && ref.current ? pauseWhenHidden(ref.current) : undefined), [moving])
  const cls = moving ? ' live' : state === 'done' ? ' done' : wentWrong(state) ? ' bad' : ''
  return (
    <span ref={ref} className={`sub-lane${cls}`} aria-hidden="true">
      <i />
    </span>
  )
}

// ── in the chat ──
/** One line for a sub-agent: its goal, what it runs on, its state; the current step under it while it runs. */
const SubRow = memo(function SubRow({ chat, id, level, onOpen, moving = false }: { chat: string; id: string; level: number; onOpen: (key: string) => void; moving?: boolean }) {
  const a = useSubAgent(chat, id)
  if (!a) return null
  const on = runsOn(a)
  return (
    <button className="sub-row" style={{ paddingLeft: 10 + Math.min(level, 5) * 14 }} onClick={() => { haptic(); onOpen(a.key) }}>
      <StateMark state={a.state} />
      <span className="sub-row-text">
        <span className="sub-row-line">
          <span className="sub-row-goal">{a.goal || 'Sub-agent'}</span>
          {on && <span className="sub-row-on dim">{on}</span>}
          {/* The mark already says Working and Done; the word stays for screen readers. */}
          <span className={a.state === 'working' || a.state === 'done' ? 'visually-hidden' : `sub-row-state${wentWrong(a.state) ? ' bad' : ''}`}>{STATE_WORD[a.state]}</span>
        </span>
        {isLive(a.state) && a.step && <span className="sub-row-step dim">{a.step}</span>}
      </span>
      <Lane state={a.state} moving={moving && a.state === 'working'} />
    </button>
  )
})

/** The rows of an opened group. Drawn only while it is open: a closed group costs nothing. */
export function SubGroupRows({ chat, keys, items }: { chat: string; keys: string[]; items: SubItem[] }) {
  const s = useNested(chat)
  const locked = useLockView() // no goals over the lock screen, also in a group left open
  useLayoutEffect(() => noteItems(chat, items), [chat, items])
  const wanted = new Set(keys)
  const rows = inTreeOrder(subAgentsOf(chat).filter(a => wanted.has(a.key)))
  const unknown = rows.filter(r => r.agent.effort === undefined && r.agent.child).length
  useEffect(() => {
    if (unknown) void loadStored(chat, profileOf())
  }, [chat, unknown, s.total])
  if (locked) return null
  // One lane moves at a time: the first that works (the others stand still until it is their turn).
  const moving = rows.find(r => r.agent.state === 'working')?.agent.key
  return (
    <div className="sub-rows">
      {rows.map(r => <SubRow key={r.agent.key} chat={chat} id={r.agent.key} level={r.level} moving={r.agent.key === moving} onOpen={k => openSubSheet(chat, k)} />)}
    </div>
  )
}

// ── in the chat list ──
function openNestedRow(chat: string, key: string): void {
  haptic()
  const s = getState()
  if (!s.opening && sameChat(s.active?.storedId, chat)) return openSubSheet(chat, key)
  setState({ drawer: false })
  resumeSession(chat)
    .then(() => {
      // Only over its own chat: the person may have gone elsewhere, or the chat didn't open.
      const cur = getState()
      if (!cur.opening && sameChat(cur.active?.storedId, chat)) openSubSheet(chat, key)
    })
    .catch(e => toast(errText(e), 'error'))
}

const NestedRow = memo(function NestedRow({ chat, id, level, turning, chatRunning, arrive = -1 }: { chat: string; id: string; level: number; turning: boolean; chatRunning: boolean; arrive?: number }) {
  useSubAgentRow(chat, id) // redraws only for what the row says
  const a = getSubAgent(chat, id)
  if (!a) return null
  const state = listState(a, chatRunning)
  const side = isLive(state) ? runsOn(a, 12) : state === 'done' || state === 'ended' ? '' : STATE_WORD[state]
  return (
    <button className={`nested-row${arrive >= 0 ? ' motion-in' : ''}`} style={{ marginLeft: 12 + Math.min(level, 5) * 14, ...(arrive >= 0 ? stagger(arrive) : null) }} aria-label={`Sub-agent: ${a.goal || 'no goal given'}, ${STATE_WORD[state]}`} onClick={() => openNestedRow(chat, a.key)}>
      <StateMark state={state} turning={turning} />
      <span className="nested-goal">{a.goal || 'Sub-agent'}</span>
      {side && <span className={`nested-side${wentWrong(state) ? ' bad' : ' dim'}`}>{side}</span>}
    </button>
  )
})

/** The rows under a chat, inside its row's container so they move with it. Their order is settled when the list's snapshot
 *  is taken (`snapAt`); after that a row keeps its place and only what it says changes, and one that is new goes last. */
export function NestedRows({ chat, snapAt, only, turning }: { chat: string; snapAt: number; only?: ReadonlySet<string>; turning: boolean }) {
  const s = useNested(chat)
  useNestedChoice()
  useListFree()
  const locked = useLockView() // nothing a chat's agents do is named over the lock screen
  const [all, setAll] = useState(false)
  const shown_ = useListShown()
  const open = shown_ && !locked && s.total > 0 && (only ? only.size > 0 : nestedIsOpen(chat, s))
  const missing = open ? s.total - s.keys.length : 0
  const unknown = open ? subAgentsOf(chat).filter(a => a.effort === undefined && a.child && isLive(a.state)).length : 0
  useEffect(() => {
    if (missing > 0 || unknown > 0) void loadStored(chat, profileOf())
  }, [chat, missing, unknown])
  const memory = useRef<{ at: number; keys: string[] } | null>(null)
  // Opened by its chat's toggle while the list was already on screen: the rows slide out from under the chat in a short
  // stagger. Opening the list itself draws them still (the list opens many times a day: no stagger there).
  const was = useRef({ open, shown: shown_, arrive: false })
  const arrive = open && (was.current.open ? was.current.arrive : was.current.shown)
  was.current = { open, shown: shown_, arrive }
  if (!open) return null
  const tree = inTreeOrder(subAgentsOf(chat))
  const shown = only ? tree.filter(r => r.agent.child && only.has(r.agent.child)) : tree
  const levels = new Map(shown.map(r => [r.agent.key, r.level]))
  const now = shown.map(r => r.agent.key)
  const m = memory.current
  if (!m || m.at !== snapAt) memory.current = { at: snapAt, keys: firstRows(shown, shown.length).map(r => r.agent.key) }
  else if (!listHeld()) m.keys = [...m.keys.filter(k => levels.has(k)), ...now.filter(k => !m.keys.includes(k))]
  const keys = memory.current!.keys.filter(k => levels.has(k))
  const list = all ? keys : keys.slice(0, NESTED_SHOWN)
  const firstLive = list.find(k => {
    const a = getSubAgent(chat, k)
    return a && listState(a, s.running > 0) === 'working'
  })
  return (
    <div className="nested-rows" role="group" aria-label="Sub-agents of this chat">
      {list.map((k, i) => <NestedRow key={k} chat={chat} id={k} level={levels.get(k) ?? 0} turning={turning && k === firstLive} chatRunning={s.running > 0} arrive={arrive ? i : -1} />)}
      {keys.length > list.length && (
        <button className="nested-more" onClick={() => { haptic(); setAll(true) }}>Show all {keys.length}</button>
      )}
    </div>
  )
}

// ── the sheet ──
/** The running output without the transcript's header, the last lines only. */
export function tailText(raw: unknown): string {
  let t = typeof raw === 'string' ? raw : ''
  const head = t.indexOf('\n====')
  if (head >= 0) t = t.slice(t.indexOf('\n', head + 1) + 1)
  // eslint-disable-next-line no-control-regex
  t = t.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
  return t.split('\n').slice(-60).join('\n').slice(-6000).trim()
}

/** Reads the output while the sheet shows a running sub-agent and the app is on screen; never more than one call at a time. */
function useTail(runtime: string | undefined, id: string | undefined, live: boolean): string {
  const [text, setText] = useState('')
  useEffect(() => {
    setText('')
    if (!runtime || !id || !live) return
    let dead = false
    let timer: number | undefined
    let busy = false
    const visible = () => document.visibilityState === 'visible'
    const tick = async () => {
      timer = undefined
      if (dead || busy || !visible()) return
      busy = true
      try {
        const r = await subAgentTail(runtime, id)
        if (!dead && r?.available) setText(tailText(r.text))
      } catch {
        /* the next read tries again */
      }
      busy = false
      if (!dead && visible()) timer = window.setTimeout(tick, TAIL_EVERY_MS)
    }
    const onVisible = () => {
      window.clearTimeout(timer)
      timer = undefined
      if (visible()) void tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    void tick()
    return () => {
      dead = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [runtime, id, live])
  return text
}

interface Stored {
  steps: string[]
  answer: string
}

/** A finished sub-agent's steps and last words, from its stored chat. Every field is checked: it is only ever text here. */
export function storedSteps(raw: unknown): Stored {
  const steps: string[] = []
  let answer = ''
  for (const m of Array.isArray(raw) ? raw.slice(0, 2000) : []) {
    if (!m || typeof m !== 'object') continue
    const row = m as Record<string, unknown>
    if (row.role !== 'assistant') continue
    if (typeof row.content === 'string' && row.content.trim()) answer = row.content.slice(0, 20_000)
    let calls = row.tool_calls
    if (typeof calls === 'string') {
      try {
        calls = JSON.parse(calls)
      } catch {
        calls = null
      }
    }
    for (const c of Array.isArray(calls) ? calls : []) {
      const fn = (c as { function?: { name?: unknown; arguments?: unknown } } | null)?.function
      const name = plainLine(fn?.name, 60)
      if (!name) continue
      let what = ''
      try {
        const args = typeof fn?.arguments === 'string' ? JSON.parse(fn.arguments) : fn?.arguments
        what = plainLine(Object.values((args ?? {}) as Record<string, unknown>).find(v => typeof v === 'string'), 100)
      } catch {
        /* the name alone */
      }
      if (steps.length < 40) steps.push(what ? `${name}: ${what}` : name)
    }
  }
  return { steps, answer }
}

const profileParam = () => (profileOf() && profileOf() !== 'default' ? `?profile=${encodeURIComponent(profileOf())}` : '')

/** The level, read from the sub-agent's stored chat: the plugin's list, or Hermes's own row with an older plugin. Hermes
 *  writes that row a moment after the start, so it is tried a few times while the sheet is open. */
function useLevel(chat: string, a: SubAgent | undefined): boolean {
  const child = a?.child
  const unknown = a?.effort === undefined
  const [gaveUp, setGaveUp] = useState(false)
  useEffect(() => {
    setGaveUp(false)
    if (!child || !unknown) return
    let dead = false
    let timer: number | undefined
    let tries = 0
    const read = async () => {
      await loadStored(chat, profileOf())
      const cur = subAgentsOf(chat).find(x => x.child === child)
      if (!dead && cur?.effort === undefined) {
        const row = await api<{ model_config?: unknown; model?: unknown }>('GET', `/api/sessions/${encodeURIComponent(child)}${profileParam()}`).catch(() => null)
        let cfg: unknown = row?.model_config
        try {
          if (typeof cfg === 'string') cfg = JSON.parse(cfg)
        } catch {
          cfg = null
        }
        const rc = (cfg as { reasoning_config?: { enabled?: unknown; effort?: unknown } | null } | null)?.reasoning_config
        if (cfg && typeof cfg === 'object') noteStored(chat, cleanStored([{ id: child, goal: cur?.goal, model: row?.model, effort: rc?.enabled === false ? 'none' : rc?.effort ?? '' }]))
      }
      if (dead || subAgentsOf(chat).find(x => x.child === child)?.effort !== undefined) return
      if (++tries < 4) timer = window.setTimeout(read, 1500)
      else setGaveUp(true)
    }
    void read()
    return () => {
      dead = true
      window.clearTimeout(timer)
    }
  }, [chat, child, unknown])
  return gaveUp
}

/** Whatever goes wrong while drawing one sub-agent stays in its sheet: the chat underneath goes on working. */
export class SheetBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    const close = () => setState({ sheet: null })
    return (
      <div className="sheet-backdrop" onClick={close}>
        <div className="sheet" role="dialog" aria-label="Sub-agent" onClick={e => e.stopPropagation()}>
          <div className="sheet-desc">This sub-agent can’t be shown.</div>
          <button className="btn" onClick={close}>Close</button>
        </div>
      </div>
    )
  }
}

export function SubAgentSheet() {
  const target = useSubTarget()
  const shown = useStore(s => s.opening || s.active?.storedId || '')
  const matches = Boolean(target && shown && sameChat(shown, target.chat))
  useEffect(() => {
    if (target && !matches && getState().sheet === 'subagent') setState({ sheet: null })
  }, [target, matches])
  if (!target || !matches) return null
  const id = `${target.chat}\n${target.key}`
  return <SheetBoundary key={id}><SheetFor key={id} chat={target.chat} first={target.key} /></SheetBoundary>
}

function SheetFor({ chat, first }: { chat: string; first: string }) {
  const [path, setPath] = useState([first])
  const [tall, setTall] = useState(false)
  const key = path[path.length - 1]
  const close = () => setState({ sheet: null })
  const back = () => setPath(p => p.slice(0, -1))
  useBackHandler(path.length > 1 ? back : close)
  const sheet = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; at: number; dy: number; id: number } | null>(null)

  /** How far down the sheet rests when it is at half height: it keeps one size and moves. */
  const rest = () => (tall ? 0 : Math.max(0, (sheet.current?.offsetHeight ?? 0) - window.innerHeight * 0.54))
  const place = (dy: number, moving: boolean) => {
    const n = sheet.current
    if (!n) return
    n.style.transition = moving ? 'none' : ''
    n.style.transform = `translateY(${Math.max(0, rest() + dy)}px)`
  }
  // It comes up from below once; `.sub-sheet`'s transition carries it to its place.
  useLayoutEffect(() => {
    const n = sheet.current
    if (!n) return
    n.style.transition = 'none'
    n.style.transform = 'translateY(100%)'
    void n.offsetHeight
  }, [])
  useLayoutEffect(() => place(0, false)) // also after every render: the height follows the keyboard
  useEffect(() => {
    const on = () => place(0, false)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  })
  const grip = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if ((e.target as Element).closest('button, a, input, textarea')) return
      drag.current = { y: e.clientY, at: Date.now(), dy: 0, id: e.pointerId }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current
      if (!d) return
      d.dy = e.clientY - d.y
      place(d.dy, true)
    },
    onPointerUp: () => {
      const d = drag.current
      drag.current = null
      if (!d) return
      const quick = Math.abs(d.dy) / Math.max(1, Date.now() - d.at) > 0.5
      const far = Math.abs(d.dy) > 70 || (quick && Math.abs(d.dy) > 24)
      if (far && d.dy < 0) setTall(true)
      else if (far && tall) setTall(false)
      else if (far) return close()
      place(0, false)
    },
    onPointerCancel: () => {
      drag.current = null
      place(0, false)
    }
  }
  return (
    <div className="sheet-backdrop sub-backdrop" onClick={close}>
      <div ref={sheet} className={`sheet sub-sheet${tall ? ' at-top' : ''}`} role="dialog" aria-label="Sub-agent" onClick={e => e.stopPropagation()}>
        <SheetBody key={key} chat={chat} id={key} depth={path.length} grip={grip} onBack={back} onOpen={k => setPath(p => [...p, k])} onFocusField={() => setTall(true)} />
      </div>
    </div>
  )
}

function SheetBody({
  chat,
  id,
  depth,
  grip,
  onBack,
  onOpen,
  onFocusField
}: {
  chat: string
  id: string
  depth: number
  grip: React.HTMLAttributes<HTMLDivElement>
  onBack: () => void
  onOpen: (key: string) => void
  onFocusField: () => void
}) {
  const direct = useSubAgent(chat, id)
  const childRef = useRef(direct?.child)
  if (direct?.child) childRef.current = direct.child
  // A row known only from the stored chats is replaced when Hermes names the sub-agent.
  const a = direct ?? subAgentsOf(chat).find(x => x.child && x.child === childRef.current)
  useNested(chat) // its own sub-agents come and go
  const title = useStore(s => plainTitle(s.sessions.find(x => sameChat(x.id, chat))?.title) || plainTitle(sameChat(s.active?.storedId, chat) ? s.active!.title : '') || 'this chat')
  const runtime = useStore(s => (!s.opening && sameChat(s.active?.storedId, chat) ? s.active!.runtimeId : undefined))
  const chatEffort = useStore(s => (sameChat(s.active?.storedId, chat) ? s.active!.info.reasoning_effort || s.defaultEffort : undefined))
  const gaveUp = useLevel(chat, a)
  const [configured, setConfigured] = useState<unknown>(undefined)
  useEffect(() => {
    let dead = false
    void api<{ delegation?: { reasoning_effort?: unknown } }>('GET', '/api/config')
      .then(c => { if (!dead) setConfigured(c?.delegation?.reasoning_effort ?? null) })
      .catch(() => {})
    return () => {
      dead = true
    }
  }, [])
  const live = !!a && isLive(a.state)
  const tail = useTail(runtime, a?.id, live)
  const [stored, setStored] = useState<Stored | null>(null)
  useEffect(() => {
    setStored(null)
    if (!a?.child || live) return
    let dead = false
    void api<{ messages?: unknown }>('GET', `/api/sessions/${encodeURIComponent(a.child)}/messages${profileParam()}`)
      .then(r => { if (!dead) setStored(storedSteps(r?.messages)) })
      .catch(() => {})
    return () => {
      dead = true
    }
  }, [a?.child, live])
  const guarded = useStore(() => chatTainted(chat)) // the sheet's own chat decides, whatever is on screen behind it
  const [refused, setRefused] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  if (!a) return <div className="dim pad">This sub-agent is no longer known.</div>

  const parent = (a.parent && getSubAgent(chat, a.parent)) || (a.parentChild ? subAgentsOf(chat).find(x => x.child === a.parentChild) : undefined)
  const own = inTreeOrder(subAgentsOf(chat)).filter(r => (r.agent.parent && r.agent.parent === a.id) || (r.agent.parentChild && r.agent.parentChild === a.child))
  const elapsed = live ? (a.startedAt ? (Date.now() - a.startedAt) / 1000 : 0) : a.secs
  const word = effortWord(a.effort)
  const same = followsChat(a.effort, configured, chatEffort)
  const numbers = numbersLine(a)
  const summary = a.summary || stored?.answer || ''
  const canSteer = live && !!a.id && !!runtime && a.accepting && !refused
  const canStop = live && !!a.id && !!runtime
  // A new chat made from this one has no record of what was read here, so it isn't offered once phone data is involved.
  const canContinue = !live && !!a.child && !a.phoneData && !guarded && idsReadState([chat, a.child]) === 'clear'
  const locked = () => {
    if (!lockView()) return false
    askUnlock('Unlock the phone first')
    return true
  }
  const send = async () => {
    const t = text.trim()
    if (!t || busy || !a.id || !runtime || locked()) return
    setBusy(true)
    try {
      if (await steerSubAgent(runtime, a.id, t)) {
        setText('')
        toast('Sent to the sub-agent')
      } else {
        setRefused(true)
        toast('It no longer takes messages', 'warn')
      }
    } catch (e) {
      toast(errText(e), 'error')
    }
    setBusy(false)
  }
  const stop = async () => {
    if (!a.id || !runtime || locked()) return
    const ok = await confirmDialog({ title: 'Stop this sub-agent?', message: 'It ends now. What it has done so far stays.', confirmLabel: 'Stop', cancelLabel: 'Keep it running', danger: true, icon: 'square' })
    if (!ok || locked()) return
    try {
      if (!(await stopSubAgent(runtime, a.id))) toast('It has already ended')
    } catch (e) {
      toast(errText(e), 'error')
    }
  }
  const goOn = async () => {
    if (!a.child || busy || locked()) return
    setBusy(true)
    try {
      await continueSubAgent(chat, a)
      setState({ sheet: null })
    } catch (e) {
      toast(errText(e), 'error')
    }
    setBusy(false)
  }
  return (
    <GuardCtx.Provider value={guarded || a.phoneData}>
      <div className="sub-sheet-head" {...grip}>
        <div className="sheet-grip" />
        <div className="sub-title-row">
          {depth > 1 && (
            <button className="icon-btn sub-back" aria-label="Back" onClick={() => { haptic(); onBack() }}>
              <Icon n="left" size={20} />
            </button>
          )}
          <div className="sub-title-text">
            <div className="sub-goal"><Linked text={a.goal || 'Sub-agent'} /></div>
            <div className="sub-of dim small">
              Sub-agent of {parent ? <bdi>{quotedGoal(parent.goal)}</bdi> : title} · <span className={wentWrong(a.state) ? 'sub-bad' : ''}>{STATE_WORD[a.state]}</span>
              {elapsed > 0 ? ` · ${shortTime(elapsed)}` : ''}
            </div>
          </div>
        </div>
      </div>
      <div className="sub-sheet-scroll">
        <div className="sub-values">
          <div className="sub-value">
            <span className="dim small">Model</span>
            <span className="sub-value-text">{a.model || 'Not reported'}</span>
          </div>
          <div className="sub-value">
            <span className="dim small">Reasoning</span>
            <span className="sub-value-text">
              {word ?? (gaveUp || !a.child ? 'Not reported' : 'Checking…')}
              {word && same ? <span className="dim"> · same as the chat</span> : null}
            </span>
          </div>
        </div>
        {numbers && <div className="sub-numbers dim small">{numbers}</div>}
        {live ? (
          <section aria-label="What it is doing">
            <div className="sub-label dim small">What it is doing</div>
            <pre className="sub-tail">{tail || a.step || 'Waiting for its first output…'}</pre>
          </section>
        ) : (
          <section aria-label="What it did">
            {stored?.steps.length ? (
              <>
                <div className="sub-label dim small">Steps</div>
                <ol className="sub-steps">{stored.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              </>
            ) : null}
            {summary && (
              <>
                <div className="sub-label dim small">Summary</div>
                <div className="sub-summary"><Linked text={summary} /></div>
              </>
            )}
          </section>
        )}
        {own.length > 0 && (
          <section aria-label="Its own sub-agents">
            <div className="sub-label dim small">Its own sub-agents</div>
            <div className="sub-rows">{own.map(r => <SubRow key={r.agent.key} chat={chat} id={r.agent.key} level={0} onOpen={onOpen} />)}</div>
          </section>
        )}
        {canSteer && (
          <div className="sub-steer">
            <input
              className="sheet-input"
              aria-label="Tell it something"
              placeholder="Tell it something"
              maxLength={2000}
              value={text}
              onFocus={onFocusField}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void send() }}
            />
            <button className="btn" disabled={!text.trim() || busy} onClick={() => void send()}>Send</button>
          </div>
        )}
        {canContinue && <button className="btn sub-wide" disabled={busy} onClick={() => void goOn()}>Continue in a new chat</button>}
        <button className="sub-settings dim small" onClick={() => { haptic(); openSettingsOn('hermes') }}>Sub-agent settings</button>
        {canStop && <button className="btn danger sub-wide" onClick={() => void stop()}>Stop</button>}
      </div>
    </GuardCtx.Provider>
  )
}
