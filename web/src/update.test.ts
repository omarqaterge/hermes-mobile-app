// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { isNewer } from './update'
import { isDevtoolsBuild } from './bridge'

describe('test builds (+devtools)', () => {
  it('detects the suffix only', () => {
    expect(isDevtoolsBuild('0.8.66+devtools')).toBe(true)
    expect(isDevtoolsBuild('0.8.66-test+devtools')).toBe(true)
    expect(isDevtoolsBuild('0.8.66')).toBe(false)
    expect(isDevtoolsBuild('web-dev')).toBe(false)
    expect(isDevtoolsBuild('')).toBe(false)
  })
  it('the suffix does not change the update comparison', () => {
    expect(isNewer('0.8.67', '0.8.66+devtools')).toBe(true)
    expect(isNewer('0.8.66', '0.8.66+devtools')).toBe(false)
  })
})

describe('isNewer', () => {
  it('compares dotted versions numerically', () => {
    expect(isNewer('0.8.22', '0.8.21')).toBe(true)
    expect(isNewer('0.8.9', '0.8.21')).toBe(false)
    expect(isNewer('v0.9.0', '0.8.21')).toBe(true)
    expect(isNewer('0.8.21', '0.8.21')).toBe(false)
    expect(isNewer('1.0', '0.9.9')).toBe(true)
  })
})
