// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { OFF_STATE, formatLeft, parseRemoteDebug, remoteDebugRow, remoteDebugStrip } from './remotedebug'

describe('remote debugging row', () => {
  it('parses the shell state', () => {
    expect(parseRemoteDebug('{"available":true,"on":true,"minutesLeft":42}')).toEqual({ available: true, on: true, minutesLeft: 42, secondsLeft: 2520 })
    expect(parseRemoteDebug('{"available":true,"on":true,"minutesLeft":42,"secondsLeft":2461}')).toEqual({ available: true, on: true, minutesLeft: 42, secondsLeft: 2461 })
    expect(parseRemoteDebug('{"available":true,"on":false,"minutesLeft":0}')).toEqual({ available: true, on: false, minutesLeft: 0, secondsLeft: 0 })
  })
  it('treats anything odd as not available', () => {
    expect(parseRemoteDebug('')).toEqual(OFF_STATE)
    expect(parseRemoteDebug('nope')).toEqual(OFF_STATE)
    expect(parseRemoteDebug('{"available":"yes","on":true}')).toEqual(OFF_STATE)
  })
  it('never reports on when not available, and clamps the minutes', () => {
    expect(parseRemoteDebug('{"available":false,"on":true,"minutesLeft":5}').on).toBe(false)
    expect(parseRemoteDebug('{"available":true,"on":true,"minutesLeft":9999}').minutesLeft).toBe(60)
    expect(parseRemoteDebug('{"available":true,"on":true,"minutesLeft":-3}').minutesLeft).toBe(0)
  })
  it('hides the row when unavailable', () => {
    expect(remoteDebugRow(OFF_STATE)).toBeNull()
  })
  it('Off opens the native confirmation; On turns off', () => {
    expect(remoteDebugRow({ available: true, on: false, minutesLeft: 0, secondsLeft: 0 })).toEqual({ sub: 'Off', action: 'open' })
    expect(remoteDebugRow({ available: true, on: true, minutesLeft: 42, secondsLeft: 2520 })).toEqual({ sub: 'On · 42:00 left', action: 'off' })
  })
  it('the strip text only while on', () => {
    expect(remoteDebugStrip({ available: true, on: false, minutesLeft: 0, secondsLeft: 0 })).toBeNull()
    expect(remoteDebugStrip({ available: true, on: true, minutesLeft: 7, secondsLeft: 425 })).toBe('Remote debugging is on · 7:05 left')
  })
  it('formats the countdown as m:ss', () => {
    expect(formatLeft(2520)).toBe('42:00')
    expect(formatLeft(59)).toBe('0:59')
    expect(formatLeft(-4)).toBe('0:00')
  })
})
