import { useBackHandler } from '../backstack'
import { confirmDialog } from '../dialog'
import { openFileInCanvas } from '../canvas'
import { useSheetDrag } from './useSheetDrag'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError, qs } from '../api'
import { errText, newSession, resumeSession, rpc } from '../gateway'
import { closeScreen, setState, toast, useStore, type Screen } from '../store'
import { haptic, openFile } from '../bridge'
import { Markdown } from './Markdown'

// ── shared building blocks ──────────────────────────────────

export function ScreenShell({ title, actions, children, onBack }: { title: string; actions?: ReactNode; children: ReactNode; onBack?: () => void }) {
  return (
    <div className="screen">
      <header className="topbar">
        <button className="back-btn" aria-label="Back" onClick={() => (onBack ? onBack() : closeScreen())}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14.5 5.5 8 12l6.5 6.5" />
          </svg>
        </button>
        <div className="title-btn">
          <span className="title">{title}</span>
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

export function useLoader<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const reload = useCallback(() => {
    setLoading(true)
    load()
      .then(d => {
        setData(d)
        setError('')
      })
      .catch(e => setError(errText(e)))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(reload, [reload])
  return { data, error, loading, reload, setData }
}

export function Status({ loading, error, empty, emptyText }: { loading: boolean; error: string; empty: boolean; emptyText: string }) {
  if (error) return <div className="notice notice-error">{error}</div>
  if (loading && empty) return <div className="dim pad">Loading…</div>
  if (empty) return <div className="dim pad">{emptyText}</div>
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
    <ScreenShell title={`Skills ${total ? `· ${on}/${total} on` : ''}`}>
      <div className="screen-tools">
        <input className="search" placeholder="Search skills…" value={q} onChange={e => setQ(e.target.value)} />
        <button className={`pill${onlyOn ? ' on' : ''}`} onClick={() => setOnlyOn(v => !v)}>
          Enabled
        </button>
      </div>
      <Status loading={loading} error={error} empty={!data?.length} emptyText="No skills" />
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
        toast(r.result.error || 'Hermes refused the change', 'error', 6000)
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
        <button className="icon-btn" aria-label="Add" onClick={() => setEdit({ old: null, text: '' })}>
          ＋
        </button>
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
      <Status loading={loading} error={error} empty={!snap?.entries.length} emptyText="Nothing saved yet" />
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
                  void confirmDialog({ title: 'Delete this memory?', message: 'Hermes will forget it.', danger: true }).then(yes => yes && run('remove', undefined, edit.old!).then(ok => ok && setEdit(null)))
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

type Job = Record<string, unknown> & { id?: string; job_id?: string }

function jobId(j: Job): string {
  return String(j.id ?? j.job_id ?? '')
}
function jobPaused(j: Job): boolean {
  return Boolean(j.paused) || j.enabled === false || String(j.state || '').toLowerCase() === 'paused'
}
function jobSchedule(j: Job): string {
  const s = j.schedule as unknown
  if (s && typeof s === 'object') return String((s as Record<string, unknown>).display ?? (s as Record<string, unknown>).expr ?? JSON.stringify(s))
  return String(s ?? j.schedule_display ?? '')
}

const SCHEDULE_EXAMPLES = ['every 30m', 'every 2h', '0 9 * * *', '0 8 * * 1-5', 'tomorrow 9am']

export function CronScreen() {
  const profile = useStore(s => s.profile)
  const { data, error, loading, reload } = useLoader(async () => {
    const r = await api<Job[] | { jobs?: Job[] }>('GET', '/api/cron/jobs')
    return Array.isArray(r) ? r : r.jobs || []
  }, [profile])
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Job | null>(null)
  const [form, setForm] = useState({ name: '', schedule: '', prompt: '' })
  const [runsFor, setRunsFor] = useState<Job | null>(null)
  const [runs, setRuns] = useState<Record<string, unknown>[] | null>(null)
  const [output, setOutput] = useState<{ title: string; text: string | null } | null>(null)

  const act = async (j: Job, what: 'pause' | 'resume' | 'trigger' | 'delete') => {
    haptic()
    try {
      if (what === 'delete') {
        if (!(await confirmDialog({ title: `Delete “${String(j.name || jobId(j))}”?`, message: 'The scheduled job is removed.', danger: true }))) return
        await api('DELETE', `/api/cron/jobs/${encodeURIComponent(jobId(j))}`)
      } else await api('POST', `/api/cron/jobs/${encodeURIComponent(jobId(j))}/${what}`)
      toast(what === 'trigger' ? 'Started' : what === 'delete' ? 'Deleted' : what === 'pause' ? 'Paused' : 'Resumed')
      reload()
    } catch (e) {
      toast(errText(e), 'error')
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

  const create = async () => {
    const body = { name: form.name.trim(), schedule: form.schedule.trim(), prompt: form.prompt.trim(), deliver: 'local' }
    try {
      if (editing) {
        const id = encodeURIComponent(jobId(editing))
        try {
          await api('PUT', `/api/cron/jobs/${id}`, { updates: body }) // the dashboard's shape: {updates: {…}}
          toast('Saved')
        } catch (e) {
          // A dashboard without job editing: replace the job (new id, its run history stays with the old one).
          if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 405)) throw e
          await api('POST', '/api/cron/jobs', body)
          await api('DELETE', `/api/cron/jobs/${id}`)
          toast('Saved as a new job')
        }
      } else {
        await api('POST', '/api/cron/jobs', body)
        toast('Scheduled')
      }
      setCreating(false)
      setEditing(null)
      setForm({ name: '', schedule: '', prompt: '' })
      reload()
    } catch (e) {
      toast(errText(e), 'error', 6000)
    }
  }

  const edit = (j: Job) => {
    haptic()
    setForm({ name: String(j.name || ''), schedule: jobSchedule(j), prompt: String(j.prompt || '') })
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
      title="Cron jobs"
      actions={
        <button className="icon-btn" aria-label="New job" onClick={() => setCreating(true)}>
          ＋
        </button>
      }
    >
      <Status loading={loading} error={error} empty={!data?.length} emptyText="No scheduled jobs on this phone yet. Tap ＋ to create one." />
      {(data || []).map(j => (
        <div key={jobId(j)} className={`card${jobPaused(j) ? ' muted' : ''}`}>
          <div className="card-head">
            <span className="list-title">{String(j.name || String(j.prompt || '').slice(0, 60) || jobId(j))}</span>
            <span className={`tag${jobPaused(j) ? ' off' : ''}`}>{jobPaused(j) ? 'paused' : 'active'}</span>
          </div>
          <div className="mono small">{jobSchedule(j)}</div>
          <div className="dim small">
            Next: {fmtTime(j.next_run_at ?? j.next_run)} · Last: {fmtTime(j.last_run_at ?? j.last_run)}
            {j.last_status ? ` (${String(j.last_status)})` : ''}
          </div>
          {j.prompt ? <div className="card-text">{String(j.prompt).slice(0, 240)}</div> : null}
          <div className="card-actions">
            <button onClick={() => void act(j, 'trigger')}>▶ Run now</button>
            <button onClick={() => void act(j, jobPaused(j) ? 'resume' : 'pause')}>{jobPaused(j) ? 'Resume' : 'Pause'}</button>
            <button onClick={() => void showRuns(j)}>Runs</button>
            <button onClick={() => edit(j)}>Edit</button>
            <button className="danger" onClick={() => void act(j, 'delete')}>
              Delete
            </button>
          </div>
        </div>
      ))}
      {creating && (
        <Sheet title={editing ? 'Edit job' : 'New scheduled job'} onClose={() => { setCreating(false); setEditing(null); setForm({ name: '', schedule: '', prompt: '' }) }}>
          <div className="sheet-scroll">
            <label className="field">
              <span>Name</span>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Morning brief" />
            </label>
            <label className="field">
              <span>Schedule</span>
              <input value={form.schedule} onChange={e => setForm({ ...form, schedule: e.target.value })} placeholder="every 2h  ·  0 9 * * *" />
            </label>
            <div className="effort-row">
              {SCHEDULE_EXAMPLES.map(x => (
                <button key={x} className="pill" onClick={() => setForm({ ...form, schedule: x })}>
                  {x}
                </button>
              ))}
            </div>
            <label className="field">
              <span>What should Hermes do?</span>
              <textarea className="sheet-input" rows={5} value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} />
            </label>
            <div className="dim small">Runs on the phone. Results are saved locally and you get a notification.</div>
          </div>
          <div className="sheet-actions">
            <button className="btn" onClick={() => { setCreating(false); setEditing(null); setForm({ name: '', schedule: '', prompt: '' }) }}>
              Cancel
            </button>
            <button className="btn primary" disabled={!form.schedule.trim() || !form.prompt.trim()} onClick={() => void create()}>
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
  ['Hermes', '/root/.hermes'],
  ['Home', '/root']
]
const TEXT_EXT = /\.(txt|md|markdown|json|ya?ml|toml|ini|cfg|conf|log|csv|tsv|py|js|ts|tsx|jsx|sh|zsh|bash|java|kt|c|h|cpp|rs|go|rb|html|css|xml|sql|env|gitignore)$/i
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i
const PREVIEW_MAX = 3 * 1024 * 1024

function decodeDataUrl(url: string): string {
  const b64 = url.split(',')[1] || ''
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function FilesScreen({ onUse }: { onUse: (text: string) => void }) {
  const [path, setPath] = useState('/sdcard')
  const { data, error, loading, reload } = useLoader(() => api<Listing>('GET', `/api/files?${qs({ path })}`, undefined, { profile: false }), [path])
  const [preview, setPreview] = useState<{ entry: FileEntry; text?: string; image?: string; note?: string } | null>(null)
  const [newDir, setNewDir] = useState<string | null>(null)
  const upload = useRef<HTMLInputElement>(null)
  // Android Back goes up one folder; at one of the root chips (or /) it leaves the screen.
  const atRoot = path === '/' || ROOTS.some(([, p]) => p === path)
  useBackHandler(() => setPath(data?.parent || path.replace(/\/[^/]+\/?$/, '') || '/'), !atRoot && !preview && newDir == null)

  const open = async (e: FileEntry) => {
    if (e.is_directory) {
      setPath(e.path)
      return
    }
    setPreview({ entry: e })
    const canText = TEXT_EXT.test(e.name) || (e.mime_type || '').startsWith('text/')
    const canImg = IMG_EXT.test(e.name) || (e.mime_type || '').startsWith('image/')
    if (!canText && !canImg) return setPreview({ entry: e, note: 'No preview for this file type.' })
    if ((e.size ?? 0) > PREVIEW_MAX) return setPreview({ entry: e, note: `Too large to preview (${fmtSize(e.size)}).` })
    try {
      const r = await api<{ data_url: string }>('GET', `/api/files/read?${qs({ path: e.path })}`, undefined, { profile: false })
      setPreview(canImg ? { entry: e, image: r.data_url } : { entry: e, text: decodeDataUrl(r.data_url) })
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
            ⤒
          </button>
          <button className="icon-btn" aria-label="New folder" onClick={() => setNewDir('')}>
            ＋
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
            ✕
          </button>
        </div>
      )}
      <Status loading={loading} error={error} empty={!data?.entries.length} emptyText="Empty folder" />
      {data?.parent && (
        <button className="file-row" onClick={() => setPath(data.parent!)}>
          <span className="file-icon">↰</span>
          <span className="list-title">..</span>
        </button>
      )}
      {data?.entries.map(e => (
        <button key={e.path} className="file-row" onClick={() => void open(e)}>
          <span className="file-icon">{e.is_directory ? '📁' : IMG_EXT.test(e.name) ? '🖼' : TEXT_EXT.test(e.name) ? '📄' : '📦'}</span>
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
            {preview.text != null &&
              (/\.(md|markdown)$/i.test(preview.entry.name) ? <Markdown text={preview.text} /> : <pre className="tool-pre">{preview.text.slice(0, 200_000)}</pre>)}
            {preview.note && <div className="dim">{preview.note}</div>}
            {!preview.image && preview.text == null && !preview.note && <div className="dim">Loading…</div>}
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
                onClick={() => {
                  const path = preview.entry.path
                  setPreview(null)
                  setState({ screen: null })
                  void openFileInCanvas(path)
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
              Ask Hermes
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
          ＋
        </button>
      }
    >
      <Status loading={loading} error={error} empty={!data?.projects?.length} emptyText="No projects yet. A project groups chats around a folder — tap ＋ to create one." />
      {data?.projects?.map(p => (
        <button key={p.id} className={`card as-button${data.active_id === p.id ? ' active' : ''}`} onClick={() => void show(p)}>
          <div className="card-head">
            <span className="list-title">📁 {p.name}</span>
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
                <span className="chev dim">›</span>
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

// ── Hermes hub ───────────────────────────────────────────────
// One screen for what Hermes knows and does on its own, each with a one-line summary; Back from a page returns here.

const HUB: { key: Exclude<Screen, null>; icon: string; title: string; tone: string }[] = [
  { key: 'skills', icon: '✦', title: 'Skills', tone: 'gold' },
  { key: 'memory', icon: '🧠', title: 'Memory', tone: 'purple' },
  { key: 'cron', icon: '⏱', title: 'Scheduled jobs', tone: 'blue' },
  { key: 'files', icon: '📁', title: 'Files', tone: 'teal' },
  { key: 'projects', icon: '🗂', title: 'Projects', tone: 'green' },
  { key: 'gallery', icon: '🖼', title: 'Canvas gallery', tone: 'gold' }
]

interface HubData {
  skills?: string
  memory?: string
  memPct?: number
  cron?: string
  projects?: string
  gallery?: string
}

/** One loader per card, so a slow one (Hermes busy) doesn't hold the others back. */
const HUB_LOADERS: (() => Promise<Partial<HubData>>)[] = [
  async () => {
    const skills = await api<SkillRow[]>('GET', '/api/skills')
    const on = skills.filter(s => s.enabled !== false).length
    return { skills: `${on} enabled${on < skills.length ? ` of ${skills.length}` : ''}` }
  },
  async () => {
    const mem = await api<MemData>('GET', '/api/plugins/hermes-mobile/memory')
    const pct = mem.memory.limit ? Math.round((mem.memory.used / mem.memory.limit) * 100) : 0
    return { memPct: pct, memory: `${mem.memory.entries.length} notes · ${pct}% full · ${mem.user.entries.length} about you` }
  },
  async () => {
    const jobs = await api<Job[] | { jobs?: Job[] }>('GET', '/api/cron/jobs')
    const list = Array.isArray(jobs) ? jobs : jobs.jobs ?? []
    const active = list.filter(j => !jobPaused(j))
    const next = active
      .map(j => j.next_run_at ?? j.next_run)
      .map(v => (typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : Date.parse(String(v ?? ''))))
      .filter(n => Number.isFinite(n) && n > Date.now())
      .sort((a, b) => a - b)[0]
    return {
      cron: list.length
        ? `${active.length} active${list.length > active.length ? `, ${list.length - active.length} paused` : ''}${next ? ` · next ${fmtTime(next)}` : ''}`
        : 'None yet'
    }
  },
  async () => {
    const r = await rpc<{ projects: Project[] }>('projects.list')
    const n = r.projects.length
    return { projects: n ? `${n} project${n > 1 ? 's' : ''}` : 'None yet' }
  },
  async () => {
    const r = await api<{ items: unknown[]; categories: Record<string, number> }>('GET', '/api/plugins/hermes-mobile/gallery', undefined, { profile: false })
    const n = r.items.length, c = Object.keys(r.categories).length
    return { gallery: n ? `${n} document${n > 1 ? 's' : ''} · ${c} categor${c > 1 ? 'ies' : 'y'}` : 'Every canvas shows up here' }
  }
]

export function HubScreen() {
  const profile = useStore(s => s.profile)
  const [data, setData] = useState<HubData>({})
  const [failed, setFailed] = useState<Set<number>>(() => new Set())
  useEffect(() => {
    let live = true
    setData({})
    setFailed(new Set())
    HUB_LOADERS.forEach((load, i) =>
      load().then(
        d => live && setData(x => ({ ...x, ...d })),
        () => live && setFailed(f => new Set(f).add(i))
      )
    )
    return () => {
      live = false
    }
  }, [profile])
  const sub = (k: string): string => {
    if (k === 'files') return 'Browse, open and upload on the phone'
    const v = data[k as keyof HubData]
    return typeof v === 'string' ? v : failed.has(['skills', 'memory', 'cron', 'projects', 'gallery'].indexOf(k)) ? 'Couldn’t load' : 'Loading…'
  }
  return (
    <ScreenShell title="Hermes">
      <div className="hub">
        {HUB.map(h => (
          <button
            key={h.key}
            className="hub-card"
            onClick={() => {
              haptic()
              setState({ screen: h.key, screenBack: 'hub' })
            }}
          >
            <span className={`set-icon tone-${h.tone}`} aria-hidden="true">{h.icon}</span>
            <span className="hub-text">
              <span className="hub-title">{h.title}</span>
              <span className="hub-sub">{sub(h.key)}</span>
              {h.key === 'memory' && data.memPct != null && (
                <span className="hub-meter" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, data.memPct)}%` }} className={data.memPct >= 90 ? 'full' : ''} />
                </span>
              )}
            </span>
            <span className="chev" aria-hidden="true">›</span>
          </button>
        ))}
      </div>
    </ScreenShell>
  )
}
