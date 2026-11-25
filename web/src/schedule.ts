// Client-side validation, plain-words summary and response verification for scheduled jobs (CronScreen, spec 3.14).
// Mirrors Hermes's `cron/jobs.py` `parse_schedule()` grammar so invalid text like "whenever" is refused before saving
// and a job can never silently land on a different time than the user asked for.
import { type Job, whenWords } from './jobwords'

export type ScheduleKind = 'interval' | 'cron' | 'once'

export interface ValidSchedule {
  ok: true
  kind: ScheduleKind
  /** Canonical input sent to Hermes (trimmed). */
  raw: string
  /** Minutes, for interval and `in <duration>` one-shots. */
  minutes?: number
  /** Normalized 5-field cron expression, for cron and weekday/daily phrases. */
  expr?: string
  /** Expected next run in local time, when computable. */
  nextRun?: Date
  /** Explicit ISO timestamp vs relative `in <duration>` one-shot. */
  relative?: boolean
  /** Plain-English summary shown above the Schedule / Save button. */
  summary: string
}

export interface InvalidSchedule {
  ok: false
  error: string
}

export type ScheduleCheck = ValidSchedule | InvalidSchedule

const DURATION_MULT: Record<string, number> = { m: 1, h: 60, d: 1440 }
const MAX_INTERVAL_MINUTES = 365 * 1440 * 10 // 10 years
const ONESHOT_GRACE_MS = 120_000 // matches Hermes cron/jobs.py ONESHOT_GRACE_SECONDS

const WEEKDAY_TO_DOW: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6
}

const DAYSPEC_TO_DOW: Record<string, string> = {
  day: '*', daily: '*', everyday: '*',
  weekday: '1-5', weekdays: '1-5',
  weekend: '0,6', weekends: '0,6'
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
}
const DOW_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6
}
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_MAX_DAYS = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const pad2 = (n: number) => String(n).padStart(2, '0')
const fmtHM = (h: number, m: number) => `${pad2(h)}:${pad2(m)}`

function parseDuration(s: string): number | null {
  const m = /^(\d*)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i.exec(s.trim())
  if (!m) return null
  const val = m[1] ? Number(m[1]) : 1
  if (!Number.isSafeInteger(val) || val <= 0) return null
  const mins = val * DURATION_MULT[m[2][0].toLowerCase()]
  return mins > 0 && mins <= MAX_INTERVAL_MINUTES ? mins : null
}

function fmtDuration(minutes: number): string {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440
    return d === 1 ? 'day' : `${d} days`
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60
    return h === 1 ? 'hour' : `${h} hours`
  }
  return minutes === 1 ? 'minute' : `${minutes} minutes`
}

function parseClockTime(text: string): [number, number] | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '')
  if (!t) return null
  if (t === 'noon' || t === 'midday') return [12, 0]
  if (t === 'midnight') return [0, 0]
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(t)
  if (!m) return null
  let hour = Number(m[1])
  const minute = m[2] ? Number(m[2]) : 0
  const mer = m[3]
  if (mer) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (mer === 'pm' ? 12 : 0)
  }
  if (hour > 23 || minute > 59) return null
  return [hour, minute]
}

function naturalEveryToCron(rest: string): string | null {
  const tokens = rest.toLowerCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean)
  if (!tokens.length) return null
  let dow = DAYSPEC_TO_DOW[tokens[0]]
  let idx = 1
  if (!dow) {
    const days: number[] = []
    idx = tokens.length
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]
      if (tok === 'and') continue
      const mapped = WEEKDAY_TO_DOW[tok]
      if (mapped === undefined) {
        idx = i
        break
      }
      if (!days.includes(mapped)) days.push(mapped)
    }
    if (!days.length) return null
    dow = days.join(',')
  }
  let timeTokens = tokens.slice(idx)
  if (timeTokens[0] === 'at') timeTokens = timeTokens.slice(1)
  if (!timeTokens.length) return null
  const parsed = parseClockTime(timeTokens.join(' '))
  if (!parsed) return null
  return `${parsed[1]} ${parsed[0]} * * ${dow}`
}

interface CronFields {
  minutes: Set<number>
  hours: Set<number>
  doms: Set<number>
  months: Set<number>
  dows: Set<number>
  domWild: boolean
  dowWild: boolean
}

function parseCronField(raw: string, min: number, max: number, names?: Record<string, number>, wrap7 = false): Set<number> | null {
  if (!raw || !/^[A-Za-z\d*,-/]+$/.test(raw)) return null
  const out = new Set<number>()
  const add = (v: number) => out.add(wrap7 && v === 7 ? 0 : v)
  const parseAtom = (tok: string): number | null => {
    const low = tok.toLowerCase()
    if (names && low in names) return names[low]
    if (!/^\d+$/.test(tok)) return null
    const n = Number(tok)
    if (n < min || n > max) return null
    return n
  }
  for (const part of raw.split(',')) {
    if (!part) return null
    const stepParts = part.split('/')
    if (stepParts.length > 2) return null
    const step = stepParts.length === 2 ? Number(stepParts[1]) : 1
    if (stepParts.length === 2 && (!/^\d+$/.test(stepParts[1]) || step <= 0 || step > max - min + 1)) return null
    const range = stepParts[0]
    if (range === '*') {
      for (let v = min; v <= (wrap7 ? 6 : max); v += step) add(v)
      continue
    }
    const bounds = range.split('-')
    if (bounds.length === 1) {
      const start = parseAtom(bounds[0])
      if (start === null) return null
      if (stepParts.length === 2) {
        const hi = wrap7 ? 6 : max
        // Reject 7/step on day-of-week: croniter rewrites it to 0/step instead of Sunday only.
        if (start > hi) return null
        for (let v = start; v <= hi; v += step) add(v)
      } else add(start)
      continue
    }
    if (bounds.length === 2) {
      const a = parseAtom(bounds[0])
      const b = parseAtom(bounds[1])
      // Reject inverted ranges (7-5) and 7-7 (croniter evaluates 7-7 as all 7 days).
      if (a === null || b === null || a > b || (wrap7 && a === 7)) return null
      for (let v = a; v <= b; v += step) add(v)
      continue
    }
    return null
  }
  return out.size ? out : null
}

function parseCronExpr(expr: string): CronFields | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const minutes = parseCronField(parts[0], 0, 59)
  const hours = parseCronField(parts[1], 0, 23)
  const doms = parseCronField(parts[2], 1, 31)
  const months = parseCronField(parts[3], 1, 12, MONTH_NAMES)
  const dows = parseCronField(parts[4], 0, 7, DOW_NAMES, true)
  if (!minutes || !hours || !doms || !months || !dows) return null
  // Reject impossible calendar combinations like Feb 30/31 or Apr 31 when both month and dom are constrained.
  const domWild = parts[2] === '*'
  const dowWild = parts[4] === '*'
  if (!domWild && dowWild) {
    let possible = false
    for (const mo of months) {
      for (const d of doms) {
        if (d <= MONTH_MAX_DAYS[mo]) {
          possible = true
          break
        }
      }
      if (possible) break
    }
    if (!possible) return null
  }
  return { minutes, hours, doms, months, dows, domWild, dowWild }
}

/** Next local occurrence strictly after `now`, up to 8 years ahead (covers leap days). */
function nextCronRun(f: CronFields, now: Date): Date | null {
  const d = new Date(now.getTime())
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  const limitYear = now.getFullYear() + 8
  while (d.getFullYear() <= limitYear) {
    if (!f.months.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    const domOk = f.doms.has(d.getDate())
    const dowOk = f.dows.has(d.getDay())
    const dayOk = !f.domWild && !f.dowWild ? domOk || dowOk : domOk && dowOk
    if (!dayOk) {
      d.setDate(d.getDate() + 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    if (!f.hours.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!f.minutes.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0)
      continue
    }
    return d
  }
  return null
}

function describeCron(expr: string, f: CronFields, nextRun: Date | null, now: Date): string {
  const parts = expr.trim().split(/\s+/)
  const singleTime = f.minutes.size === 1 && f.hours.size === 1
  const hm = singleTime ? fmtHM([...f.hours][0], [...f.minutes][0]) : ''
  let base = ''
  if (singleTime && parts[2] === '*' && parts[3] === '*') {
    if (parts[4] === '*') base = `Every day at ${hm}`
    else if (parts[4] === '1-5') base = `Weekdays at ${hm}`
    else if (parts[4] === '0,6' || parts[4] === '6,0') base = `Weekends at ${hm}`
    else {
      const days = [...f.dows].sort((a, b) => a - b).map(d => DOW_LABELS[d]).join(', ')
      base = `Every ${days} at ${hm}`
    }
  } else if (nextRun) {
    base = `Next run ${whenWords(nextRun, now)}`
  } else {
    base = `Cron ${expr}`
  }
  if (nextRun && !base.startsWith('Next run ')) return `${base} · next ${whenWords(nextRun, now)}`
  return base
}

function parseIsoTimestamp(s: string): Date | null {
  // Require a time component before any timezone offset/Z: Python's datetime.fromisoformat does not accept
  // date-only offsets like 2027-01-01+02:00 as midnight UTC+2 (and Hermes strips/reinterprets them differently).
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/i.exec(s)
  if (!m) return null
  const [, yStr, moStr, dStr, hStr = '00', miStr = '00', sStr = '00', tz] = m
  const y = Number(yStr), mo = Number(moStr), day = Number(dStr)
  const h = Number(hStr), mi = Number(miStr), sec = Number(sStr)
  if (mo < 1 || mo > 12 || day < 1 || day > 31 || h > 23 || mi > 59 || sec > 59) return null
  // Verify the calendar date did not roll over (e.g. 2026-02-30).
  const check = new Date(Date.UTC(y, mo - 1, day))
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== day) return null
  const dt = tz ? new Date(`${yStr}-${moStr}-${dStr}T${hStr}:${miStr}:${sStr}${tz}`) : new Date(y, mo - 1, day, h, mi, sec, 0)
  return Number.isFinite(dt.getTime()) ? dt : null
}

const INVALID_HELP = 'Use an interval (every 30m, every 2h), a delay (in 30m), a weekday time (weekdays at 9am), a 5-part cron (0 9 * * *), or an ISO date (2027-01-01T09:00).'

/** Validates a schedule the way Hermes's `cron/jobs.py` does and describes when it will run. */
export function parseSchedule(raw: string, now = new Date()): ScheduleCheck {
  const s = raw.trim()
  if (!s) return { ok: false, error: 'Enter a schedule.' }
  const lower = s.toLowerCase()

  // Natural weekday/daily phrase ("every monday 9am", "weekdays at 9am") or "every <duration>".
  const isEvery = lower.startsWith('every ')
  const rest = isEvery ? s.slice(6).trim() : lower
  const naturalCron = naturalEveryToCron(rest)
  if (naturalCron) {
    const f = parseCronExpr(naturalCron)!
    const nextRun = nextCronRun(f, now) ?? undefined
    return { ok: true, kind: 'cron', raw: s, expr: naturalCron, nextRun, summary: describeCron(naturalCron, f, nextRun ?? null, now) }
  }
  if (isEvery) {
    const mins = parseDuration(rest)
    if (!mins) return { ok: false, error: `Invalid interval “${s}”. ${INVALID_HELP}` }
    const nextRun = new Date(now.getTime() + mins * 60_000)
    return { ok: true, kind: 'interval', raw: s, minutes: mins, nextRun, summary: `Every ${fmtDuration(mins)} · next ${whenWords(nextRun, now)}` }
  }

  // 5-field cron expression.
  const parts = s.split(/\s+/)
  if (parts.length === 5 && parts.every(p => /^[A-Za-z\d*,-/]+$/.test(p))) {
    const f = parseCronExpr(s)
    if (!f) return { ok: false, error: `Invalid cron expression “${s}”. Check the 5 fields (minute hour day month weekday).` }
    const nextRun = nextCronRun(f, now)
    if (!nextRun) return { ok: false, error: `Cron expression “${s}” has no upcoming run.` }
    const expr = parts.join(' ')
    return { ok: true, kind: 'cron', raw: expr, expr, nextRun, summary: describeCron(expr, f, nextRun, now) }
  }

  // ISO timestamp.
  if (s.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(s)) {
    const dt = parseIsoTimestamp(s)
    if (!dt) return { ok: false, error: `Invalid date/time “${s}”. Use e.g. 2027-01-01T09:00.` }
    if (now.getTime() - dt.getTime() > ONESHOT_GRACE_MS) {
      return { ok: false, error: 'That time is in the past. Choose a future date and time.' }
    }
    return { ok: true, kind: 'once', raw: s, nextRun: dt, relative: false, summary: `Once, ${whenWords(dt, now)}` }
  }

  // One-shot delay ("in 30m", "in 2h").
  if (lower.startsWith('in ')) {
    const dur = s.slice(3).trim()
    const mins = parseDuration(dur)
    if (!mins) return { ok: false, error: `Invalid delay “${s}”. Use e.g. in 30m or in 2h.` }
    const nextRun = new Date(now.getTime() + mins * 60_000)
    return { ok: true, kind: 'once', raw: s, minutes: mins, nextRun, relative: true, summary: `Once, in ${fmtDuration(mins)} (${whenWords(nextRun, now)})` }
  }

  // Bare duration ("30m", "2h") is a recurring interval in Hermes.
  const bareMins = parseDuration(s)
  if (bareMins) {
    const nextRun = new Date(now.getTime() + bareMins * 60_000)
    return { ok: true, kind: 'interval', raw: s, minutes: bareMins, nextRun, summary: `Every ${fmtDuration(bareMins)} · next ${whenWords(nextRun, now)}` }
  }

  return { ok: false, error: `Unrecognised schedule “${s}”. ${INVALID_HELP}` }
}

const normExpr = (e: string) => e.trim().replace(/\s+/g, ' ').toLowerCase()

function toMs(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : Date.parse(String(v))
  return Number.isFinite(n) ? n : null
}

/** Returns an editable schedule string that `parseSchedule` accepts for an existing job. Hermes's `schedule.display`
 *  for one-shots is human prose like "once in 30m", which Hermes rejects on save; prefer structured fields first. */
export function jobEditSchedule(j: Job, now = new Date()): string {
  const s = j.schedule as unknown
  if (s && typeof s === 'object') {
    const so = s as Record<string, unknown>
    const kind = typeof so.kind === 'string' ? so.kind : ''
    if (kind === 'once' && typeof so.run_at === 'string' && so.run_at.trim()) return so.run_at.trim()
    if (kind === 'cron' && typeof so.expr === 'string' && so.expr.trim()) return so.expr.trim()
    if (kind === 'interval' && typeof so.minutes === 'number' && Number.isFinite(so.minutes) && so.minutes > 0) {
      if (so.minutes % 1440 === 0) return `every ${so.minutes / 1440}d`
      if (so.minutes % 60 === 0) return `every ${so.minutes / 60}h`
      return `every ${so.minutes}m`
    }
    if (typeof so.run_at === 'string' && so.run_at.trim()) return so.run_at.trim()
    if (typeof so.expr === 'string' && so.expr.trim()) return so.expr.trim()
    if (typeof so.display === 'string' && so.display.trim()) {
      const disp = so.display.trim()
      if (parseSchedule(disp, now).ok) return disp
    }
  } else if (typeof s === 'string' && s.trim()) {
    const raw = s.trim()
    if (parseSchedule(raw, now).ok) return raw
  }
  const next = j.next_run_at ?? j.next_run
  if (typeof next === 'string' && next.trim() && parseSchedule(next.trim(), now).ok) return next.trim()
  if (s && typeof s === 'object') {
    const so = s as Record<string, unknown>
    return String(so.display ?? so.expr ?? '')
  }
  return String(s ?? j.schedule_display ?? '')
}

/** Checks whether Hermes's returned job contradicts the schedule the user requested. Returns a plain-words reason on
 *  mismatch, or null when it matches (or the response carries no schedule metadata, e.g. a minimal mock). */
export function scheduleMismatch(
  requested: ValidSchedule,
  job: unknown,
  opts: { isNew?: boolean; checkNextRun?: boolean; now?: Date } = {}
): string | null {
  if (!job || typeof job !== 'object') return null
  const rec = job as Record<string, unknown>
  const now = opts.now ?? new Date()
  const sched = rec.schedule
  if (sched && typeof sched === 'object') {
    const so = sched as Record<string, unknown>
    const kind = typeof so.kind === 'string' ? so.kind : ''
    if (kind && kind !== requested.kind) {
      return `Hermux returned a ${kind} schedule instead of ${requested.kind} (“${String(so.display ?? so.expr ?? kind)}”).`
    }
    if (requested.kind === 'interval' && typeof so.minutes === 'number' && so.minutes !== requested.minutes) {
      return `Hermux scheduled every ${so.minutes}m instead of every ${requested.minutes}m.`
    }
    if (requested.kind === 'cron' && typeof so.expr === 'string' && requested.expr && normExpr(so.expr) !== normExpr(requested.expr)) {
      return `Hermux scheduled “${so.expr}” instead of “${requested.expr}”.`
    }
    if (requested.kind === 'once' && requested.nextRun && so.run_at != null && so.run_at !== '') {
      const runMs = toMs(so.run_at)
      if (runMs == null) {
        return `Hermux returned an unreadable one-shot time (“${String(so.run_at)}”).`
      }
      const tol = requested.relative ? 10 * 60_000 : 27 * 3600_000
      if (Math.abs(runMs - requested.nextRun.getTime()) > tol) {
        return `Hermux scheduled ${whenWords(runMs, now)} instead of ${whenWords(requested.nextRun, now)}.`
      }
    }
  } else if (typeof sched === 'string' && sched.trim()) {
    const parsed = parseSchedule(sched, now)
    if (parsed.ok) {
      if (parsed.kind !== requested.kind) {
        return `Hermux scheduled “${sched}” instead of “${requested.raw}”.`
      }
      if (requested.kind === 'interval' && parsed.minutes !== requested.minutes) {
        return `Hermux scheduled “${sched}” instead of “${requested.raw}”.`
      }
      if (requested.kind === 'cron' && parsed.expr && requested.expr && normExpr(parsed.expr) !== normExpr(requested.expr)) {
        return `Hermux scheduled “${sched}” instead of “${requested.raw}”.`
      }
      if (requested.kind === 'once' && parsed.nextRun && requested.nextRun) {
        const tol = requested.relative ? 10 * 60_000 : 27 * 3600_000
        if (Math.abs(parsed.nextRun.getTime() - requested.nextRun.getTime()) > tol) {
          return `Hermux scheduled “${sched}” instead of “${requested.raw}”.`
        }
      }
    }
  }

  // On a newly created job (no prior last_run_at) or a schedule-changing edit, also sanity-check next_run_at so a
  // broken scheduler can't quietly fire a yearly cron 30 minutes from now. Allow 27 hours of tolerance for timezone
  // differences on wall-clock schedules.
  const checkNext = opts.checkNextRun ?? (Boolean(opts.isNew) && !rec.last_run_at)
  if (checkNext) {
    const nextMs = toMs(rec.next_run_at ?? rec.next_run)
    if (nextMs != null && requested.nextRun) {
      const diff = Math.abs(nextMs - requested.nextRun.getTime())
      if (requested.kind === 'cron' && diff > 27 * 3600_000) {
        return `Hermux set the next run to ${whenWords(nextMs, now)} instead of ${whenWords(requested.nextRun, now)}.`
      }
      if (requested.kind === 'interval' && requested.minutes != null) {
        const tol = Math.max(10 * 60_000, requested.minutes * 60_000 * 0.25)
        if (diff > tol) return `Hermux set the next run to ${whenWords(nextMs, now)} instead of ${whenWords(requested.nextRun, now)}.`
      }
      if (requested.kind === 'once') {
        const tol = requested.relative ? 10 * 60_000 : 27 * 3600_000
        if (diff > tol) return `Hermux set the next run to ${whenWords(nextMs, now)} instead of ${whenWords(requested.nextRun, now)}.`
      }
    }
  }
  return null
}
