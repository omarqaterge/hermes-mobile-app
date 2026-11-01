import { getState, setState } from './store'
import { canvasState, openCanvas } from './canvas'
import { newSession } from './gateway'
import { DOCK, dragCancel, dragEnd, dragTo, dragging, edgePullStart } from './splitview'

/** The header canvas button (and the swipe left): open the chat's canvas. The canvas belongs to a chat: on the empty
 * screen, start the chat first. A chat still opening (cold start) has its canvas already: creating a chat here would
 * abandon that resume and land on an empty chat. */
export function openChatCanvas(): void {
  const s = getState()
  if (s.active || s.opening) openCanvas()
  else void newSession().then(() => openCanvas()).catch(() => {})
}

// Swipe right anywhere on a chat to open the sessions drawer (the same menu as ☰); swipe left to open the chat's
// canvas (the same as the header canvas button; only with a chat on screen and the canvas closed). On wide screens a
// swipe that starts at the right edge pulls the canvas in under the finger instead (EDGE, splitview.ts).
// Ignored when the finger starts on something that scrolls or drags sideways itself (tables, code blocks,
// diagrams, the canvas, sliders, text fields, the drawer) or while a sheet, dialog or screen is open.
const SKIP = '.scrubber,.html-viewer,.inline-frame,input,textarea,select,[contenteditable],[role=dialog],.sheet-backdrop,.canvas-panel,.drawer,.drawer-backdrop,.lightbox,.slider,.tts-player,.find-bar,pre,table,.katex-display,.mermaid,.diagram,.hm-openui'

// Wide screens: a touch that starts in this strip at the right edge pulls the canvas in (splitview.ts). The strip
// belongs to the canvas, so code blocks, tables or the scrubber under it don't stop the pull; text fields and
// anything covering the chat still do.
const EDGE = 24
const EDGE_SKIP = 'input,textarea,select,[contenteditable],[role=dialog],.sheet-backdrop,.canvas-panel,.drawer,.drawer-backdrop,.lightbox,.tts-player'

function scrollsSideways(el: Element | null): boolean {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 2) {
      const ox = getComputedStyle(n).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
  }
  return false
}

export function installSwipeToDrawer(): () => void {
  let start: { x: number; y: number; t: number } | null = null
  let edge: { x: number; y: number } | null = null
  const down = (e: TouchEvent) => {
    start = null
    edge = null
    const s = getState()
    if (e.touches.length !== 1 || s.drawer || s.screen || s.sheet) return
    const t = e.target as Element | null
    const { clientX: x, clientY: y } = e.touches[0]
    if (DOCK.matches && x >= window.innerWidth - EDGE && (s.active || s.opening) && !canvasState().open && !t?.closest(EDGE_SKIP)) {
      edge = { x, y }
      return
    }
    if (!t || t.closest(SKIP) || scrollsSideways(t)) return
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }
  }
  const move = (e: TouchEvent) => {
    if (edge) {
      const { clientX: x, clientY: y } = e.touches[0]
      if (dragging()) dragTo(x)
      else if (x - edge.x < -10 && edge.x - x > Math.abs(y - edge.y)) edgePullStart(x, openChatCanvas)
      else if (Math.abs(y - edge.y) > 20) edge = null // a vertical scroll
      return
    }
    if (!start) return
    const dx = e.touches[0].clientX - start.x
    const dy = e.touches[0].clientY - start.y
    if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)) start = null // a vertical scroll
    else if (dx > 70 && dx > Math.abs(dy) * 2) {
      start = null
      setState({ drawer: true })
    } else if (dx < -70 && -dx > Math.abs(dy) * 2) {
      start = null
      const s = getState()
      if ((s.active || s.opening) && !canvasState().open) openChatCanvas()
    }
  }
  const end = () => {
    if (edge && dragging()) dragEnd()
    start = edge = null
  }
  const cancel = () => {
    if (edge && dragging()) dragCancel()
    start = edge = null
  }
  document.addEventListener('touchstart', down, { passive: true })
  document.addEventListener('touchmove', move, { passive: true })
  document.addEventListener('touchend', end, { passive: true })
  document.addEventListener('touchcancel', cancel, { passive: true })
  return () => {
    document.removeEventListener('touchstart', down)
    document.removeEventListener('touchmove', move)
    document.removeEventListener('touchend', end)
    document.removeEventListener('touchcancel', cancel)
  }
}
