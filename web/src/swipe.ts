import { getState, setState } from './store'
import { canvasState, openCanvas } from './canvas'
import { newSession } from './gateway'
import { DOCK, dragCancel, dragEnd, dragTo, dragging, edgePullStart } from './splitview'
import { drawerDragEnd, drawerDragStart, drawerDragTo, drawerDragging, drawerSlides } from './drawerdrag'

/** The header canvas button (and the swipe left): open the chat's canvas. The canvas belongs to a chat: on the empty
 * screen, start the chat first. A chat still opening (cold start) has its canvas already: creating a chat here would
 * abandon that resume and land on an empty chat. */
export function openChatCanvas(): void {
  const s = getState()
  if (s.active || s.opening) openCanvas()
  else void newSession().then(() => openCanvas()).catch(() => {})
}

// Swipe right anywhere on a chat to pull the sessions drawer in (the same menu as ☰; it follows the finger, drawerdrag.ts);
// swipe left on the open drawer or its backdrop to push it back. Swipe left on a chat to open the chat's canvas (the same as the header canvas button; only with a chat on screen and the canvas closed). On wide screens a
// swipe that starts at the right edge pulls the canvas in under the finger instead (EDGE, splitview.ts).
// Ignored when the finger starts on something that scrolls or drags sideways itself (tables, code blocks,
// diagrams, the canvas, sliders, text fields, the drawer) or while a sheet, dialog or screen is open.
const SKIP = '.scrubber,.html-viewer,.inline-frame,input,textarea,select,[contenteditable],[role=dialog],.sheet-backdrop,.canvas-panel,.drawer,.drawer-backdrop,.lightbox,.slider,.tts-player,.find-bar,pre,table,.katex-display,.mermaid,.diagram,.hm-openui'

// Wide screens: a touch that starts in this strip at the right edge pulls the canvas in (splitview.ts). The strip
// belongs to the canvas, so code blocks, tables or the scrubber under it don't stop the pull; text fields and
// anything covering the chat still do.
const EDGE = 24
// A swipe left that starts here closes the open drawer. Not on the chat rows: they swipe themselves (archive / delete).
const CLOSE_SKIP = '.drag-item,input,textarea,[contenteditable],[role=dialog],.slider'

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
  let start: { x: number; y: number; t: number; closing: boolean } | null = null
  let edge: { x: number; y: number } | null = null
  const down = (e: TouchEvent) => {
    start = null
    edge = null
    if (drawerDragging()) drawerDragEnd(true) // a second finger
    const s = getState()
    if (e.touches.length !== 1 || s.screen || s.sheet) return
    const t = e.target as Element | null
    const { clientX: x, clientY: y } = e.touches[0]
    if (s.drawer) {
      if (t?.closest('.drawer,.drawer-backdrop') && !t.closest(CLOSE_SKIP) && drawerSlides()) start = { x, y, t: Date.now(), closing: true }
      return
    }
    if (DOCK.matches && x >= window.innerWidth - EDGE && (s.active || s.opening) && !canvasState().open && !t?.closest(EDGE_SKIP)) {
      edge = { x, y }
      return
    }
    if (!t || t.closest(SKIP) || scrollsSideways(t)) return
    start = { x, y, t: Date.now(), closing: false }
  }
  const move = (e: TouchEvent) => {
    if (edge) {
      const { clientX: x, clientY: y } = e.touches[0]
      if (dragging()) dragTo(x)
      else if (x - edge.x < -10 && edge.x - x > Math.abs(y - edge.y)) edgePullStart(x, openChatCanvas)
      else if (Math.abs(y - edge.y) > 20) edge = null // a vertical scroll
      return
    }
    if (drawerDragging()) {
      drawerDragTo(e.touches[0].clientX)
      return
    }
    if (!start) return
    const dx = e.touches[0].clientX - start.x
    const dy = e.touches[0].clientY - start.y
    // The drawer takes the finger as soon as the move is clearly sideways, measured from where the touch began.
    if (start.closing) {
      if (dx < -10 && -dx > Math.abs(dy) * 1.5) {
        drawerDragStart(start.x, true)
        drawerDragTo(e.touches[0].clientX)
        start = null
      } else if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) start = null // scrolling the chat list
      return
    }
    if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)) start = null // a vertical scroll
    else if (dx > 10 && dx > Math.abs(dy) * 1.5 && drawerSlides()) {
      drawerDragStart(start.x, false)
      drawerDragTo(e.touches[0].clientX)
      start = null
    } else if (dx > 70 && dx > Math.abs(dy) * 2) {
      start = null
      setState({ drawer: true })
    } else if (dx < -70 && -dx > Math.abs(dy) * 2) {
      start = null
      const s = getState()
      if ((s.active || s.opening) && !canvasState().open) openChatCanvas()
    }
  }
  const end = () => {
    if (drawerDragging()) drawerDragEnd()
    if (edge && dragging()) dragEnd()
    start = edge = null
  }
  const cancel = () => {
    if (drawerDragging()) drawerDragEnd(true)
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
