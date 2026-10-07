import { useEffect, useRef } from 'react'

// Every spinner turns on ONE shared 8 Hz tick instead of its own CSS animation. A smooth CSS spin redraws the
// WebView every frame (120 Hz screens) for as long as Hermes works, and spinners started at different moments
// never share a frame: during a turn that waits on a command that cost more battery than Hermes itself
// (docs/battery-report.md). The tick runs only while a spinner is mounted.
const STEP_MS = 125
const live = new Set<HTMLElement>()
let step = 0
let timer: ReturnType<typeof setInterval> | null = null

function angle(): string {
  return `rotate(${step * 45}deg)`
}

function tick(): void {
  step = (step + 1) % 8
  const t = angle()
  live.forEach(el => {
    el.style.transform = t
  })
}

/** Registers a spinner element with the shared tick; returns the cleanup. Exported for tests. */
export function trackSpinner(el: HTMLElement): () => void {
  live.add(el)
  el.style.transform = angle()
  if (!timer) timer = setInterval(tick, STEP_MS)
  return () => {
    live.delete(el)
    if (!live.size && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

export function spinnersTicking(): boolean {
  return timer !== null
}

export function Spinner({ small = false }: { small?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => (ref.current ? trackSpinner(ref.current) : undefined), [])
  return <span ref={ref} className={small ? 'spinner small' : 'spinner'} />
}
