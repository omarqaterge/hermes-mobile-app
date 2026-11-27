import { useBackHandler } from '../backstack'
import { confirmDialog } from '../dialog'
import { canvasOpenBlockReason, openFileInCanvas } from '../canvas'
import { useSheetDrag } from './useSheetDrag'
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api, ApiError, qs } from '../api'
import { errText, newSession, resumeSession, rpc } from '../gateway'
import { closeScreen, setState, toast, useStore } from '../store'
import { haptic, openFile } from '../bridge'
import { Markdown } from './Markdown'
import { DocView, HeldScope } from './DocView'
import { Media } from './Media'
import { previewKind, type PreviewKind } from '../filekind'
import { Linked } from './Linked'
import { ReportLink } from './Report'
import { LOAD_LIMIT_MS, timeLimit, TimeLimitError } from '../timelimit'
import { Icon, iconOf, type IconName } from './icons'
import { EmptyState } from './ui'
import { BotTag } from './BotTag'
import { jobPaused, jobRunning, lastFailed, lastRunWords, nextRunWords, type Job } from '../jobwords'
import { refreshPanelValues } from '../panelvalues'
import { jobEditSchedule, parseSchedule, scheduleMismatch, type ValidSchedule } from '../schedule'

// ── shared building blocks ──────────────────────────────────

/** Inside the Library page a part (Canvases, Files, Projects) is a ScreenShell without its own bar: its buttons go into
 *  the Library's top bar (`slot`) and its body is shown as it is. */
export const EmbeddedShell = createContext<{ slot: HTMLElement | null } | null>(null)

export function ScreenShell({ title, actions, children, onBack, className }: { title: string; actions?: ReactNode; children: ReactNode; onBack?: () => void; className?: string }) {
  const embedded = useContext(EmbeddedShell)
  const titleId = useId()
  if (embedded) return <>{embedded.slot && actions ? createPortal(actions, embedded.slot) : null}{children}</>
  // The page is a region named by its title, and the title its level-1 heading: screen readers and the browser checks
  // find the open page by role and name. Neither changes anything on screen.
  return (
    <div className={className ? `screen ${className}` : 'screen'} role="region" aria-labelledby={titleId}>
      <header className="topbar">
        <button className="back-btn" aria-label="Back" onClick={() => (onBack ? onBack() : closeScreen())}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14.5 5.5 8 12l6.5 6.5" />
          </svg>
        </button>
        <div className="title-btn">
          <span className="title" id={titleId} role="heading" aria-level={1}>{title}</span>
        </div>
        {actions}
      </header>
      <div className="screen-body">{children}</div>
    </div>
  )
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const drag = useSheetDrag(onClose)
  useBackHandler(onClose)
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet tall" role="dialog" ref={drag.ref} {...drag.bind} onClick={e => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-title">{title}</div>
        {children}
      </div>
    </div>
  )
}

/**
 * Loads once per `deps` change; `reload` loads again. A load that takes longer than LOAD_LIMIT_MS ends in an error (so
 * "Loading…" never stays), and its answer still fills the screen if it comes later. Only the latest load counts.
 */
export function useLoader<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  const reload = useCallback(() => {
    const n = ++seq.current
    const mine = () => n === seq.current
    setLoading(true)
    setError('')
    const p = load()
    const got = (d: T) => {
      if (!mine()) return
      setData(d)
      setError('')
    }
    const failed = (e: unknown) => mine() && setError(errText(e))
    timeLimit(p, LOAD_LIMIT_MS)
      .then(got, e => {
        failed(e)
        if (e instanceof TimeLimitError) p.then(got, failed) // a late answer still counts
      })
      .finally(() => mine() && setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(reload, [reload])
  return { data, error, loading, reload, setData }
}

/** A load's error with "Try again", in a notice. */
/** Opens Setup check, like its other links (Back from it goes to the chat). */
function openSetupCheck() {
  haptic()
  setState({ sheet: null, screen: 'setup' })
}

export function LoadError({ error, onRetry }: { error: string; onRetry?: () => void }) {
  // The dashboard didn't answer at all (api.ts): Setup check finds and fixes what stopped it.
  const unreachable = error.startsWith('Hermux unreachable')
  return (
    <div className="notice notice-error load-error">
      <span>
        <Linked text={error} />{' '}
        {unreachable && (
          <>
            <button className="report-link" onClick={openSetupCheck}>
              Setup check
            </button>
            {' · '}
          </>
        )}
        <ReportLink />
      </span>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

/** A list's load state: the error, "Loading…", or when it is empty `emptyState` (an `EmptyState`, ui.tsx) or else the
 *  dim `emptyText`. */
export function Status({ loading, error, empty, emptyText, emptyState, onRetry }: { loading: boolean; error: string; empty: boolean; emptyText: string; emptyState?: ReactNode; onRetry?: () => void }) {
  if (error) return <LoadError error={error} onRetry={onRetry} />
  if (loading && empty) return <div className="dim pad">Loading…</div>
  if (empty && emptyState) return <>{emptyState}</>
  if (empty && emptyText) return <div className="dim pad">{emptyText}</div>
  return null
}

function fmtTime(v: unknown): string {
  if (v == null || v === '') return '—'
  const n = typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : Date.parse(String(v))
  if (!Number.isFinite(n)) return String(v)
  const d = new Date(n)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtSize(n?: number | null): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

// ── Skills ───────────────────────────────────────────────────

interface SkillRow {
  name: string
  description?: string
  category?: string
  enabled?: boolean
  usage?: number
  provenance?: string
}

export function SkillsScreen({ onUse }: { onUse: (text: string) => void }) {
  const profile = useStore(s => s.profile)
  const { data, error, loading, setData } = useLoader(() => api<SkillRow[]>('GET', '/api/skills'), [profile])
  const [q, setQ] = useState('')
  const [onlyOn, setOnlyOn] = useState(false)
  const [open, setOpen] = useState<SkillRow | null>(null)
  const [content, setContent] = useState<string | null>(null)

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out: Record<string, SkillRow[]> = {}
    for (const s of data || []) {
      if (onlyOn && !s.enabled) continue
      if (needle && !`${s.name} ${s.description || ''} ${s.category || ''}`.toLowerCase().includes(needle)) continue
      ;(out[s.category || 'general'] ||= []).push(s)
    }
    return Object.entries(out).sort(([a], [b]) => a.localeCompare(b))
  }, [data, q, onlyOn])

  const toggle = async (s: SkillRow) => {
    haptic()
    const enabled = !s.enabled
    setData(d => (d || []).map(x => (x.name === s.name ? { ...x, enabled } : x)))
    try {
      await api('PUT', '/api/skills/toggle', { name: s.name, enabled, profile })
    } catch (e) {
      setData(d => (d || []).map(x => (x.name === s.name ? { ...x, enabled: !enabled } : x)))
      toast(errText(e), 'error')
    }
  }

  const view = async (s: SkillRow) => {
    setOpen(s)
    setContent(null)
    try {
      const r = await api<Record<string, unknown>>('GET', `/api/skills/content?${qs({ name: s.name })}`)
      // Drop the YAML front matter (name/version/tags); it renders as one giant heading otherwise.
      setContent(String(r?.content ?? r?.markdown ?? r?.text ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ''))
    } catch (e) {
      setContent(`Could not load: ${errText(e)}`)
    }
  }

  const total = data?.length ?? 0
  const on = (data || []).filter(s => s.enabled).length
  return (
    <ScreenShell title={`Skills ${total ? `· ${on}/${total} on` : ''}`} actions={<BotTag />}>
      <div className="screen-tools">
        <input className="search" placeholder="Search skills…" value={q} onChange={e => setQ(e.target.value)} />
        <button className={`pill${onlyOn ? ' on' : ''}`} onClick={() => setOnlyOn(v => !v)}>
          Enabled
        </button>
      </div>
      <Status
        loading={loading}
        error={error}
        empty={!data?.length}
        emptyText=""
        emptyState={
          <EmptyState
            icon="puzzle"
            title="No skills yet"
            text="Skills teach Hermux how to do a job. Ask Hermux to make one, or turn on one it comes with."
            action="Ask Hermux to make one"
            onAction={() => {
              onUse('Make a skill that ')
              setState({ screen: null })
            }}
          />
        }
      />
      {!!data?.length && !groups.length && <div className="dim pad">No skills match</div>}
      {groups.map(([cat, rows]) => (
        <div key={cat} className="group">
          <div className="group-title">
            {cat} <span className="dim">({rows.length})</span>
          </div>
          {rows.map(s => (
            <div key={s.name} className="list-row">
              <button className="list-main" onClick={() => void view(s)}>
                <span className="list-title">{s.name}</span>
                <span className="list-sub">{s.description}</span>
              </button>
              <button className={`switch${s.enabled ? ' on' : ''}`} aria-label="Enabled" onClick={() => void toggle(s)}>
                <span />
              </button>
            </div>
          ))}
        </div>
      ))}
      {open && (
        <Sheet title={open.name} onClose={() => setOpen(null)}>
          <div className="dim small">
            {open.category} · {open.provenance || 'local'} · used {open.usage ?? 0}×
          </div>
          <div className="sheet-scroll">{content == null ? <div className="dim">Loading…</div> : <Markdown text={content} />}</div>
          <div className="sheet-actions">
            <button className="btn" onClick={() => setOpen(null)}>
              Close
            </button>
            <button
              className="btn primary"
              onClick={() => {
                onUse(`/${open.name.replace(/^\/+/, '')} `)
                setOpen(null)
                setState({ screen: null })
              }}
            >
              Use in chat
            </button>
          </div>
        </Sheet>
      )}
    </ScreenShell>
  )
}

// ── Memory ───────────────────────────────────────────────────

interface MemSnapshot {
  target: 'memory' | 'user'
  entries: string[]
  used: number
  limit: number
}
type MemData = { memory: MemSnapshot; user: MemSnapshot }

export function MemoryScreen() {
  const profile = useStore(s => s.profile)
  const { data, error, loading, setData } = useLoader(() => api<MemData>('GET', '/api/plugins/hermes-mobile/memory'), [profile])
  const [tab, setTab] = useState<'memory' | 'user'>('memory')
  const [edit, setEdit] = useState<{ old: string | null; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const snap = data?.[tab]

  const run = async (action: 'add' | 'replace' | 'remove', content?: string, old?: string) => {
    setBusy(true)
    try {
      const r = await api<{ result: { success?: boolean; error?: string; message?: string }; memory?: MemSnapshot; user?: MemSnapshot }>(
        'POST',
        '/api/plugins/hermes-mobile/memory',
        { action, target: tab, content, old_text: old }
      )
      if (r.result?.success === false) {
        toast(r.result.error || 'Hermux refused the change', 'error', 6000)
        return false
      }
      const fresh = r[tab]
      if (fresh) setData(d => (d ? { ...d, [tab]: fresh } : d))
      toast(action === 'remove' ? 'Removed' : 'Saved')
      return true
    } catch (e) {
      toast(errText(e), 'error')
      return false
    } finally {
      setBusy(false)
    }
  }

  const pct = snap ? Math.min(100, Math.round((snap.used / Math.max(1, snap.limit)) * 100)) : 0
  return (
    <ScreenShell
      title="Memory"
      actions={
        <>
          <BotTag />
          <button className="icon-btn" aria-label="Add" onClick={() => setEdit({ old: null, text: '' })}>
            <Icon n="plus" />
          </button>
        </>
      }
    >
      <div className="segmented">
        <button className={tab === 'memory' ? 'on' : ''} onClick={() => setTab('memory')}>
          Memory
        </button>
        <button className={tab === 'user' ? 'on' : ''} onClick={() => setTab('user')}>
          About you
        </button>
      </div>
      {snap && (
        <div className="usage">
          <div className="usage-bar">
            <span style={{ width: `${pct}%` }} className={pct > 92 ? 'full' : ''} />
          </div>
          <span className="dim small">
            {snap.used.toLocaleString()} / {snap.limit.toLocaleString()} characters · {snap.entries.length} entries
          </span>
        </div>
      )}
      <Status
        loading={loading}
        error={error}
        empty={!snap?.entries.length}
        emptyText=""
        emptyState={
          <EmptyState
            icon="brain"
            title={tab === 'user' ? 'Nothing about you yet' : 'No notes yet'}
            text={tab === 'user' ? 'Hermux keeps notes here as it learns about you. Add the first one yourself.' : 'Hermux keeps notes here as it learns how you work. Add the first one yourself.'}
            action="Add a memory"
            onAction={() => setEdit({ old: null, text: '' })}
          />
        }
      />
      {snap?.entries.map((e, i) => (
        <button key={i} className={`mem-entry${/^(mac|phone)\s*:/i.test(e) ? ' device' : ''}`} onClick={() => setEdit({ old: e, text: e })}>
          {e}
        </button>
      ))}
      <div className="dim small pad">
        Synced with your Mac. Start an entry with “Phone:” to keep it on this phone only.
      </div>
      {edit && (
        <Sheet title={edit.old ? 'Edit memory' : 'New memory'} onClose={() => setEdit(null)}>
          <textarea className="sheet-input grow" rows={7} autoFocus value={edit.text} onChange={e => setEdit({ ...edit, text: e.target.value })} />
          <div className="dim small">{edit.text.trim().length} characters</div>
          <div className="sheet-actions">
            {edit.old && (
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => {
                  void confirmDialog({ title: 'Delete this memory?', message: 'Hermux will forget it.', danger: true }).then(yes => yes && run('remove', undefined, edit.old!).then(ok => ok && setEdit(null)))
                }}
              >
                Delete
              </button>
            )}
            <button
              className="btn primary"
              disabled={busy || !edit.text.trim() || edit.text === edit.old}
              onClick={() =>
                void (edit.old ? run('replace', edit.text.trim(), edit.old) : run('add', edit.text.trim())).then(ok => ok && setEdit(null))
              }
            >
              Save
            </button>
          </div>
        </Sheet>
      )}
    </ScreenShell>
  )
}

// ── Cron ─────────────────────────────────────────────────────

function jobId(j: Job): string {
  return String(j.id ?? j.job_id ?? '')
}
function jobSchedule(j: Job): string {
  const s = j.schedule as unknown
  if (s && typeof s === 'object') return String((s as Record<string, unknown>).display ?? (s as Record<string, unknown>).expr ?? JSON.stringify(s))
  return String(s ?? j.schedule_display ?? '')
}

const SCHEDULE_EXAMPLES = ['every 30m', 'every 2h', '0 9 * * *', '0 8 * * 1-5', 'in 30m']

async function fetchCronJobs(): Promise<Job[]> {
  const r = await api<Job[] | { jobs?: Job[] }>('GET', '/api/cron/jobs')
  return Array.isArray(r) ? r : r.jobs || []
}

function responseFailed(r: unknown): boolean {
  if (!r || typeof r !== 'object') return false
  const o = r as Record<string, unknown>
  return o.ok === false || o.deleted === false || o.removed === false
}

function schedulesMatch(a: ValidSchedule, b: ValidSchedule): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'interval') return a.minutes === b.minutes
  if (a.kind === 'cron') {
    const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
    return Boolean(a.expr && b.expr && norm(a.expr) === norm(b.expr))
  }
  if (a.kind === 'once') {
    return Boolean(a.nextRun && b.nextRun && Math.abs(a.nextRun.getTime() - b.nextRun.getTime()) <= 60_000)
  }
  return false
}

/** Deletes a scheduled job and reloads the store to confirm it is actually gone. */
async function verifiedDeleteCronJob(id: string): Promise<{ ok: boolean; jobs?: Job[]; reason?: string }> {
  if (!id) return { ok: false, reason: 'Hermux returned no id for the job.' }
  let res: unknown
  try {
    res = await api<unknown>('DELETE', `/api/cron/jobs/${encodeURIComponent(id)}`)
  } catch (e) {
    return { ok: false, reason: errText(e) }
  }
  if (responseFailed(res)) return { ok: false, reason: 'Hermux did not delete the scheduled job.' }
  let fresh: Job[]
  try {
    fresh = await fetchCronJobs()
  } catch {
    return { ok: false, reason: 'Could not reload the job list to confirm removal.' }
  }
  if (fresh.some(x => jobId(x) === id)) {
    return { ok: false, jobs: fresh, reason: 'The scheduled job is still active.' }
  }
  return { ok: true, jobs: fresh }
}

/** True when a save reply shows something `scheduleMismatch` can check: a schedule or a next run. */
const carriesSchedule = (x: unknown): boolean =>
  !!x && typeof x === 'object' && ['schedule', 'next_run_at', 'next_run'].some(k => (x as Record<string, unknown>)[k] != null)

/** The job as Hermes stored it: the save reply when it shows the schedule, else the job read back from a fresh list
 *  (a bare `{ ok: true }` reply can't be checked). `rec` is null when the job can't be read back. */
async function savedJobRecord(saved: unknown, id: string): Promise<{ rec: unknown; jobs?: Job[] }> {
  if (carriesSchedule(saved) || !id) return { rec: saved }
  try {
    const jobs = await fetchCronJobs()
    return { rec: jobs.find(x => jobId(x) === id) ?? null, jobs }
  } catch {
    return { rec: null }
  }
}

/** Pauses a job whose schedule came out wrong and confirms from a fresh list that it is paused, never trusting the save
 *  reply. `already` is true when the list shows it was paused before. */
async function verifiedPauseCronJob(id: string): Promise<{ ok: boolean; already?: boolean; jobs?: Job[] }> {
  if (!id) return { ok: false }
  try {
    let jobs = await fetchCronJobs()
    let found = jobs.find(x => jobId(x) === id)
    if (found && jobPaused(found)) return { ok: true, already: true, jobs }
    const res = await api<unknown>('POST', `/api/cron/jobs/${encodeURIComponent(id)}/pause`)
    if (responseFailed(res)) return { ok: false, jobs }
    jobs = await fetchCronJobs()
    found = jobs.find(x => jobId(x) === id)
    return { ok: Boolean(found && jobPaused(found)), jobs }
  } catch {
    return { ok: false }
  }
}

export function CronScreen() {
  const profile = useStore(s => s.profile)
  const { data, error, loading, reload, setData } = useLoader(fetchCronJobs, [profile])
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Job | null>(null)
  const [form, setForm] = useState({ name: '', schedule: '', prompt: '' })
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [runsFor, setRunsFor] = useState<Job | null>(null)
  const [runs, setRuns] = useState<Record<string, unknown>[] | null>(null)
  const [output, setOutput] = useState<{ title: string; text: string | null } | null>(null)

  const scheduleCheck = useMemo(() => (form.schedule.trim() ? parseSchedule(form.schedule) : null), [form.schedule])

  const act = async (j: Job, what: 'pause' | 'resume' | 'trigger' | 'delete') => {
    const id = jobId(j)
    if (!id) {
      toast('This job has no id and cannot be changed here.', 'error')
      return
    }
    if (busyId) return
    haptic()
    try {
      if (what === 'delete') {
        if (!(await confirmDialog({ title: `Delete “${String(j.name || id)}”?`, message: 'The scheduled job is removed.', danger: true }))) return
        setBusyId(id)
        const del = await verifiedDeleteCronJob(id)
        if (del.jobs) setData(del.jobs)
        else reload()
        refreshPanelValues(true)
        if (!del.ok) {
          toast(
            del.jobs ? 'Could not delete the scheduled job — it is still active.' : `Delete was not confirmed: ${del.reason} Check the list.`,
            'error',
            6000
          )
          return
        }
        if (jobRunning(j)) toast('Deleted. A run that had already started will finish.', 'info', 6000)
        else toast('Deleted')
        return
      }
      setBusyId(id)
      await api('POST', `/api/cron/jobs/${encodeURIComponent(id)}/${what}`)
      toast(what === 'trigger' ? 'Started' : what === 'pause' ? 'Paused' : 'Resumed')
      reload()
      refreshPanelValues(true)
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setBusyId('')
    }
  }

  const showRuns = async (j: Job) => {
    setRunsFor(j)
    setRuns(null)
    try {
      const r = await api<unknown>('GET', `/api/cron/jobs/${encodeURIComponent(jobId(j))}/runs?limit=20`)
      setRuns((Array.isArray(r) ? r : ((r as { runs?: unknown[] })?.runs ?? [])) as Record<string, unknown>[])
    } catch (e) {
      toast(errText(e), 'error')
      setRuns([])
    }
  }

  const closeForm = () => {
    setCreating(false)
    setEditing(null)
    setForm({ name: '', schedule: '', prompt: '' })
  }

  const rollbackMismatchedJob = async (saved: unknown, bad: string, label: string) => {
    const newId = saved && typeof saved === 'object' ? jobId(saved as Job) : ''
    const rb = await verifiedDeleteCronJob(newId)
    if (rb.jobs) setData(rb.jobs)
    else reload()
    refreshPanelValues(true)
    if (rb.ok) {
      toast(`${label}: ${bad}`, 'error', 8000)
    } else {
      closeForm()
      toast(
        `Wrong schedule (${bad}), and automatic removal failed (${rb.reason}). Delete the job from Scheduled now.`,
        'error',
        10000
      )
    }
  }

  // A new job's schedule as Hermes stored it, checked against what was asked; a job that can't be read back counts as wrong.
  const newJobMismatch = async (parsed: ValidSchedule, saved: unknown): Promise<string | null> => {
    const back = await savedJobRecord(saved, saved && typeof saved === 'object' ? jobId(saved as Job) : '')
    if (back.jobs) setData(back.jobs)
    if (back.rec == null) return 'Hermux could not read the new job back to check its schedule.'
    return scheduleMismatch(parsed, back.rec, { isNew: true })
  }

  const create = async () => {
    if (saving) return
    const parsed = parseSchedule(form.schedule)
    if (!parsed.ok) {
      toast(parsed.error, 'error', 6000)
      return
    }
    const body = { name: form.name.trim(), schedule: parsed.raw, prompt: form.prompt.trim(), deliver: 'local' }
    setSaving(true)
    try {
      let saved: unknown = null
      if (editing) {
        const rawId = jobId(editing)
        const id = encodeURIComponent(rawId)
        const prevParsed = parseSchedule(jobEditSchedule(editing))
        const scheduleChanged = !prevParsed.ok || !schedulesMatch(prevParsed, parsed)
        try {
          saved = await api('PUT', `/api/cron/jobs/${id}`, { updates: body }) // the dashboard's shape: {updates: {…}}
          const back = await savedJobRecord(saved, rawId)
          if (back.jobs) setData(back.jobs)
          if (back.rec == null) {
            closeForm()
            reload()
            refreshPanelValues(true)
            toast('Saved, but Hermux could not read the job back to check its schedule. Check it in Scheduled.', 'error', 10000)
            return
          }
          const bad = scheduleMismatch(parsed, back.rec, { checkNextRun: scheduleChanged })
          if (bad) {
            // Fail closed on edit mismatch: pause the job so it cannot fire at the wrong time, and verify it is paused.
            const pause = await verifiedPauseCronJob(rawId)
            if (pause.jobs) setData(pause.jobs)
            else reload()
            refreshPanelValues(true)
            closeForm()
            toast(
              pause.ok
                ? `Schedule did not match (${bad}). The job ${pause.already ? 'stays' : 'was'} paused so it won’t run at the wrong time.`
                : `Schedule did not match (${bad}), and Hermux could not confirm the job is paused. Pause or delete it from Scheduled now.`,
              'error',
              10000
            )
            return
          }
          toast('Saved')
        } catch (e) {
          // A dashboard without job editing: replace the job (new id, its run history stays with the old one).
          if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 405)) throw e
          saved = await api('POST', '/api/cron/jobs', body)
          const bad = await newJobMismatch(parsed, saved)
          if (bad) {
            await rollbackMismatchedJob(saved, bad, 'Cancelled')
            return
          }
          const oldDel = await verifiedDeleteCronJob(rawId)
          if (oldDel.jobs) setData(oldDel.jobs)
          else reload()
          refreshPanelValues(true)
          if (!oldDel.ok) {
            closeForm()
            toast(`New job saved, but the old job could not be deleted (${oldDel.reason}). Delete the old one from the list.`, 'error', 8000)
            return
          }
          toast('Saved as a new job')
        }
      } else {
        saved = await api('POST', '/api/cron/jobs', body)
        const bad = await newJobMismatch(parsed, saved)
        if (bad) {
          // Fail closed: never leave an unattended job running on a time the person did not ask for.
          await rollbackMismatchedJob(saved, bad, 'Job was not kept')
          return
        }
        toast('Scheduled')
      }
      closeForm()
      reload()
      refreshPanelValues(true)
    } catch (e) {
      toast(errText(e), 'error', 6000)
    } finally {
      setSaving(false)
    }
  }

  const edit = (j: Job) => {
    haptic()
    setForm({ name: String(j.name || ''), schedule: jobEditSchedule(j), prompt: String(j.prompt || '') })
    setEditing(j)
    setCreating(true)
  }

  /** A run's result: its chat if it has one, else its saved output. */
  const openRun = async (r: Record<string, unknown>) => {
    haptic()
    // The dashboard lists runs as the chats they ran in (source "cron"): the row's id is the chat.
    const sid = String(r.session_id || r.stored_session_id || r.session || (r.source === 'cron' && r.id) || '')
    if (sid) {
      setRunsFor(null)
      setState({ screen: null })
      resumeSession(sid).catch(e => toast(errText(e), 'error'))
      return
    }
    const title = String(r.title || r.status || 'Run')
    const inline = r.output ?? r.response ?? r.final_response ?? r.result
    if (typeof inline === 'string' && inline) return setOutput({ title, text: inline })
    const file = String(r.output_file || r.output_path || r.path || '')
    if (!file) return setOutput({ title, text: String(r.preview || 'This run saved no output.') })
    setOutput({ title, text: null })
    try {
      const f = await api<{ data_url: string }>('GET', `/api/files/read?${qs({ path: file })}`, undefined, { profile: false })
      setOutput({ title, text: decodeDataUrl(f.data_url) })
    } catch (e) {
      setOutput({ title, text: errText(e) })
    }
  }

  return (
    <ScreenShell
      title="Scheduled"
      actions={
        <>
          <BotTag />
          <button className="icon-btn" aria-label="New job" onClick={() => setCreating(true)}>
            <Icon n="plus" />
          </button>
        </>
      }
    >
      <Status
        loading={loading}
        error={error}
        empty={!data?.length}
        emptyText=""
        emptyState={
          <EmptyState
            icon="clock"
            title="Nothing scheduled yet"
            text="A scheduled job runs a request on its own at the times you choose, on this phone, and tells you when the result is ready."
            action="New scheduled job"
            onAction={() => setCreating(true)}
          />
        }
      />
      {(data || []).map(j => (
        <div key={jobId(j)} className={`card${jobPaused(j) ? ' muted' : ''}`}>
          <div className="card-head">
            <span className="list-title">{String(j.name || String(j.prompt || '').slice(0, 60) || jobId(j))}</span>
            <span className={`tag${jobPaused(j) ? ' off' : ''}`}>{jobPaused(j) ? 'paused' : 'active'}</span>
          </div>
          <div className="job-when">{nextRunWords(j)}</div>
          <div className={`job-last${lastFailed(j) ? ' failed' : ''}`}>{lastRunWords(j)}</div>
          <div className="mono small dim">{jobSchedule(j)}</div>
          {j.prompt ? <div className="card-text"><Linked text={String(j.prompt).slice(0, 240)} /></div> : null}
          <div className="card-actions">
            <button disabled={busyId === jobId(j)} onClick={() => void act(j, 'trigger')}><Icon n="play" /> Run now</button>
            <button disabled={busyId === jobId(j)} onClick={() => void act(j, jobPaused(j) ? 'resume' : 'pause')}>{jobPaused(j) ? 'Resume' : 'Pause'}</button>
            <button onClick={() => void showRuns(j)}>Runs</button>
            <button disabled={busyId === jobId(j)} onClick={() => edit(j)}>Edit</button>
            <button className="danger" disabled={busyId === jobId(j)} onClick={() => void act(j, 'delete')}>
              Delete
            </button>
          </div>
        </div>
      ))}
      {creating && (
        <Sheet title={editing ? 'Edit job' : 'New scheduled job'} onClose={closeForm}>
          <div className="sheet-scroll">
            <label className="field">
              <span>Name</span>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Morning brief" />
            </label>
            <label className="field">
              <span>Schedule</span>
              <input value={form.schedule} onChange={e => setForm({ ...form, schedule: e.target.value })} placeholder="e.g. 0 9 * * * or every 2h" />
            </label>
            <div className="effort-row">
              {SCHEDULE_EXAMPLES.map(x => (
                <button key={x} type="button" className={`pill${form.schedule.trim() === x ? ' on' : ''}`} onClick={() => setForm({ ...form, schedule: x })}>
                  {x}
                </button>
              ))}
            </div>
            <label className="field">
              <span>What should Hermux do?</span>
              <textarea className="sheet-input" rows={5} value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} />
            </label>
            <div className="dim small">Runs on the phone. Results are saved locally and you get a notification.</div>
          </div>
          {scheduleCheck && (
            <div className={`job-schedule-check${scheduleCheck.ok ? '' : ' bad'}`} role={scheduleCheck.ok ? 'status' : 'alert'}>
              {scheduleCheck.ok ? `Will run: ${scheduleCheck.summary}` : scheduleCheck.error}
            </div>
          )}
          <div className="sheet-actions">
            <button className="btn" onClick={closeForm}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !scheduleCheck?.ok || !form.prompt.trim()} onClick={() => void create()}>
              {editing ? 'Save' : 'Schedule'}
            </button>
          </div>
        </Sheet>
      )}
      {runsFor && (
        <Sheet title={`Runs · ${String(runsFor.name || jobId(runsFor))}`} onClose={() => setRunsFor(null)}>
          <div className="sheet-scroll">
            {runs == null && <div className="dim">Loading…</div>}
            {runs?.length === 0 && <div className="dim">No runs yet</div>}
            {runs?.map((r, i) => (
              <button key={i} className="card as-button" onClick={() => void openRun(r)}>
                <div className="card-head">
                  <span className="list-title">{String(r.title || r.status || 'Run')}</span>
                  <span className="dim small">{fmtTime(r.started_at ?? r.timestamp)}</span>
                </div>
                {r.preview && !String(r.preview).startsWith('[IMPORTANT:') ? (
                  <div className="card-text">{String(r.preview)}</div>
                ) : typeof r.message_count === 'number' ? (
                  <div className="dim small">
                    {r.message_count} msgs{r.end_reason ? ` · ${String(r.end_reason).replace(/_/g, ' ')}` : ''}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {output && (
        <Sheet title={output.title} onClose={() => setOutput(null)}>
          <div className="sheet-scroll">{output.text == null ? <div className="dim">Loading…</div> : <Markdown text={output.text} />}</div>
        </Sheet>
      )}
    </ScreenShell>
  )
}

// ── Files ────────────────────────────────────────────────────

interface FileEntry {
  name: string
  path: string
  is_directory: boolean
  size?: number | null
  mtime?: number
  mime_type?: string | null
}
interface Listing {
  path: string
  parent?: string | null
  entries: FileEntry[]
}

const ROOTS: [string, string][] = [
  ['Phone', '/sdcard'],
  ['Downloads', '/sdcard/Download'],
  ['Photos', '/sdcard/DCIM'],
  ['Documents', '/sdcard/Documents'],
  ['Hermux', '/root/.hermes'],
  ['Home', '/root']
]
const PREVIEW_MAX = 3 * 1024 * 1024
const NO_PREVIEW = 'No preview here. Use Open with… to view it in another app.'

function fileIcon(name: string, mime?: string | null): IconName {
  const k = previewKind(name, mime).kind
  return k === 'image' ? 'image' : k === 'doc' ? 'file' : k === 'media' ? 'film' : 'package'
}

function decodeDataUrl(url: string): string {
  const b64 = url.split(',')[1] || ''
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function FilesScreen({ onUse }: { onUse: (text: string) => void }) {
  const [path, setPath] = useState('/sdcard')
  const { data, error, loading, reload } = useLoader(() => api<Listing>('GET', `/api/files?${qs({ path })}`, undefined, { profile: false }), [path])
  const [preview, setPreview] = useState<{ entry: FileEntry; text?: string; image?: string; media?: string; note?: string; doc?: Extract<PreviewKind, { kind: 'doc' }> } | null>(null)
  const [openingCanvas, setOpeningCanvas] = useState(false)
  const [newDir, setNewDir] = useState<string | null>(null)
  const upload = useRef<HTMLInputElement>(null)
  const openBlocked = preview ? canvasOpenBlockReason(preview.entry.path) : null
  // Android Back goes up one folder; at one of the root chips (or /) it leaves the screen.
  const atRoot = path === '/' || ROOTS.some(([, p]) => p === path)
  useBackHandler(() => setPath(data?.parent || path.replace(/\/[^/]+\/?$/, '') || '/'), !atRoot && !preview && newDir == null)

  const open = async (e: FileEntry) => {
    if (e.is_directory) {
      setPath(e.path)
      return
    }
    setPreview({ entry: e })
    const k = previewKind(e.name, e.mime_type)
    // Audio and video stream through `Media`; the file is never read into the page.
    if (k.kind === 'media') return setPreview({ entry: e, media: e.path })
    if (k.kind === 'none') return setPreview({ entry: e, note: NO_PREVIEW })
    if ((e.size ?? 0) > PREVIEW_MAX) return setPreview({ entry: e, note: `Too large to preview (${fmtSize(e.size)}).` })
    try {
      const r = await api<{ data_url: string }>('GET', `/api/files/read?${qs({ path: e.path })}`, undefined, { profile: false })
      setPreview(k.kind === 'image' ? { entry: e, image: r.data_url } : { entry: e, text: decodeDataUrl(r.data_url), doc: k })
    } catch (err) {
      setPreview({ entry: e, note: errText(err) })
    }
  }

  const remove = async (e: FileEntry) => {
    if (!(await confirmDialog({ title: `Delete ${e.is_directory ? 'folder' : 'file'} “${e.name}”?`, message: e.is_directory ? 'Everything inside it will be deleted.' : 'This cannot be undone.', danger: true }))) return
    try {
      await api('DELETE', '/api/files', { path: e.path, recursive: e.is_directory }, { profile: false })
      toast('Deleted')
      setPreview(null)
      reload()
    } catch (err) {
      toast(errText(err), 'error')
    }
  }

  const mkdir = async () => {
    const name = (newDir || '').trim()
    if (!name || name.includes('/')) return
    try {
      await api('POST', '/api/files/mkdir', { path: `${path.replace(/\/$/, '')}/${name}` }, { profile: false })
      setNewDir(null)
      reload()
    } catch (err) {
      toast(errText(err), 'error')
    }
  }

  const onUpload = async (files: FileList | null) => {
    for (const f of Array.from(files || [])) {
      try {
        const dataUrl = await new Promise<string>((res, rej) => {
          const fr = new FileReader()
          fr.onload = () => res(String(fr.result))
          fr.onerror = () => rej(fr.error)
          fr.readAsDataURL(f)
        })
        await api('POST', '/api/files/upload', { path: `${path.replace(/\/$/, '')}/${f.name}`, data_url: dataUrl, overwrite: false }, { profile: false })
        toast(`Uploaded ${f.name}`)
      } catch (err) {
        toast(`${f.name}: ${errText(err)}`, 'error')
      }
    }
    reload()
  }

  const crumbs = (data?.path || path).split('/').filter(Boolean)
  return (
    <ScreenShell
      title="Files"
      actions={
        <>
          <button className="icon-btn" aria-label="Upload" onClick={() => upload.current?.click()}>
            <Icon n="upload" />
          </button>
          <button className="icon-btn" aria-label="New folder" onClick={() => setNewDir('')}>
            <Icon n="plus" />
          </button>
        </>
      }
    >
      <input ref={upload} type="file" multiple hidden onChange={e => { void onUpload(e.target.files); e.target.value = '' }} />
      <div className="chips-row">
        {ROOTS.map(([label, p]) => (
          <button key={p} className={`pill${path === p ? ' on' : ''}`} onClick={() => setPath(p)}>
            {label}
          </button>
        ))}
      </div>
      <div className="crumbs">
        <button aria-label="Top folder" onClick={() => setPath('/')}>/</button>
        {crumbs.map((c, i) => (
          <button key={i} onClick={() => setPath('/' + crumbs.slice(0, i + 1).join('/'))}>
            {c}/
          </button>
        ))}
      </div>
      {newDir != null && (
        <div className="inline-form">
          <input autoFocus placeholder="Folder name" value={newDir} onChange={e => setNewDir(e.target.value)} onKeyDown={e => e.key === 'Enter' && void mkdir()} />
          <button className="btn primary" onClick={() => void mkdir()}>
            Create
          </button>
          <button className="btn" aria-label="Cancel" onClick={() => setNewDir(null)}>
            <Icon n="close" />
          </button>
        </div>
      )}
      <Status loading={loading} error={error} empty={!data?.entries.length} emptyText="Empty folder" />
      {data?.parent && (
        <button className="file-row" onClick={() => setPath(data.parent!)}>
          <span className="file-icon"><Icon n="back" /></span>
          <span className="list-title">..</span>
        </button>
      )}
      {data?.entries.map(e => (
        <button key={e.path} className="file-row" onClick={() => void open(e)}>
          <span className="file-icon"><Icon n={e.is_directory ? 'folder' : fileIcon(e.name, e.mime_type)} /></span>
          <span className="list-main static">
            <span className="list-title">{e.name}</span>
            <span className="list-sub">
              {e.is_directory ? 'Folder' : fmtSize(e.size)}
              {e.mtime ? ` · ${fmtTime(e.mtime)}` : ''}
            </span>
          </span>
        </button>
      ))}
      {preview && (
        <Sheet title={preview.entry.name} onClose={() => setPreview(null)}>
          <div className="dim small mono">{preview.entry.path}</div>
          <div className="sheet-scroll">
            {preview.image && <img className="preview-img" src={preview.image} alt={preview.entry.name} />}
            {preview.media && <Media src={preview.media} alt={preview.entry.name} />}
            {preview.text != null && preview.doc &&
              (preview.doc.type === 'text' ? (
                <HeldScope from={null}><pre className="tool-pre"><Linked text={preview.text.slice(0, 200_000)} /></pre></HeldScope>
              ) : (
                <DocView type={preview.doc.type} lang={preview.doc.lang} title={preview.entry.name} text={preview.text} network={false} from={null} />
              ))}
            {preview.note && <div className="dim">{preview.note}</div>}
            {!preview.image && !preview.media && preview.text == null && !preview.note && <div className="dim">Loading…</div>}
          </div>
          <div className="sheet-actions wrap">
            <button className="btn danger" onClick={() => void remove(preview.entry)}>
              Delete
            </button>
            <button
              className="btn"
              onClick={() => {
                if (!openFile(preview.entry.path)) toast('Open works in the phone app', 'warn')
              }}
            >
              Open with…
            </button>
            {preview.text != null && (
              <button
                className="btn"
                disabled={Boolean(openBlocked) || openingCanvas}
                title={openBlocked || undefined}
                onClick={async () => {
                  if (openingCanvas || openBlocked) return
                  const targetPath = preview.entry.path
                  setOpeningCanvas(true)
                  try {
                    if (await openFileInCanvas(targetPath)) {
                      setPreview(null)
                      setState({ screen: null })
                    }
                  } finally {
                    setOpeningCanvas(false)
                  }
                }}
              >
                Open in canvas
              </button>
            )}
            <button
              className="btn primary"
              onClick={() => {
                onUse(`Look at the file ${preview.entry.path} and `)
                setPreview(null)
                setState({ screen: null })
              }}
            >
              Ask Hermux
            </button>
          </div>
        </Sheet>
      )}
    </ScreenShell>
  )
}

// ── Projects ─────────────────────────────────────────────────

interface Project {
  id: string
  slug: string
  name: string
  description?: string | null
  primary_path?: string | null
  folders?: { path?: string }[]
  created_at: number
}

export function ProjectsScreen() {
  const profile = useStore(s => s.profile)
  const { data, error, loading, reload } = useLoader(() => rpc<{ projects: Project[]; active_id?: string | null }>('projects.list'), [profile])
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', path: '', description: '' })
  const [openP, setOpenP] = useState<Project | null>(null)
  const [sessions, setSessions] = useState<{ id?: string; title?: string; label?: string }[] | null>(null)

  const slug = form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const defaultPath = slug ? `/root/projects/${slug}` : ''

  const create = async () => {
    const dir = (form.path || defaultPath).trim()
    try {
      await api('POST', '/api/files/mkdir', { path: dir }, { profile: false }).catch(() => undefined)
      await rpc('projects.create', { name: form.name.trim(), description: form.description.trim() || null, folders: [dir], primary_path: dir, use: true })
      toast('Project created')
      setCreating(false)
      setForm({ name: '', path: '', description: '' })
      reload()
    } catch (e) {
      toast(errText(e), 'error', 6000)
    }
  }

  const show = async (p: Project) => {
    setOpenP(p)
    setSessions(null)
    try {
      type Row = { id?: string; title?: string; label?: string; last_active?: number }
      const r = await rpc<{ project?: { previewSessions?: Row[]; repos?: { groups?: { sessions?: Row[] }[] }[] } }>('projects.project_sessions', {
        project_id: p.id,
        session_limit: 30
      })
      // Hermes fills repos → groups (branches) → sessions; previewSessions is often empty.
      const all = [...(r.project?.previewSessions || []), ...(r.project?.repos || []).flatMap(x => (x.groups || []).flatMap(g => g.sessions || []))]
      const seen = new Set<string>()
      setSessions(all.filter(x => x.id && !seen.has(x.id) && seen.add(x.id)).sort((a, b) => (b.last_active || 0) - (a.last_active || 0)))
    } catch {
      setSessions([])
    }
  }

  const startChat = async (p: Project) => {
    try {
      await rpc('projects.set_active', { id: p.id })
      await newSession({ cwd: p.primary_path || p.folders?.[0]?.path || undefined })
      setOpenP(null)
      setState({ screen: null })
    } catch (e) {
      toast(errText(e), 'error')
    }
  }

  const remove = async (p: Project) => {
    if (!(await confirmDialog({ title: `Remove project “${p.name}”?`, message: 'Its folder and chats are kept.', confirmLabel: 'Remove', danger: true }))) return
    try {
      await rpc('projects.delete', { id: p.id })
      setOpenP(null)
      reload()
    } catch (e) {
      toast(errText(e), 'error')
    }
  }

  return (
    <ScreenShell
      title="Projects"
      actions={
        <button className="icon-btn" aria-label="New project" onClick={() => setCreating(true)}>
          <Icon n="plus" />
        </button>
      }
    >
      <Status
        loading={loading}
        error={error}
        empty={!data?.projects?.length}
        emptyText=""
        emptyState={
          <EmptyState
            icon="folder"
            title="No projects yet"
            text="A project keeps the chats about one folder together, and Hermux works in that folder."
            action="New project"
            onAction={() => setCreating(true)}
          />
        }
      />
      {data?.projects?.map(p => (
        <button key={p.id} className={`card as-button${data.active_id === p.id ? ' active' : ''}`} onClick={() => void show(p)}>
          <div className="card-head">
            <span className="list-title"><Icon n="folder" /> {p.name}</span>
            {data.active_id === p.id && <span className="tag">active</span>}
          </div>
          {p.description && <div className="card-text">{p.description}</div>}
          <div className="mono small dim">{p.primary_path || p.folders?.[0]?.path || ''}</div>
        </button>
      ))}
      {creating && (
        <Sheet title="New project" onClose={() => setCreating(false)}>
          <div className="sheet-scroll">
            <label className="field">
              <span>Name</span>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="KBAI assignment 1" />
            </label>
            <label className="field">
              <span>Folder</span>
              <input value={form.path} onChange={e => setForm({ ...form, path: e.target.value })} placeholder={defaultPath || '/root/projects/…'} />
            </label>
            <label className="field">
              <span>Description (optional)</span>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </label>
          </div>
          <div className="sheet-actions">
            <button className="btn" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={!form.name.trim()} onClick={() => void create()}>
              Create
            </button>
          </div>
        </Sheet>
      )}
      {openP && (
        <Sheet title={openP.name} onClose={() => setOpenP(null)}>
          <div className="mono small dim">{openP.primary_path}</div>
          <div className="sheet-scroll">
            <div className="group-title">Chats</div>
            {sessions == null && <div className="dim">Loading…</div>}
            {sessions?.length === 0 && <div className="dim">No chats in this project yet</div>}
            {sessions?.map((s, i) => (
              <button
                key={s.id || i}
                className="list-row project-chat"
                disabled={!s.id}
                onClick={() => {
                  if (!s.id) return
                  haptic()
                  setOpenP(null)
                  setState({ screen: null })
                  resumeSession(s.id).catch(e => toast(errText(e), 'error'))
                }}
              >
                <span className="list-title">{s.title || s.label || s.id}</span>
                <span className="chev dim"><Icon n="right" /></span>
              </button>
            ))}
          </div>
          <div className="sheet-actions">
            <button className="btn danger" onClick={() => void remove(openP)}>
              Remove
            </button>
            <button className="btn primary" onClick={() => void startChat(openP)}>
              New chat here
            </button>
          </div>
        </Sheet>
      )}
    </ScreenShell>
  )
}
