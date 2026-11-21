import { describe, expect, it } from 'vitest'
import { lastFailed, lastRunWords, nextRunWords, whenWords } from './jobwords'

const now = new Date(2026, 10, 21, 12, 0)
const at = (d: number, h: number) => new Date(2026, 10, 21 + d, h, 0).getTime() / 1000

describe('Scheduled job words', () => {
  it('says today, tomorrow and yesterday, else the date', () => {
    expect(whenWords(at(0, 15), now)).toMatch(/^today /)
    expect(whenWords(at(1, 9), now)).toMatch(/^tomorrow /)
    expect(whenWords(at(-1, 9), now)).toMatch(/^yesterday /)
    expect(whenWords(at(5, 9), now)).not.toMatch(/^(today|tomorrow|yesterday)/)
    expect(whenWords(null, now)).toBe('')
  })
  it('leads with the next run, or says it is paused or has none', () => {
    expect(nextRunWords({ next_run_at: new Date(Date.now() + 60_000).toISOString() })).toMatch(/^Next run /)
    expect(nextRunWords({ next_run_at: null })).toBe('No next run planned')
    expect(nextRunWords({ paused: true, next_run_at: 1 })).toMatch(/^Paused/)
    expect(nextRunWords({ state: 'paused' })).toMatch(/^Paused/)
  })
  it('says how the last run ended, in words', () => {
    expect(lastRunWords({})).toBe('Hasn’t run yet')
    expect(lastRunWords({ last_run_at: Date.now(), last_status: 'ok' })).toMatch(/^Last ran today .*: it worked$/)
    expect(lastRunWords({ last_run: Date.now(), last_status: 'error' })).toMatch(/: it failed$/)
    expect(lastRunWords({ last_run_at: Date.now(), last_status: 'cancelled_by_user' })).toMatch(/: cancelled by user$/)
    expect(lastFailed({ last_status: 'failed' })).toBe(true)
    expect(lastFailed({ last_status: 'ok' })).toBe(false)
  })
})
