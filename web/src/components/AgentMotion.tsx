// The shared pieces of the agent's animations (agentmotion.ts holds the states, agent-motion.css the movement):
// the travelling light round an edge, the still glow behind a working chat, the thinking orb and the drawn marks.
import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { pauseWhenHidden } from '../motion'
import { stepEnd, type Light, type StepEnd } from '../agentmotion'

/** A light that travels round the edge of its parent (the text box, the background-app card) while `state` is working,
 *  and stands still in amber while it is waiting. It is a layer that turns under a mask that leaves only the edge
 *  showing: the turn is a transform, so it costs the compositor alone. Always there and empty at rest (opacity 0, no
 *  animation), so the light fades in and out instead of popping; it stands still while the app is away or it is off
 *  screen. `still` keeps it lit but not moving (the text box while the background-app card above carries the light:
 *  one travelling light at a time). */
export function EdgeLight({ state, still = false }: { state: Light; still?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const moving = state === 'working' && !still
  useEffect(() => (moving && ref.current ? pauseWhenHidden(ref.current) : undefined), [moving])
  return (
    <span ref={ref} className={`edge-light${state ? ` ${state}` : ''}${still ? ' still' : ''}`} aria-hidden="true">
      <i className="edge-light-layer" />
    </span>
  )
}

/** A soft, still gold glow far behind the chat while Hermux works on it: a gradient laid out once that only fades in
 *  and out (no movement, no blur). OLED black has none (agent-motion.css). */
export function WorkGlow() {
  const on = useStore(s => Boolean(s.active?.running) && s.requests.length === 0)
  return <div className={`work-glow${on ? ' on' : ''}`} aria-hidden="true" />
}

/** The small orb beside "Thinking…": it turns and breathes while the thought streams (Full only), and stands still in
 *  Reduced and Off, and when told (`still`: something newer is the one thing that moves, agentmotion.ts liveStep). */
export function ThinkOrb({ still = false }: { still?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => (!still && ref.current ? pauseWhenHidden(ref.current) : undefined), [still])
  return <span ref={ref} className={`think-orb${still ? ' still' : ''}`} aria-hidden="true" />
}

/** A tick (done) or a cross (failed) that draws itself once when `draw` is set (a step seen running that just ended),
 *  and is simply there otherwise. `label` names it for screen readers when nothing else on the line says it. */
export function DrawnMark({ kind, draw, label, size = 14 }: { kind: 'done' | 'failed'; draw: boolean; label?: string; size?: number }) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const }
  return (
    <svg className={`drawn-mark ${kind}${draw ? ' draw' : ''}`} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...a11y}>
      {kind === 'done' ? (
        <path className="drawn-line" pathLength={1} d="M5 12.5l4.5 4.5L19 7.5" />
      ) : (
        <>
          <path className="drawn-line" pathLength={1} d="M7 7l10 10" />
          <path className="drawn-line" pathLength={1} d="M17 7L7 17" />
        </>
      )}
    </svg>
  )
}

/** How a step drawn by this component ended while it was on screen (agentmotion.ts `stepEnd`): set once, at the render
 *  where it stops running, and kept, so the mark draws once and is not drawn again by a later render. */
export function useStepEnd(live: boolean, failed: boolean): StepEnd {
  const was = useRef(live)
  const ended = useRef<StepEnd>(null)
  const now = stepEnd(was.current, live, failed)
  if (now) ended.current = now
  was.current = live
  return ended.current
}
