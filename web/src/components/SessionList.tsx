import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal, flushSync } from 'react-dom'
import type { SessionListRow } from '@hermes/shared/gateway-contract.generated'
import { errText, loadArchived, loadMoreSessions, moreSessionsMayExist, resumeSession, searchMessages, type MessageHit } from '../gateway'
import { useOrder } from '../order'
import { setState, toast, useStore } from '../store'
import { parseSnippet } from '../jump'
import { haptic } from '../bridge'
import { Title, plainTitle } from './Title'
import { ago, lastActive } from '../unread'
import { dayLabel, frozenActivity, orderChats, recentIds, restoreAside } from '../chatorder'
import { holdChatSnapshot, useChatSnapshot } from '../chatsnapshot'
import { aimAtNeed, needParts, useListedNeeds, type Need } from '../needsyou'
import { archiveChat, deleteChat, pinChat } from '../chatactions'
import { cronJobId, runName, useJobName } from '../panelvalues'
import { Chevron, MenuGroup, MenuRow, MenuSheet } from './ui'
import { ChatMenuHeader } from './ChatMenu'
import { Icon } from './icons'
import { NestedRows, NestedToggle } from './SubAgentsCore'
import { forgetChat, noteStored, searchNested, useChatsWithAgents, useNested, useRunningChats, type NestedHit } from '../subagents'

/** A scheduled job's run (source "cron"): a clock and the job's name. */
function RunSource({ s }: { s: SessionListRow }) {
  const name = runName(s, useJobName(cronJobId(s.id)))
  return (
    <span className="session-run">
      <Icon n="clock" label="Scheduled" />
      {name}
    </span>
  )
}

// ── one swipeable row ────────────────────────────────────────
type RightAction = 'archive' | 'unarchive'
const ARCHIVE_AT = 0.3 // fraction of row width
const DELETE_AT = 0.3

interface RowProps {
  s: SessionListRow
  active: boolean
  pinned: boolean
  archived?: boolean
  /** The row stands in the Needs you group: what the chat waits for replaces the working and unread states. */
  need?: Need
  /** It has sub-agents / one of them runs (`useChatsWithAgents`): only such a row does anything about them. */
  hasAgents: boolean
  agentsRun: boolean
  onOpen: () => void
  onRight: (a: RightAction) => void
  onDelete: () => void
  onLongPress: (pointerY: number, pointerId: number, rowTop: number) => void
  onMenu: () => void
}

function SwipeRow({ s, active, pinned, archived, need, hasAgents, agentsRun, onOpen, onRight, onDelete, onLongPress, onMenu }: RowProps) {
  // Working right now: the open chat's own turn, or any chat in the plugin's activity feed (a background
  // memory/skills review after a reply doesn't count: the answer is already in).
  const working = (useStore(
    st => (st.active?.storedId === s.id && !!st.active?.running) || st.activity.some(a => a.session === s.id && !a.review)
  ) || agentsRun) && !need
  const unread = useStore(st => !active && st.unread.includes(s.id)) && !working && !need
  const ref = useRef<HTMLDivElement>(null)
  const g = useRef({ down: false, x0: 0, y0: 0, mode: '' as '' | 'swipe' | 'scroll' | 'drag', moved: false, y: 0, id: 0, timer: 0 as unknown as ReturnType<typeof setTimeout>, zone: '' })
  const [dx, setDx] = useState(0)
  const [anim, setAnim] = useState(false)

  const width = () => ref.current?.offsetWidth || 320
  const rightAction = (x: number): RightAction | null => {
    if (x > width() * ARCHIVE_AT) return archived ? 'unarchive' : 'archive'
    return null
  }
  const zoneOf = (x: number) => (x > 0 ? rightAction(x) || '' : x < -width() * DELETE_AT ? 'delete' : '')

  const settle = (to: number) => {
    setAnim(true)
    setDx(to)
    setTimeout(() => setAnim(false), 220)
  }

  const onDown = (e: React.PointerEvent) => {
    g.current = { ...g.current, down: true, x0: e.clientX, y0: e.clientY, y: e.clientY, id: e.pointerId, mode: '', moved: false, zone: '' }
    clearTimeout(g.current.timer)
    g.current.timer = setTimeout(() => {
      if (!g.current.moved) {
        // Long-press: lift the row and keep dragging with the same finger.
        g.current.mode = 'drag'
        g.current.moved = true // no tap afterwards
        haptic()
        onLongPress(g.current.y, g.current.id, ref.current?.getBoundingClientRect().top ?? g.current.y)
      }
    }, 450)
  }
  const onMove = (e: React.PointerEvent) => {
    if (!g.current.down) return // a mouse passing over the row is not a swipe; a press on its buttons never reaches onDown
    g.current.y = e.clientY
    if (g.current.mode === 'drag') return
    const x = e.clientX - g.current.x0
    const y = e.clientY - g.current.y0
    if (Math.abs(x) > 6 || Math.abs(y) > 6) {
      g.current.moved = true
      clearTimeout(g.current.timer)
    }
    if (!g.current.mode) {
      if (Math.abs(x) > 10 && Math.abs(x) > Math.abs(y) * 1.3) {
        g.current.mode = 'swipe'
        try {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        } catch {
          /* synthetic pointer */
        }
      } else if (Math.abs(y) > 10) g.current.mode = 'scroll'
    }
    if (g.current.mode === 'swipe') {
      const clamped = Math.max(-width() * 0.9, Math.min(width() * 0.9, x))
      const z = zoneOf(clamped)
      if (z !== g.current.zone) {
        if (z) haptic() // tick when crossing into an action
        g.current.zone = z
      }
      setDx(clamped)
    }
  }
  const onUp = () => {
    g.current.down = false
    clearTimeout(g.current.timer)
    if (g.current.mode !== 'swipe') return
    const z = zoneOf(dx)
    if (z === 'delete') {
      settle(0)
      onDelete()
    } else if (z === 'archive' || z === 'unarchive') {
      settle(width())
      setTimeout(() => onRight(z), 180)
    } else settle(0)
  }

  const r = dx > 0 ? rightAction(dx) : null
  const del = dx < -width() * DELETE_AT
  const bg = dx > 0 ? 'blue' : dx < 0 ? 'red' : ''
  const label = dx > 0 ? (archived ? 'Unarchive' : 'Archive') : 'Delete'
  const icon = dx > 0 ? 'archive' : 'trash'
  const armed = dx > 0 ? Boolean(r) : del

  return (
    <div className="swipe-row" ref={ref}>
      {dx !== 0 && (
        <div className={`swipe-bg ${bg}${dx > 0 ? ' left' : ' right'}${armed ? ' armed' : ''}`}>
          <span className="swipe-icon"><Icon n={icon} /></span>
          <span>{label}</span>
        </div>
      )}
      <div
        className={`session-row${active ? ' on' : ''}${dx ? ' moving' : ''}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: anim ? 'transform 0.2s ease' : undefined }}
        onPointerDown={onDown}
        onContextMenu={e => e.preventDefault()}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          g.current.down = false
          clearTimeout(g.current.timer)
          if (g.current.mode === 'swipe') settle(0)
        }}
        onClick={() => {
          if (!g.current.moved) onOpen()
        }}
      >
        <span className="session-main">
          {working && <span className="visually-hidden">Working</span>}
          {need && <span className="visually-hidden">Needs you</span>}
          <span className={`session-title${working ? ' working' : ''}`}>
            {need && <span className="needs-dot" />}
            {unread && <span className="unread-dot" role="img" aria-label="Finished, not opened yet" />}
            {pinned && <span className="pin-dot"><Icon n="pin" /> </span>}
            {s.title ? <Title text={s.title} /> : s.preview || 'Untitled'}
          </span>
          {need ? <NeedLine need={need} /> : hasAgents ? <AgentsRowLine s={s} state={working ? 'Working' : unread ? 'Finished' : ''} /> : <RowLine s={s} state={working ? 'Working' : unread ? 'Finished' : ''} />}
        </span>
        {hasAgents && <NestedToggle chat={s.id} />}
        <button
            className="row-menu-btn"
            aria-label="Chat options"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation()
              haptic()
              onMenu()
            }}
          >
            <Icon n="dots" />
          </button>
      </div>
    </div>
  )
}

/** The line under a row's title: the time since its last activity, the state word ("Working" while it runs, "Finished"
 *  while it is unread), then where it came from when not from this app (a scheduled run: the job's name with a clock).
 *  The state word is text, so it does not rest on the dot's colour; screen readers already hear the state before the
 *  title (the dot's label, the hidden "Working"), so the word is hidden from them and they hear it once. One line: it
 *  never wraps, a long source is cut with an ellipsis. */
function RowLine({ s, state, agents = 0 }: { s: SessionListRow; state: '' | 'Working' | 'Finished'; agents?: number }) {
  const parts: React.ReactNode[] = []
  const when = ago(lastActive(s))
  if (when) parts.push(when)
  if (state) parts.push(<span key="state" className="session-state" aria-hidden="true">{state}</span>)
  if (agents) parts.push(`${agents} sub-agent${agents === 1 ? '' : 's'}`)
  if (s.source === 'cron') parts.push(<RunSource key="run" s={s} />)
  else if (s.source && s.source !== 'mobile') parts.push(s.source)
  return (
    <span className="session-sub dim small">
      {parts.flatMap((p, i) => (i ? [' · ', p] : [p]))}
    </span>
  )
}

/** The same line for a chat with sub-agents: it says how many. */
function AgentsRowLine({ s, state }: { s: SessionListRow; state: '' | 'Working' | 'Finished' }) {
  return <RowLine s={s} state={state} agents={useNested(s.id).total} />
}

/** What a chat waits for. A sub-agent's goal stands in its own <bdi>, so its text direction can't reorder the app's words. */
export function NeedWords({ need }: { need: Need }) {
  const { asker, lead, what } = needParts(need)
  return <>{lead}{asker ? <><bdi>{asker}</bdi> </> : null}{what}</>
}

/** The line under the title of a chat that waits: the state word, then what for. Screen readers already heard the word
 *  before the title, as with "Working". */
function NeedLine({ need }: { need: Need }) {
  return (
    <span className="session-sub dim small">
      <span className="session-state needs-word" aria-hidden="true">Needs you</span> · <NeedWords need={need} />
    </span>
  )
}

// ── drag-to-reorder ──────────────────────────────────────────
// The dragged row follows the finger (translateY); the others slide aside to show the gap.
// The DOM order never changes during a drag (that would lose the touch); the new order is
// committed on release. Near the top/bottom edge the drawer list auto-scrolls.
type ListName = 'pinned' | 'chats'
/** cross: dragging past the edge of the list moves the row into the other list (pin / unpin) on release. */
interface DragOpts {
  onLift?: () => void
  onStill?: () => void
  onCancel?: () => void
  cross?: { free: 'up' | 'down'; over: (y: number) => boolean; onHover: (over: boolean, y: number) => void; onDrop: (y: number) => void }
}
interface DragView {
  list: ListName
  id: string
  from: number
  to: number
  dy: number
  h: number
}

function useDrag(commit: (list: ListName, ids: string[]) => void, gap: { list: ListName; at: number } | null = null) {
  const [view, setView] = useState<DragView | null>(null)
  const active = useRef<(() => void) | null>(null)
  useEffect(() => () => active.current?.(), [])

  // opts.onLift: a long-press only becomes a drag once the finger moves; onStill: released without moving.
  const begin = (
    list: ListName,
    container: HTMLElement,
    ids: string[],
    id: string,
    pointerY: number,
    pointerId: number,
    rowTop: number,
    opts: DragOpts = {}
  ) => {
    active.current?.()
    const from = ids.indexOf(id)
    if (from < 0) return
    holdChatSnapshot(true) // the list's order is not read again until the row is dropped (chatsnapshot.ts)
    const grab = pointerY - rowTop
    let d: { tops: number[]; hs: number[]; scroll0: number; scroller: HTMLElement } | null = null
    let lastY = pointerY
    let to = from
    let raf = 0
    let done = false
    let lifted = !opts.onLift
    let crossing = false

    const measure = () => {
      const els = ids.map(i => container.querySelector<HTMLElement>(`[data-id="${CSS.escape(i)}"]`))
      if (els.some(e => !e)) return
      const rects = els.map(e => e!.getBoundingClientRect())
      const scroller = (container.closest('.drawer-list') as HTMLElement) || container
      d = { tops: rects.map(r => r.top), hs: rects.map(r => r.height), scroll0: scroller.scrollTop, scroller }
    }
    const update = () => {
      if (!lifted) {
        if (Math.abs(lastY - pointerY) < 10) return
        lifted = true
        flushSync(() => opts.onLift!()) // layout switches to the flat list now, so measure after
        d = null
      }
      if (!d) measure()
      if (!d) return
      const scrolled = d.scroller.scrollTop - d.scroll0
      const h = d.hs[from]
      const last = d.tops.length - 1
      let dy = lastY - grab - d.tops[from] + scrolled
      const lo = opts.cross?.free === 'up' ? -1e6 : d.tops[0] - d.tops[from] - 8
      const hi = opts.cross?.free === 'down' ? 1e6 : d.tops[last] + d.hs[last] - h - d.tops[from] + 8
      dy = Math.max(lo, Math.min(hi, dy))
      if (opts.cross) {
        const now = opts.cross.over(lastY)
        if (now || now !== crossing) opts.cross.onHover(now, lastY)
        if (now !== crossing) {
          crossing = now
          haptic()
        }
      }
      const center = d.tops[from] + dy + h / 2
      let next = crossing ? from : 0
      if (!crossing) for (let j = 0; j < d.tops.length; j++) if (j !== from && d.tops[j] + d.hs[j] / 2 < center) next++
      if (next !== to) {
        to = next
        haptic()
      }
      setView({ list, id, from, to, dy, h })
    }
    const frame = () => {
      if (done) return
      if (d && lifted) {
        const r = d.scroller.getBoundingClientRect()
        const edge = 72
        if (lastY < r.top + edge) d.scroller.scrollTop -= Math.ceil((r.top + edge - lastY) / 6)
        else if (lastY > r.bottom - edge) d.scroller.scrollTop += Math.ceil((lastY - (r.bottom - edge)) / 6)
        update()
      }
      raf = requestAnimationFrame(frame)
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      lastY = e.clientY
      update()
    }
    const onTouch = (e: TouchEvent) => {
      e.preventDefault() // keep the browser from scrolling (and cancelling) under the drag
      const t = e.touches[0]
      if (t) {
        lastY = t.clientY
        update()
      }
    }
    const cleanup = () => {
      done = true
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('touchmove', onTouch)
      window.removeEventListener('touchend', finish)
      active.current = null
      holdChatSnapshot(false)
    }
    function finish() {
      if (done) return
      cleanup()
      if (!lifted) opts.onStill?.()
      else if (crossing && opts.cross) opts.cross.onDrop(lastY)
      else if (!d || to === from) opts.onCancel?.()
      else {
        const next = ids.filter(x => x !== id)
        next.splice(to, 0, id)
        commit(list, next)
      }
      setView(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('touchmove', onTouch, { passive: false })
    window.addEventListener('touchend', finish)
    active.current = cleanup
    setView({ list, id, from, to: from, dy: 0, h: 0 }) // held: show it lifted right away
    // Measure after the layout settles.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (done) return
        measure()
        update()
        raf = requestAnimationFrame(frame)
      })
    )
  }

  const styleFor = (list: ListName, id: string, idx: number): React.CSSProperties | undefined => {
    if (view && view.list !== list && gap?.list === list && idx >= gap.at && view.h) {
      // The dragged row is over this list: rows from the drop point slide down to open a gap.
      return { transform: `translateY(${view.h}px)`, transition: 'transform 0.18s ease' }
    }
    if (view && view.list !== list && gap?.list === list) return { transition: 'transform 0.18s ease' }
    if (!view || view.list !== list) return undefined
    if (id === view.id) return { transform: `translateY(${view.dy}px)`, zIndex: 5, position: 'relative' }
    let shift = 0
    if (view.from < view.to && idx > view.from && idx <= view.to) shift = -view.h
    if (view.from > view.to && idx >= view.to && idx < view.from) shift = view.h
    return { transform: shift ? `translateY(${shift}px)` : undefined, transition: 'transform 0.18s ease' }
  }

  return { view, begin, styleFor }
}

// ── ⋮ menu ──────────────────────────────────────────
/** A row's menu: the chat's title with Rename, then Pin / Unpin (not for archived chats), Archive / Unarchive and
 *  Delete. Nothing that needs the chat to be open (the owner's decision, session-list-gestures.md). It opens over the
 *  side panel, which is glass, so it is a solid surface (glass never lies on glass) and the list stays where it was. */
function SessionMenu({
  s,
  archived,
  pinned,
  close,
  onPin,
  onArchive,
  onDelete
}: {
  s: SessionListRow
  archived: boolean
  pinned: boolean
  close: () => void
  onPin: (on: boolean) => void
  onArchive: (on: boolean) => void
  onDelete: () => void
}) {
  const act = (fn: () => void) => () => {
    close()
    fn()
  }
  return (
    <MenuSheet label="Chat options" onClose={close} solid>
      <ChatMenuHeader id={s.id} title={s.title} fallback={s.preview || 'Untitled'} onDone={close} />
      <MenuGroup>
        {!archived && <MenuRow icon="pin" title={pinned ? 'Unpin' : 'Pin to top'} onClick={act(() => onPin(!pinned))} />}
        <MenuRow icon="archive" title={archived ? 'Unarchive' : 'Archive'} onClick={act(() => onArchive(!archived))} />
        <MenuRow icon="trash" title="Delete" danger onClick={act(onDelete)} />
      </MenuGroup>
    </MenuSheet>
  )
}

// ── the list ─────────────────────────────────────────────────
/** The Needs you group. While the open chat works (its text box's light moves) the first row's ring stands still
 *  (`needs-still`): two repeating animations at most. Only this wrapper follows that state, so a reply starting or
 *  ending redraws no row of the list (the rows are the same elements). */
function NeedsGroup({ children }: { children: ReactNode }) {
  const activeId = useStore(s => s.active?.storedId)
  const runs = useStore(s => Boolean(s.active?.running))
  const agents = useNested(activeId ?? '').live
  return (
    <div role="group" aria-labelledby="needs-you-title" className={runs || agents > 0 ? 'needs-still' : undefined}>
      <div id="needs-you-title" className="group-title needs-title" role="heading" aria-level={2}>
        Needs you
      </div>
      {children}
    </div>
  )
}

export function SessionList({ query }: { query: string }) {
  const sessions = useStore(s => s.sessions)
  const loading = useStore(s => s.sessionsLoading)
  const profile = useStore(s => s.profile)
  const activeId = useStore(s => s.active?.storedId)
  const needs = useListedNeeds()
  const [order, setOrder] = useOrder(profile)
  // Last activity as of the latest snapshot (chatsnapshot.ts): a reply that lands does not move a row; a chat listed
  // after the snapshot uses its time now. The date headings are worked out as of the snapshot too.
  const snap = useChatSnapshot()
  const activity = useMemo(() => frozenActivity<SessionListRow>(snap.profile === profile ? snap.times : new Map(), lastActive), [snap, profile])
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [archived, setArchivedRows] = useState<SessionListRow[] | null>(null)
  const [menu, setMenu] = useState<{ s: SessionListRow; archived: boolean } | null>(null)
  const [pinZone, setPinZone] = useState(false) // a chat is being dragged: show the Pinned target even if empty
  const [hover, setHover] = useState<'' | 'pin' | 'unpin'>('')
  const [gap, setGap] = useState<{ list: ListName; at: number } | null>(null)
  const pinnedRef = useRef<HTMLDivElement>(null)
  const chatsRef = useRef<HTMLDivElement>(null)

  const [hits, setHits] = useState<MessageHit[] | null>(null)
  const [agentHits, setAgentHits] = useState<NestedHit[]>([])
  const q2 = query.trim()
  useEffect(() => {
    setAgentHits([])
    if (q2.length < 2) {
      setHits(null)
      return
    }
    let dead = false
    const t = setTimeout(() => {
      searchMessages(q2)
        .then(h => !dead && setHits(h))
        .catch(() => !dead && setHits([]))
      searchNested(q2, profile)
        .then(found => {
          if (dead) return
          for (const h of found) noteStored(h.chat, [{ id: h.child, parent: '', goal: h.goal, model: '', started: 0, ended: 1, reason: '', steps: 0 }])
          setAgentHits(found)
        })
        .catch(() => {}) // a plugin older than the app
    }, 350)
    return () => {
      dead = true
      clearTimeout(t)
    }
  }, [q2, profile])

  const needle = query.trim().toLowerCase()
  // A sub-agent found by its goal shows under its chat, and brings the chat into the results.
  const agentsFound = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const h of agentHits) m.set(h.chat, (m.get(h.chat) ?? new Set()).add(h.child))
    return m
  }, [agentHits])
  const match = (s: SessionListRow) => !needle || agentsFound.has(s.id) || `${s.title || ''} ${s.preview || ''}`.toLowerCase().includes(needle)
  const canReorder = !needle

  // The Needs you group, on top: a chat in it is not repeated under Pinned or its date.
  const needRows = useMemo(() => {
    const byId = new Map(sessions.map(s => [s.id, s]))
    return needs.flatMap(need => {
      const s = byId.get(need.session)
      return s && match(s) ? [{ s, need }] : []
    })
  }, [sessions, needs, needle, agentsFound]) // eslint-disable-line react-hooks/exhaustive-deps
  const needIds = useMemo(() => new Set(needs.map(n => n.session)), [needs])

  const pinnedRows = useMemo(() => {
    const byId = new Map(sessions.map(s => [s.id, s]))
    return order.pinned.filter(id => !needIds.has(id)).map(id => byId.get(id)).filter((s): s is SessionListRow => Boolean(s) && match(s!))
  }, [sessions, order.pinned, needle, needIds, agentsFound]) // eslint-disable-line react-hooks/exhaustive-deps

  const ordered = useMemo(() => {
    const others = sessions.filter(s => !order.pinned.includes(s.id) && match(s))
    // Last activity from the snapshot (or the saved custom order).
    return orderChats(others, order.manual, activity)
  }, [sessions, order.pinned, order.manual, needle, activity, agentsFound]) // eslint-disable-line react-hooks/exhaustive-deps
  const chats = useMemo(() => ordered.filter(s => !needIds.has(s.id)), [ordered, needIds])
  /** A custom order made from the rows on show, with the chats now in the group back in their places: they return there. */
  const withWaiting = (ids: string[]) => restoreAside(ids, ordered.map(s => s.id), needIds)

  const drag = useDrag((list, ids) => {
    if (list === 'pinned') setOrder(o => ({ ...o, pinned: restoreAside([...ids, ...o.pinned.filter(x => !ids.includes(x))], o.pinned, needIds) }))
    else setOrder(o => ({ ...o, manual: withWaiting(ids) }))
  }, gap)

  useEffect(() => {
    if (!drag.view) {
      setPinZone(false)
      setHover('')
      setGap(null)
    }
  }, [drag.view])

  const refreshArchived = useCallback(() => {
    loadArchived()
      .then(setArchivedRows)
      .catch(e => toast(errText(e), 'error'))
  }, [])
  useEffect(() => {
    if (archivedOpen) refreshArchived()
  }, [archivedOpen, profile, refreshArchived])

  const pin = (id: string, on: boolean) => pinChat(profile, id, on)
  const archive = (id: string, on: boolean) => {
    void archiveChat(profile, id, on).then(ok => {
      if (ok && (archivedOpen || !on)) refreshArchived()
    })
  }
  const remove = async (s: SessionListRow) => {
    if (await deleteChat(profile, s.id, plainTitle(s.title) || s.preview || '')) {
      forgetChat(s.id) // its nested rows go with it
      setArchivedRows(a => a && a.filter(x => x.id !== s.id))
    }
  }

  /** Where (0-based) a row dropped at height y would land among the rows of a list, ignoring the dragged one. */
  const dropIndex = (container: HTMLElement | null, y: number, skip: string) =>
    [...(container?.querySelectorAll<HTMLElement>('[data-id]') ?? [])].filter(e => e.dataset.id !== skip).filter(e => e.getBoundingClientRect().top + e.offsetHeight / 2 < y).length
  const showGap = (list: ListName, at: number) => setGap(g => (g && g.list === list && g.at === at ? g : { list, at }))

  const startDrag = (list: ListName, id: string, y: number, pointerId: number, rowTop: number, opts?: DragOpts) => {
    const container = (list === 'pinned' ? pinnedRef : chatsRef).current
    const ids = (list === 'pinned' ? pinnedRows : chats).map(s => s.id)
    if (container) drag.begin(list, container, ids, id, y, pointerId, rowTop, opts)
  }

  // Only one ring turns in the list, on the first chat that has something running (at most two repeating animations).
  const runningChats = useRunningChats()
  const withAgents = useChatsWithAgents()
  const turningChat = [...needRows.map(r => r.s), ...pinnedRows, ...chats].find(s => runningChats.includes(s.id))?.id

  const row = (s: SessionListRow, list: ListName | null, idx: number, need?: Need) => (
    <div
      key={s.id}
      data-id={s.id}
      className={`${drag.view?.id === s.id ? 'drag-item dragging' : 'drag-item'}${need ? ' motion-in' : ''}`}
      style={list ? drag.styleFor(list, s.id, idx) : undefined}
    >
      <SwipeRow
        s={s}
        active={s.id === activeId}
        pinned={order.pinned.includes(s.id)}
        archived={!list && !need}
        need={need}
        hasAgents={withAgents.has(s.id)}
        agentsRun={runningChats.includes(s.id)}
        onOpen={() => {
          haptic()
          const opening = resumeSession(s.id)
          if (need) aimAtNeed(s.id)
          opening.catch(e => toast(errText(e), 'error'))
        }}
        onRight={a => archive(s.id, a === 'archive')}
        onDelete={() => remove(s)}
        onLongPress={(y, pid, top) => {
          // Hold + move = drag to rearrange, straight away: no mode to enter or leave.
          if (!list || !canReorder) return
          const wasManual = order.manual
          const pinnedBottom = () => pinnedRef.current?.getBoundingClientRect().bottom ?? -1
          startDrag(list, s.id, y, pid, top, {
            // Chats: merge the date groups into one list while dragging, so a chat can cross days.
            onLift: () => {
              if (list === 'chats') {
                setPinZone(true)
                if (!wasManual) setOrder(o => ({ ...o, manual: withWaiting(chats.map(x => x.id)) }))
              }
            },
            onCancel: () => {
              if (list === 'chats' && !wasManual) setOrder(o => ({ ...o, manual: null }))
            },
            // Drag a chat up into Pinned to pin it (at the spot you drop it); drag a pinned one down out of Pinned to unpin it.
            cross:
              list === 'chats'
                ? {
                    free: 'up',
                    over: y => y < pinnedBottom() - 4,
                    onHover: (o, y) => {
                      setHover(o ? 'pin' : '')
                      if (o) showGap('pinned', dropIndex(pinnedRef.current, y, s.id))
                      else setGap(null)
                    },
                    onDrop: y => {
                      const at = dropIndex(pinnedRef.current, y, s.id)
                      setOrder(o => {
                        const rest = o.pinned.filter(x => x !== s.id && !needIds.has(x)) // `at` counts the rows on show
                        rest.splice(Math.min(at, rest.length), 0, s.id)
                        return { ...o, pinned: restoreAside(rest, o.pinned, needIds), manual: wasManual }
                      })
                      toast('Pinned')
                    }
                  }
                : {
                    free: 'down',
                    over: y => y > pinnedBottom() + 12,
                    onHover: (o, y) => {
                      setHover(o ? 'unpin' : '')
                      if (o) showGap('chats', dropIndex(chatsRef.current, y, s.id))
                      else setGap(null)
                    },
                    onDrop: y => {
                      // Lands where you let go: switch to a custom order with it inserted at that spot.
                      const at = dropIndex(chatsRef.current, y, s.id)
                      const ids = chats.map(x => x.id)
                      ids.splice(Math.min(at, ids.length), 0, s.id)
                      setOrder(o => ({ ...o, pinned: o.pinned.filter(x => x !== s.id), manual: withWaiting(ids) }))
                      toast('Unpinned')
                    }
                  }
          })
        }}
        onMenu={() => setMenu({ s, archived: !list && !need })}
      />
      {withAgents.has(s.id) && <NestedRows chat={s.id} snapAt={snap.at} only={needle ? agentsFound.get(s.id) : undefined} turning={s.id === turningChat} />}
    </div>
  )

  // Date headings in the normal view; one flat "Chats" list while rearranging or in custom order.
  // Headings are siblings of the rows (same parent, stable keys) so rows never remount mid-gesture.
  const grouped = !order.manual
  const chatChildren: React.ReactNode[] = []
  let lastLabel = ''
  const asOf = snap.at || Date.now()
  chats.forEach((s, i) => {
    if (grouped) {
      const label = dayLabel(activity(s), asOf) // the day of the snapshot's last activity
      if (label !== lastLabel) {
        chatChildren.push(
          <div key={`h:${label}`} className="group-title" role="heading" aria-level={2}>
            {label}
          </div>
        )
        lastLabel = label
      }
    }
    chatChildren.push(row(s, 'chats', i))
  })

  return (
    <>
      {loading && sessions.length === 0 && <div className="dim pad">Loading chats…</div>}
      {!loading && sessions.length === 0 && <div className="dim pad">No chats yet</div>}
      {needRows.length > 0 && (
        <NeedsGroup>{needRows.map(({ s, need }, i) => row(s, null, i, need))}</NeedsGroup>
      )}
      {(pinnedRows.length > 0 || pinZone) && (
        <>
          <div id="pinned-title" className="group-title" role="heading" aria-level={2}>
            <Icon n="pin" /> Pinned{hover === 'unpin' && <span className="pin-hint"> · release to unpin</span>}
          </div>
          <div ref={pinnedRef} role="group" aria-labelledby="pinned-title" className={hover === 'pin' ? 'pin-list drop-hot' : 'pin-list'}>
            {pinnedRows.map((s, i) => row(s, 'pinned', i))}
            {pinnedRows.length === 0 && <div className="pin-empty">Drop here to pin</div>}
          </div>
        </>
      )}
      {!grouped && chats.length > 0 && (
        <div className="group-title">
          Chats
          {order.manual && (
            <button className="mini" onClick={() => setOrder(o => ({ ...o, manual: recentIds(sessions.filter(x => !o.pinned.includes(x.id)), lastActive) }))}>
              Sort by recent
            </button>
          )}
        </div>
      )}
      <div ref={chatsRef}>{chatChildren}</div>
      {hits && hits.length > 0 && (
        <>
          <div className="group-title">In messages</div>
          {hits.map(h => (
            <button
              key={h.id}
              className="hit-row"
              onClick={() => {
                haptic()
                const { terms, plain } = parseSnippet(h.snippet)
                resumeSession(h.id)
                  .then(() => setState({ jump: { storedId: h.id, terms, snippet: plain } }))
                  .catch(e => toast(errText(e), 'error'))
              }}
            >
              <span className="hit-title">{h.title ? <Title text={h.title} /> : 'Untitled'}</span>
              <span className="hit-snippet">
                {h.snippet
                  .replace(/\\+[nt]/g, ' ')
                  .replace(/\\+"/g, '"')
                  .replace(/\*\*|`/g, '') // markdown marks read as noise in a one-line preview
                  .split(/(>>>.*?<<<)/g)
                  .map((part, i) =>
                    part.startsWith('>>>') ? <mark key={i}>{part.slice(3, -3)}</mark> : <span key={i}>{part}</span>
                  )}
              </span>
            </button>
          ))}
        </>
      )}
      {moreSessionsMayExist() && (
        <button
          className="archived-toggle more-chats"
          disabled={loading}
          onClick={() => {
            haptic()
            loadMoreSessions().catch(e => toast(errText(e), 'error'))
          }}
        >
          {loading ? 'Loading…' : 'Show older chats'}
        </button>
      )}
      <button className="archived-toggle" onClick={() => setArchivedOpen(v => !v)}>
        <Icon n="archive" /> Archived {archived ? `(${archived.length})` : ''} <span className="chev"><Chevron open={archivedOpen} /></span>
      </button>
      {menu &&
        createPortal(
          <SessionMenu
            s={menu.s}
            archived={menu.archived}
            pinned={order.pinned.includes(menu.s.id)}
            close={() => setMenu(null)}
            onPin={on => pin(menu.s.id, on)}
            onArchive={on => archive(menu.s.id, on)}
            onDelete={() => remove(menu.s)}
          />,
          document.body
        )}
      {archivedOpen && (
        <div className="archived-list">
          {archived == null && <div className="dim pad">Loading…</div>}
          {archived?.length === 0 && <div className="dim pad">Nothing archived. Swipe a chat right to archive it.</div>}
          {archived?.filter(match).map((s, i) => row(s, null, i))}
        </div>
      )}
    </>
  )
}
