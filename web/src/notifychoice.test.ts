// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { NOTIFY_CHANGED, notifyChoicesAvailable, notifySummary, readNotifyState, setNotifyChoice } from './notifychoice'

const w = window as unknown as { HermesAndroid?: unknown }
afterEach(() => delete w.HermesAndroid)

describe('notifychoice', () => {
  it('reads the shell’s state, both on when it gives nothing readable', () => {
    expect(notifyChoicesAvailable()).toBe(false)
    expect(readNotifyState()).toEqual({ finishes: true, needsMe: true, allowed: true, canAsk: false })
    w.HermesAndroid = { notifyChoices: () => '' }
    expect(readNotifyState().needsMe).toBe(true)
    w.HermesAndroid = { notifyChoices: () => '{not json' }
    expect(readNotifyState().finishes).toBe(true)
    w.HermesAndroid = { notifyChoices: () => JSON.stringify({ finishes: false, needsMe: false, allowed: false, canAsk: true }) }
    expect(notifyChoicesAvailable()).toBe(true)
    expect(readNotifyState()).toEqual({ finishes: false, needsMe: false, allowed: false, canAsk: true })
  })
  it('sends exactly "true" or "false" and reports what the shell answered', () => {
    const sent: unknown[] = []
    w.HermesAndroid = { setNotifyChoice: (which: string, value: string) => (sent.push([which, value]), which !== 'refused') }
    expect(setNotifyChoice('needsMe', false)).toBe(true)
    expect(setNotifyChoice('finishes', true)).toBe(true)
    expect(sent).toEqual([['needsMe', 'false'], ['finishes', 'true']])
    w.HermesAndroid = { setNotifyChoice: () => false }
    expect(setNotifyChoice('needsMe', true)).toBe(false)
    delete w.HermesAndroid
    expect(setNotifyChoice('needsMe', true)).toBe(false)
  })
  it('names the state on the main page', () => {
    const s = { finishes: true, needsMe: true, allowed: true, canAsk: false }
    expect(notifySummary(s)).toBe('On')
    expect(notifySummary({ ...s, finishes: false })).toBe('Only when needed')
    expect(notifySummary({ ...s, needsMe: false })).toBe('Only finished tasks')
    expect(notifySummary({ ...s, finishes: false, needsMe: false })).toBe('Off')
    expect(notifySummary({ ...s, allowed: false })).toBe('Off in Android')
  })
  it('Android’s answer to the permission dialog reaches the page as an event', () => {
    let n = 0
    window.addEventListener(NOTIFY_CHANGED, () => n++)
    window.hermesNotifyChanged?.()
    expect(n).toBe(1)
  })
})
