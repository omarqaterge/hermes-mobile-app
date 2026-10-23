// Settings → Uninstall Hermes: the step logic (pure, unit-tested) and the shell calls. The Termux half is
// phone/uninstall.sh (run by the shell, Uninstall.java); the apps are removed with Android's own prompt, one at a time.
import type { NativeSetup } from './bridge'

export type StepId = 'stop' | 'backup' | 'android' | 'debian' | 'files' | 'termux'
export type StepState = 'ok' | 'skip' | 'fail' | 'pending'
export interface StepOutcome {
  id: StepId
  label: string
  state: StepState
  text: string
}

export const STEP_LABEL: Record<StepId, string> = {
  stop: 'Stop Hermes',
  backup: 'Backup to Downloads',
  android: 'Phone settings the installer changed',
  debian: 'Debian, Hermes, chats and keys',
  files: 'The installer’s files in Termux',
  termux: 'Termux taking commands from this app'
}
const ORDER: StepId[] = ['stop', 'backup', 'android', 'debian', 'files', 'termux']

export interface CleanupReport {
  steps: StepOutcome[]
  /** Full path of the backup file (BACKUP line). */
  backup: string
  removed: string[]
  done: boolean
  fails: string[]
}

/** phone/uninstall.sh's "HMUNINSTALL …" lines → one outcome per step (the last word on a step wins; FAIL sticks). */
export function parseCleanup(stdout: string, withBackup: boolean): CleanupReport {
  const steps = new Map<StepId, StepOutcome>()
  const seen = (id: string): id is StepId => (ORDER as string[]).includes(id)
  let backup = ''
  let done = false
  const removed: string[] = []
  const fails: string[] = []
  for (const raw of stdout.split('\n')) {
    const m = /^HMUNINSTALL (STEP|OK|SKIP|FAIL|RM|BACKUP|DONE)(?: (\S+))?(?: (.*))?$/.exec(raw.trim())
    if (!m) continue
    const [, kind, a = '', rest = ''] = m
    if (kind === 'DONE') { done = true; continue }
    if (kind === 'RM') { removed.push([a, rest].filter(Boolean).join(' ')); continue }
    if (kind === 'BACKUP') { backup = [a, rest].filter(Boolean).join(' '); continue }
    if (kind === 'FAIL') fails.push(rest || a)
    if (!seen(a)) continue
    const prev = steps.get(a)
    const state: StepState = kind === 'STEP' ? 'pending' : kind === 'OK' ? 'ok' : kind === 'SKIP' ? 'skip' : 'fail'
    if (prev?.state === 'fail' && state !== 'fail') continue
    steps.set(a, { id: a, label: STEP_LABEL[a], state, text: kind === 'STEP' ? '' : rest })
  }
  const list = ORDER.filter(id => id !== 'backup' || withBackup || steps.has('backup')).map(
    id => steps.get(id) ?? { id, label: STEP_LABEL[id], state: 'pending' as StepState, text: '' }
  )
  return { steps: list, backup, removed, done, fails }
}

// ── the apps, in the order they are removed (Termux after its cleanup, this app last) ──
export type AppId = 'termux-api' | 'termux-boot' | 'shizuku' | 'termux' | 'self'
export interface AppInfo {
  id: AppId
  name: string
  what: string
}
export const APPS: AppInfo[] = [
  { id: 'termux-api', name: 'Termux:API', what: 'Phone features for Hermes (battery, location, notifications…)' },
  { id: 'termux-boot', name: 'Termux:Boot', what: 'Started Hermes after a restart' },
  { id: 'shizuku', name: 'Shizuku', what: 'Screen, taps and apps for Hermes without root' },
  { id: 'termux', name: 'Termux', what: 'The terminal Debian and Hermes ran in, with everything left in it' },
  { id: 'self', name: 'Hermes Mobile', what: 'This app' }
]

/** Is the app installed? Unknown (an older shell that doesn't report it) counts as installed: the prompt tells. */
export function appInstalled(n: NativeSetup | null, id: AppId): boolean {
  if (id === 'self') return true
  if (!n) return false
  const v = id === 'termux-api' ? n.termuxApi : id === 'termux-boot' ? n.termuxBoot : id === 'shizuku' ? n.shizuku : n.termux
  return v !== false
}

/** The next app to remove, or null when only… nothing is left (never: this app is always last). */
export function nextApp(n: NativeSetup | null): AppId {
  return (APPS.find(a => a.id !== 'self' && appInstalled(n, a.id))?.id ?? 'self') as AppId
}

// ── the native state ──
export interface CleanupResult {
  exit: number
  stdout: string
  stderr?: string
  err?: number
  errmsg?: string
}
export interface UninstallNative {
  started: boolean
  running: boolean
  removed: boolean
  result: CleanupResult | null
}

export type Phase = 'review' | 'running' | 'lost' | 'failed' | 'apps'

/** What the sheet shows. `go` = the user confirmed in this sheet (or chose to carry on after a failure). */
export function phaseOf(s: UninstallNative | null, termuxThere: boolean, go: { confirmed: boolean; skipCleanup: boolean }): Phase {
  if (s?.running) return 'running'
  if (go.skipCleanup) return 'apps'
  if (s?.result) {
    if (s.result.exit === 0) return 'apps'
    if (s.result.exit === 3 && !s.removed) return go.confirmed ? 'failed' : 'review' // nothing was removed
    return 'failed'
  }
  if (s?.started) return 'lost' // started, but the answer never came (the app was closed or killed meanwhile)
  if (go.confirmed && !termuxThere) return 'apps' // nothing to clean in Termux: Debian went with it
  return 'review'
}

/** Did the Termux side finish? Termux may then be uninstalled without a warning. */
export function cleanupOk(s: UninstallNative | null): boolean {
  return Boolean(s?.result && s.result.exit === 0)
}

/** The app's own settings for the backup (no caches, drafts or chat data; nothing secret lives in localStorage). */
export const SETTINGS_KEYS = [
  'hm.theme', 'hm.oled', 'hm.textScale', 'hm.tts', 'hm.autoread', 'hm.autoread.chats', 'hm.favModels.v1', 'hm.live.pause',
  'hm.profile', 'hm.yolo.v1'
]
export function settingsSnapshot(get: (k: string) => string | null): string {
  const o: Record<string, string> = {}
  for (const k of SETTINGS_KEYS) {
    const v = get(k)
    if (v != null) o[k] = v
  }
  return JSON.stringify({ app: 'hermes-mobile', settings: o })
}

/** The backup's file name for the screen ("hermes-backup-….tar.gz" in Download). */
export function backupName(path: string): string {
  return path.split('/').pop() || path
}

// ── shell calls (Uninstall.java through MainActivity's bridge) ──
type Shell = {
  uninstallStart?: (backup: boolean, keys: boolean, settings: string) => string
  uninstallState?: () => string
  uninstallApp?: (which: string) => boolean
}
const shell = () => (window as unknown as { HermesAndroid?: Shell }).HermesAndroid

export const canUninstall = () => typeof shell()?.uninstallState === 'function'

export function uninstallState(): UninstallNative | null {
  try {
    const raw = shell()?.uninstallState?.()
    return raw ? (JSON.parse(raw) as UninstallNative) : null
  } catch {
    return null
  }
}

/** "ok", or why not: busy · no-termux · no-permission · error: … */
export function startCleanup(backup: boolean, keys: boolean, settings: string): string {
  try {
    return shell()?.uninstallStart?.(backup, keys, backup ? settings : '') || 'error: not available'
  } catch (e) {
    return `error: ${String(e)}`
  }
}

export function uninstallApp(id: AppId): boolean {
  try {
    return Boolean(shell()?.uninstallApp?.(id))
  } catch {
    return false
  }
}

const doneSubs = new Set<() => void>()
/** The shell calls window.hermesUninstallDone() when Termux answered. */
export function onCleanupDone(fn: () => void): () => void {
  doneSubs.add(fn)
  return () => {
    doneSubs.delete(fn)
  }
}
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).hermesUninstallDone = () => doneSubs.forEach(f => f())
