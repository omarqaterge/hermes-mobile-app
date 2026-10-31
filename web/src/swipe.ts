import { getState, setState } from './store'
import { canvasState, openCanvas } from './canvas'
import { newSession } from './gateway'

/** The header canvas button (and the swipe left): open the chat's canvas. The canvas belongs to a chat: on the empty
 * screen, start the chat first. A chat still opening (cold start) has its canvas already: creating a chat here would
 * abandon that resume and land on an empty chat. */
export function openChatCanvas(): void {
  const s = getState()
  if (s.active || s.opening) openCanvas()
  else void newSession().then(() => openCanvas()).catch(() => {})
}

// Swipe right anywhere on a chat to open the sessions drawer (the same menu as ☰); swipe left to open the chat's
// canvas (the same as the header canvas button; only with a chat on screen and the canvas closed).
// Ignored when the finger starts on something that scrolls or drags sideways itself (tables, code blocks,
// diagrams, the canvas, sliders, text fields, the drawer) or while a sheet, dialog or screen is open.
const SKIP = '.scrubber,.html-viewer,.inline-frame,input,textarea,select,[contenteditable],[role=dialog],.sheet-backdrop,.canvas-panel,.drawer,.drawer-backdrop,.lightbox,.slider,.tts-player,.find-bar,pre,table,.katex-display,.mermaid,.diagram,.hm-openui'

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
  const down = (e: TouchEvent) => {
    start = null
    const s = getState()
    if (e.touches.length !== 1 || s.drawer || s.screen || s.sheet) return
    const t = e.target as Element | null
    if (!t || t.closest(SKIP) || scrollsSideways(t)) return
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }
  }
  const move = (e: TouchEvent) => {
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
  const end = () => { start = null }
  document.addEventListener('touchstart', down, { passive: true })
  document.addEventListener('touchmove', move, { passive: true })
  document.addEventListener('touchend', end, { passive: true })
  document.addEventListener('touchcancel', end, { passive: true })
  return () => {
    document.removeEventListener('touchstart', down)
    document.removeEventListener('touchmove', move)
    document.removeEventListener('touchend', end)
    document.removeEventListener('touchcancel', end)
  }
}
