import { describe, expect, it } from 'vitest'
import { frameDoc, frameHeight } from './htmlframe'

describe('frameDoc', () => {
  it('puts the guard first, after the doctype when there is one', () => {
    const d = frameDoc('<!DOCTYPE html><h1>x</h1><script>1</script>', false)
    expect(d.startsWith('<!DOCTYPE html><meta name="viewport"')).toBe(true)
    expect(d.indexOf('delete window.HermesAndroid')).toBeLessThan(d.indexOf('<h1>'))
    expect(d.indexOf('delete window.HermesAndroid')).toBeLessThan(d.indexOf('<script>1'))
  })
  it('adds a doctype and the guard at the start without one', () => {
    const d = frameDoc('<p>hi</p>', true)
    expect(d.startsWith('<!doctype html><meta name="viewport"')).toBe(true)
    expect(d.indexOf('HermesAndroid')).toBeLessThan(d.indexOf('<p>hi'))
  })
  it('has the offline CSP only when network is off', () => {
    expect(frameDoc('<p>a</p>', false)).toContain("default-src 'none'")
    expect(frameDoc('<p>a</p>', false)).toContain("form-action 'none'")
    expect(frameDoc('<p>a</p>', true)).not.toContain('Content-Security-Policy')
  })
  it('reports the height only with autoHeight', () => {
    expect(frameDoc('<p>a</p>', false)).not.toContain('hmFrameHeight')
    expect(frameDoc('<p>a</p>', false, true)).toContain('hmFrameHeight')
    const d = frameDoc('<!doctype html><p>a</p>', false, true)
    expect(d.indexOf('hmFrameHeight')).toBeLessThan(d.indexOf('<p>a'))
  })
})

describe('frameHeight', () => {
  it('clamps to min and max', () => {
    expect(frameHeight(50, 160, 400)).toBe(160)
    expect(frameHeight(300.2, 160, 400)).toBe(301)
    expect(frameHeight(9000, 160, 400)).toBe(400)
  })
  it('ignores anything that is not a finite number', () => {
    for (const v of ['300', NaN, Infinity, null, undefined, {}]) expect(frameHeight(v, 160, 400)).toBeNull()
  })
})
