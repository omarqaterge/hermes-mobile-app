// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { nextLabel, scheduledValue } from './panelvalues'

const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).getTime()
const NOW = at(2026, 11, 16, 6, 0) // a Monday

describe('the side panel row values', () => {
  it('names the next run: today by its time, this week by its day, later by its date', () => {
    expect(nextLabel(at(2026, 11, 16, 7, 0), NOW)).toBe('next 07:00')
    expect(nextLabel(at(2026, 11, 23, 9, 5), NOW)).toBe('next 23 Nov 09:05')
    expect(nextLabel(at(2026, 11, 20, 18, 30), NOW)).toBe('next Fri 18:30')
    expect(nextLabel(at(2026, 11, 17, 9, 0), NOW)).toBe('next Tue 09:00')
  })
  it('says None yet with no jobs and Paused when every job is paused', () => {
    expect(scheduledValue([], NOW)).toBe('None yet')
    expect(scheduledValue({ jobs: [] }, NOW)).toBe('None yet')
    expect(scheduledValue([{ paused: true }, { enabled: false }], NOW)).toBe('Paused')
  })
  it('picks the soonest upcoming run of the active jobs, in seconds or milliseconds', () => {
    const t = at(2026, 11, 16, 7, 0)
    expect(scheduledValue([{ next_run_at: at(2026, 11, 17, 7, 0) / 1000 }, { next_run_at: t }, { paused: true, next_run_at: at(2026, 11, 16, 6, 30) }], NOW)).toBe('next 07:00')
    expect(scheduledValue({ jobs: [{ next_run: new Date(t).toISOString() }] }, NOW)).toBe('next 07:00')
  })
  it('leaves the value out when an active job has no next time', () => {
    expect(scheduledValue([{ next_run_at: null }], NOW)).toBeUndefined()
    expect(scheduledValue([{ next_run_at: at(2026, 11, 15, 7, 0) }], NOW)).toBeUndefined()
  })
})
