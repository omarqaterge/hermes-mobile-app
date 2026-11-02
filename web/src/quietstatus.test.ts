import { describe, expect, it } from 'vitest'
import { quietStatus } from './quietstatus'

describe('quietStatus', () => {
  it('hides a title that failed because the provider is busy, with or without the warning sign', () => {
    expect(quietStatus('⚠ Auxiliary title generation failed: HTTP 429: This request would exceed your rate limit')).toBe(true)
    expect(quietStatus('⚠️ Auxiliary title generation failed: timed out')).toBe(true)
    expect(quietStatus('Auxiliary title generation failed: HTTP 503')).toBe(true)
  })
  it('keeps every other status line', () => {
    expect(quietStatus('⚠ Auxiliary compression failed: HTTP 429')).toBe(false)
    expect(quietStatus('⚠ Auxiliary title generation failed: HTTP 402: insufficient credits')).toBe(false)
    expect(quietStatus('⚠ Auxiliary title generation failed: model not found')).toBe(false)
    expect(quietStatus('Subagent Task Completed: Count to three')).toBe(false)
    expect(quietStatus('Rate limited, retrying in 5s')).toBe(false)
    expect(quietStatus('')).toBe(false)
  })
})
