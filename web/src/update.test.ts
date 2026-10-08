// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { isNewer } from './update'

describe('isNewer', () => {
  it('compares dotted versions numerically', () => {
    expect(isNewer('0.8.22', '0.8.21')).toBe(true)
    expect(isNewer('0.8.9', '0.8.21')).toBe(false)
    expect(isNewer('v0.9.0', '0.8.21')).toBe(true)
    expect(isNewer('0.8.21', '0.8.21')).toBe(false)
    expect(isNewer('1.0', '0.9.9')).toBe(true)
  })
})
