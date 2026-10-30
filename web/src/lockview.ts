// Talking to Hermes on the lock screen (Settings → Voice → Phone assistant → "Talk to Hermes on the lock screen",
// localStorage hm.lockAssist.v1, default off). When it is on and the assist gesture arrives while the phone is locked,
// the Android shell shows the app over the lock screen and calls window.hermesLockView(true). Then the page is for
// talking only: answering a request (Allow, a question, a password) asks for an unlock first, the drawer, screens and
// sheets ask for an unlock instead of opening, and ending Live mode puts the lock screen back.
import { getState, setState, subscribe, toast } from './store'

export const LOCK_ASSIST_KEY = 'hm.lockAssist.v1'

type LockBridge = { setLockAssist?: (on: boolean) => void; requestUnlock?: () => void; leaveLockScreen?: () => void }
const bridge = () => window.HermesAndroid as unknown as LockBridge | undefined

/** The saved choice; off when unknown. */
export function lockAssist(): boolean {
  try {
    return localStorage.getItem(LOCK_ASSIST_KEY) === '1'
  } catch {
    return false
  }
}

/** Saves the choice and tells the shell (it keeps its own copy, so the assist gesture works before the page loads). */
export function setLockAssist(on: boolean): void {
  try {
    localStorage.setItem(LOCK_ASSIST_KEY, on ? '1' : '0')
  } catch {
    // storage blocked: the shell's copy still holds it
  }
  bridge()?.setLockAssist?.(on)
}

/** Whether the shell can do it at all (an older shell has no such method: the row is hidden). */
export const lockAssistAvailable = (): boolean => typeof bridge()?.setLockAssist === 'function'

let on = false
let unsub: (() => void) | null = null

/** True while the app is shown over a locked phone's lock screen. */
export const lockView = (): boolean => on

/** Ask Android for the unlock screen (PIN, pattern, fingerprint). Nothing happens on its own: the user taps again. */
export function askUnlock(why = 'Unlock the phone first'): void {
  toast(why, 'warn')
  bridge()?.requestUnlock?.()
}

/** Live mode ended over the lock screen: hide the app behind the lock screen again. */
export function leaveLockView(): void {
  if (on) bridge()?.leaveLockScreen?.()
}

function guard(): void {
  const s = getState()
  if (!s.drawer && !s.screen && !s.sheet) return
  setState({ drawer: false, screen: null, sheet: null })
  askUnlock('Unlock the phone to see your chats')
}

declare global {
  interface Window {
    hermesLockView?: (on: boolean) => void
  }
}

window.hermesLockView = (v: boolean) => {
  on = Boolean(v)
  unsub?.()
  unsub = null
  if (!on) return
  guard()
  unsub = subscribe(guard)
}
