// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { compat, parseBuild } from './hermes-update'

const T = '0.21.5+4582.gb8a8be1'

describe('hermes build compatibility', () => {
  it('parses a git-describe version', () => {
    expect(parseBuild('0.21.5+4582.gb8a8be1')).toEqual({ count: 4582, sha: 'b8a8be1' })
    expect(parseBuild('0.21.5')).toBeNull()
  })
  it('same build, newer, older, unknown', () => {
    expect(compat('0.21.5+4582.gb8a8be1', T)).toBe('same')
    expect(compat('0.21.5+4582.gb8a8be185.dirty', T)).toBe('same')
    expect(compat('0.22.0+9311.g1234567', T)).toBe('newer')
    expect(compat('0.20.1+100.gabcdef0', T)).toBe('older')
    expect(compat('0.21.5', T)).toBe('unknown')
    expect(compat('', T)).toBe('unknown')
  })
})
