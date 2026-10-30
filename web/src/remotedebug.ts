// Settings → About → Remote debugging (plan 14). The page only READS the shell's state and asks it to open its own
// confirmation or to turn off; turning on happens in native code after the phone's screen lock.
import { useEffect, useState } from 'react'
import { remoteDebuggingState } from './bridge'

export interface RemoteDebugState {
  available: boolean
  on: boolean
  minutesLeft: number
}

export const OFF_STATE: RemoteDebugState = { available: false, on: false, minutesLeft: 0 }

/** The shell's JSON → a state; anything unexpected counts as "not available". */
export function parseRemoteDebug(json: string): RemoteDebugState {
  try {
    const o = JSON.parse(json) as Partial<RemoteDebugState>
    const available = o.available === true
    const on = available && o.on === true
    const m = Number(o.minutesLeft)
    return { available, on, minutesLeft: on && Number.isFinite(m) ? Math.max(0, Math.min(60, Math.round(m))) : 0 }
  } catch {
    return OFF_STATE
  }
}

export interface RemoteDebugRow {
  sub: string
  action: 'open' | 'off'
}

/** The row: null = hidden (Developer options are off). Tapping opens the native confirmation, or turns it off. */
export function remoteDebugRow(s: RemoteDebugState): RemoteDebugRow | null {
  if (!s.available) return null
  return s.on ? { sub: `On · ${s.minutesLeft} min left`, action: 'off' } : { sub: 'Off', action: 'open' }
}

/** The strip text while it is on, else null. */
export function remoteDebugStrip(s: RemoteDebugState): string | null {
  return s.available && s.on ? `Remote debugging is on · ${s.minutesLeft} min left` : null
}

/** Live state. Re-read when the page comes back (the credential screen), on the shell's `hm-devtools` event, and once a
 *  minute only while it is on and the page is visible (at most 60 reads, then it is off and the timer is gone). */
export function useRemoteDebug(): RemoteDebugState {
  const [s, setS] = useState<RemoteDebugState>(() => parseRemoteDebug(remoteDebuggingState()))
  useEffect(() => {
    const read = () => setS(prev => {
      const next = parseRemoteDebug(remoteDebuggingState())
      return next.available === prev.available && next.on === prev.on && next.minutesLeft === prev.minutesLeft ? prev : next
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
  const ticking = s.on
  useEffect(() => {
    if (!ticking) return
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') setS(parseRemoteDebug(remoteDebuggingState()))
    }, 60_000)
    return () => window.clearInterval(t)
  }, [ticking])
  return s
}
