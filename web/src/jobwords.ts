// Scheduled (Screens.tsx CronScreen): a job card leads with when the job runs next and how its last run ended, in words.
// The dashboard's job rows vary between Hermes versions, so every field is read loosely.

export type Job = Record<string, unknown> & { id?: string; job_id?: string }

export function jobPaused(j: Job): boolean {
  return Boolean(j.paused) || j.enabled === false || String(j.state || '').toLowerCase() === 'paused'
}

export function jobRunning(j: Job): boolean {
  return Boolean(j.is_running || j.fire_claim || j.run_claim || String(j.state || '').toLowerCase() === 'running')
}

/** A time in words: "today 09:00", "tomorrow 09:00", or the date ("3 Dec, 09:00"). */
export function whenWords(v: unknown, now = new Date()): string {
  if (v == null || v === '') return ''
  const n = typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : Date.parse(String(v))
  if (!Number.isFinite(n)) return String(v)
  const d = new Date(n)
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(d) - day(now)) / 86400000)
  if (diff === 0) return `today ${time}`
  if (diff === 1) return `tomorrow ${time}`
  if (diff === -1) return `yesterday ${time}`
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`
}
const FAILED = /^(error|failed|failure|crashed|timeout|timed_out)$/i
export const lastFailed = (j: Job) => FAILED.test(String(j.last_status || ''))
/** The card's first line: when the job runs next, in words. */
export function nextRunWords(j: Job): string {
  if (jobPaused(j)) return 'Paused: it won’t run until you resume it'
  const next = whenWords(j.next_run_at ?? j.next_run)
  return next ? `Next run ${next}` : 'No next run planned'
}
/** The card's second line: the last run and how it ended, in words. */
export function lastRunWords(j: Job): string {
  const last = whenWords(j.last_run_at ?? j.last_run)
  if (!last) return 'Hasn’t run yet'
  const st = String(j.last_status || '').toLowerCase()
  const how = !st ? '' : FAILED.test(st) ? ': it failed' : /^(ok|success|succeeded|done|completed|finished)$/.test(st) ? ': it worked' : `: ${st.replace(/_/g, ' ')}`
  return `Last ran ${last}${how}`
}

