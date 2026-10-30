import type { NativeSetup } from './bridge'
import type { PhoneAccess } from './setupflow'

export interface ShizukuRow {
  value: string
  state: 'ok' | 'wait' | 'err'
  note: string | null
  /** Tapping the row does something: open Shizuku (installed) or the Setup check (not installed). */
  fix: 'open-shizuku' | 'setup' | null
}

/** Sub-line under a working Shizuku: does it come back by itself? Nothing when the app doesn't report it (older builds). */
function restartNote(a: NativeSetup['shizukuAuto']): string | null {
  if (!a) return null
  return a.sdk && a.wss && a.paired ? 'Restarts by itself' : 'Start it by hand after a restart'
}

/** The Shizuku row of the status sheet. Shizuku is required, so everything but "running and Hermes can use it"
 * is a problem (red), except "Not installed" (not started yet) and while the check is still running.
 * @param native what the app knows at once (null outside the app)
 * @param plugin what Hermes can do with it; undefined = still asking, null = no answer (old plugin, offline)
 * @returns null when nothing is known (desktop browser, old plugin): the row is hidden */
export function shizukuRow(native: Pick<NativeSetup, 'shizuku' | 'shizukuRunning' | 'shizukuAuto'> | null, plugin: PhoneAccess['shizuku'] | null | undefined): ShizukuRow | null {
  const installed = native?.shizuku
  if (installed === false) {
    return { value: 'Not installed', state: 'wait', note: 'Lets Hermes see and use the screen. Install it from Setup check.', fix: 'setup' }
  }
  if (native?.shizukuRunning === false) {
    return { value: 'Not running', state: 'err', note: 'Open Shizuku and start it.', fix: installed ? 'open-shizuku' : 'setup' }
  }
  const fix = installed ? 'open-shizuku' : 'setup'
  const knowsNative = native?.shizukuRunning === true
  if (plugin === undefined) {
    return knowsNative ? { value: 'Checking…', state: 'wait', note: null, fix: null } : null
  }
  if (plugin === null) return knowsNative ? { value: 'Checking…', state: 'wait', note: null, fix: null } : null
  switch (plugin) {
    case 'ok':
      return { value: 'Running', state: 'ok', note: restartNote(native?.shizukuAuto), fix: null }
    case 'denied':
      return { value: 'Termux not allowed', state: 'err', note: 'In Shizuku, allow Termux.', fix }
    case 'blocked':
      return { value: 'Not answering', state: 'err', note: 'Set Shizuku’s and Termux’s Battery to Unrestricted.', fix }
    case 'missing':
      return { value: 'Not set up for Hermes', state: 'err', note: 'Run the installer in Termux again.', fix }
    default: // off: Hermes can't reach Shizuku (while the app knows it runs: Termux isn't allowed yet)
      return knowsNative
        ? { value: 'Termux not allowed', state: 'err', note: 'In Shizuku, allow Termux.', fix }
        : { value: 'Not running', state: 'err', note: 'Open Shizuku and start it.', fix }
  }
}
