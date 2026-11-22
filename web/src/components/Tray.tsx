// The composer's tray (tray.ts holds its state): its handle on the top edge of the bar below the chat, the hint shown
// once beside it, the tray's body above the text box (the live status line and the model row), and the two figures
// that live in it (the status line, the last reply's speed).
//
// Movement (docs/decisions/redesign-costs-no-speed-or-battery.md, rules 4, 6, 7): the composer is laid out once at its
// final height, when the tray opens or once it has closed, and the tray's layer and the handle move by `translate` and
// `opacity` only, following the finger during a drag and settling with the shared spring (motion.css tokens). Nothing in
// the closed tray is rendered, so nothing in it ticks or redraws.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { useVoice, fmtClock } from '../voice'
import { ctxLevel } from '../ctxring'
import { motionLevel } from '../motion'
import { dismissTrayHint, setTrayOpen, takeTrayJump, trayState, useTray } from '../tray'
import { Spinner } from './Spinner'

/** Finger travel (px) under which a press on the handle is a tap. */
const TAP_SLOP = 6
/** A release faster than this (px per ms) settles the way the finger went: a short flick is enough. */
const FLICK = 0.3
/** Share of the tray's height the finger must travel to settle the other way without a flick. */
const PAST = 0.3
/** Without Full animations the tray does not follow the finger; a drag this long (px) opens or closes it. */
const STEP_DRAG = 16

// The two moving layers, shared by the handle (App.tsx) and the body (Composer.tsx).
const els: { body: HTMLElement | null; handle: HTMLElement | null; h: number } = { body: null, handle: null, h: 0 }
/** A drag on the handle that opened the tray: the body, when it mounts, starts where the finger is (`dy`, px). */
let dragOpening: { dy: number } | null = null
let settleTimer: ReturnType<typeof setTimeout> | undefined

/** Length of the settle in ms: the --motion-settle token of the current level (0 under Off). */
function settleMs(): number {
  if (motionLevel() === 'off') return 0
  const v = getComputedStyle(document.documentElement).getPropertyValue('--motion-settle').trim()
  const n = parseFloat(v)
  return Number.isFinite(n) ? (v.endsWith('s') && !v.endsWith('ms') ? n * 1000 : n) : 0
}

/** Puts the tray's layer `offset` px below its open place (0 = open, its height = hidden behind the text box). */
function place(offset: number, fade = true): void {
  const { body, handle, h } = els
  const travel = motionLevel() === 'full'
  if (body) {
    body.style.translate = travel ? `0 ${offset}px` : ''
    body.style.opacity = fade && h ? String(Math.max(0, Math.min(1, 1 - offset / h))) : ''
  }
  if (handle) handle.style.translate = travel ? `0 ${offset}px` : ''
}

/** Clears what a movement left: no translate stays behind (a transformed tray would become the frame of the Auto
 *  picker and the Model sheet's fixed layers). */
function rest(): void {
  clearTimeout(settleTimer)
  settleTimer = undefined
  for (const el of [els.body, els.handle]) {
    if (!el) continue
    el.classList.remove('tray-settle')
    el.style.translate = ''
    el.style.opacity = ''
  }
  els.body?.parentElement?.classList.remove('tray-moving')
}

/** Moves the layer from where it is now to `to` (0 = open, its height = closed) with the shared spring, then `done`. */
function settle(to: number, done: () => void): void {
  const ms = settleMs()
  clearTimeout(settleTimer)
  if (!ms || !els.body) {
    done()
    return
  }
  els.body.parentElement?.classList.add('tray-moving')
  els.body.classList.add('tray-settle')
  els.handle?.classList.add('tray-settle')
  place(to)
  settleTimer = setTimeout(done, ms) // one timer per settle, cleared by the next movement
}

/** The tray's body above the text box. Open: its children, arriving from behind the text box. Closing: they leave the
 *  same way, then nothing is rendered. */
export function TrayBody({ open, children }: { open: boolean; children: ReactNode }) {
  const [shown, setShown] = useState(open)
  const ref = useRef<HTMLDivElement>(null)
  const first = useRef(true)
  if (open && !shown) setShown(true)

  useLayoutEffect(() => {
    const el = ref.current
    const initial = first.current
    first.current = false
    if (!shown || !el) {
      // Removed (closed): the handle goes back to its place in the same frame as the composer shrinks.
      rest()
      els.body = null
      return
    }
    els.body = el
    els.h = el.offsetHeight || els.h
    const jump = takeTrayJump() // another chat came on screen: no movement
    if (open) {
      // Arrives: laid out at once at its final height, the layer moves up into it.
      if (dragOpening) {
        // A drag opened it: it starts where the finger is and follows it (TrayHandle).
        const dy = dragOpening.dy
        dragOpening = null
        el.parentElement?.classList.add('tray-moving')
        place(Math.max(0, Math.min(els.h, els.h + dy)))
        return
      }
      if (el.style.translate || el.style.opacity) {
        settle(0, rest) // opened again while it was leaving: back up from where it is
        return
      }
      if (initial || jump || !settleMs()) return // already there: the page opened with it, or another chat did
      el.parentElement?.classList.add('tray-moving')
      place(els.h)
      void el.offsetHeight // the start position is drawn before the movement starts
      settle(0, rest)
      return
    }
    // Leaves: the layer moves back behind the text box, then the body is removed (the composer shrinks once, at the end).
    if (jump) {
      rest()
      setShown(false)
      return
    }
    settle(els.h, () => setShown(false))
  }, [shown, open])

  useLayoutEffect(
    () => () => {
      rest()
      els.body = null
    },
    []
  )

  if (!shown) return null
  return (
    <div className="tray">
      <div className="tray-body" ref={ref}>
        {children}
      </div>
    </div>
  )
}

/** The handle on the top edge of the bar below the chat: a button that opens and closes the tray by a tap, a keyboard
 *  or a screen reader, or by a drag up or down. Dim at rest, gold and still while a reply runs (the text box's light
 *  carries the movement), amber and still while Hermux waits for you; the context ring's colour when the context is nearly full. */
export function TrayHandle() {
  const { mode, open, hint } = useTray()
  const live = useVoice(v => v.live)
  const running = useStore(s => s.active?.running ?? false)
  const waiting = useStore(s => s.requests.length > 0)
  const ctx = useStore(s => ctxLevel(s.active?.ctx ? Math.min(100, Math.max(0, s.active.ctx.percent)) : 0))
  const ref = useRef<HTMLButtonElement>(null)
  // A press on the handle: `far` once the finger went past the tap slop (either way), `moved` once it drags the tray.
  const press = useRef<{ id: number; y0: number; far: boolean; moved: boolean; opening: boolean; trail: Array<{ y: number; t: number }>; under: HTMLElement | null } | null>(null)
  const swallowClick = useRef(0) // until when a click is the end of a drag, not a tap
  const working = running && !waiting
  const shown = mode === 'tucked' && live === 'off'
  useLayoutEffect(() => {
    els.handle = ref.current
    return () => {
      if (els.handle === ref.current) els.handle = null
    }
  })
  // A touch anywhere takes the hint away.
  useEffect(() => {
    if (!hint) return
    const off = () => dismissTrayHint()
    document.addEventListener('pointerdown', off, true)
    return () => document.removeEventListener('pointerdown', off, true)
  }, [hint])

  if (!shown) return null

  const offsetFor = (dy: number, opening: boolean) => {
    const h = els.h
    return Math.max(0, Math.min(h, opening ? h + dy : dy))
  }
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || press.current) return
    swallowClick.current = 0
    press.current = { id: e.pointerId, y0: e.clientY, far: false, moved: false, opening: !trayState().open, trail: [{ y: e.clientY, t: e.timeStamp }], under: buttonUnder(e.currentTarget, e.clientX, e.clientY) }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* */
    }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    const dy = e.clientY - p.y0
    p.trail.push({ y: e.clientY, t: e.timeStamp })
    if (p.trail.length > 6) p.trail.shift()
    if (!p.moved) {
      if (Math.abs(dy) < TAP_SLOP) return
      p.far = true
      if (p.opening ? dy > 0 : dy < 0) return // the wrong way: nothing to drag yet
      p.moved = true
      if (motionLevel() !== 'full') return // no following: the release decides
      rest()
      if (p.opening) {
        dragOpening = { dy } // the body mounts where the finger is (TrayBody) and follows from here
        setTrayOpen(true)
        return
      }
      els.body?.parentElement?.classList.add('tray-moving')
    }
    if (motionLevel() === 'full' && els.body) place(offsetFor(dy, p.opening))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    press.current = null
    dragOpening = null
    if (!p.moved && p.far) {
      swallowClick.current = e.timeStamp + 500 // a drag the wrong way: neither a tap nor a drag
      return
    }
    if (!p.moved) {
      // A tap on the part of the target that reaches over the chat, right on one of a message's buttons: it was meant
      // for that button.
      if (p.under?.isConnected) {
        swallowClick.current = e.timeStamp + 500
        p.under.click()
      }
      return // otherwise the click that follows toggles
    }
    swallowClick.current = e.timeStamp + 500
    const dy = e.clientY - p.y0
    const first = p.trail[0]
    const v = e.timeStamp > first.t ? (e.clientY - first.y) / (e.timeStamp - first.t) : 0
    if (motionLevel() !== 'full') {
      if (Math.abs(dy) >= STEP_DRAG || Math.abs(v) > FLICK) setTrayOpen(p.opening)
      return
    }
    const h = els.h || 1
    const offset = offsetFor(dy, p.opening)
    const toOpen = v < -FLICK ? true : v > FLICK ? false : p.opening ? h - offset > h * PAST : offset < h * PAST
    if (toOpen) {
      if (!trayState().open) setTrayOpen(true)
      settle(0, rest)
    } else if (trayState().open) setTrayOpen(false) // TrayBody settles it closed from where it is
    else rest()
  }
  const onPointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    press.current = null
    dragOpening = null
    if (!p.moved) return
    // Back to where it started.
    if (p.opening && trayState().open) setTrayOpen(false)
    else settle(0, rest)
  }

  const cls = ['tray-handle', working ? 'working' : '', waiting ? 'waiting' : '', !waiting && ctx ? ctx : ''].filter(Boolean).join(' ')
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={cls}
        aria-expanded={open}
        aria-label={open ? 'Model and status, open. Close' : 'Model and status, closed. Open'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={e => {
          if (swallowClick.current && e.timeStamp < swallowClick.current) {
            swallowClick.current = 0
            return
          }
          setTrayOpen(!trayState().open)
        }}
      >
        <span className="tray-pill" aria-hidden="true" />
      </button>
      {hint && (
        <div className="tray-hint" role="status">
          Model and context are here
        </div>
      )}
    </>
  )
}

/** The control of the chat under a press on the handle's target where it reaches above the bar, if any: such a tap goes
 *  to it, so the last reply's buttons stay easy to hit without padding the end of the chat. */
function buttonUnder(handle: HTMLElement, x: number, y: number): HTMLElement | null {
  const bar = handle.parentElement?.getBoundingClientRect()
  if (!bar || y >= bar.top) return null
  for (const el of document.elementsFromPoint(x, y)) {
    if (handle.contains(el) || !el.closest('.chat-wrap')) continue
    return (el.closest('button, a[href], [role="button"], summary, label') as HTMLElement | null) ?? null
  }
  return null
}

/** Milliseconds since `start`, redrawn once a second only while a turn runs and the page is visible (battery); it stops
 *  by itself when the page is hidden and catches up on the next tick once it is visible again. Mounted only while the
 *  status line is on screen, so a closed tray runs no timer. */
function useElapsed(start: number | null, running: boolean): number {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!running || start == null) return
    let id: ReturnType<typeof setInterval> | undefined
    const stop = () => {
      if (id !== undefined) clearInterval(id)
      id = undefined
    }
    const go = () => {
      stop()
      if (document.visibilityState === 'visible') {
        tick(n => n + 1)
        id = setInterval(() => tick(n => n + 1), 1000)
      }
    }
    go()
    document.addEventListener('visibilitychange', go)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', go)
    }
  }, [start, running])
  return start == null ? 0 : Math.max(0, Date.now() - start)
}

/** The live status while a turn runs: spinner, what Hermux does, the elapsed time, tokens per second. */
export function StatusLine() {
  const running = useStore(s => s.active?.running ?? false)
  const status = useStore(s => s.active?.status ?? '')
  const tps = useStore(s => s.active?.tps ?? null)
  const turnStart = useStore(s => s.active?.turnStart ?? null)
  const elapsed = useElapsed(turnStart, running)
  if (!running) return null
  return (
    <div className="status-line tray-status">
      <Spinner small /> <span className="status-text">{status || 'Working…'}</span>
      {elapsed >= 3000 ? <span className="dim small status-elapsed">{fmtClock(elapsed / 1000)}</span> : null}
      {tps ? <span className="dim small status-tps">~{tps} tok/s</span> : null}
    </div>
  )
}

/** The last reply's speed (from the line under it), dim, beside the context ring while no reply runs. */
export function LastSpeed() {
  const speed = useStore(s => {
    const a = s.active
    if (!a || a.running) return ''
    for (let i = a.items.length - 1; i >= 0; i--) {
      const it = a.items[i]
      if (it.kind !== 'assistant') continue
      const m = /(~?\d+(?:\.\d+)?) tok\/s/.exec(it.meta || '')
      return m ? `${m[1]} tok/s` : ''
    }
    return ''
  })
  return speed ? <span className="tray-speed dim small">{speed}</span> : null
}
