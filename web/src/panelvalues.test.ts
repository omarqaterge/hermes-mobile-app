// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { cronJobId, namesOf, nextLabel, runName, scheduledValue } from './panelvalues'

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

describe('scheduled runs in the chat list', () => {
  it('reads the job a run chat names', () => {
    expect(cronJobId('cron_3f9a2b1c4d5e_20261117_090000')).toBe('3f9a2b1c4d5e')
    expect(cronJobId('cron_my_job_20261117_090000')).toBe('my_job')
    expect(cronJobId('local-1a2b')).toBeNull()
    expect(cronJobId('s-9')).toBeNull()
  })
  it('takes the job names from the jobs list', () => {
    expect(namesOf([{ id: 'j1', name: ' Morning brief ' }, { id: 'j2' }, { name: 'no id' }])).toEqual({ j1: 'Morning brief' })
    expect(namesOf({ jobs: [{ id: 7, name: 'Weekly' }] })).toEqual({ '7': 'Weekly' })
  })
  it('shows the job name, else the start of the run title, else Scheduled', () => {
    expect(runName({ title: 'Morning brief · Nov 17 09:00' }, 'Morning brief (renamed)')).toBe('Morning brief (renamed)')
    expect(runName({ title: 'Morning brief · Nov 17 09:00' })).toBe('Morning brief')
    expect(runName({ title: 'A · B · Nov 17 09:00' })).toBe('A · B')
    expect(runName({ title: '' })).toBe('Scheduled')
    expect(runName({})).toBe('Scheduled')
    expect(runName({ title: 'No date here' })).toBe('Scheduled')
  })
})
