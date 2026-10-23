// The setup state of the whole app, as pure data: which pieces are in place, which are missing, and which step comes
// next. Setup check (Settings) lists every row; SetupFlow (first run) shows the first missing required one and resumes
// from there. The rows are in the order the flow walks them. The steps before Hermes exists on the phone (get the apps,
// start Shizuku, run the installer and follow its progress) come first, so an app-first install, a computer install and a
// half-finished one all resume at whatever is missing.
import type { NativeSetup } from './bridge'

export type StepId =
  | 'apps' | 'termux' | 'shizuku-start' | 'run' | 'installer' | 'hermes' | 'plugin' | 'enabled' | 'model'
  | 'notif' | 'bat-app' | 'bat-termux' | 'termux-boot' | 'files' | 'termux-api' | 'shizuku' | 'autostart'

/** What Termux said to the shell's probe (MainActivity.probeTermux). unknown: not asked / no answer yet · denied: no
 *  RUN_COMMAND permission · not-allowed: Termux refuses commands (the installer never got far) · no-services: Termux runs
 *  our commands but the install never finished · stopped: installed, dashboard down · running: dashboard answers. */
export type Probe = 'unknown' | 'denied' | 'not-allowed' | 'no-services' | 'stopped' | 'running'

/** The installer's progress lines (HermesService /setup): active = a command was copied and DONE hasn't come yet. */
export interface Progress {
  active: boolean
  lines: string[]
  done: boolean
  /** The step named by the last FAIL line ('' = none). */
  fail: string
}

/** The pre-Hermes facts. probe null = this app build can't probe (older shell): those rows are skipped. */
export interface PreHermes {
  probe: Probe | null
  progress: Progress | null
  /** The user skipped (or finished) the Start Shizuku step. */
  shizukuSkipped: boolean
}

/** The native probe's raw answer. */
export interface ProbeRaw {
  result: 'denied' | 'not-allowed' | 'ran' | 'error'
  services?: boolean
  installed?: boolean
  dash?: number
}

/** The supervisor script exists from the middle of the install on, so without the finished marker (an install from before
 *  the marker existed) it only counts as installed when no installer is running right now. */
export function probeState(raw: ProbeRaw | null, installerRunning: boolean): Probe {
  if (!raw) return 'unknown'
  if (raw.result === 'denied') return 'denied'
  if (raw.result !== 'ran') return 'not-allowed'
  if (raw.dash === 200) return 'running'
  if (raw.installed || (raw.services && !installerRunning)) return 'stopped'
  return 'no-services'
}

/** The installer's steps in order (phone/bootstrap.sh), for the progress view. */
export const INSTALL_STEPS: { id: string; label: string }[] = [
  { id: 'packages', label: 'Termux packages' },
  { id: 'access', label: 'Access to the phone' },
  { id: 'android', label: 'Android child-process limit' },
  { id: 'debian', label: 'Debian' },
  { id: 'hermes', label: 'Hermes Agent (10-30 minutes)' },
  { id: 'plugin', label: 'Hermes Mobile plugin' },
  { id: 'start', label: 'Starting Hermes' }
]

export interface ProgressView {
  steps: { id: string; label: string; state: 'ok' | 'run' | 'bad' | 'todo' }[]
  /** The latest "phone: …" line: what the user has to do on the phone right now. */
  hint: string
  todo: string[]
  fail: string
  done: boolean
  /** The latest android: line (whether the child-process limit was lifted). */
  android: string
}

/** Turns the progress lines into the view: finished steps, the one running, the latest hint, TODO lines, FAIL/DONE. */
export function progressView(lines: string[]): ProgressView {
  let cur = ''
  let fail = ''
  let hint = ''
  let android = ''
  let done = false
  const seen: string[] = []
  const todo: string[] = []
  for (const l of lines) {
    let m: RegExpMatchArray | null
    if ((m = l.match(/^STEP ([a-z-]+)/))) {
      cur = m[1]
      if (!seen.includes(cur)) seen.push(cur)
      fail = ''
    } else if ((m = l.match(/^FAIL ([a-z-]+)/))) fail = m[1]
    else if (l === 'DONE') done = true
    else if (l.startsWith('phone: ')) hint = l.slice(7)
    else if (l.startsWith('android: ')) android = l.slice(9)
    else if (l.startsWith('TODO ')) todo.push(l.slice(5))
  }
  const known = INSTALL_STEPS.map(s => s.id)
  const ids = [...known, ...seen.filter(id => !known.includes(id))]
  const at = ids.indexOf(cur)
  const steps = ids
    .map(id => ({ id, label: INSTALL_STEPS.find(s => s.id === id)?.label ?? id }))
    .filter(s => known.includes(s.id) || seen.includes(s.id))
    .map(s => {
      const i = ids.indexOf(s.id)
      const state: 'ok' | 'run' | 'bad' | 'todo' = done ? 'ok' : s.id === fail ? 'bad' : i < at ? 'ok' : i === at ? (fail ? 'bad' : 'run') : 'todo'
      return { ...s, state }
    })
  return { steps, hint, todo, fail, done, android }
}

/** ok: in place · bad: missing · wait: answer not here yet · skip: can't be known here (browser, Hermes offline) ·
 *  info: can't be detected, shown as a tip. */
export type StepState = 'ok' | 'bad' | 'wait' | 'skip' | 'info'

export interface FlowStep {
  id: StepId
  /** Hermes can't work without it (running, plugin, a model). The rest is recommended and never blocks. */
  required: boolean
  state: StepState
}

export interface PhoneAccess {
  files: boolean
  termux_api: boolean
  shizuku: 'ok' | 'off' | 'denied' | 'blocked' | 'missing'
}

/** What the dashboard says (null until it answered). */
export interface Remote {
  plugin: boolean | null // the dashboard knows the plugin
  enabled: boolean | null // …and this profile has it enabled
  enabledList: string[]
  phone: PhoneAccess | null // null: an older plugin that can't tell
}

/** Xiaomi's Autostart switch can't be read, so it is only a tip on these makers. */
export const AUTOSTART_MAKERS = ['xiaomi', 'redmi', 'poco']

/** @param hasModel true = a provider is connected, false = none, null = not asked / no answer yet. */
export function setupSteps(n: NativeSetup | null, conn: string, r: Remote | null, hasModel: boolean | null, pre?: PreHermes): FlowStep[] {
  const online = conn === 'open'
  // App-first rows exist only in a shell that can install the helper apps (older builds: skipped, old rows instead).
  const appFirst = Boolean(n && n.canInstall !== undefined)
  const allApps = Boolean(n?.termux && n.termuxApi && n.termuxBoot && n.shizuku)
  const prog = pre?.progress ?? null
  const probe = pre?.probe ?? null
  const installed = online || Boolean(prog?.done) || probe === 'stopped' || probe === 'running'
  const installing = Boolean(prog?.active && !prog.done && !prog.fail)
  const installerState: StepState =
    !appFirst || probe == null ? 'skip'
      : installed ? 'ok'
        : !n?.termux ? 'bad'
          : installing ? 'wait'
            : prog?.fail ? 'bad'
              : probe === 'unknown' ? 'wait'
                : 'bad'
  const shizukuState: StepState = !appFirst || probe == null || installed || installing || pre?.shizukuSkipped ? 'skip' : 'bad'
  const nat = (v: boolean | undefined): StepState => (n ? (v ? 'ok' : 'bad') : 'skip')
  const p = online ? r?.phone ?? null : null
  const remoteState = (v: boolean | undefined): StepState => (p ? (v ? 'ok' : 'bad') : 'skip')
  const maker = (n?.maker || '').toLowerCase()
  const row = (id: StepId, required: boolean, state: StepState): FlowStep => ({ id, required, state })
  return [
    row('apps', true, appFirst ? (allApps ? 'ok' : 'bad') : 'skip'),
    row('termux', false, appFirst ? 'skip' : nat(n?.termux)),
    row('shizuku-start', true, shizukuState),
    // Required before the installer once Termux is there: the probe and starting Hermes need it. Hermes already
    // answering means it works without the app starting it, so then it is only recommended.
    row('run', Boolean(appFirst && n?.termux && !online), n && !n.termux ? 'skip' : nat(n?.runCommand)),
    row('installer', true, installerState),
    row('hermes', true, online ? 'ok' : conn === 'connecting' ? 'wait' : 'bad'),
    row('plugin', true, !online || !r || r.plugin == null ? (online ? 'wait' : 'skip') : r.plugin ? 'ok' : 'bad'),
    row('enabled', true, !online || !r?.plugin || r.enabled == null ? 'skip' : r.enabled ? 'ok' : 'bad'),
    row('model', true, !online ? 'skip' : hasModel == null ? 'wait' : hasModel ? 'ok' : 'bad'),
    row('notif', false, nat(n?.notifications)),
    row('bat-app', false, nat(n?.batteryApp)),
    row('bat-termux', false, n && !n.termux ? 'skip' : nat(n?.batteryTermux)),
    row('termux-boot', false, n?.termuxBoot && n.termuxBootStopped ? 'bad' : n?.termuxBoot && n.termuxBootStopped === false ? 'ok' : 'skip'),
    row('files', false, remoteState(p?.files)),
    row('termux-api', false, n?.termuxApi === false ? 'bad' : remoteState(p?.termux_api)),
    row('shizuku', false, n?.shizuku === false ? 'bad' : !p ? 'skip' : p.shizuku === 'ok' ? 'ok' : 'bad'),
    row('autostart', false, n && AUTOSTART_MAKERS.includes(maker) ? 'info' : 'skip')
  ]
}

/** The Start Shizuku step re-asks the app whether Shizuku runs, but only while it is on screen and for at most 10 minutes. */
export const SHIZUKU_WATCH_MS = 10 * 60 * 1000
export const SHIZUKU_WATCH_EVERY_MS = 3000
export function shizukuWatchActive(s: { visible: boolean; running: boolean; startedAt: number; now: number }): boolean {
  return s.visible && !s.running && s.now - s.startedAt < SHIZUKU_WATCH_MS
}

/** The first required step that isn't done (bad, or still being checked), else null. */
export function nextStep(steps: FlowStep[]): FlowStep | null {
  return steps.find(s => s.required && (s.state === 'bad' || s.state === 'wait')) ?? null
}

/** Recommended rows that are missing (shown once, never blocking). */
export const recommendedGaps = (steps: FlowStep[]): FlowStep[] => steps.filter(s => !s.required && s.state === 'bad')

export interface FlowFlags {
  welcomeDone: boolean
  flowDone: boolean
}

/** Should the flow open by itself at start-up? Only on a first run (neither flag set): a missing plugin, no model, or
 *  a recommended item that is missing, once. An established setup is never interrupted. (Hermes not running on a first
 *  run is handled by watchFirstRun.) */
export function shouldOpenFlow(steps: FlowStep[], f: FlowFlags): boolean {
  if (f.welcomeDone || f.flowDone) return false
  const bad = (id: StepId) => steps.find(s => s.id === id)?.state === 'bad'
  return bad('plugin') || bad('model') || recommendedGaps(steps).length > 0
}
