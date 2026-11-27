import { describe, expect, it } from 'vitest'
import { jobEditSchedule, parseSchedule, scheduleMismatch } from './schedule'

const NOW = new Date(2026, 10, 23, 19, 28, 0) // 23 Nov 2026 19:28 local

describe('parseSchedule', () => {
  it('rejects nonsense like "whenever" and unsupported natural phrases like "tomorrow 9am"', () => {
    expect(parseSchedule('whenever', NOW).ok).toBe(false)
    expect(parseSchedule('tomorrow 9am', NOW).ok).toBe(false)
    expect(parseSchedule('', NOW).ok).toBe(false)
    expect(parseSchedule('   ', NOW).ok).toBe(false)
    expect(parseSchedule('every 0m', NOW).ok).toBe(false)
    expect(parseSchedule('in 0m', NOW).ok).toBe(false)
    expect(parseSchedule('every monday', NOW).ok).toBe(false)
    expect(parseSchedule('weekdays', NOW).ok).toBe(false)
  })

  it('accepts bare-unit durations like "every day" and "every hour" just like Hermes', () => {
    const d = parseSchedule('every day', NOW)
    expect(d.ok).toBe(true)
    if (d.ok) {
      expect(d.kind).toBe('interval')
      expect(d.minutes).toBe(1440)
    }
    const h = parseSchedule('every hour', NOW)
    expect(h.ok).toBe(true)
    if (h.ok) {
      expect(h.kind).toBe('interval')
      expect(h.minutes).toBe(60)
    }
  })

  it('accepts intervals and computes expected next run', () => {
    const a = parseSchedule('every 30m', NOW)
    expect(a.ok).toBe(true)
    if (a.ok) {
      expect(a.kind).toBe('interval')
      expect(a.minutes).toBe(30)
      expect(a.nextRun?.getTime()).toBe(NOW.getTime() + 30 * 60_000)
      expect(a.summary).toContain('Every 30 minutes')
    }
    const b = parseSchedule('every 2h', NOW)
    expect(b.ok).toBe(true)
    if (b.ok) {
      expect(b.kind).toBe('interval')
      expect(b.minutes).toBe(120)
      expect(b.summary).toContain('Every 2 hours')
    }
    const c = parseSchedule('45m', NOW)
    expect(c.ok).toBe(true)
    if (c.ok) {
      expect(c.kind).toBe('interval')
      expect(c.minutes).toBe(45)
    }
  })

  it('accepts one-shot delays and future ISO timestamps, and rejects past/impossible dates', () => {
    const delay = parseSchedule('in 30m', NOW)
    expect(delay.ok).toBe(true)
    if (delay.ok) {
      expect(delay.kind).toBe('once')
      expect(delay.minutes).toBe(30)
      expect(delay.summary).toContain('Once, in 30 minutes')
    }
    const iso = parseSchedule('2027-01-01T03:00:00', NOW)
    expect(iso.ok).toBe(true)
    if (iso.ok) {
      expect(iso.kind).toBe('once')
      expect(iso.nextRun?.getFullYear()).toBe(2027)
      expect(iso.nextRun?.getMonth()).toBe(0)
      expect(iso.nextRun?.getDate()).toBe(1)
      expect(iso.nextRun?.getHours()).toBe(3)
    }
    expect(parseSchedule('2020-01-01T03:00:00', NOW).ok).toBe(false)
    expect(parseSchedule('2027-02-30T03:00:00', NOW).ok).toBe(false)
    // Date-only with timezone offset/Z is rejected: Python datetime.fromisoformat does not interpret it as UTC/offset midnight.
    expect(parseSchedule('2027-01-01+02:00', NOW).ok).toBe(false)
    expect(parseSchedule('2027-01-01Z', NOW).ok).toBe(false)
    // Date-only without offset and full timestamp with offset/Z stay valid.
    expect(parseSchedule('2027-01-01', NOW).ok).toBe(true)
    expect(parseSchedule('2027-01-01T03:00:00Z', NOW).ok).toBe(true)
    expect(parseSchedule('2027-01-01T03:00:00+02:00', NOW).ok).toBe(true)
  })

  it('parses cron expressions including 0 3 1 1 * and rejects invalid fields or impossible dates', () => {
    const jan1 = parseSchedule('0 3 1 1 *', NOW)
    expect(jan1.ok).toBe(true)
    if (jan1.ok) {
      expect(jan1.kind).toBe('cron')
      expect(jan1.expr).toBe('0 3 1 1 *')
      expect(jan1.nextRun?.getFullYear()).toBe(2027)
      expect(jan1.nextRun?.getMonth()).toBe(0)
      expect(jan1.nextRun?.getDate()).toBe(1)
      expect(jan1.nextRun?.getHours()).toBe(3)
      expect(jan1.nextRun?.getMinutes()).toBe(0)
    }
    const weekdays = parseSchedule('0 8 * * 1-5', NOW)
    expect(weekdays.ok).toBe(true)
    if (weekdays.ok) expect(weekdays.summary).toContain('Weekdays at 08:00')

    const natural = parseSchedule('every monday 9am', NOW)
    expect(natural.ok).toBe(true)
    if (natural.ok) {
      expect(natural.kind).toBe('cron')
      expect(natural.expr).toBe('0 9 * * 1')
    }

    // Day-of-week 7 (Sunday) parity with Python croniter: valid ranges/steps wrap 7 -> 0,
    // while 7-5, 7-7 and 7/2 are rejected instead of disagreeing with croniter.
    const sun7 = parseSchedule('0 9 * * 7', NOW)
    expect(sun7.ok).toBe(true)
    if (sun7.ok) expect(sun7.nextRun?.getDay()).toBe(0)
    const friSun = parseSchedule('0 9 * * 5-7', NOW)
    expect(friSun.ok).toBe(true)
    if (friSun.ok) expect(friSun.nextRun?.getDay()).toBe(5) // NOW is Mon -> next Fri
    const stepFriSun = parseSchedule('0 9 * * 5-7/2', NOW)
    expect(stepFriSun.ok).toBe(true)
    if (stepFriSun.ok) expect(stepFriSun.summary).toContain('Every Sun, Fri at 09:00')
    expect(parseSchedule('0 9 * * 7-5', NOW).ok).toBe(false)
    expect(parseSchedule('0 9 * * 7-7', NOW).ok).toBe(false)
    expect(parseSchedule('0 9 * * 7/2', NOW).ok).toBe(false)

    expect(parseSchedule('60 9 * * *', NOW).ok).toBe(false)
    expect(parseSchedule('0 25 * * *', NOW).ok).toBe(false)
    expect(parseSchedule('0 9 32 * *', NOW).ok).toBe(false)
    expect(parseSchedule('0 9 * 13 *', NOW).ok).toBe(false)
    expect(parseSchedule('0 9 31 2 *', NOW).ok).toBe(false)
    expect(parseSchedule('0 9 31 4 *', NOW).ok).toBe(false)
    expect(parseSchedule('every single morning around nine please', NOW).ok).toBe(false)
  })
})

describe('jobEditSchedule', () => {
  it('prefers parseable structured fields over Hermes human-prose display strings', () => {
    expect(
      jobEditSchedule(
        { schedule: { kind: 'once', display: 'once in 30m', run_at: '2027-01-01T09:00:00Z' } },
        NOW
      )
    ).toBe('2027-01-01T09:00:00Z')
    expect(
      jobEditSchedule(
        { schedule: { kind: 'once', display: 'once in 30m' }, next_run_at: '2027-01-01T09:00:00Z' },
        NOW
      )
    ).toBe('2027-01-01T09:00:00Z')
    expect(
      jobEditSchedule(
        { schedule: { kind: 'cron', display: 'Every day at 9am', expr: '0 9 * * *' } },
        NOW
      )
    ).toBe('0 9 * * *')
    expect(
      jobEditSchedule(
        { schedule: { kind: 'interval', display: 'every 2 hours', minutes: 120 } },
        NOW
      )
    ).toBe('every 2h')
  })
})

describe('scheduleMismatch', () => {
  it('catches when Hermes returns an interval for a cron request or a wildly wrong next_run_at', () => {
    const req = parseSchedule('0 3 1 1 *', NOW)
    expect(req.ok).toBe(true)
    if (!req.ok) return
    expect(scheduleMismatch(req, { schedule: { kind: 'interval', minutes: 30, display: 'every 30m' } }, { isNew: true, now: NOW })).toBeTruthy()
    expect(scheduleMismatch(req, { schedule: 'every 30m' }, { isNew: true, now: NOW })).toBeTruthy()
    expect(
      scheduleMismatch(
        req,
        { schedule: { kind: 'cron', expr: '0 3 1 1 *' }, next_run_at: new Date(NOW.getTime() + 30 * 60_000).toISOString() },
        { isNew: true, now: NOW }
      )
    ).toBeTruthy()
    expect(
      scheduleMismatch(
        req,
        { schedule: { kind: 'cron', expr: '0 3 1 1 *' }, next_run_at: new Date(2027, 0, 1, 3, 0, 0).toISOString() },
        { isNew: true, now: NOW }
      )
    ).toBeNull()
  })

  it('catches one-shot run_at mismatch and schedule-changing edit next_run_at mismatch even with prior last_run_at', () => {
    const onceReq = parseSchedule('2027-01-01T09:00:00Z', NOW)
    expect(onceReq.ok).toBe(true)
    if (!onceReq.ok) return
    expect(
      scheduleMismatch(
        onceReq,
        { schedule: { kind: 'once', run_at: new Date(NOW.getTime() + 30 * 60_000).toISOString() } },
        { checkNextRun: false, now: NOW }
      )
    ).toBeTruthy()
    expect(
      scheduleMismatch(
        onceReq,
        { schedule: { kind: 'once', run_at: '2027-01-01T09:00:00Z' } },
        { checkNextRun: false, now: NOW }
      )
    ).toBeNull()

    const editReq = parseSchedule('0 3 1 1 *', NOW)
    expect(editReq.ok).toBe(true)
    if (!editReq.ok) return
    // Prior last_run_at must not suppress next_run_at verification when checkNextRun is true (schedule changed on edit).
    expect(
      scheduleMismatch(
        editReq,
        {
          schedule: { kind: 'cron', expr: '0 3 1 1 *' },
          last_run_at: new Date(NOW.getTime() - 3600_000).toISOString(),
          next_run_at: new Date(NOW.getTime() + 30 * 60_000).toISOString()
        },
        { checkNextRun: true, now: NOW }
      )
    ).toBeTruthy()
  })

  it('ignores minimal responses without schedule fields (e.g. older mocks)', () => {
    const req = parseSchedule('0 9 * * *', NOW)
    if (!req.ok) return
    expect(scheduleMismatch(req, { ok: true }, { isNew: true, now: NOW })).toBeNull()
  })
})
