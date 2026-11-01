// Wide screens (min-width 700px, styles.css): the open canvas is a column beside the chat. The divider between them
// (`.canvas-split` in Canvas.tsx) drags to share the width; a swipe in from the right edge (swipe.ts) is the same drag,
// starting from a closed canvas. The canvas width is kept as a fraction of the room beside the docked chat list
// (localStorage hm.canvasSplit.v1, CSS `--canvas-frac` on `html[data-split]`), so a rotation or hiding the list re-flows
// without code; the CSS clamp keeps the chat at least 340 px and the canvas at least 300 px wide.
// While a finger drags, `html.resizing` sets `--canvas-w` to `--canvas-live` (px, written here, no React render).
// Let go past 85 % of the room: full screen; under 20 %: the canvas closes.
import { useSyncExternalStore } from 'react'
import { canvasState, closeCanvas, setCanvasSize } from './canvas'
import { setEdgeGrab } from './bridge'

const KEY = 'hm.canvasSplit.v1'
export const DOCK = window.matchMedia('(min-width: 700px)')
const MIN = 0.2
const MAX = 0.85
const CHAT_MIN = 340
const subs = new Set<() => void>()
const root = document.documentElement

let frac: number | null = (() => {
  try {
    const v = Number(localStorage.getItem(KEY))
    return v >= MIN && v <= MAX ? v : null
  } catch {
    return null
  }
})()

function apply() {
  if (frac == null) {
    delete root.dataset.split
    root.style.removeProperty('--canvas-frac')
  } else {
    root.dataset.split = ''
    root.style.setProperty('--canvas-frac', String(frac))
  }
  subs.forEach(f => f())
}
apply()

function store(v: number | null) {
  frac = v == null ? null : Math.min(MAX, Math.max(MIN, v))
  try {
    if (frac == null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, String(frac))
  } catch {
    /* private mode: still applies for this run */
  }
  apply()
}

/** Width beside the docked chat list (styles.css `--side-w`, 0 when the list is hidden or not docked). */
function room(): number {
  return window.innerWidth - (parseFloat(getComputedStyle(root).getPropertyValue('--side-w')) || 0)
}

/** The canvas's share of the room as shown (the CSS clamp may hold it below the stored share). */
function current(): number {
  const panel = document.querySelector('.canvas-panel')
  const w = panel ? panel.getBoundingClientRect().width : 0
  return w > 0 ? w / room() : frac ?? 0.46
}

/** Keep what the screen can show: past the chat's minimum width the canvas stops growing, so does the share. */
function keep(v: number) {
  const r = room()
  store(Math.min(v, (r - CHAT_MIN) / r))
}

type Drag = { edge: boolean; offset: number; frac: number; lastX: number; lastT: number; v: number }
let drag: Drag | null = null

function begin(edge: boolean, x: number, offset: number) {
  drag = { edge, offset, frac: edge ? 0 : current(), lastX: x, lastT: performance.now(), v: 0 }
  root.classList.add('resizing')
}

/** The divider: a finger or mouse goes down on it at `x`. */
export function dividerStart(x: number): void {
  const panel = document.querySelector('.canvas-panel')
  const w = panel ? panel.getBoundingClientRect().width : 0
  begin(false, x, window.innerWidth - x - w)
  dragTo(x)
}

/** A swipe from the right edge has started moving left: open the canvas at zero width and let it follow the finger. */
export function edgePullStart(x: number, open: () => void): void {
  begin(true, x, 0)
  root.style.setProperty('--canvas-live', '0px')
  open()
  if (canvasState().size !== 'side') setCanvasSize('side')
  dragTo(x)
}

export function dragging(): boolean {
  return drag != null
}

export function dragTo(x: number): void {
  const d = drag
  if (!d) return
  const now = performance.now()
  if (now - d.lastT >= 10) {
    d.v = (x - d.lastX) / (now - d.lastT)
    d.lastX = x
    d.lastT = now
  }
  const r = room()
  const w = window.innerWidth - x - d.offset
  d.frac = w / r
  root.style.setProperty('--canvas-live', `${Math.round(Math.max(0, Math.min(w, r - CHAT_MIN)))}px`)
  const snap = d.frac < MIN ? 'close' : d.frac > MAX ? 'max' : ''
  if ((root.dataset.snap || '') !== snap) {
    if (snap) root.dataset.snap = snap
    else delete root.dataset.snap
  }
}

function finish() {
  drag = null
  root.classList.remove('resizing')
  delete root.dataset.snap
  root.style.removeProperty('--canvas-live')
}

export function dragEnd(): void {
  const d = drag
  if (!d) return
  finish()
  // A quick flick in from the edge opens the canvas at the width it had last time.
  if (d.edge && d.v < -0.5) return
  if (d.frac < MIN) closeCanvas()
  else if (d.frac > MAX) setCanvasSize('max')
  else keep(d.frac)
}

export function dragCancel(): void {
  const d = drag
  if (!d) return
  finish()
  if (d.edge) closeCanvas()
}

/** Arrow keys on the divider: `step` > 0 widens the canvas. */
export function nudgeSplit(step: number): void {
  keep(current() + step)
}

/** Double-tap on the divider: back to the default width. */
export function resetSplit(): void {
  store(null)
}

function subscribe(f: () => void) {
  subs.add(f)
  DOCK.addEventListener?.('change', f)
  return () => {
    subs.delete(f)
    DOCK.removeEventListener?.('change', f)
  }
}

/** Is the canvas docked beside the chat (wide screen)? */
export function useDock(): boolean {
  return useSyncExternalStore(subscribe, () => DOCK.matches)
}

/** The stored canvas share in percent (null = default), for the divider's aria-valuenow. */
export function useSplitPercent(): number | null {
  return useSyncExternalStore(subscribe, () => (frac == null ? null : Math.round(frac * 100)))
}

/** The pull tab is on screen: ask the Android shell to keep its Back gesture off that strip of the right edge. */
let grab = false
export function claimEdge(on: boolean): void {
  if (on === grab) return
  grab = on
  setEdgeGrab(on)
}
