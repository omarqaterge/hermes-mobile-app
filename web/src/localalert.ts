// The local authentication alert banner's state. The Android shell decides that something is wrong (it checks the
// local server before sending it anything) and tells the page which alert to show with
// window.__hmLocalAlert('dashboard' | 'events'), or window.__hmLocalAlert(null) when none is on (LocalDashboard.alertJs).
// The page only picks one of its own fixed texts for a kind from this closed set: the argument is never shown, logged
// or kept, and anything else is ignored. It is a plain window property, so a script in the page could call it too,
// which can only show or hide one of these fixed banners.
import { useSyncExternalStore } from 'react'

export type LocalAlertKind = 'dashboard' | 'events'

declare global {
  interface Window {
    __hmLocalAlert?: (kind: unknown) => void
  }
}

/** The fixed texts. `more` is the extra line the notification shows when expanded; `retry` adds Try again. */
export const LOCAL_ALERT_TEXT: Record<LocalAlertKind, { title: string; body: string; more: string; retry: boolean }> = {
  dashboard: {
    title: 'Hermux stopped talking to Hermes',
    body: 'Something else on this phone answered instead of Hermes, so Hermux sent it nothing. Restart the phone to fix it.',
    more: 'If this comes back, an app installed recently may be the cause.',
    retry: true
  },
  events: {
    title: "Hermux can't hear from Hermes",
    body: 'Another app on this phone is using the connection Hermux listens on. Restart the phone to fix it.',
    more: '',
    retry: false
  }
}

let kind: LocalAlertKind | null = null
const subs = new Set<() => void>()

function set(next: LocalAlertKind | null): void {
  if (next === kind) return
  kind = next
  subs.forEach(l => l())
}

/** What the shell's call means: a kind of the closed set, `null` for none, or `undefined` (ignored) for anything else. */
export function parseLocalAlert(v: unknown): LocalAlertKind | null | undefined {
  if (v === null) return null
  if (v === 'dashboard' || v === 'events') return v
  return undefined
}

/** The page callback: never throws, whatever it is called with or how often. */
export function onLocalAlert(v: unknown): void {
  try {
    const next = parseLocalAlert(v)
    if (next !== undefined) set(next)
  } catch {
    // nothing to do: the banner keeps what it shows
  }
}

export const localAlert = (): LocalAlertKind | null => kind

export const useLocalAlert = (): LocalAlertKind | null => useSyncExternalStore(cb => (subs.add(cb), () => subs.delete(cb)), () => kind)

// Only the shell clears a banner (null): the page never guesses from its own connection, which can open while a newer
// alert is already on (the shell pushes an alert once, not again while it stays on).

// Try again: one try at a time. `run` is the try (it asks the shell for a fresh token, which re-runs the hello); while
// it runs, further taps do nothing. A try that never settles is let go after TRY_LIMIT_MS.
export const TRY_LIMIT_MS = 20_000
let trying = false
const trySubs = new Set<() => void>()
function setTrying(v: boolean): void {
  if (v === trying) return
  trying = v
  trySubs.forEach(l => l())
}

export async function tryAgain(run: () => Promise<unknown>): Promise<void> {
  if (trying) return
  setTrying(true)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([Promise.resolve().then(run), new Promise(resolve => (timer = setTimeout(resolve, TRY_LIMIT_MS)))])
  } catch {
    // a failed try only ends it: the shell decides what the banner shows
  } finally {
    clearTimeout(timer)
    setTrying(false)
  }
}

export const useLocalAlertTrying = (): boolean => useSyncExternalStore(cb => (trySubs.add(cb), () => trySubs.delete(cb)), () => trying)

window.__hmLocalAlert = onLocalAlert
