// Settings → About → Remote debugging (plan 14). The page only READS the shell's state and asks it to open its own
// confirmation or to turn off; turning on happens in native code after the phone's screen lock.
import { useEffect, useRef, useState } from 'react'
import { remoteDebuggingState } from './bridge'

export interface RemoteDebugState {
  available: boolean
  on: boolean
  minutesLeft: number
  secondsLeft: number
}

export const OFF_STATE: RemoteDebugState = { available: false, on: false, minutesLeft: 0, secondsLeft: 0 }

/** The shell's JSON → a state; anything unexpected counts as "not available". */
export function parseRemoteDebug(json: string): RemoteDebugState {
  try {
    const o = JSON.parse(json) as Partial<RemoteDebugState>
    const available = o.available === true
    const on = available && o.on === true
    const m = Number(o.minutesLeft)
    const sec = Number.isFinite(Number(o.secondsLeft)) && o.secondsLeft != null ? Number(o.secondsLeft) : m * 60 // an older shell: minutes only
    const secondsLeft = on && Number.isFinite(sec) ? Math.max(0, Math.min(3600, Math.round(sec))) : 0
    return { available, on, minutesLeft: Math.ceil(secondsLeft / 60), secondsLeft }
  } catch {
    return OFF_STATE
  }
}

export interface RemoteDebugRow {
  sub: string
  action: 'open' | 'off'
}

/** 2520 → "42:00", 59 → "0:59". */
export function formatLeft(secondsLeft: number): string {
  const t = Math.max(0, Math.floor(secondsLeft))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

/** The row: null = hidden (Developer options are off). Tapping opens the native confirmation, or turns it off. */
export function remoteDebugRow(s: RemoteDebugState): RemoteDebugRow | null {
  if (!s.available) return null
  return s.on ? { sub: `On · ${formatLeft(s.secondsLeft)} left`, action: 'off' } : { sub: 'Off', action: 'open' }
}

/** The strip text while it is on, else null. */
export function remoteDebugStrip(s: RemoteDebugState): string | null {
  return s.available && s.on ? `Remote debugging is on · ${formatLeft(s.secondsLeft)} left` : null
}

/** Live state, counting down every second while it is on and the page is visible (at most 3600 ticks, then it is off
 *  and the timer is gone). Re-read from the shell when the page comes back (the credential screen), on the shell's
 *  `hm-devtools` event, once a minute while ticking, and when the countdown reaches 0. */
export function useRemoteDebug(): RemoteDebugState {
  const [base, setBase] = useState(() => ({ s: parseRemoteDebug(remoteDebuggingState()), at: Date.now() }))
  const [, setTick] = useState(0)
  useEffect(() => {
    const read = () => setBase(prev => {
      const next = parseRemoteDebug(remoteDebuggingState())
      return next.available === prev.s.available && next.on === prev.s.on && Math.abs(next.secondsLeft - leftNow(prev)) < 2 ? prev : { s: next, at: Date.now() }
    })
    const vis = () => { if (document.visibilityState === 'visible') read() }
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('focus', read)
    window.addEventListener('hm-devtools', read)
    read()
    return () => {
      document.removeEventListener('visibilitychange', vis)
      window.removeEventListener('focus', read)
      window.removeEventListener('hm-devtools', read)
    }
  }, [])
  const ticking = base.s.on
  useEffect(() => {
    if (!ticking) return
    let n = 0
    const t = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      n++
      if (n % 60 === 0 || leftNow(baseRef.current) <= 0) setBase({ s: parseRemoteDebug(remoteDebuggingState()), at: Date.now() })
      else setTick(x => x + 1)
    }, 1000)
    return () => window.clearInterval(t)
  }, [ticking])
  const baseRef = useRef(base)
  baseRef.current = base
  if (!base.s.on) return base.s
  const secondsLeft = leftNow(base)
  return { ...base.s, secondsLeft, minutesLeft: Math.ceil(secondsLeft / 60) }
}

function leftNow(b: { s: RemoteDebugState; at: number }): number {
  return Math.max(0, b.s.secondsLeft - Math.floor((Date.now() - b.at) / 1000))
}
