import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSheetDrag } from './useSheetDrag'
import { createPortal, flushSync } from 'react-dom'
import type { SessionListRow } from '@hermes/shared/gateway-contract.generated'
import { deleteSession, errText, loadArchived, loadMoreSessions, moreSessionsMayExist, renameStored, resumeSession, searchMessages, setArchived, type MessageHit } from '../gateway'
import { useOrder } from '../order'
import { setState, toast, useStore } from '../store'
import { parseSnippet } from '../jump'
import { haptic } from '../bridge'
import { Title, keepBranch, plainTitle } from './Title'
import { confirmDialog } from '../dialog'
import { ago, lastActive } from '../unread'
import { orderChats, recentIds } from '../chatorder'
import { Chevron } from './ui'

function dayLabel(ms?: number): string {
  if (!ms) return 'Older'
  const d = new Date(ms)
  const now = new Date()
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'This week'
  if (days < 31) return 'This month'
  return 'Older'
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
  onOpen: () => void
  onRight: (a: RightAction) => void
  onDelete: () => void
  onLongPress: (pointerY: number, pointerId: number, rowTop: number) => void
  onMenu: () => void
}

function SwipeRow({ s, active, pinned, archived, onOpen, onRight, onDelete, onLongPress, onMenu }: RowProps) {
  // Working right now: the open chat's own turn, or any chat in the plugin's activity feed (a background
  // memory/skills review after a reply doesn't count: the answer is already in).
  const working = useStore(
    st => (st.active?.storedId === s.id && !!st.active?.running) || st.activity.some(a => a.session === s.id && !a.review)
  )
  const unread = useStore(st => !active && st.unread.includes(s.id)) && !working
  const sent = useStore(st => st.sentCounts[s.id])
  const ref = useRef<HTMLDivElement>(null)
  const g = useRef({ x0: 0, y0: 0, mode: '' as '' | 'swipe' | 'scroll' | 'drag', moved: false, y: 0, id: 0, timer: 0 as unknown as ReturnType<typeof setTimeout>, zone: '' })
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
    g.current = { ...g.current, x0: e.clientX, y0: e.clientY, y: e.clientY, id: e.pointerId, mode: '', moved: false, zone: '' }
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
  const icon = dx > 0 ? '🗄' : '🗑'
  const armed = dx > 0 ? Boolean(r) : del

  return (
    <div className="swipe-row" ref={ref}>
      {dx !== 0 && (
        <div className={`swipe-bg ${bg}${dx > 0 ? ' left' : ' right'}${armed ? ' armed' : ''}`}>
          <span className="swipe-icon">{icon}</span>
          <span>{label}</span>
        </div>
      )}
      <div
        className={`session-row${active ? ' on' : ''}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: anim ? 'transform 0.2s ease' : undefined }}
        onPointerDown={onDown}
        onContextMenu={e => e.preventDefault()}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          clearTimeout(g.current.timer)
          if (g.current.mode === 'swipe') settle(0)
        }}
        onClick={() => {
          if (!g.current.moved) onOpen()
        }}
      >
        <span className="session-main">
          <span className="session-title">
            {working && <span className="working-dot" aria-label="Working" />}
            {unread && <span className="unread-dot" aria-label="Finished, not opened yet" />}
            {pinned && <span className="pin-dot">📌 </span>}
            {s.title ? <Title text={s.title} /> : s.preview || 'Untitled'}
          </span>
          <span className="dim small">
            {[ago(lastActive(s)), sent !== undefined && `${sent} msgs`, s.source !== 'mobile' && s.source]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
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
            ⋮
          </button>
      </div>
    </div>
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
function SessionMenu({
  s,
  archived,
  pinned,
  close,
  onPin,
  onArchive,
  onDelete,
  onRename
}: {
  s: SessionListRow
  archived: boolean
  pinned: boolean
  close: () => void
  onPin: (on: boolean) => void
  onArchive: (on: boolean) => void
  onDelete: () => void
  onRename: (title: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(plainTitle(s.title))
  const act = (fn: () => void) => () => {
    haptic()
    close()
    fn()
  }
  const drag = useSheetDrag(close)
  return (
    <div className="sheet-backdrop" onClick={close}>
      <div className="sheet session-menu" role="dialog" ref={drag.ref} {...drag.bind} onClick={e => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-title session-menu-title">{s.title ? <Title text={s.title} /> : s.preview || 'Untitled'}</div>
        {editing ? (
          <form
            className="rename-row"
            onSubmit={e => {
              e.preventDefault()
              close()
              onRename(draft.trim())
            }}
          >
            <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} placeholder="Chat title" />
            <button className="btn" type="submit">
              Save
            </button>
          </form>
        ) : (
        <div className="menu-list">
          <button className="menu-item" onClick={() => setEditing(true)}>
            <span className="mi-icon">✏️</span>
            Rename
          </button>
          {!archived && (
            <button className="menu-item" onClick={act(() => onPin(!pinned))}>
              <span className="mi-icon gold">📌</span>
              {pinned ? 'Unpin' : 'Pin to top'}
            </button>
          )}
          <button className="menu-item" onClick={act(() => onArchive(!archived))}>
            <span className="mi-icon blue">🗄</span>
            {archived ? 'Unarchive' : 'Archive'}
          </button>
          <button className="menu-item danger" onClick={act(onDelete)}>
            <span className="mi-icon red">🗑</span>
            Delete
          </button>
        </div>
        )}
      </div>
    </div>
  )
}

// ── the list ─────────────────────────────────────────────────
export function SessionList({ query }: { query: string }) {
  const sessions = useStore(s => s.sessions)
  const loading = useStore(s => s.sessionsLoading)
  const profile = useStore(s => s.profile)
  const activeId = useStore(s => s.active?.storedId)
  const [order, setOrder] = useOrder(profile)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [archived, setArchivedRows] = useState<SessionListRow[] | null>(null)
  const [menu, setMenu] = useState<{ s: SessionListRow; archived: boolean } | null>(null)
  const [pinZone, setPinZone] = useState(false) // a chat is being dragged: show the Pinned target even if empty
  const [hover, setHover] = useState<'' | 'pin' | 'unpin'>('')
  const [gap, setGap] = useState<{ list: ListName; at: number } | null>(null)
  const pinnedRef = useRef<HTMLDivElement>(null)
  const chatsRef = useRef<HTMLDivElement>(null)

  const [hits, setHits] = useState<MessageHit[] | null>(null)
  const q2 = query.trim()
  useEffect(() => {
    if (q2.length < 2) {
      setHits(null)
      return
    }
    let dead = false
    const t = setTimeout(() => {
      searchMessages(q2)
        .then(h => !dead && setHits(h))
        .catch(() => !dead && setHits([]))
    }, 350)
    return () => {
      dead = true
      clearTimeout(t)
    }
  }, [q2])

  const needle = query.trim().toLowerCase()
  const match = (s: SessionListRow) => !needle || `${s.title || ''} ${s.preview || ''}`.toLowerCase().includes(needle)
  const canReorder = !needle

  const pinnedRows = useMemo(() => {
    const byId = new Map(sessions.map(s => [s.id, s]))
    return order.pinned.map(id => byId.get(id)).filter((s): s is SessionListRow => Boolean(s) && match(s!))
  }, [sessions, order.pinned, needle]) // eslint-disable-line react-hooks/exhaustive-deps

  const chats = useMemo(() => {
    const others = sessions.filter(s => !order.pinned.includes(s.id) && match(s))
    // Creation order (or the saved custom one): a message sent or received never moves a chat.
    return orderChats(others, order.manual)
  }, [sessions, order.pinned, order.manual, needle]) // eslint-disable-line react-hooks/exhaustive-deps

  const drag = useDrag((list, ids) => {
    if (list === 'pinned') setOrder(o => ({ ...o, pinned: [...ids, ...o.pinned.filter(x => !ids.includes(x))] }))
    else setOrder(o => ({ ...o, manual: ids }))
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

  const pin = (id: string, on: boolean) => {
    setOrder(o => ({ ...o, pinned: on ? [id, ...o.pinned.filter(x => x !== id)] : o.pinned.filter(x => x !== id) }))
    toast(on ? 'Pinned' : 'Unpinned')
  }
  const archive = (id: string, on: boolean) => {
    setArchived(id, on)
      .then(() => {
        if (on) setOrder(o => ({ ...o, pinned: o.pinned.filter(x => x !== id) }))
        toast(on ? 'Archived' : 'Restored')
        if (archivedOpen || !on) refreshArchived()
      })
      .catch(e => toast(errText(e), 'error'))
  }
  const remove = async (s: SessionListRow) => {
    const ok = await confirmDialog({
      title: `Delete “${plainTitle(s.title) || s.preview || 'this chat'}”?`,
      message: 'The whole conversation is removed. This cannot be undone.',
      danger: true
    })
    if (!ok) return
    deleteSession(s.id)
      .then(() => {
        setOrder(o => ({ ...o, pinned: o.pinned.filter(x => x !== s.id), manual: o.manual && o.manual.filter(x => x !== s.id) }))
        setArchivedRows(a => a && a.filter(x => x.id !== s.id))
        toast('Deleted')
      })
      .catch(e => toast(errText(e), 'error'))
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

  const row = (s: SessionListRow, list: ListName | null, idx: number) => (
    <div
      key={s.id}
      data-id={s.id}
      className={drag.view?.id === s.id ? 'drag-item dragging' : 'drag-item'}
      style={list ? drag.styleFor(list, s.id, idx) : undefined}
    >
      <SwipeRow
        s={s}
        active={s.id === activeId}
        pinned={order.pinned.includes(s.id)}
        archived={!list}
        onOpen={() => {
          haptic()
          resumeSession(s.id).catch(e => toast(errText(e), 'error'))
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
                if (!wasManual) setOrder(o => ({ ...o, manual: chats.map(x => x.id) }))
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
                        const rest = o.pinned.filter(x => x !== s.id)
                        rest.splice(Math.min(at, rest.length), 0, s.id)
                        return { ...o, pinned: rest, manual: wasManual }
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
                      setOrder(o => ({ ...o, pinned: o.pinned.filter(x => x !== s.id), manual: ids }))
                      toast('Unpinned')
                    }
                  }
          })
        }}
        onMenu={() => setMenu({ s, archived: !list })}
      />
    </div>
  )

  // Date headings in the normal view; one flat "Chats" list while rearranging or in custom order.
  // Headings are siblings of the rows (same parent, stable keys) so rows never remount mid-gesture.
  const grouped = !order.manual
  const chatChildren: React.ReactNode[] = []
  let lastLabel = ''
  chats.forEach((s, i) => {
    if (grouped) {
      const label = dayLabel((s.started_at || 0) * 1000) // creation day: activity must not move a chat between groups
      if (label !== lastLabel) {
        chatChildren.push(
          <div key={`h:${label}`} className="group-title">
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
      {loading && sessions.length === 0 && <div className="dim pad">Loading sessions…</div>}
      {!loading && sessions.length === 0 && <div className="dim pad">No sessions yet</div>}
      {(pinnedRows.length > 0 || pinZone) && (
        <>
          <div className="group-title">
            📌 Pinned{hover === 'unpin' && <span className="pin-hint"> · release to unpin</span>}
          </div>
          <div ref={pinnedRef} className={hover === 'pin' ? 'pin-list drop-hot' : 'pin-list'}>
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
        🗄 Archived {archived ? `(${archived.length})` : ''} <span className="chev"><Chevron open={archivedOpen} /></span>
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
            onRename={t =>
              renameStored(menu.s.id, keepBranch(menu.s.title, t))
                .then(() => toast('Renamed'))
                .catch(e => toast(errText(e), 'error'))
            }
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
