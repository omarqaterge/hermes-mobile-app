import { useRef } from 'react'

// Drag a bottom sheet down by its top strip (grip + title) to dismiss it.
export function useSheetDrag(onClose: () => void) {
  const el = useRef<HTMLDivElement>(null)
  const st = useRef<{ y0: number; t0: number; dy: number; id: number } | null>(null)
  const set = (dy: number, anim: boolean) => {
    const n = el.current
    if (!n) return
    n.style.transition = anim ? 'transform 0.18s ease' : 'none'
    n.style.transform = dy ? `translateY(${dy}px)` : ''
  }
  const bind = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      const n = el.current
      if (!n || e.clientY - n.getBoundingClientRect().top > 64) return
      // A control in the top strip (a menu header's Rename button, its title field) takes its own tap: capturing the
      // pointer here would send the tap to the sheet instead.
      if ((e.target as Element).closest?.('button, input, textarea, a, [role="switch"]')) return
      st.current = { y0: e.clientY, t0: Date.now(), dy: 0, id: e.pointerId }
      n.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const s = st.current
      if (!s) return
      s.dy = Math.max(0, e.clientY - s.y0)
      set(s.dy, false)
    },
    onPointerUp: () => {
      const s = st.current
      st.current = null
      if (!s) return
      const fast = s.dy / Math.max(1, Date.now() - s.t0) > 0.5
      if (s.dy > 110 || (fast && s.dy > 30)) {
        set(window.innerHeight, true)
        setTimeout(onClose, 160)
      } else set(0, true)
    },
    onPointerCancel: () => {
      st.current = null
      set(0, true)
    },
  }
  return { ref: el, bind }
}
