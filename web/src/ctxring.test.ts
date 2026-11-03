import { describe, expect, it } from 'vitest'
import { ctxFromStatText, ctxLevel, fmtCost, ringDash, stripCtxStat } from './ctxring'

describe('ctxring', () => {
  it('levels switch at 80 and 90', () => {
    expect(ctxLevel(79.9)).toBe('ok')
    expect(ctxLevel(80)).toBe('warn')
    expect(ctxLevel(89.9)).toBe('warn')
    expect(ctxLevel(90)).toBe('full')
  })
  it('ringDash clamps and measures', () => {
    const c = 2 * Math.PI * 7
    expect(ringDash(0, 7).dashoffset).toBeCloseTo(c)
    expect(ringDash(100, 7).dashoffset).toBeCloseTo(0)
    expect(ringDash(50, 7).dashoffset).toBeCloseTo(c / 2)
    expect(ringDash(150, 7).dashoffset).toBeCloseTo(0)
    expect(ringDash(-5, 7).dashoffset).toBeCloseTo(c)
    expect(ringDash(NaN, 7).dashoffset).toBeCloseTo(c)
    expect(ringDash(10, 7).dasharray).toBeCloseTo(c)
  })
  it('formats cost', () => {
    expect(fmtCost(0.0123)).toBe('$0.0123')
    expect(fmtCost(2.5)).toBe('$2.50')
  })
  it('reads the context part of old reply stats', () => {
    expect(ctxFromStatText('58 tok/s · ctx 5% · 47k/1M')).toEqual({ used: 47000, max: 1e6, percent: 5 })
    expect(ctxFromStatText('ctx <1% · 900/200k')).toEqual({ used: 900, max: 200000, percent: 0.5 })
    expect(ctxFromStatText('~41 tok/s · 1m 23s')).toBeNull()
    expect(ctxFromStatText('ctx 5% · 0/0')).toBeNull()
  })
  it('strips the context part from old reply stats', () => {
    expect(stripCtxStat('58 tok/s · 1m 2s · ctx 5% · 47k/1M')).toBe('58 tok/s · 1m 2s')
    expect(stripCtxStat('ctx 5% · 47k/1M')).toBe('')
    expect(stripCtxStat('~41 tok/s')).toBe('~41 tok/s')
  })
})
