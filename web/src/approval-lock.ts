// Settings → Access & privacy → Approvals → "Confirm approvals with fingerprint" (on by default; the Android shell keeps the choice and
// the confirmed live sessions, ApprovalLock.java). With it on, the first Allow in a chat session asks for the phone's
// biometric or screen lock; after one success that chat's later approvals go through until the session ends: the app
// restarts, or the chat's live Hermes session closes. A confirmation is filed under the live session (Hermes's runtime
// id, the approval's `session_id`) it was made in, never under the stored chat: a new live session has nothing on file,
// so its first Allow always asks, and a closed one's id never comes back, so nothing has to be forgotten for the rule
// to hold (forgetApprovalConfirm only tidies). Deny never asks. No screen lock: approved as before, with a one-time hint.
import { toast } from './store'

type LockBridge = {
  confirmApproval?: (id: number, runtime: string, what: string) => void
  confirmIdentity?: (id: number, what: string) => void
  approvalLockState?: () => string
  setApprovalLock?: (on: boolean) => void
  forgetApproval?: (runtime: string) => void
}
const bridge = () => window.HermesAndroid as unknown as LockBridge | undefined

declare global {
  interface Window {
    hermesApprovalConfirm?: (id: number, result: string) => void
  }
}

/** The shell can do it (an older shell or a plain browser can't: approvals work as before, the row is hidden). */
export const approvalLockAvailable = (): boolean => typeof bridge()?.confirmApproval === 'function'

export function approvalLockState(): { on: boolean; secure: boolean } {
  try {
    const s = JSON.parse(bridge()?.approvalLockState?.() || '{}')
    return { on: s.on !== false, secure: s.secure !== false }
  } catch {
    return { on: true, secure: true }
  }
}

/** Live sessions confirmed in this page, the newest last (the shell has the real list; this only skips a round trip). */
const confirmed = new Set<string>()
/** At most this many are kept here (the shell keeps as many): past it the oldest asks again. */
export const CONFIRMED_MAX = 64
function noteConfirmed(runtime: string): void {
  confirmed.delete(runtime)
  confirmed.add(runtime)
  while (confirmed.size > CONFIRMED_MAX) confirmed.delete(confirmed.values().next().value as string)
}
const waiting = new Map<number, (result: string) => void>()
let seq = 0
window.hermesApprovalConfirm = (id, result) => {
  const done = waiting.get(Number(id))
  waiting.delete(Number(id))
  done?.(String(result))
}

/** An Allow from this live session (runtime id; '' when unknown, which never counts as confirmed) must be confirmed first. */
export function approvalNeedsConfirm(runtime: string): boolean {
  return approvalLockAvailable() && !(runtime && confirmed.has(runtime)) && approvalLockState().on
}

const NO_LOCK_HINT_KEY = 'hm.approvalNoLockHint.v1'
function noLockHint(): void {
  try {
    if (localStorage.getItem(NO_LOCK_HINT_KEY)) return
    localStorage.setItem(NO_LOCK_HINT_KEY, '1')
  } catch {
    return
  }
  toast('This phone has no screen lock, so approvals can’t be confirmed with your fingerprint. Set a screen lock to protect them.')
}

/** Asks the shell for the biometric or screen lock; true when the Allow may go through. `runtime` is the live session the
 *  approval came from: a success is filed under it, and only under it ('' files nothing). */
export function confirmAllow(runtime: string, what: string): Promise<boolean> {
  const b = bridge()
  if (!b?.confirmApproval) return Promise.resolve(true)
  return new Promise(resolve => {
    const id = ++seq
    waiting.set(id, result => {
      if (result === 'ok') {
        if (runtime) noteConfirmed(runtime)
        resolve(true)
      } else if (result === 'nolock') {
        noLockHint()
        resolve(true)
      } else {
        toast('Not allowed: confirm it’s you to allow this')
        resolve(false)
      }
    })
    try {
      b.confirmApproval!(id, runtime, what)
    } catch {
      waiting.delete(id)
      resolve(false)
    }
  })
}

/** A setting that asks on every change, whatever the approvals setting; true when the change may go through. */
export function confirmAlways(what: string): Promise<boolean> {
  const b = bridge()
  if (!b?.confirmIdentity) return confirmAllow('', what) // an older shell
  return new Promise(resolve => {
    const id = ++seq
    waiting.set(id, result => {
      if (result === 'nolock') noLockHint()
      else if (result !== 'ok') toast('Not changed: confirm it’s you to change this')
      resolve(result === 'ok' || result === 'nolock')
    })
    try {
      b.confirmIdentity!(id, what)
    } catch {
      waiting.delete(id)
      resolve(false)
    }
  })
}

/** Turning it off asks for the biometric or screen lock too (so it can't be switched off to skip it). */
export async function setApprovalLock(on: boolean): Promise<boolean> {
  if (!on && approvalLockState().secure && !(await confirmAllow('', 'Turn off fingerprint for approvals'))) return false
  confirmed.clear()
  bridge()?.setApprovalLock?.(on)
  return true
}

/** The live Hermes session closed. Tidying only: its id never comes back, so the rule holds without this. */
export function forgetApprovalConfirm(runtime: string): void {
  if (!runtime) return
  confirmed.delete(runtime)
  bridge()?.forgetApproval?.(runtime)
}
