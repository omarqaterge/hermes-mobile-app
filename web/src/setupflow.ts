// The setup state of the whole app, as pure data: which pieces are in place, which are missing, and which step comes
// next. Setup check (Settings) lists every row; SetupFlow (first run) shows the first missing required one and resumes
// from there. The rows are in the order the flow walks them. Steps that happen BEFORE Hermes exists on the phone
// (getting the apps, running the installer) go at the top of ROWS below, in the same shape.
import type { NativeSetup } from './bridge'

export type StepId =
  | 'termux' | 'run' | 'hermes' | 'plugin' | 'enabled' | 'model'
  | 'notif' | 'bat-app' | 'bat-termux' | 'files' | 'termux-api' | 'shizuku' | 'autostart'

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
export function setupSteps(n: NativeSetup | null, conn: string, r: Remote | null, hasModel: boolean | null): FlowStep[] {
  const online = conn === 'open'
  const nat = (v: boolean | undefined): StepState => (n ? (v ? 'ok' : 'bad') : 'skip')
  const p = online ? r?.phone ?? null : null
  const remoteState = (v: boolean | undefined): StepState => (p ? (v ? 'ok' : 'bad') : 'skip')
  const maker = (n?.maker || '').toLowerCase()
  const row = (id: StepId, required: boolean, state: StepState): FlowStep => ({ id, required, state })
  return [
    row('termux', false, nat(n?.termux)),
    row('run', false, n && !n.termux ? 'skip' : nat(n?.runCommand)),
    row('hermes', true, online ? 'ok' : conn === 'connecting' ? 'wait' : 'bad'),
    row('plugin', true, !online || !r || r.plugin == null ? (online ? 'wait' : 'skip') : r.plugin ? 'ok' : 'bad'),
    row('enabled', true, !online || !r?.plugin || r.enabled == null ? 'skip' : r.enabled ? 'ok' : 'bad'),
    row('model', true, !online ? 'skip' : hasModel == null ? 'wait' : hasModel ? 'ok' : 'bad'),
    row('notif', false, nat(n?.notifications)),
    row('bat-app', false, nat(n?.batteryApp)),
    row('bat-termux', false, n && !n.termux ? 'skip' : nat(n?.batteryTermux)),
    row('files', false, remoteState(p?.files)),
    row('termux-api', false, n?.termuxApi === false ? 'bad' : remoteState(p?.termux_api)),
    row('shizuku', false, n?.shizuku === false ? 'bad' : !p ? 'skip' : p.shizuku === 'ok' ? 'ok' : 'bad'),
    row('autostart', false, n && AUTOSTART_MAKERS.includes(maker) ? 'info' : 'skip')
  ]
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
