import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { haptic } from '../bridge'
import { nearestMark, type Mark } from '../scrub'

/**
 * The rail on the right edge of a long chat: one tick per message you sent, and an orange thumb that follows the scroll
 * (it melts into a tick when that message is at the top, and slides through the gap while you read the reply). Drag
 * along it to pick a message (a bubble shows it), let go to jump there; a tap jumps to the nearest tick. Drag logic uses pointer events (they also fire for
 * touch because the rail has `touch-action: none`); the touch handlers only keep the swipe/pull gestures and the
 * list's own scrolling away from it.
 */
export function Scrubber({
  marks,
  current,
  rail,
  pos,
  onPick,
}: {
  marks: Mark[]
  current: number
  /** The rail element, so `Chat` can move the thumb on every scroll frame without re-rendering. */
  rail: RefObject<HTMLDivElement | null>
  /** Where the screen is, counted in marks (`railPosition`). */
  pos: RefObject<number>
  onPick: (markIndex: number) => void
}) {
  const [picked, setPicked] = useState<number | null>(null)
  const pickedRef = useRef<number | null>(null)
  const n = marks.length

  // Not React's onTouchMove: that listener is passive and cannot stop the chat scrolling under the finger.
  useEffect(() => {
    const el = rail.current
    if (!el) return
    const stop = (e: TouchEvent) => {
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
    }
    el.addEventListener('touchmove', stop, { passive: false })
    return () => el.removeEventListener('touchmove', stop)
  }, [rail])
  // While a finger is on the rail the thumb sits on the picked tick; otherwise it follows the scroll.
  useLayoutEffect(() => paintRail(rail.current, picked ?? pos.current ?? 0, marks.length, true))

  const pickAt = (clientY: number) => {
    const r = rail.current?.getBoundingClientRect()
    if (!r || !r.height) return
    const k = nearestMark(marks, (clientY - r.top) / r.height)
    if (k !== pickedRef.current) {
      pickedRef.current = k
      setPicked(k)
      haptic()
    }
  }
  const finish = (commit: boolean) => {
    const k = pickedRef.current
    pickedRef.current = null
    setPicked(null)
    if (commit && k !== null) onPick(Math.min(k, marks.length - 1))
  }

  const shown = picked ?? current
  const at = (k: number) => (n > 1 ? (k / (n - 1)) * 100 : 0)
  const mark = marks[Math.min(shown, n - 1)]
  return (
    <div
      ref={rail}
      className={`scrubber${picked !== null ? ' active' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label="Jump to a message"
      aria-orientation="vertical"
      aria-valuemin={1}
      aria-valuemax={n}
      aria-valuenow={shown + 1}
      aria-valuetext={mark?.text}
      onTouchStart={e => e.stopPropagation()}
      onTouchEnd={e => e.stopPropagation()}
      onPointerDown={e => {
        e.stopPropagation()
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* synthetic pointers can't be captured */
        }
        pickedRef.current = null
        pickAt(e.clientY)
      }}
      onPointerMove={e => {
        e.stopPropagation()
        if (pickedRef.current !== null) pickAt(e.clientY)
      }}
      onPointerUp={e => {
        e.stopPropagation()
        finish(true)
      }}
      onPointerCancel={() => finish(false)}
      onKeyDown={e => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        e.preventDefault()
        // Part way through a reply, ArrowUp goes back to the start of that message first.
        const back = (pos.current ?? 0) - current > 0.02 ? 0 : -1
        const k = Math.min(n - 1, Math.max(0, current + (e.key === 'ArrowUp' ? back : 1)))
        if (k !== current || back === 0) onPick(k)
      }}
    >
      {marks.map((m, k) => (
        <span key={m.idx} className="scrub-tick" style={{ top: `${at(k)}%` }} aria-hidden="true" />
      ))}
      <span className="scrub-thumb" aria-hidden="true" />
      {picked !== null && mark && (
        <div className="scrub-bubble" style={{ top: `${at(picked)}%` }} aria-hidden="true">
          <span className="scrub-num">
            {picked + 1} / {n}
          </span>
          <span className="scrub-text">{mark.text}</span>
        </div>
      )}
    </div>
  )
}

/** Moves the thumb to `pos` (in marks). Near a tick it is pulled onto it and turns into the tick's shape (`--merge` 1);
 * half way between two ticks it is a full pill. Skipped while a finger is on the rail unless `force`. */
export function paintRail(el: HTMLElement | null, pos: number, n: number, force = false) {
  if (!el || n < 1 || (!force && el.classList.contains('active'))) return
  const p = Math.min(n - 1, Math.max(0, Number.isFinite(pos) ? pos : 0))
  const k = Math.round(p)
  const merge = Math.max(0, 1 - Math.abs(p - k) * 4)
  const shown = p + (k - p) * merge
  el.style.setProperty('--thumb', `${n > 1 ? (shown / (n - 1)) * 100 : 0}%`)
  el.style.setProperty('--merge', merge.toFixed(3))
}
