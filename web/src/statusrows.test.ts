import { describe, expect, it } from 'vitest'
import { shizukuRow } from './statusrows'

const run = { shizuku: true, shizukuRunning: true }
describe('shizukuRow', () => {
  it('running and usable', () => expect(shizukuRow(run, 'ok')).toMatchObject({ value: 'Running', state: 'ok', fix: null }))
  it('not installed', () => expect(shizukuRow({ shizuku: false }, 'ok')).toMatchObject({ value: 'Not installed', state: 'wait', fix: 'setup' }))
  it('not running (native wins)', () => expect(shizukuRow({ shizuku: true, shizukuRunning: false }, 'ok')).toMatchObject({ value: 'Not running', state: 'err', fix: 'open-shizuku' }))
  it('plugin states are problems', () => {
    expect(shizukuRow(run, 'denied')).toMatchObject({ value: 'Termux not allowed', state: 'err' })
    expect(shizukuRow(run, 'blocked')).toMatchObject({ value: 'Not answering', state: 'err' })
    expect(shizukuRow(run, 'missing')).toMatchObject({ value: 'Not set up for Hermes', state: 'err' })
    expect(shizukuRow({ shizuku: true }, 'off')).toMatchObject({ value: 'Not running', state: 'err' })
  })
  it('the app sees Shizuku running but Termux can not reach it: Termux not allowed, not "Not running"', () =>
    expect(shizukuRow(run, 'off')).toMatchObject({ value: 'Termux not allowed', state: 'err', fix: 'open-shizuku' }))
  it('says whether Shizuku restarts by itself, only when the app reports it', () => {
    const a = { sdk: true, wss: true, paired: true, last: 'ok' }
    expect(shizukuRow({ ...run, shizukuAuto: a }, 'ok')).toMatchObject({ value: 'Running', note: 'Restarts by itself' })
    expect(shizukuRow({ ...run, shizukuAuto: { ...a, paired: false } }, 'ok')).toMatchObject({ note: 'Start it by hand after a restart' })
    expect(shizukuRow({ ...run, shizukuAuto: { ...a, wss: false } }, 'ok')).toMatchObject({ note: 'Start it by hand after a restart' })
    expect(shizukuRow({ ...run, shizukuAuto: { ...a, sdk: false } }, 'ok')).toMatchObject({ note: 'Start it by hand after a restart' })
    expect(shizukuRow(run, 'ok')).toMatchObject({ note: null })
  })
  it('checking while the plugin has not answered', () => expect(shizukuRow(run, undefined)).toMatchObject({ value: 'Checking…', state: 'wait' }))
  it('unknown native + plugin ok still shows', () => expect(shizukuRow(null, 'ok')).toMatchObject({ value: 'Running' }))
  it('unknown native, no plugin answer: hidden', () => {
    expect(shizukuRow(null, undefined)).toBeNull()
    expect(shizukuRow(null, null)).toBeNull()
  })
})
