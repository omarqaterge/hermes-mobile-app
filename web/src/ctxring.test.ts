import { describe, expect, it } from 'vitest'
import { ctxLevel, fmtCost, ringDash } from './ctxring'

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
})
