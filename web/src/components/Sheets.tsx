import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { openSettingsOn } from '../settings-open'
import type { CommandsCatalogResult, GoalSnapshot, ModelOptionsResult } from '@hermes/shared/gateway-contract.generated'
import { canRestoreFile, checkpointDiff, folderLabel, hunksOnly, listCheckpoints, reasonLabel, restoreCheckpoint, restoreLines, restoreSummary, type CheckpointFolder, type DiffFile, type Snapshot } from '../checkpoints'
import { REASONING_EFFORT_VALUES } from '@hermes/shared/reasoning-effort'
import { compressChat, errText, goalAction, reconnectNow, rpc, setModel, setReasoning } from '../gateway'
import { confirmDialog } from '../dialog'
import { plainTitle } from './Title'
import { checkHealth, dotState, type Health } from '../health'
import { setState, toast, useStore } from '../store'
import { copyText, haptic, setupFix, setupState } from '../bridge'
import { api } from '../api'
import { shizukuRow } from '../statusrows'
import type { PhoneAccess } from '../setupflow'
import { refreshLogins } from '../api'
import { isFav, toggleFav, useFavs } from '../favs'
import { addCustom, customCandidate, isCustom, removeCustom, useCustoms, withCustoms } from '../custommodels'
import { useSheetDrag } from './useSheetDrag'
import { DiffView } from './Diff'
import { useBackHandler } from '../backstack'
import { Spinner } from './Spinner'
import { fmtCost } from '../ctxring'
import { openReport } from './Report'
import { Icon } from './icons'
import { Row as SetRow, Section } from './ui'
import { LoadError } from './Screens'
import { LOAD_LIMIT_MS, timeLimit } from '../timelimit'
import { cachedModels, liveOnce, refreshDue, refreshing, saveModels, slim, type ModelList } from '../modelcache'

/** How long the model picker's live refresh waits for the subscription-token renewal before going on without it. */
const LOGIN_LIMIT_MS = 8000

function Shell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose?: () => void }) {
  const close = onClose ?? (() => setState({ sheet: null }))
  const drag = useSheetDrag(close)
  return (
    <div className="sheet-backdrop" onClick={close}>
      <div className="sheet tall" role="dialog" ref={drag.ref} {...drag.bind} onClick={e => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-title">{title}</div>
        {children}
      </div>
    </div>
  )
}

export function ModelSheet() {
  const active = useStore(s => s.active)
  const profile = useStore(s => s.profile)
  // The list shown last time, at once (Hermes takes seconds to build it on a phone); Hermes's answer replaces it.
  const [data, setData] = useState<ModelList | null>(() => cachedModels(profile))
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [updating, setUpdating] = useState(() => refreshing(profile))
  const [tries, setTries] = useState(0) // Try again / Refresh the list: load once more
  const forced = useRef(false)
  useEffect(() => {
    let gone = false
    let live = false // a live list arrived: a later plain read (maybe staler) must not replace it
    setErr('')
    // A plain open reads Hermes's disk cache of each provider's catalog (stale after a new login or new models).
    // No answer within LOAD_LIMIT_MS ends in an error with Try again; a late answer still fills the list.
    const plain = rpc<ModelOptionsResult>('model.options', { session_id: active?.runtimeId })
    plain
      .then(r => {
        if (gone || live) return
        const list = slim(r)
        saveModels(profile, list, false)
        setData(list)
        setErr('')
      })
      .catch(() => {})
    timeLimit(plain, LOAD_LIMIT_MS).catch(e => !gone && !live && setErr(errText(e)))
    // The live list (every catalog fetched again) only when the last one is old, or when asked: it is slow on a phone
    // and runs beside a reply. One already running (opened before) is waited for instead of starting another.
    if (forced.current || refreshDue(profile) || refreshing(profile)) {
      forced.current = false
      setUpdating(true)
      liveOnce(profile, () =>
        // An expired subscription token is renewed first, so the live list has that provider's models; a dashboard that
        // doesn't answer holds it for LOGIN_LIMIT_MS at most.
        timeLimit(refreshLogins(), LOGIN_LIMIT_MS)
          .catch(() => null)
          .then(() => rpc<ModelOptionsResult>('model.options', { session_id: active?.runtimeId, refresh: true }))
      )
        .then(list => {
          if (gone) return
          live = true
          setData(list)
          setErr('')
        })
        .catch(() => {})
        .finally(() => !gone && setUpdating(false))
    }
    return () => {
      gone = true
    }
  }, [active?.runtimeId, profile, tries])
  const again = (live: boolean) => {
    haptic()
    forced.current = live
    setTries(n => n + 1)
  }
  const currentModel = active?.info.model || data?.model
  const currentProvider = active?.info.provider || data?.provider
  const defaultEffort = useStore(s => s.defaultEffort)
  const effort = active?.info.reasoning_effort || defaultEffort || 'medium'
  const touched = useRef(false) // a level picked in this sheet wins over the medium reset on a model switch
  const customs = useCustoms()
  // Connected providers (current first) with the model ids typed in earlier added to their lists. A provider whose
  // catalog lists nothing stays here: it can still take a typed id.
  const connected = useMemo(() => {
    const isCur = (p: { slug: string; is_current?: boolean | null }) => Number(Boolean(p.is_current) || p.slug === currentProvider?.replace(/^custom:/, ''))
    return withCustoms((data?.providers || []).filter(p => p.authenticated !== false || p.is_current), customs).sort((a, b) => isCur(b) - isCur(a))
  }, [data, customs, currentProvider])
  const providers = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return connected
      .map(p => ({ ...p, models: (p.models || []).filter(m => !needle || m.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle)) }))
      .filter(p => p.models.length)
  }, [connected, q])
  // A typed id no provider lists: offer it under every connected provider (Hermes Desktop's "Custom model").
  const typed = data ? customCandidate(q, connected) : null
  const favs = useFavs()
  // Starred models first, in the order starred; only those this profile can use now (and that match the search).
  const favRows = useMemo(
    () => favs.flatMap(f => {
      const p = providers.find(x => x.slug === f.p)
      return p && p.models.includes(f.m) ? [{ p, m: f.m }] : []
    }),
    [favs, providers]
  )
  const pick = (slug: string, m: string, remember = false) => {
    haptic()
    // A new chat's switch waits for its agent (~2 s); a send meanwhile waits for the switch.
    setState({ sheet: null })
    setModel(slug, m, touched.current ? undefined : defaultEffort || 'medium')
      .then(() => remember && addCustom(slug, m))
      .catch(x => toast(errText(x), 'error'))
  }
  const row = (p: (typeof providers)[number], m: string, sub?: string) => {
    const on = m === currentModel && (p.slug === currentProvider || `custom:${p.slug}` === currentProvider)
    const starred = isFav(favs, p.slug, m)
    return (
      <div key={`${p.slug}/${m}`} className={`row model-row${on ? ' on' : ''}`}>
        <button className="model-pick" aria-pressed={on} onClick={() => pick(p.slug, m)}>
          <span className="model-name">
            {on ? <Icon n="active" /> : null}{on ? ' ' : ''}
            {m}
          </span>
          {sub && <span className="dim model-sub">{sub}</span>}
        </button>
        {!sub && isCustom(customs, p.slug, m) && (
          <button
            className="star-btn"
            aria-label={`Forget ${m}`}
            onClick={() => {
              haptic()
              removeCustom(p.slug, m)
            }}
          >
            <Icon n="close" />
          </button>
        )}
        <button
          className={`star-btn${starred ? ' starred' : ''}`}
          aria-label={starred ? `Unstar ${m}` : `Star ${m}`}
          aria-pressed={starred}
          onClick={() => {
            haptic()
            toggleFav(p.slug, m)
          }}
        >
          <Icon n="star" className={starred ? 'filled' : undefined} />
        </button>
      </div>
    )
  }
  return (
    <Shell title="Model">
      <div className="effort-row">
        {REASONING_EFFORT_VALUES.map(e => (
          <button
            key={e}
            className={`pill${e === effort ? ' on' : ''}`}
            onClick={() => {
              haptic()
              touched.current = true
              setReasoning(e).catch(x => toast(errText(x), 'error'))
            }}
          >
            {e}
          </button>
        ))}
      </div>
      <input className="search" placeholder="Search models…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="sheet-scroll">
        {err && !data && <LoadError error={err} onRetry={() => again(false)} />}
        {!data && !err && <div className="dim pad">Loading models…</div>}
        {favRows.length > 0 && (
          <div className="group fav-group">
            <div className="group-title">Favourites</div>
            {favRows.map(({ p, m }) => row(p, m, p.name))}
          </div>
        )}
        {providers.map(p => (
          <div key={p.slug} className="group">
            <div className="group-title">
              {p.name}
              {p.free_tier ? <span className="tag">free</span> : null}
            </div>
            {p.models.map(m => row(p, m))}
          </div>
        ))}
        {typed && connected.length > 0 && (
          <div className="group typed-group">
            <div className="group-title">Use “{typed}”</div>
            {connected.map(p => (
              <div key={p.slug} className="row model-row">
                <button className="model-pick" aria-label={`Use ${typed} with ${p.name}`} onClick={() => pick(p.slug, typed, true)}>
                  <span className="model-name">{typed}</span>
                  <span className="dim model-sub">{p.name}</span>
                </button>
              </div>
            ))}
          </div>
        )}
        {data && !q && (
          <div className="dim small pad model-foot">
            Missing a model? Type its exact name in the search box to use it.{' '}
            {updating ? (
              <span className="model-updating">Updating the list…</span>
            ) : (
              <button className="report-link" onClick={() => again(true)}>
                Refresh the list
              </button>
            )}
          </div>
        )}
        {/* Last row: Settings on Add a provider; Back there comes back to this chat (settings-open.ts). */}
        <button className="row model-add" onClick={() => { haptic(); openSettingsOn('add') }}>
          <Icon n="plus" />
          <span>Add a provider</span>
        </button>
      </div>
    </Shell>
  )
}

export function CommandsSheet({ onPick }: { onPick: (cmd: string) => void }) {
  const [data, setData] = useState<CommandsCatalogResult | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    rpc<CommandsCatalogResult>('commands.catalog').then(setData).catch(e => toast(errText(e), 'error'))
  }, [])
  const needle = q.trim().toLowerCase()
  const cats = (data?.categories || []).map(c => ({
    name: c.name,
    pairs: (c.pairs || []).filter(([cmd, desc]) => !needle || cmd.toLowerCase().includes(needle) || (desc || '').toLowerCase().includes(needle))
  }))
  const skills = Object.entries(data?.skills || {}).filter(([n]) => !needle || n.toLowerCase().includes(needle))
  return (
    <Shell title="Commands">
      <input className="search" placeholder="Search commands and skills…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
      <div className="sheet-scroll">
        {!data && <div className="dim pad">Loading…</div>}
        {cats
          .filter(c => c.pairs.length)
          .map(c => (
            <div key={c.name} className="group">
              <div className="group-title">{c.name}</div>
              {c.pairs.map(([cmd, desc]) => (
                <button key={cmd} className="row cmd" onClick={() => onPick(cmd.startsWith('/') ? cmd : `/${cmd}`)}>
                  <span className="mono">{cmd.startsWith('/') ? cmd : `/${cmd}`}</span>
                  <span className="dim">{desc}</span>
                </button>
              ))}
            </div>
          ))}
        {skills.length > 0 && (
          <div className="group">
            <div className="group-title">Skills ({skills.length})</div>
            {skills.slice(0, 200).map(([name, meta]) => (
              <button key={name} className="row cmd" onClick={() => onPick(`/${name.replace(/^\/+/, '')}`)}>
                <span className="mono">/{name.replace(/^\/+/, '')}</span>
                <span className="dim">{String((meta as { description?: string })?.description || '')}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}

/** Chat details (from the chat menu): read-only facts, in groups and plain words. Rename, undo and delete live in the
 *  menu itself. */
export function SessionActionsSheet() {
  const active = useStore(s => s.active)
  const profiles = useStore(s => s.profiles)
  if (!active) return null
  const u = active.usage
  const bot = profiles.find(p => p.name === active.profile)
  const tokens = u != null && (u.input != null || u.output != null)
  const usage = u != null && (tokens || u.context_percent != null || u.cost_usd != null)
  return (
    <Shell title="Chat details">
      <div className="sheet-scroll details">
        <Section title="Chat">
          <SetRow title="Title" value={plainTitle(active.title) || '—'} />
          <SetRow title="Bot" value={bot?.display_name || active.profile || '—'} />
          <SetRow title="Working folder" sub={<span className="mono">{active.info.cwd || '—'}</span>} />
        </Section>
        <Section title="Model">
          <SetRow title="Model" value={active.info.model || '—'} />
          <SetRow title="Provider" value={active.info.provider || '—'} />
        </Section>
        {usage && u && (
          <Section title="Usage">
            {tokens && <SetRow title="Tokens" value={`${(u.input ?? 0).toLocaleString()} in · ${(u.output ?? 0).toLocaleString()} out`} />}
            {u.context_percent != null && <SetRow title="Context" value={`${Math.round(u.context_percent)}% used`} />}
            {u.cost_usd != null && <SetRow title="Cost" value={`$${u.cost_usd.toFixed(4)}`} />}
          </Section>
        )}
        <Section>
          <SetRow
            title="Chat ID"
            sub={<span className="mono">{active.storedId}</span>}
            trailing={
              <button
                className="icon-btn"
                aria-label="Copy chat ID"
                onClick={() => {
                  haptic()
                  void copyText(active.storedId).then(() => toast('Copied'))
                }}
              >
                <Icon n="copy" />
              </button>
            }
          />
        </Section>
      </div>
    </Shell>
  )
}

// ── backend status ────────────────────────────────────────

const STATE_WORD: Record<string, string> = { error: 'Offline', closed: 'Offline', idle: 'Offline', connecting: 'Connecting', ok: 'OK', connected: 'Connected', running: 'Running', degraded: 'Degraded', fatal: 'Failed' }
const word = (s?: string) => (s ? STATE_WORD[s] || s.replace(/_/g, ' ') : '—')
const tone = (s?: string) => (!s ? '' : /^(ok|connected|running)$/.test(s) ? 'ok' : /fatal|error|down|stopped/.test(s) ? 'err' : 'warn')
const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000)
  return s < 5 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`
}

function Row({ label, value, state, note, onClick }: { label: string; value: string; state?: string; note?: string | null; onClick?: () => void }) {
  return (
    <div className="status-row" {...(onClick ? { role: 'button', tabIndex: 0, onClick, style: { cursor: 'pointer' } } : {})}>
      <span className={`conn-dot ${state || ''}`} />
      <div className="status-main">
        <div className="status-label">{label}</div>
        {note ? <div className="status-note">{note}</div> : null}
      </div>
      <div className="status-value">{value}</div>
    </div>
  )
}

export function StatusSheet() {
  const conn = useStore(s => s.conn)
  const detail = useStore(s => s.connDetail)
  const h = useStore(s => s.health) as Health | null
  const [busy, setBusy] = useState(false)
  // What Hermes can do with Shizuku: undefined = asking, null = no answer. One call per open / "Check again"; a late answer after close is dropped.
  const [shz, setShz] = useState<PhoneAccess['shizuku'] | null | undefined>(undefined)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => void (alive.current = false)
  }, [])
  const refresh = () => {
    setBusy(true)
    setShz(undefined)
    void checkHealth().finally(() => setBusy(false))
    void api<PhoneAccess>('GET', '/api/plugins/hermes-mobile/phone-access', undefined, { profile: false })
      .then(p => (p && typeof p.shizuku === 'string' ? p.shizuku : null), () => null)
      .then(v => alive.current && setShz(v))
  }
  useEffect(refresh, [])
  const shRow = shizukuRow(setupState(), shz)
  const dot = dotState(conn, h)
  const headline =
    dot === 'ok' ? 'Everything is working' : dot === 'wait' ? 'Connecting to Hermux…' : dot === 'err' ? 'Hermux is offline' : 'Hermux is up, with problems'
  const mem = h?.memory
  return (
    <Shell title="Backend status">
      <div className="sheet-scroll">
        <div className={`status-hero ${dot}`}>
          <span className={`conn-dot big ${dot}`} />
          <div>
            <div className="status-headline">{headline}</div>
            <div className="dim small">
              {h ? `Checked ${ago(h.checkedAt)}` : 'Checking…'}
              {h?.version ? ` · Hermux agent v${h.version}` : ''}
            </div>
          </div>
        </div>
        <Row
          label="Connection"
          value={conn === 'open' ? (h?.pingMs != null ? `${h.pingMs} ms` : 'Connected') : word(conn)}
          state={conn === 'open' ? 'ok' : conn === 'connecting' ? 'wait' : 'err'}
          note={conn === 'open' ? 'Live link to Hermux on this phone' : detail || null}
        />
        <Row label="Dashboard" value={h?.error ? 'Unreachable' : word(h?.components?.dashboard?.status || (h ? 'ok' : undefined))} state={h?.error ? 'err' : tone(h?.components?.dashboard?.status || 'ok')} note={h?.error ? "Can't reach Hermux's dashboard on the phone" : null} />
        {h?.active_agents != null && <Row label="Agents running" value={String(h.active_agents)} state={h.active_agents ? 'wait' : 'ok'} />}
        {mem && (
          <Row
            label="Memory"
            value={mem.system_available_mb != null ? `${(mem.system_available_mb / 1024).toFixed(1)} GB free` : word(mem.pressure)}
            state={tone(mem.pressure)}
            note={mem.swap_used_mb ? `${(mem.swap_used_mb / 1024).toFixed(1)} GB swap in use` : null}
          />
        )}
        {h?.disk && <Row label="Storage" value={h.disk.free_mb != null ? `${Math.round(h.disk.free_mb / 1024)} GB free` : word(h.disk.pressure)} state={tone(h.disk.pressure)} />}
        {shRow && (
          <Row
            label="Shizuku"
            value={shRow.value}
            state={shRow.state}
            note={shRow.note}
            onClick={
              shRow.fix === 'open-shizuku'
                ? () => setupFix('open-shizuku')
                : shRow.fix === 'setup'
                  ? () => setState({ sheet: null, screen: 'setup' })
                  : undefined
            }
          />
        )}
        <div className="sheet-actions col">
          <button className="btn primary" disabled={busy} onClick={refresh}>
            {busy ? 'Checking…' : 'Check again'}
          </button>
          <button
            className="btn"
            onClick={() => {
              haptic()
              reconnectNow()
              toast('Reconnecting…')
            }}
          >
            Reconnect / start Hermux
          </button>
          {dot !== 'ok' && dot !== 'wait' && (
            <button className="btn" onClick={() => { setState({ sheet: null }); openReport() }}>
              Report a problem
            </button>
          )}
          <button className="btn" onClick={() => setState({ sheet: null, screen: 'setup' })}>
            Setup check
          </button>
        </div>
      </div>
    </Shell>
  )
}

const when = (ts?: string) => {
  if (!ts) return ''
  const d = new Date(/^\d+(\.\d+)?$/.test(ts) ? Number(ts) * 1000 : ts)
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Hermes snapshots a folder before it edits a file there (once per turn). This lists the snapshots this chat
 * caused, grouped by folder, with what changed since each one, and restores a folder or one file. */
export function RollbackSheet() {
  const a = useStore(s => s.active)
  const [folders, setFolders] = useState<CheckpointFolder[] | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<{ workdir: string; snap: Snapshot } | null>(null)
  const [diff, setDiff] = useState<DiffFile[] | null>(null)
  const [diffErr, setDiffErr] = useState('')
  const [busy, setBusy] = useState(false)
  useBackHandler(() => setOpen(null), open != null)
  const load = () => {
    if (!a) return
    listCheckpoints(a.storedId)
      .then(setFolders)
      .catch(e => setErr(errText(e)))
  }
  useEffect(load, [a?.storedId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setDiff(null)
    setDiffErr('')
    if (!a || !open) return
    checkpointDiff(a.storedId, open.workdir, open.snap.id)
      .then(setDiff)
      .catch(e => setDiffErr(errText(e)))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!a) return null
  const restore = async (only = '') => {
    if (!open || !diff || busy) return
    const lines = restoreLines(diff, only)
    const ok = await confirmDialog({
      title: only ? `Restore ${only}?` : 'Restore this folder?',
      message: only
        ? `It goes back to how it was at ${when(open.snap.date)}.`
        : `${folderLabel(open.workdir)} goes back to ${when(open.snap.date)}. Files you changed yourself are kept; the chat itself stays as it is.`,
      list: lines,
      icon: 'reset',
      confirmLabel: lines.length === 1 ? 'Restore 1 file' : `Restore ${lines.length} files`,
      danger: true
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await restoreCheckpoint(a.storedId, open.workdir, open.snap.id, only)
      const sum = restoreSummary(r, only)
      toast(sum.text, sum.warn ? 'warn' : 'info', 5000)
      setOpen(null)
      load() // Hermes snapshotted the state before the restore: the list changed
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const snap = open?.snap
  return (
    <Shell title={snap ? `Snapshot · ${when(snap.date)}` : 'File checkpoints'}>
      <div className="sheet-scroll">
        {err ? (
          <div className="dim pad">{err}</div>
        ) : !folders ? (
          <div className="dim pad">
            <Spinner small /> Loading…
          </div>
        ) : open && snap ? (
          <>
            <button className="menu-item" onClick={() => setOpen(null)}>
              <span className="mi-icon"><Icon n="left" /></span>
              All checkpoints
            </button>
            <div className="dim small pad">
              {folderLabel(open.workdir)} · before this chat edited {snap.files.join(', ')}. Changed since then:
            </div>
            {diffErr ? (
              <div className="dim pad">{diffErr}</div>
            ) : !diff ? (
              <div className="dim pad">
                <Spinner small /> Loading…
              </div>
            ) : diff.length === 0 ? (
              <div className="dim pad">Nothing changed since this snapshot.</div>
            ) : (
              diff.map(f => (
                <div key={f.file} className="cp-file">
                  <div className="cp-file-head">
                    <span className={`cp-status ${f.status}`}>{f.status === 'added' ? 'new' : f.status === 'deleted' ? 'deleted' : 'changed'}</span>
                    <span className="cp-name">{f.file}</span>
                    <span className="dim small">
                      +{f.added} −{f.removed}
                    </span>
                    {snap.files.includes(f.file) && canRestoreFile(diff, f.file) && diff.length > 1 && (
                      <button className="btn" disabled={busy} onClick={() => void restore(f.file)}>
                        Restore file
                      </button>
                    )}
                  </div>
                  <DiffView text={hunksOnly(f.diff)} />
                </div>
              ))
            )}
            {diff && diff.length > 0 && (
              <button
                className="btn danger block rollback-go"
                disabled={busy}
                // One changed file: put exactly that file back. Several: Hermes's safe folder restore (keeps your own edits).
                onClick={() => void restore(diff.length === 1 && canRestoreFile(diff, diff[0].file) ? diff[0].file : '')}
              >
                {busy ? 'Restoring…' : diff.length === 1 ? `Restore ${diff[0].file}` : `Restore these ${diff.length} files`}
              </button>
            )}
          </>
        ) : folders.length === 0 ? (
          <div className="dim pad">No checkpoints yet. Hermux snapshots a folder before this chat first edits a file in it, once per turn.</div>
        ) : (
          folders.map(f => (
            <div key={f.workdir}>
              <div className="cp-folder" title={f.workdir}>
                {folderLabel(f.workdir)}
              </div>
              {f.snapshots.map((c, i) => (
                <button key={c.id} className="menu-item" onClick={() => setOpen({ workdir: f.workdir, snap: c })}>
                  <span className="mi-icon"><Icon n="active" /></span>
                  <span className="mi-text">
                    <span>
                      {when(c.date)}
                      {i === 0 && <span className="cp-latest"> · latest</span>}
                    </span>
                    <span className="mi-sub">
                      {reasonLabel(c.reason)} · {c.files.join(', ')}
                    </span>
                  </span>
                </button>
              ))}
              {f.pruned > 0 && (
                <div className="dim small pad">
                  {f.pruned} older snapshot{f.pruned === 1 ? '' : 's'} pruned (Hermux keeps 20 per folder)
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </Shell>
  )
}

const CONTRACT_LABELS: [keyof GoalSnapshot['contract'], string][] = [
  ['outcome', 'Outcome'],
  ['verification', 'Verification'],
  ['constraints', 'Constraints'],
  ['boundaries', 'Boundaries'],
  ['stop_when', 'Stop when']
]

/** The chat's goal (Hermes's /goal): its contract and subgoals, with Pause / Resume and Clear. Opened from the goal line in the status bar. */
export function GoalSheet({ goal, onClose }: { goal: GoalSnapshot; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  useBackHandler(onClose, true)
  const paused = goal.status === 'paused'
  const run = async (action: 'goal.pause' | 'goal.resume' | 'goal.clear') => {
    if (busy) return
    setBusy(true)
    haptic()
    try {
      await goalAction(action)
    } finally {
      setBusy(false)
    }
  }
  const clear = async () => {
    const ok = await confirmDialog({ title: 'Clear this goal?', confirmLabel: 'Clear', danger: true })
    if (ok) {
      await run('goal.clear')
      onClose()
    }
  }
  const rows = CONTRACT_LABELS.filter(([k]) => goal.contract?.[k])
  return (
    <Shell title="Goal" onClose={onClose}>
      <div className="sheet-scroll">
        <div className="kv">
          <div>Goal</div>
          <div>{goal.title}</div>
          <div>Status</div>
          <div>{goal.status}{goal.paused_reason ? ` (${goal.paused_reason})` : ''}</div>
          <div>Turns</div>
          <div>{goal.turns_used} of {goal.max_turns}</div>
          {rows.map(([k, label]) => (
            <Fragment key={k}>
              <div>{label}</div>
              <div>{goal.contract[k]}</div>
            </Fragment>
          ))}
          {goal.last_verdict ? (
            <>
              <div>Last verdict</div>
              <div>{goal.last_verdict}</div>
            </>
          ) : null}
          {goal.last_reason ? (
            <>
              <div>Reason</div>
              <div>{goal.last_reason}</div>
            </>
          ) : null}
        </div>
        {goal.subgoals?.length > 0 && (
          <>
            <div className="dim small goal-sub-head">Subgoals</div>
            <ul className="goal-subs">
              {goal.subgoals.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </>
        )}
        <div className="sheet-actions col">
          {(goal.status === 'active' || paused) && (
            <button className="btn primary" disabled={busy} onClick={() => void run(paused ? 'goal.resume' : 'goal.pause')}>
              {paused ? 'Resume' : 'Pause'}
            </button>
          )}
          <button className="btn danger" disabled={busy} onClick={() => void clear()}>
            Clear goal
          </button>
        </div>
      </div>
    </Shell>
  )
}

/** Compress older turns (session.compress), shared by the compress hint and the context sheet. `run` toasts the result; `onDone` runs afterwards. */
export function useCompress(onDone?: () => void): { busy: boolean; run: () => void } {
  const [busy, setBusy] = useState(false)
  const run = () => {
    if (busy) return
    setBusy(true)
    haptic()
    compressChat()
      .then(t => toast(t))
      .catch(e => toast(errText(e), 'error'))
      .finally(() => {
        onDone?.()
        setBusy(false)
      })
  }
  return { busy, run }
}

/** The chat's context window: how full it is, what Hermes reports about tokens, cost and cache, and a Compress button. */
export function ContextSheet() {
  const ctx = useStore(s => s.active?.ctx)
  const usage = useStore(s => s.active?.usage)
  const running = useStore(s => s.active?.running ?? false)
  const { busy, run } = useCompress()
  const pct = ctx ? Math.min(100, Math.max(0, ctx.percent)) : 0
  return (
    <Shell title="Context window">
      <div className="sheet-scroll">
        {ctx ? (
          <>
            <div className="ctx-bar" role="img" aria-label={`${Math.round(pct)}% used`}>
              <div className={`ctx-bar-fill ${pct >= 90 ? 'full' : pct >= 80 ? 'warn' : ''}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="ctx-figures">{Math.round(pct)}% used</div>
            <div>
              {ctx.used.toLocaleString()} of {ctx.max.toLocaleString()} tokens
            </div>
            {usage?.context_estimated ? <div className="dim small">estimated by Hermux</div> : null}
          </>
        ) : (
          <div className="dim">Nothing to show yet.</div>
        )}
        {usage && (usage.input != null || usage.output != null) ? (
          <div className="ctx-row">
            This chat so far: input {(usage.input ?? 0).toLocaleString()} · output {(usage.output ?? 0).toLocaleString()}
          </div>
        ) : null}
        {usage?.cost_usd != null ? <div className="ctx-row">Cost: {fmtCost(usage.cost_usd)}</div> : null}
        {usage?.cache_hit_pct != null ? <div className="ctx-row">Cache hits: {Math.round(usage.cache_hit_pct)}%</div> : null}
        <button className="btn block ctx-compress" disabled={running || busy || !ctx} onClick={run}>
          {busy ? <Spinner small /> : 'Compress older turns'}
        </button>
        {running ? <div className="dim small">Wait for the reply to finish</div> : null}
      </div>
    </Shell>
  )
}
