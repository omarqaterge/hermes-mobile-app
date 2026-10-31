import { describe, expect, it } from 'vitest'
import { effortLevel } from './effort'

describe('effortLevel', () => {
  it('maps the known levels', () => {
    expect(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].map(effortLevel)).toEqual([0, 1, 2, 3, 4, 5])
  })
  it('ignores case and spaces', () => {
    expect(effortLevel(' High ')).toBe(4)
  })
  it('returns null for unknown levels', () => {
    expect(effortLevel('turbo')).toBeNull()
    expect(effortLevel('')).toBeNull()
  })
})
