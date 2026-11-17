// The two short values on the side panel's rows ("Scheduled: next 07:00", "Skills: 12 on"). They ride on the calls the
// old hub page made (`GET /api/cron/jobs`, `GET /api/skills`), read when the panel opens (and, while it is docked on a
// wide screen, when the app returns to the foreground), at most once a minute per bot, with no timer. A value that has
// not loaded or failed is left out and the row still works. The same jobs list gives the chat list the job names of
// scheduled runs (`useJobName`).
import { useSyncExternalStore } from 'react'
import { api } from './api'
import { getState } from './store'

export interface PanelValues {
  /** "next 07:00", "next Mon 09:00", "None yet" or "Paused". */
  scheduled?: string
  /** "12 on". */
  skills?: string
}

export const PANEL_VALUES_TTL_MS = 60_000

interface Job {
  id?: unknown
  name?: unknown
  paused?: unknown
  enabled?: unknown
  state?: unknown
  next_run_at?: unknown
  next_run?: unknown
}

let values: PanelValues = {}
let jobNames: Record<string, string> = {}
let loadedAt = 0
let loadedFor = ''
let token = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach(f => f())

const pad = (n: number) => String(n).padStart(2, '0')

/** "next 07:00" today, "next Mon 09:00" within the coming week, else "next 3 Dec 09:00". 24-hour clock, English day names. */
export function nextLabel(ms: number, now = Date.now()): string {
  const d = new Date(ms)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(d) - startOf(new Date(now))) / 86_400_000)
  if (days <= 0) return `next ${time}`
  if (days < 7) return `next ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${time}`
  return `next ${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${time}`
}

const jobPaused = (j: Job) => Boolean(j.paused) || j.enabled === false || String(j.state || '').toLowerCase() === 'paused'
const toMs = (v: unknown) => (typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : Date.parse(String(v ?? '')))

/** The Scheduled row's value from the jobs list: the next run, "None yet" with no jobs, "Paused" when every job is
 *  paused; undefined (left out) when a job is active but the list gives no next time. */
export function scheduledValue(raw: Job[] | { jobs?: Job[] }, now = Date.now()): string | undefined {
  const list = Array.isArray(raw) ? raw : raw.jobs ?? []
  if (!list.length) return 'None yet'
  const active = list.filter(j => !jobPaused(j))
  if (!active.length) return 'Paused'
  const next = active
    .map(j => toMs(j.next_run_at ?? j.next_run))
    .filter(n => Number.isFinite(n) && n > now)
    .sort((a, b) => a - b)[0]
  return next ? nextLabel(next, now) : undefined
}

/** Reads the values unless they are under a minute old for this bot. `force` ignores the age. */
export function refreshPanelValues(force = false): void {
  const profile = getState().profile
  if (!force && profile === loadedFor && Date.now() - loadedAt < PANEL_VALUES_TTL_MS) return
  if (profile !== loadedFor) {
    values = {}
    jobNames = {}
    emit()
  }
  loadedFor = profile
  loadedAt = Date.now()
  const mine = ++token
  const put = (v: PanelValues) => {
    if (mine !== token) return
    values = { ...values, ...v }
    emit()
  }
  api<Job[] | { jobs?: Job[] }>('GET', '/api/cron/jobs').then(r => {
    if (mine === token) jobNames = namesOf(r)
    put({ scheduled: scheduledValue(r) })
  }, () => {})
  api<Array<{ enabled?: boolean }>>('GET', '/api/skills').then(r => put({ skills: `${r.filter(s => s.enabled !== false).length} on` }), () => {})
}

/** Job id → name, from the jobs list. */
export function namesOf(raw: Job[] | { jobs?: Job[] }): Record<string, string> {
  const list = Array.isArray(raw) ? raw : raw.jobs ?? []
  const out: Record<string, string> = {}
  for (const j of list) {
    const name = typeof j.name === 'string' ? j.name.trim() : ''
    if (j.id != null && name) out[String(j.id)] = name
  }
  return out
}

/** The job a scheduled run's chat id names: Hermes calls a run's chat `cron_<job id>_<YYYYmmdd>_<HHMMSS>`; null for
 *  any other id (a newer Hermes's `local-…` ids name no job). */
export function cronJobId(id: string): string | null {
  const m = /^cron_(.+)_\d{8}_\d{6}$/.exec(id)
  return m ? m[1] : null
}

/** The name a scheduled run's row shows: its job's name from the jobs list when the run's id names the job, else the
 *  start of the run's title (Hermes titles a run "<job name> · Nov 17 09:00"), else "Scheduled". */
export function runName(run: { title?: string }, jobName?: string): string {
  if (jobName) return jobName
  const t = (run.title || '').trim()
  const cut = t.lastIndexOf(' · ')
  return cut > 0 ? t.slice(0, cut).trim() : 'Scheduled'
}

function subscribe(f: () => void) {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}

export function usePanelValues(): PanelValues {
  return useSyncExternalStore(subscribe, () => values)
}

/** The name of a scheduled job, once the jobs list has been read (the panel reads it when it opens). */
export function useJobName(jobId: string | null): string | undefined {
  return useSyncExternalStore(subscribe, () => (jobId ? jobNames[jobId] : undefined))
}
