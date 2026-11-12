// Settings → About → Hermux plugin: the plugin in Hermes's Debian against the copy inside this app (PluginSync.java runs
// phone/plugin-update.sh in Termux). The shell updates it by itself at a quiet moment; this row shows how it stands and
// lets the user update now, try again after a failure, or replace a copy changed by hand.
import { useEffect, useState } from 'react'

export type PluginStateName = 'unknown' | 'not-ready' | 'current' | 'older' | 'busy' | 'busy-unknown' | 'newer' | 'modified' | 'held' | 'failed'
export interface PluginState {
  state: PluginStateName | string
  detail: string
  /** The installed plugin's version stamp (seconds since 1970; "0" = an old copy without one); "" = not known yet. */
  installed: string
  /** This app's copy. */
  apk: string
  /** "check" or "apply" while the script runs, else "". */
  running: string
  tries: number
  maxTries: number
  /** Local authentication's switch is on: a tap's restart can't see an old plugin's work (it may cut off a turn). */
  enforced?: boolean
}

export interface PluginRowView {
  value: string
  sub: string
  /** What a tap does: update (never a downgrade), force (also over a copy changed by hand), or nothing. */
  action: 'update' | 'force' | null
  tone: 'gold' | 'red' | 'green' | 'blue'
}

const date = (stamp: string) => {
  const n = Number(stamp)
  return n > 0 ? new Date(n * 1000).toISOString().slice(0, 10) : ''
}

/** The row for a state (pure, unit-tested). */
export function pluginRow(s: PluginState): PluginRowView {
  const value = date(s.installed) || (s.installed === '0' ? 'Old version' : '—')
  if (s.running === 'apply') return { value, sub: 'Updating… Hermux restarts for a moment', action: null, tone: 'blue' }
  if (s.running === 'check') return { value, sub: 'Checking…', action: null, tone: 'blue' }
  const tap = 'Tap to update now (Hermux restarts for a moment)'
  switch (s.state) {
    case 'current':
      return { value, sub: 'Up to date with this app', action: null, tone: 'green' }
    case 'older':
      return { value, sub: `This app has a newer version. It installs by itself once Hermux is idle and the app is closed. ${tap}`, action: 'update', tone: 'gold' }
    case 'busy':
      return { value, sub: `Waiting until Hermux has finished its work. ${tap}`, action: 'update', tone: 'gold' }
    case 'busy-unknown':
      return { value, sub: 'This older plugin can’t say whether Hermes is working, so it isn’t updated by itself. Tap to update now: an answer or a scheduled job that is running would be cut off', action: 'update', tone: 'gold' }
    case 'newer':
      return { value, sub: 'Newer than this app’s copy, so it was left as it is', action: null, tone: 'green' }
    case 'modified':
      return { value, sub: 'Changed by hand, so it wasn’t replaced. Tap to replace it with this app’s copy', action: 'force', tone: 'gold' }
    case 'held':
      return { value, sub: 'Held for testing: the app leaves it alone', action: null, tone: 'blue' }
    case 'not-ready':
      return { value, sub: 'Not installed yet: the setup puts it in place', action: null, tone: 'blue' }
    case 'failed': {
      const why = s.detail ? ` (${s.detail})` : ''
      const more = s.tries >= s.maxTries ? 'It tries again only when you tap' : 'It tries again later by itself'
      return { value, sub: `Couldn’t update${why}. The plugin that was there still works. ${more}. Tap to try now`, action: 'update', tone: 'red' }
    }
    default:
      return { value, sub: 'Not checked yet', action: null, tone: 'blue' }
  }
}

export interface UpdateDialog {
  title: string
  message: string
  confirmLabel: string
}

/** The plugin states whose update tap restarts Hermes: on a switched phone the app can't see their work. */
const RESTARTS = ['older', 'failed', 'busy', 'busy-unknown', 'modified']

/**
 * The question a tap must answer first (pure, unit-tested): replacing hand changes, or a restart that may cut off work:
 * always for `busy-unknown`, and on a switched phone (`enforced`) for every state whose tap restarts Hermes, since the
 * app can't see an older plugin's work there. `cut` says the user was told so: then the shell is told it was confirmed.
 */
export function updateDialog(state: string | undefined, force: boolean, enforced = false): (UpdateDialog & { cut: boolean }) | null {
  const cutOff = state === 'busy-unknown' || (enforced && !!state && RESTARTS.includes(state))
  const cut = cutOff
    ? ' This older plugin can’t say whether Hermes is working: an answer or a scheduled job that is running now would be cut off.'
    : ''
  if (force) {
    return {
      title: 'Replace the plugin?',
      message: `The plugin in Hermux was changed by hand. Replace it with this app’s copy? The changes made by hand go, and Hermux restarts for a moment.${cut}`,
      confirmLabel: 'Replace',
      cut: cutOff
    }
  }
  if (cutOff) return { title: 'Update the plugin now?', message: `Hermux restarts for a moment.${cut}`, confirmLabel: 'Update now', cut: true }
  return null
}

/** A tap on an update button anywhere (Settings, the setup check): the dialog first when one is needed, then the update.
 *  Its answer for a toast ('' = started, or the user said no). */
export async function runPluginUpdate(force: boolean): Promise<string> {
  const st = pluginState()
  const d = updateDialog(st?.state, force, !!st?.enforced)
  if (d) {
    const { confirmDialog } = await import('./dialog') // loaded here so this file stays free of the page (unit tests)
    if (!(await confirmDialog({ title: d.title, message: d.message, confirmLabel: d.confirmLabel }))) return ''
  }
  // Only a tap whose warning about cut-off work was answered may replace an old plugin whose work can't be asked.
  return updateAnswer(d?.cut ? pluginUpdateConfirmed(force) : pluginUpdate(force))
}

/** What a tap's answer means for the user; '' = it started. */
export function updateAnswer(r: string): string {
  if (r === 'ok') return ''
  if (r === 'working') return 'Hermux is working. Try again when it has finished'
  if (r === 'busy') return 'Already checking or updating'
  if (r === 'not-ready') return 'Hermux isn’t set up yet, or Termux doesn’t take commands from this app'
  return r.replace(/^error: /, '') || 'Not available in this version of the app'
}

// ── shell calls (PluginSync through MainActivity's bridge) ──
type Shell = { pluginState?: () => string; pluginUpdate?: (force: boolean) => string; pluginUpdateConfirmed?: (force: boolean) => string }
const shell = () => (window as unknown as { HermesAndroid?: Shell }).HermesAndroid

export function pluginState(): PluginState | null {
  try {
    const raw = shell()?.pluginState?.()
    return raw ? (JSON.parse(raw) as PluginState) : null
  } catch {
    return null
  }
}

export function pluginUpdate(force: boolean): string {
  try {
    return shell()?.pluginUpdate?.(force) || 'error: not available'
  } catch (e) {
    return `error: ${String(e)}`
  }
}

/** pluginUpdate after the user answered the warning that a running answer or job may be cut off (`--confirmed`). */
export function pluginUpdateConfirmed(force: boolean): string {
  try {
    return shell()?.pluginUpdateConfirmed?.(force) || 'error: not available'
  } catch (e) {
    return `error: ${String(e)}`
  }
}

const subs = new Set<() => void>()
/** The shell calls window.hermesPluginState() when a check or update starts or ends. */
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).hermesPluginState = () => subs.forEach(f => f())

/** The state, kept current by the shell's calls; null outside the app (or an app without this). */
export function usePluginState(): PluginState | null {
  const [s, set] = useState(pluginState)
  useEffect(() => {
    const f = () => set(pluginState())
    subs.add(f)
    return () => {
      subs.delete(f)
    }
  }, [])
  return s
}
