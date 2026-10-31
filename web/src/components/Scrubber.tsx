import { useEffect, useRef, useState } from 'react'
import { haptic } from '../bridge'
import { nearestMark, type Mark } from '../scrub'

/**
 * The rail on the right edge of a long chat: one tick per message you sent. Drag along it to pick a message (a bubble
 * shows it), let go to jump there; a tap jumps to the nearest tick. Drag logic uses pointer events (they also fire for
 * touch because the rail has `touch-action: none`); the touch handlers only keep the swipe/pull gestures and the
 * list's own scrolling away from it.
 */
export function Scrubber({ marks, current, onPick }: { marks: Mark[]; current: number; onPick: (markIndex: number) => void }) {
  const rail = useRef<HTMLDivElement>(null)
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
  }, [])

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
  const pos = (k: number) => (n > 1 ? (k / (n - 1)) * 100 : 0)
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
        const k = Math.min(n - 1, Math.max(0, current + (e.key === 'ArrowUp' ? -1 : 1)))
        if (k !== current) onPick(k)
      }}
    >
      {marks.map((m, k) => (
        <span key={m.idx} className={`scrub-tick${k === shown ? ' on' : ''}`} style={{ top: `${pos(k)}%` }} aria-hidden="true" />
      ))}
      {picked !== null && mark && (
        <div className="scrub-bubble" style={{ top: `${pos(picked)}%` }} aria-hidden="true">
          <span className="scrub-num">
            {picked + 1} / {n}
          </span>
          <span className="scrub-text">{mark.text}</span>
        </div>
      )}
    </div>
  )
}
