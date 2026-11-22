// Settings → Notifications. The Android shell keeps the two choices (NotifyChoice.java, both on by default) and is the
// only one that posts notifications, so this file only reads and sets them through the keyed bridge, and tells whether
// Android shows the app's notifications at all. "When a task finishes" off: no Done chip, reply, failed-turn or
// scheduled-job cards. "When Hermux needs me" off: no approval or question chip, pop-up or re-alert, nor the masked-prompt
// notification; what waits still waits in the app (the sheet and Needs you), nothing is answered or dropped.
// The state is read when the page opens, when the app comes back on screen and when Android answers the permission
// dialog (window.hermesNotifyChanged); nothing polls.

export type NotifyKind = 'finishes' | 'needsMe'
export interface NotifyState {
  finishes: boolean
  needsMe: boolean
  /** Android shows this app's notifications (the permission on Android 13+ and the app's own switch). */
  allowed: boolean
  /** Android will still show its permission dialog; otherwise only its settings page can turn them on. */
  canAsk: boolean
}

type NotifyBridge = {
  notifyChoices?: () => string
  setNotifyChoice?: (which: string, value: string) => boolean
  setupFix?: (what: string) => void
}
const bridge = () => window.HermesAndroid as unknown as NotifyBridge | undefined

declare global {
  interface Window {
    hermesNotifyChanged?: () => void
  }
}

/** The event this page sends when Android answered the permission dialog. */
export const NOTIFY_CHANGED = 'hm-notify'
window.hermesNotifyChanged = () => window.dispatchEvent(new Event(NOTIFY_CHANGED))

/** The shell can do it (a plain browser or an older shell: the page says so). */
export const notifyChoicesAvailable = (): boolean => typeof bridge()?.notifyChoices === 'function'

/** The choices and Android's state; both choices on when the shell gives nothing readable. */
export function readNotifyState(): NotifyState {
  try {
    const s = JSON.parse(bridge()?.notifyChoices?.() || '{}')
    return { finishes: s.finishes !== false, needsMe: s.needsMe !== false, allowed: s.allowed !== false, canAsk: s.canAsk === true }
  } catch {
    return { finishes: true, needsMe: true, allowed: true, canAsk: false }
  }
}

/** Stores one choice in the shell; false when it refused or there is no shell. */
export function setNotifyChoice(which: NotifyKind, on: boolean): boolean {
  try {
    return bridge()?.setNotifyChoice?.(which, on ? 'true' : 'false') === true
  } catch {
    return false
  }
}

/** Android's page for this app's notifications (sound, vibration, the lock screen, each channel); the app's own settings
 *  page where a phone has none. */
export function openNotificationSettings(): void {
  bridge()?.setupFix?.('notifications')
}

/** Asks Android for the notification permission where it still asks (Android 13+), else opens its settings page. */
export function turnOnNotifications(): void {
  bridge()?.setupFix?.('notify-permission')
}

/** The main page's value for the Notifications row. */
export function notifySummary(s: NotifyState): string {
  if (!s.allowed) return 'Off in Android'
  if (s.finishes && s.needsMe) return 'On'
  if (s.needsMe) return 'Only when needed'
  if (s.finishes) return 'Only finished tasks'
  return 'Off'
}
