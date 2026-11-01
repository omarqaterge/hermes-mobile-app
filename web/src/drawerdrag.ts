import { setState } from './store'

// The drawer follows the finger (swipe.ts): a swipe right on the chat pulls it in from the left edge, a swipe left on
// the open drawer or its backdrop pushes it back. While the finger is down the drawer and the backdrop are moved by
// inline styles (no React render per frame); on release it always finishes opening or closing, never stays half open:
// it goes the way the finger was flicking, or, without a clear flick, to whichever side is nearer.

const FLICK = 0.3 // px/ms: faster than this decides the direction on its own
const SNAP_MS = 260 // a little longer than the CSS transition (.drawer 0.22s) before the inline styles are dropped

let drag: { x0: number; p0: number; w: number; p: number; samples: { x: number; t: number }[] } | null = null
let clearTimer = 0

function els(): { drawer: HTMLElement; backdrop: HTMLElement } | null {
  const drawer = document.querySelector<HTMLElement>('.drawer')
  const backdrop = document.querySelector<HTMLElement>('.drawer-backdrop')
  // A docked chat list (wide screens) has no backdrop and never slides.
  if (!drawer || !backdrop || getComputedStyle(backdrop).display === 'none') return null
  return { drawer, backdrop }
}

function paint(p: number, w: number) {
  const e = els()
  if (!e) return
  e.drawer.style.transform = `translateX(${p - w}px)`
  e.backdrop.style.opacity = String(p / w)
}

/** Whether the drawer can slide over the chat (phones, or a hidden chat list on wide screens). */
export function drawerSlides(): boolean {
  return els() !== null
}

export function drawerDragging(): boolean {
  return drag !== null
}

/** Start following the finger at x; `open` is whether the drawer is open now. */
export function drawerDragStart(x: number, open: boolean): void {
  const e = els()
  if (!e) return
  clearTimeout(clearTimer)
  const w = e.drawer.offsetWidth || 1
  e.drawer.style.transition = 'none'
  e.backdrop.style.transition = 'none'
  drag = { x0: x, p0: open ? w : 0, w, p: open ? w : 0, samples: [{ x, t: performance.now() }] }
}

export function drawerDragTo(x: number): void {
  if (!drag) return
  const t = performance.now()
  drag.samples.push({ x, t })
  while (drag.samples.length > 2 && t - drag.samples[0].t > 100) drag.samples.shift()
  drag.p = Math.max(0, Math.min(drag.w, drag.p0 + x - drag.x0))
  paint(drag.p, drag.w)
}

/** Let go: finish opening or closing. `cancelled` (the touch was taken away) returns to where it started. */
export function drawerDragEnd(cancelled = false): void {
  if (!drag) return
  const { p, p0, w, samples } = drag
  drag = null
  const a = samples[0]
  const b = samples[samples.length - 1]
  const v = b.t - a.t >= 10 ? (b.x - a.x) / (b.t - a.t) : 0
  const open = cancelled ? p0 > 0 : Math.abs(v) > FLICK ? v > 0 : p > w / 2
  const e = els()
  if (e) {
    e.drawer.style.transition = ''
    e.backdrop.style.transition = ''
    e.drawer.style.transform = open ? 'none' : 'translateX(-102%)'
    e.backdrop.style.opacity = open ? '1' : '0'
    clearTimer = window.setTimeout(() => {
      e.drawer.style.transform = ''
      e.backdrop.style.opacity = ''
    }, SNAP_MS)
  }
  setState({ drawer: open })
}
