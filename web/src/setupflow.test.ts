import { describe, expect, test } from 'vitest'
import type { NativeSetup } from './bridge'
import { nextStep, recommendedGaps, setupSteps, shouldOpenFlow, type Remote } from './setupflow'

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
  test('Autostart is an info row on Xiaomi-family phones only', () => {
    for (const maker of ['xiaomi', 'redmi', 'poco']) expect(st(setupSteps({ ...native, maker }, 'open', remote, true), 'autostart')).toBe('info')
    expect(st(setupSteps(native, 'open', remote, true), 'autostart')).toBe('skip')
    expect(recommendedGaps(setupSteps({ ...native, maker: 'xiaomi' }, 'open', remote, true))).toEqual([])
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
  test('plugin not installed on a first run → opens', () => {
    expect(shouldOpenFlow(setupSteps(native, 'open', { ...remote, plugin: false }, true), none)).toBe(true)
  })
})
