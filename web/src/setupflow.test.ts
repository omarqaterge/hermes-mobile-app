import { describe, expect, test } from 'vitest'
import type { NativeSetup } from './bridge'
import { nextStep, probeState, progressView, recommendedGaps, setupSteps, shizukuAutoKind, shizukuWatchActive, shouldOpenFlow, type PreHermes, type Remote } from './setupflow'

const native: NativeSetup = { termux: true, runCommand: true, notifications: true, batteryApp: true, batteryTermux: true, termuxApi: true, shizuku: true, startError: '', maker: 'google' }
const remote: Remote = { plugin: true, enabled: true, enabledList: ['hermes-mobile'], phone: { files: true, termux_api: true, shizuku: 'ok' } }
const st = (steps: ReturnType<typeof setupSteps>, id: string) => steps.find(s => s.id === id)?.state

describe('setupSteps / nextStep', () => {
  test('a PC-installed phone with everything working has no next step', () => {
    const steps = setupSteps(native, 'open', remote, true)
    expect(nextStep(steps)).toBeNull()
    expect(steps.every(s => s.state === 'ok' || s.state === 'skip')).toBe(true)
  })
  test('Hermes not running → the next step is hermes', () => {
    expect(nextStep(setupSteps(native, 'closed', null, null))?.id).toBe('hermes')
    expect(nextStep(setupSteps(native, 'connecting', null, null))?.id).toBe('hermes') // still being checked
  })
  test('running, no model → model', () => {
    expect(nextStep(setupSteps(native, 'open', remote, false))?.id).toBe('model')
  })
  test('the plugin comes before the model, installed before enabled', () => {
    expect(nextStep(setupSteps(native, 'open', { ...remote, plugin: false, enabled: null }, false))?.id).toBe('plugin')
    expect(nextStep(setupSteps(native, 'open', { ...remote, enabled: false }, false))?.id).toBe('enabled')
  })
  test('answers that have not arrived are waiting, never missing', () => {
    const steps = setupSteps(native, 'open', null, null)
    expect(st(steps, 'plugin')).toBe('wait')
    expect(st(steps, 'model')).toBe('wait')
    expect(st(steps, 'files')).toBe('skip')
  })
  test('no native bridge (a browser): Android rows are skipped, never bad', () => {
    const steps = setupSteps(null, 'open', remote, true)
    for (const id of ['termux', 'run', 'notif', 'bat-app', 'bat-termux', 'autostart']) expect(st(steps, id)).toBe('skip')
    expect(nextStep(steps)).toBeNull()
  })
  test('recommended rows are listed but never block', () => {
    const steps = setupSteps({ ...native, batteryApp: false }, 'open', remote, true)
    expect(st(steps, 'bat-app')).toBe('bad')
    expect(nextStep(steps)).toBeNull()
    expect(recommendedGaps(steps).map(s => s.id)).toEqual(['bat-app'])
  })
  test('Autostart: a tip only where the shell found an Autostart page, ✓ once the user says Done', () => {
    for (const autostart of ['list', 'app', 'settings', 'info'] as const) expect(st(setupSteps({ ...native, autostart }, 'open', remote, true), 'autostart')).toBe('info')
    // no such switch on this phone (Pixel/AOSP, Samsung…), or an older shell that doesn't say: no row, whatever the maker
    expect(st(setupSteps({ ...native, autostart: '' }, 'open', remote, true), 'autostart')).toBe('skip')
    expect(st(setupSteps({ ...native, maker: 'xiaomi' }, 'open', remote, true), 'autostart')).toBe('skip')
    expect(recommendedGaps(setupSteps({ ...native, autostart: 'list' }, 'open', remote, true))).toEqual([])
    const pre = { probe: null, progress: null, shizukuDone: false, autostartDone: true }
    expect(st(setupSteps({ ...native, autostart: 'list' }, 'open', remote, true, pre), 'autostart')).toBe('ok')
  })
  test('Shizuku battery: bad when installed but limited, ok when unrestricted, skipped when not installed or an older build', () => {
    const rowOf = (n: NativeSetup) => setupSteps(n, 'open', remote, true).find(s => s.id === 'bat-shizuku')
    expect(rowOf({ ...native, shizuku: true, batteryShizuku: false })).toEqual({ id: 'bat-shizuku', required: false, state: 'bad' })
    expect(rowOf({ ...native, shizuku: true, batteryShizuku: true })).toEqual({ id: 'bat-shizuku', required: false, state: 'ok' })
    expect(rowOf({ ...native, shizuku: false, batteryShizuku: false })?.state).toBe('skip')
    expect(rowOf({ ...native, shizuku: true })?.state).toBe('skip') // older app build: not reported
    expect(setupSteps(null, 'open', remote, true).find(s => s.id === 'bat-shizuku')?.state).toBe('skip')
  })
  test('Shizuku starts by itself: required on Android 11+, only once Shizuku works, hidden on 10 and older or older builds', () => {
    const auto = { sdk: true, wss: true, paired: true, last: 'ok' }
    const rowOf = (n: NativeSetup, r = remote) => setupSteps(n, 'open', r, true).find(s => s.id === 'shizuku-auto')
    expect(rowOf({ ...native, shizukuAuto: auto })).toEqual({ id: 'shizuku-auto', required: true, state: 'ok' })
    expect(rowOf({ ...native, shizukuAuto: { ...auto, paired: false } })?.state).toBe('bad')
    expect(rowOf({ ...native, shizukuAuto: { ...auto, wss: false } })?.state).toBe('bad')
    expect(rowOf({ ...native, shizukuAuto: { ...auto, sdk: false, paired: false } })?.state).toBe('skip')
    expect(rowOf({ ...native })?.state).toBe('skip') // older app build
    expect(rowOf({ ...native, shizukuAuto: { ...auto, paired: false } }, { ...remote, phone: { ...remote.phone!, shizuku: 'off' } })?.state).toBe('skip') // Shizuku not working yet
    expect(rowOf({ ...native, shizuku: false, shizukuAuto: { ...auto, paired: false } })?.state).toBe('skip')
    expect(setupSteps(null, 'open', remote, true).find(s => s.id === 'shizuku-auto')?.state).toBe('skip')
  })
  test('shizukuAutoKind: what the row says', () => {
    expect(shizukuAutoKind({ sdk: true, wss: true, paired: true, last: 'ok' })).toBe('ok')
    expect(shizukuAutoKind({ sdk: true, wss: false, paired: false, last: '' })).toBe('installer')
    expect(shizukuAutoKind({ sdk: true, wss: true, paired: false, last: 'not-paired' })).toBe('pair')
    expect(shizukuAutoKind({ sdk: true, wss: true, paired: false, last: 'untrusted-network' })).toBe('pair')
  })
  test('Shizuku battery limit is recommended: listed, never blocks', () => {
    const steps = setupSteps({ ...native, batteryShizuku: false }, 'open', remote, true)
    expect(nextStep(steps)).toBeNull()
    expect(recommendedGaps(steps).map(s => s.id)).toEqual(['bat-shizuku'])
  })
  test('Shizuku (what Hermes can do with it) is a required row, not a recommendation', () => {
    const steps = setupSteps(native, 'open', remote, true)
    expect(steps.find(s => s.id === 'shizuku')?.required).toBe(true)
    const off = setupSteps(native, 'open', { ...remote, phone: { files: true, termux_api: true, shizuku: 'off' } }, true)
    expect(nextStep(off)?.id).toBe('shizuku')
    expect(recommendedGaps(off).map(s => s.id)).not.toContain('shizuku')
  })
  test('Termux:API and Shizuku missing on Android are bad even before Hermes answers', () => {
    const steps = setupSteps({ ...native, termuxApi: false, shizuku: false }, 'closed', null, null)
    expect(st(steps, 'termux-api')).toBe('bad')
    expect(st(steps, 'shizuku')).toBe('bad')
  })
})

describe('shouldOpenFlow', () => {
  const none = { welcomeDone: false, flowDone: false }
  test('everything fine → never opens', () => {
    expect(shouldOpenFlow(setupSteps(native, 'open', remote, true), none)).toBe(false)
  })
  test('no model on a first run → opens', () => {
    expect(shouldOpenFlow(setupSteps(native, 'open', remote, false), none)).toBe(true)
  })
  test('a recommended gap opens it once, on a first run only', () => {
    const steps = setupSteps({ ...native, batteryTermux: false }, 'open', remote, true)
    expect(shouldOpenFlow(steps, none)).toBe(true)
    expect(shouldOpenFlow(steps, { welcomeDone: false, flowDone: true })).toBe(false)
    expect(shouldOpenFlow(steps, { welcomeDone: true, flowDone: false })).toBe(false)
  })
  test('a plugin that is installed but not enabled for this profile does not interrupt', () => {
    expect(shouldOpenFlow(setupSteps(native, 'open', { ...remote, enabled: false }, true), none)).toBe(false)
  })
  test('Shizuku not working on a first run → opens (it is required)', () => {
    const off = setupSteps(native, 'open', { ...remote, phone: { files: true, termux_api: true, shizuku: 'off' } }, true)
    expect(shouldOpenFlow(off, none)).toBe(true)
    expect(shouldOpenFlow(off, { welcomeDone: false, flowDone: true })).toBe(false)
  })
  test('plugin not installed on a first run → opens', () => {
    expect(shouldOpenFlow(setupSteps(native, 'open', { ...remote, plugin: false }, true), none)).toBe(true)
  })
})

// App-first setup: the steps before Hermes exists (get the apps, start Shizuku, run the installer, its progress).
describe('app-first steps', () => {
  const fresh: NativeSetup = {
    ...native, termux: false, runCommand: false, termuxApi: false, termuxBoot: false, termuxBootStopped: false, shizuku: false,
    canInstall: false, devOptions: false, wirelessDebugging: false, termuxSigner: ''
  }
  const allApps: NativeSetup = { ...fresh, termux: true, termuxApi: true, termuxBoot: true, shizuku: true, runCommand: true, canInstall: true, termuxSigner: 'fdroid' }
  const pre = (p: Partial<PreHermes> = {}): PreHermes => ({ probe: 'unknown', progress: null, shizukuDone: false, ...p })
  const active = { active: true, lines: ['STEP packages Termux packages'], done: false, fail: '' }
  test('no Termux → the next step is apps', () => {
    expect(nextStep(setupSteps(fresh, 'closed', null, null, pre()))?.id).toBe('apps')
  })
  test('one helper app missing → still apps (all four are required)', () => {
    for (const k of ['termuxApi', 'termuxBoot', 'shizuku'] as const) expect(nextStep(setupSteps({ ...allApps, [k]: false }, 'closed', null, null, pre()))?.id).toBe('apps')
  })
  test('apps present → Start Shizuku comes before the installer, and moves on once Shizuku was seen running', () => {
    expect(nextStep(setupSteps(allApps, 'closed', null, null, pre({ probe: 'not-allowed' })))?.id).toBe('shizuku-start')
    expect(nextStep(setupSteps(allApps, 'closed', null, null, pre({ probe: 'not-allowed', shizukuDone: true })))?.id).toBe('installer')
  })
  test('no skip: without a stored "done" the Start Shizuku step stays, whatever else is known', () => {
    for (const probe of ['unknown', 'not-allowed', 'no-services', 'denied'] as const) {
      expect(st(setupSteps(allApps, 'closed', null, null, pre({ probe, shizukuDone: false })), 'shizuku-start')).toBe('bad')
    }
    expect(st(setupSteps(allApps, 'closed', null, null, pre({ probe: 'not-allowed', shizukuDone: true })), 'shizuku-start')).toBe('ok')
    // Shizuku seen running: the step stays up for its tick; the page then stores "done" itself
    expect(st(setupSteps({ ...allApps, shizukuRunning: true }, 'closed', null, null, pre({ probe: 'not-allowed' })), 'shizuku-start')).toBe('bad')
  })
  test('apps present, no dashboard, Termux refuses commands (start fails) → installer', () => {
    const steps = setupSteps({ ...allApps, startError: 'refused' }, 'closed', null, null, pre({ probe: 'not-allowed', shizukuDone: true }))
    expect(nextStep(steps)?.id).toBe('installer')
    expect(st(steps, 'installer')).toBe('bad')
  })
  test('a half-finished install (Termux allows us, not finished) → installer', () => {
    expect(nextStep(setupSteps(allApps, 'closed', null, null, pre({ probe: 'no-services', shizukuDone: true })))?.id).toBe('installer')
  })
  test('Termux there but Hermes Mobile may not run commands → run, before the installer', () => {
    expect(nextStep(setupSteps({ ...allApps, runCommand: false }, 'closed', null, null, pre({ probe: 'denied', shizukuDone: true })))?.id).toBe('run')
  })
  test('installed but stopped → hermes (Start Hermes); the Shizuku step is not shown any more', () => {
    const steps = setupSteps(allApps, 'closed', null, null, pre({ probe: 'stopped' }))
    expect(nextStep(steps)?.id).toBe('hermes')
    expect(st(steps, 'shizuku-start')).toBe('skip')
    expect(st(steps, 'installer')).toBe('ok')
  })
  test('the installer is running → installer, waiting (the progress view), never Start Hermes', () => {
    const steps = setupSteps(allApps, 'closed', null, null, pre({ probe: 'no-services', progress: active }))
    expect(nextStep(steps)?.id).toBe('installer')
    expect(st(steps, 'installer')).toBe('wait')
  })
  test('the installer failed → installer is bad again', () => {
    expect(st(setupSteps(allApps, 'closed', null, null, pre({ probe: 'no-services', progress: { ...active, fail: 'debian' } })), 'installer')).toBe('bad')
  })
  test('DONE → installer ok; once Hermes answers the model step is next', () => {
    const done = pre({ probe: 'no-services', progress: { active: false, lines: ['DONE'], done: true, fail: '' } })
    expect(st(setupSteps(allApps, 'connecting', null, null, done), 'installer')).toBe('ok')
    expect(nextStep(setupSteps(allApps, 'open', remote, false, done))?.id).toBe('model')
  })
  test('the probe has not answered yet → installer waits', () => {
    expect(st(setupSteps(allApps, 'closed', null, null, pre({ shizukuDone: true })), 'installer')).toBe('wait')
  })
  test('a PC-installed phone with everything working never sees the new rows', () => {
    const steps = setupSteps(allApps, 'open', remote, true, pre())
    expect(nextStep(steps)).toBeNull()
    for (const id of ['shizuku-start', 'termux']) expect(st(steps, id)).toBe('skip')
    expect(st(steps, 'apps')).toBe('ok')
    expect(st(steps, 'installer')).toBe('ok')
    expect(shouldOpenFlow(steps, { welcomeDone: false, flowDone: false })).toBe(false)
  })
  test('an older app build (no install support, no probe) keeps the old rows', () => {
    const steps = setupSteps(native, 'closed', null, null)
    for (const id of ['apps', 'shizuku-start', 'installer']) expect(st(steps, id)).toBe('skip')
    expect(st(steps, 'termux')).toBe('ok')
  })
  test('Termux:Boot never opened is a recommended gap, not a blocker', () => {
    const steps = setupSteps({ ...allApps, termuxBootStopped: true }, 'open', remote, true, pre())
    expect(st(steps, 'termux-boot')).toBe('bad')
    expect(nextStep(steps)).toBeNull()
  })
})

describe('probeState', () => {
  test('maps the native probe answer', () => {
    expect(probeState({ result: 'denied' }, false)).toBe('denied')
    expect(probeState({ result: 'not-allowed' }, false)).toBe('not-allowed')
    expect(probeState({ result: 'ran', services: false, installed: false, dash: 0 }, false)).toBe('no-services')
    expect(probeState({ result: 'ran', services: true, installed: true, dash: 0 }, false)).toBe('stopped')
    expect(probeState({ result: 'ran', services: true, installed: false, dash: 200 }, true)).toBe('running')
    expect(probeState(null, false)).toBe('unknown')
  })
  test('the supervisor exists mid-install: stopped only when no installer is running (older installs have no marker)', () => {
    expect(probeState({ result: 'ran', services: true, installed: false, dash: 0 }, false)).toBe('stopped')
    expect(probeState({ result: 'ran', services: true, installed: false, dash: 0 }, true)).toBe('no-services')
  })
})

describe('progressView', () => {
  test('every step is listed: done, the current one, those still to come; the latest phone hint and the TODO lines', () => {
    const v = progressView(['STEP packages Termux packages', 'STEP access Access', 'phone: tap Allow', 'STEP android limit', 'android: lifted', 'TODO files: allow', 'STEP debian Debian'])
    expect(v.steps.map(s => [s.id, s.state])).toEqual([['packages', 'ok'], ['access', 'ok'], ['android', 'ok'], ['debian', 'run'], ['hermes', 'todo'], ['plugin', 'todo'], ['start', 'todo']])
    expect(v.hint).toBe('tap Allow')
    expect(v.todo).toEqual(['files: allow'])
    expect(v.fail).toBe('')
  })
  test('FAIL marks the step that stopped; DONE ticks every step', () => {
    const f = progressView(['STEP packages x', 'STEP debian y', 'FAIL debian (line 120)'])
    expect(f.fail).toBe('debian')
    expect(f.steps.find(s => s.id === 'debian')?.state).toBe('bad')
    const d = progressView(['STEP packages x', 'STEP start y', 'DONE'])
    expect(d.done).toBe(true)
    expect(d.steps.every(s => s.state === 'ok')).toBe(true)
  })
})

describe('progressView step times', () => {
  const L = ['STEP packages P', 'STEP access A', 'phone: tap', 'STEP debian D']
  test('finished steps get their own duration, the running one counts up to now, total spans the first STEP to now', () => {
    const v = progressView(L, [1000, 1102, 1110, 1130], 1190)
    expect(v.steps.map(s => [s.id, s.secs])).toEqual([['packages', 102], ['access', 28], ['android', null], ['debian', 60], ['hermes', null], ['plugin', null], ['start', null]])
    expect(v.total).toBe(190)
  })
  test('DONE and FAIL stop the clock (now is ignored afterwards)', () => {
    const d = progressView([...L, 'DONE'], [1000, 1102, 1110, 1130, 1400], 9999)
    expect(d.steps.find(s => s.id === 'debian')?.secs).toBe(270)
    expect(d.total).toBe(400)
    const f = progressView([...L, 'FAIL debian x'], [1000, 1102, 1110, 1130, 1200], 9999)
    expect(f.steps.find(s => s.id === 'debian')?.secs).toBe(70)
    expect(f.total).toBe(200)
  })
  test('a step run again after a FAIL adds its segments', () => {
    const v = progressView(['STEP debian a', 'FAIL debian x', 'STEP debian a'], [100, 160, 500], 530)
    expect(v.steps.find(s => s.id === 'debian')?.secs).toBe(60 + 30)
  })
  test('no times (older app build) or a length mismatch: no durations, nothing breaks', () => {
    for (const t of [undefined, [1, 2]]) {
      const v = progressView(L, t, 5000)
      expect(v.total).toBeNull()
      expect(v.steps.every(s => s.secs === null)).toBe(true)
      expect(v.steps.find(s => s.id === 'debian')?.state).toBe('run')
    }
  })
  test('a clock that went backwards never gives a negative time', () => {
    expect(progressView(['STEP packages P'], [500], 100).steps[0].secs).toBe(0)
  })
})

// The Start Shizuku step re-asks the app whether Shizuku runs, but only while it is on screen (battery).
describe('shizukuWatchActive', () => {
  const base = { visible: true, running: false, startedAt: 1000, now: 1000 + 5000 }
  test('polls while the step is visible and Shizuku is not running yet', () => {
    expect(shizukuWatchActive(base)).toBe(true)
  })
  test('stops when Shizuku is running, when the app is hidden and after 10 minutes', () => {
    expect(shizukuWatchActive({ ...base, running: true })).toBe(false)
    expect(shizukuWatchActive({ ...base, visible: false })).toBe(false)
    expect(shizukuWatchActive({ ...base, now: 1000 + 10 * 60 * 1000 - 1 })).toBe(true)
    expect(shizukuWatchActive({ ...base, now: 1000 + 10 * 60 * 1000 })).toBe(false)
  })
})
