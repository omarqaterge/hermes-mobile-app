// The heights of the chat screen's two glass bars (App.tsx: `.bar-top` holds the header, banners and find bar,
// `.bar-bottom` the activity banner, status bar, player and composer). The message list reaches under both, so the
// glass has something to show; these heights become its padding (`--bar-top`, `--bar-bottom` on `.stage`, read by
// glass.css), so the first and the last message are never hidden under a bar. Measured by a ResizeObserver: work only
// when a bar changes height, never per frame.

export interface Insets {
  top: number
  bottom: number
}

let insets: Insets = { top: 0, bottom: 0 }
const subs = new Set<(now: Insets, before: Insets) => void>()

/** The bars' heights now (0 before the chat screen is laid out). */
export const barInsets = (): Insets => insets

/** Calls `f` after the bars changed height (the padding is already updated). Returns the unsubscribe. */
export function onBarInsets(f: (now: Insets, before: Insets) => void): () => void {
  subs.add(f)
  return () => subs.delete(f)
}

/** Watches the two bars and writes their heights onto `stage`. Returns the cleanup. */
export function watchBars(stage: HTMLElement, top: HTMLElement, bottom: HTMLElement): () => void {
  const measure = () => {
    const next = { top: top.getBoundingClientRect().height, bottom: bottom.getBoundingClientRect().height }
    if (Math.abs(next.top - insets.top) < 0.5 && Math.abs(next.bottom - insets.bottom) < 0.5) return
    const before = insets
    insets = next
    stage.style.setProperty('--bar-top', `${next.top}px`)
    stage.style.setProperty('--bar-bottom', `${next.bottom}px`)
    subs.forEach(f => f(next, before))
  }
  measure() // before the first paint, so nothing starts under a bar
  if (typeof ResizeObserver !== 'function') return () => {}
  const ro = new ResizeObserver(measure)
  ro.observe(top)
  ro.observe(bottom)
  return () => ro.disconnect()
}
