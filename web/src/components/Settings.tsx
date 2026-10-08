// Settings: default model per bot (or all), API keys, and every Hermes config option — the phone
// twin of Desktop's Models / Keys / Config pages. All writes go through the dashboard REST API,
// scoped with ?profile=, so Hermes validates and stores them exactly as Desktop would.
import { savedTheme, setTheme, type Theme } from '../theme'
import { autoReadOn, loadVoices, saveTtsConfig, setAutoRead, testVoice, ttsAvailable, ttsConfig, useVoice, type TtsConfig } from '../voice'
import { confirmDialog } from '../dialog'
import { useEffect, useMemo, useState } from 'react'
import { api, qs } from '../api'
import { REASONING_EFFORT_VALUES } from '@hermes/shared/reasoning-effort'
import { errText, loadDefaultModel, loadProfiles, reconnectNow } from '../gateway'
import { getState, setState, toast, useStore } from '../store'
import { appVersion, haptic } from '../bridge'
import { checkForUpdate, startUpdate, useUpdate } from '../update'
import { ScreenShell, Sheet, Status, useLoader } from './Screens'
import { useBackHandler } from '../backstack'
import { getLivePause, setLivePause } from '../live'
import { Row, Section, SelectRow, Segmented, SliderRow, ToggleRow, type Option } from './ui'
import { AccountsList } from './Connect'

// ── shared ───────────────────────────────────────────────────

interface ModelProvider {
  slug: string
  name: string
  is_current?: boolean
  authenticated?: boolean
  models?: string[]
  free_tier?: boolean
}
interface ModelOptions {
  model?: string
  provider?: string
  providers?: ModelProvider[]
}

/** «redacted:sk-o…f800» → sk-o…f800 */
const redacted = (v?: string | null) => (v || '').replace(/^«redacted:(.*)»$/, '$1')

export const profileLabel = (p: { name: string; bot_title?: string; display_name?: string }) =>
  p.display_name || p.bot_title || p.name

/** Main model for one profile, via the same validated path as Desktop's Models page. */
export async function setProfileModel(profile: string, provider: string, model: string, effort = 'medium'): Promise<void> {
  const body = { scope: 'main', provider, model, profile }
  let r = await api<{ ok?: boolean; confirm_required?: boolean; confirm_message?: string }>('POST', '/api/model/set', body, { profile: false })
  if (r?.confirm_required) {
    if (!(await confirmDialog({ title: `Use ${model}?`, message: r.confirm_message || 'This model may cost more than your usual one.', confirmLabel: 'Use it' }))) throw new Error('Cancelled')
    r = await api('POST', '/api/model/set', { ...body, confirm_expensive_model: true }, { profile: false })
  }
  // The reasoning level new chats start with; a per-model override would beat it, so set that too.
  await api('PUT', `/api/config?${qs({ profile })}`, { config: { agent: { reasoning_effort: effort, reasoning_overrides: { [model]: effort } } } }, { profile: false })
  void loadDefaultModel() // the header on the empty home screen follows the default
}

/** Provider → model picker for a profile. `target` is shown in the title. */
export function ModelPicker({ profile, target, onPick, onClose, refresh }: { profile: string; target: string; onPick: (provider: string, model: string, effort: string) => Promise<void>; onClose: () => void; refresh?: boolean }) {
  const [data, setData] = useState<ModelOptions | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [effort, setEffort] = useState('medium')
  useEffect(() => {
    // `refresh` right after a new sign-in or key: Hermes's 1 h model-list cache doesn't know that provider yet.
    // Cached list first (instant), then a live one so models released since the cache was written show up.
    let gone = false
    const load = (live: boolean) => api<ModelOptions>('GET', `/api/model/options?${qs({ profile, ...(live ? { refresh: 'true' } : {}) })}`, undefined, { profile: false })
    if (refresh) load(true).then(setData).catch(e => setErr(errText(e)))
    else {
      load(false).then(r => !gone && setData(r)).catch(e => setErr(errText(e)))
      load(true).then(r => !gone && (setData(r), setErr(''))).catch(() => {})
    }
    return () => {
      gone = true
    }
  }, [profile, refresh])
  const cur = (data?.provider || '').replace(/^custom:/, '')
  const providers = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (data?.providers || [])
      .filter(p => p.authenticated !== false)
      .map(p => ({ ...p, models: (p.models || []).filter(m => !needle || m.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle)) }))
      .filter(p => p.models.length)
      .sort((a, b) => Number(b.slug === cur) - Number(a.slug === cur))
  }, [data, q, cur])
  return (
    <Sheet title={`Model · ${target}`} onClose={onClose}>
      <div className="effort-row">
        {REASONING_EFFORT_VALUES.map(e => (
          <button key={e} className={`pill${e === effort ? ' on' : ''}`} onClick={() => { haptic(); setEffort(e) }}>
            {e}
          </button>
        ))}
      </div>
      <input className="search" placeholder="Search models…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="sheet-scroll">
        {err && <div className="notice notice-error">{err}</div>}
        {!data && !err && <div className="dim pad">Loading models…</div>}
        {data && !providers.length && !q && <div className="dim pad">No connected providers. Sign in under Subscriptions & accounts, or add an API key.</div>}
        {providers.map(p => (
          <div key={p.slug} className="picker-block">
            <div className="picker-group">
              {p.name}
              {p.free_tier ? <span className="tag">free</span> : null}
            </div>
            {p.models.map(m => {
              const on = m === data?.model && p.slug === cur
              return (
                <button
                  key={m}
                  className={`picker-opt${on ? ' on' : ''}`}
                  disabled={busy}
                  onClick={() => {
                    haptic()
                    setBusy(true)
                    onPick(p.slug, m, effort)
                      .then(onClose)
                      .catch(e => errText(e) !== 'Cancelled' && toast(errText(e), 'error', 6000))
                      .finally(() => setBusy(false))
                  }}
                >
                  <span className="set-text">
                    <span className="set-title">{m}</span>
                  </span>
                  <span className="picker-check">{on ? '✓' : ''}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </Sheet>
  )
}

/** Horizontal profile chips; `all` adds an "All bots" chip (value "*"). */
function ProfileChips({ value, onChange, all, label = 'Bot' }: { value: string; onChange: (v: string) => void; all?: boolean; label?: string }) {
  const profiles = useStore(s => s.profiles)
  return (
    <div className="scope-bar">
      <h3 className="set-heading">{label}</h3>
    <div className="chips-row">
      {all && (
        <button className={`pill${value === '*' ? ' on' : ''}`} onClick={() => onChange('*')}>
          All bots
        </button>
      )}
      {profiles.map(p => (
        <button key={p.name} className={`pill${value === p.name ? ' on' : ''}`} onClick={() => onChange(p.name)}>
          {profileLabel(p)}
        </button>
      ))}
    </div>
    </div>
  )
}

/** Run `fn` for one profile or every profile ("*"), collecting failures into one toast. */
async function forProfiles(target: string, fn: (profile: string) => Promise<unknown>): Promise<boolean> {
  const names = target === '*' ? getState().profiles.map(p => p.name) : [target]
  const failed: string[] = []
  for (const n of names) {
    try {
      await fn(n)
    } catch (e) {
      failed.push(`${n}: ${errText(e)}`)
    }
  }
  if (failed.length) toast(failed.join(' · '), 'error', 8000)
  return failed.length < names.length
}

// ── Models ───────────────────────────────────────────────────

function ModelsTab() {
  const profiles = useStore(s => s.profiles)
  const [pick, setPick] = useState<string | null>(null) // profile name or "*"
  const target = pick === '*' ? 'all bots' : profileLabel(profiles.find(p => p.name === pick) || { name: pick || '' })
  return (
    <>
      <Section footer="The model each bot starts new chats with. Change the model of a single chat from the chip in its header.">
        <Row icon="✨" tone="gold" title="Set one model for all bots" chevron onClick={() => setPick('*')} />
      </Section>
      <Section title="Bots">
        {profiles.map(p => (
          <Row
            key={p.name}
            icon={profileLabel(p).slice(0, 1).toUpperCase()}
            tone="gold"
            title={profileLabel(p)}
            sub={`${p.model || 'no model set'}${p.provider ? ` · ${p.provider.replace(/^custom:/, '')}` : ''}`}
            chevron
            onClick={() => setPick(p.name)}
          />
        ))}
      </Section>
      {pick && (
        <ModelPicker
          profile={pick === '*' ? getState().profile : pick}
          target={target}
          onClose={() => setPick(null)}
          onPick={async (provider, model, effort) => {
            const ok = await forProfiles(pick, n => setProfileModel(n, provider, model, effort))
            await loadProfiles()
            if (ok) toast(`${model} → ${target}`)
          }}
        />
      )}
    </>
  )
}

// ── Keys ─────────────────────────────────────────────────────

interface EnvRow {
  is_set: boolean
  redacted_value?: string | null
  description?: string
  url?: string | null
  category?: string
  is_password?: boolean
  advanced?: boolean
  channel_managed?: boolean
  provider_label?: string
  custom?: boolean
}

/** This app is the only front end: hide everything that configures other chat platforms / the messaging gateway. */
const MESSAGING_CATS = new Set(['messaging', 'slack', 'discord', 'mattermost', 'matrix', 'gateway', 'bot_desktop'])
const isMessagingField = (key: string, category?: string) =>
  MESSAGING_CATS.has(category || '') || /^display\.platforms\./.test(key) || /^agent\.gateway_/.test(key) || /^(telegram|whatsapp|signal|email)\./.test(key)

const CAT_LABEL: Record<string, string> = { provider: 'Model providers', tool: 'Tools', messaging: 'Messaging', setting: 'Settings', custom: 'Custom keys' }

function KeysTab({ scope, setScope }: { scope: string; setScope: (s: string) => void }) {
  const { data, error, loading, reload } = useLoader(() => api<Record<string, EnvRow>>('GET', `/api/env?${qs({ profile: scope })}`, undefined, { profile: false }), [scope])
  const [q, setQ] = useState('')
  const [onlySet, setOnlySet] = useState(true)
  const [edit, setEdit] = useState<{ key: string; row?: EnvRow } | null>(null)

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rows = Object.entries(data || {}).filter(
      ([k, r]) =>
        !r.channel_managed &&
        r.category !== 'messaging' &&
        !/^(TELEGRAM|DISCORD|SLACK|WHATSAPP|SIGNAL|MATRIX|MATTERMOST)_/.test(k) &&
        (!onlySet || r.is_set || needle) &&
        (!needle || k.toLowerCase().includes(needle) || (r.description || '').toLowerCase().includes(needle) || (r.provider_label || '').toLowerCase().includes(needle))
    )
    const by = new Map<string, [string, EnvRow][]>()
    for (const [k, r] of rows) {
      const cat = CAT_LABEL[r.category || ''] || r.category || 'Other'
      by.set(cat, [...(by.get(cat) || []), [k, r]])
    }
    return [...by.entries()].sort(([a], [b]) => (a === 'Model providers' ? -1 : b === 'Model providers' ? 1 : a.localeCompare(b)))
  }, [data, q, onlySet])

  return (
    <>
      <ProfileChips value={scope} onChange={setScope} label="Keys for" />
      <label className="set-search">
        <span aria-hidden="true">🔍</span>
        <input placeholder="Search keys (e.g. openai, tavily)" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      <Section>
        <ToggleRow icon="●" tone="green" title="Only keys that are set" sub="Turn off to see every key Hermes supports" on={onlySet} onChange={setOnlySet} />
        <Row icon="＋" tone="gold" title="Add a custom key" chevron onClick={() => setEdit({ key: '' })} />
      </Section>
      <Status loading={loading} error={error} empty={!groups.length} emptyText={onlySet ? 'No keys set. Turn off “Only keys that are set” to see every key Hermes supports.' : 'No matches'} />
      {groups.map(([cat, rows]) => (
        <Section key={cat} title={`${cat} · ${rows.length}`}>
          {rows.map(([k, r]) => (
            <Row
              key={k}
              title={
                <span className="key-line">
                  <span className={r.is_set ? 'dot-set' : 'dot-unset'} />
                  <span className="key-name">{k}</span>
                </span>
              }
              sub={`${r.provider_label ? `${r.provider_label} · ` : ''}${r.is_set ? redacted(r.redacted_value) || 'set' : r.description || 'not set'}`}
              chevron
              onClick={() => setEdit({ key: k, row: r })}
            />
          ))}
        </Section>
      ))}
      {edit && <KeySheet scope={scope} keyName={edit.key} row={edit.row} onClose={() => setEdit(null)} onSaved={reload} />}
    </>
  )
}

function KeySheet({ scope, keyName, row, onClose, onSaved }: { scope: string; keyName: string; row?: EnvRow; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(keyName)
  const [value, setValue] = useState('')
  const [all, setAll] = useState(false)
  const [shown, setShown] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const target = all ? '*' : scope
  const key = name.trim().toUpperCase()

  const run = async (what: 'save' | 'remove') => {
    setBusy(true)
    haptic()
    const ok = await forProfiles(target, p =>
      what === 'save'
        ? api('PUT', `/api/env?${qs({ profile: p })}`, { key, value: value.trim() }, { profile: false })
        : api('DELETE', `/api/env?${qs({ profile: p })}`, { key }, { profile: false }).catch(e => {
            if (!/not found/i.test(errText(e))) throw e // already absent there
          })
    )
    setBusy(false)
    if (ok) {
      toast(what === 'save' ? `${key} saved${all ? ' for all bots' : ''}` : `${key} removed${all ? ' from all bots' : ''}`)
      onSaved()
      onClose()
    }
  }

  return (
    <Sheet title={keyName || 'Add a key'} onClose={onClose}>
      <div className="sheet-scroll">
        {row?.description && <div className="dim small">{row.description}</div>}
        {row?.url && (
          <a className="small" href={row.url} target="_blank" rel="noreferrer">
            Get a key ↗
          </a>
        )}
        {!keyName && (
          <label className="field">
            <span>Name</span>
            <input className="mono" value={name} onChange={e => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))} placeholder="MY_API_KEY" autoCapitalize="characters" />
          </label>
        )}
        {row?.is_set && (
          <div className="kv">
            <div>Current</div>
            <div className="mono small">{shown ?? (redacted(row.redacted_value) || 'set')}</div>
          </div>
        )}
        <label className="field">
          <span>{row?.is_set ? 'Replace with' : 'Value'}</span>
          <input
            className="mono"
            type={row?.is_password === false ? 'text' : 'password'}
            autoComplete="off"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="Paste here"
          />
        </label>
        <Section footer={`Saved to ${all ? 'every profile’s' : `${scope}’s`} .env on the phone. New chats pick it up.`}>
          <ToggleRow title="Apply to all bots" on={all} onChange={setAll} />
        </Section>
      </div>
      <div className="sheet-actions">
        {row?.is_set && (
          <button className="btn danger" disabled={busy} onClick={() => void confirmDialog({ title: `Remove ${key}?`, message: all ? 'It is removed from all bots.' : 'The saved value is deleted.', confirmLabel: 'Remove', danger: true }).then(ok => { if (ok) void run('remove') })}>
            Remove
          </button>
        )}
        {row?.is_set && shown == null && (
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              api<{ value: string }>('POST', `/api/env/reveal?${qs({ profile: scope })}`, { key }, { profile: false })
                .then(r => setShown(r.value))
                .catch(e => toast(errText(e), 'error'))
            }
          >
            Show
          </button>
        )}
        <button className="btn primary" disabled={busy || !key || !value.trim()} onClick={() => void run('save')}>
          Save
        </button>
      </div>
    </Sheet>
  )
}

// ── Config (schema-driven, every option Hermes has) ──────────

interface Field {
  type: 'string' | 'number' | 'boolean' | 'list' | 'select'
  description?: string
  category?: string
  options?: string[]
}
interface Schema {
  fields: Record<string, Field>
  category_order: string[]
}

let schemaCache: Schema | null = null

function getPath(obj: unknown, path: string): unknown {
  if (obj && typeof obj === 'object' && path in (obj as Record<string, unknown>)) return (obj as Record<string, unknown>)[path]
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

function nest(path: string, value: unknown): Record<string, unknown> {
  return path
    .split('.')
    .reverse()
    .reduce<unknown>((acc, k) => ({ [k]: acc }), value) as Record<string, unknown>
}

const titleCase = (s: string) => s.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

function show(v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function ConfigTab({ scope, setScope }: { scope: string; setScope: (s: string) => void }) {
  const { data, error, loading, reload, setData } = useLoader(async () => {
    schemaCache ??= await api<Schema>('GET', '/api/config/schema', undefined, { profile: false })
    const config = await api<Record<string, unknown>>('GET', `/api/config?${qs({ profile: scope })}`, undefined, { profile: false })
    return { schema: schemaCache, config }
  }, [scope])
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [edit, setEdit] = useState<string | null>(null)

  const cats = useMemo(() => {
    if (!data) return []
    const by = new Map<string, [string, Field][]>()
    for (const [k, f] of Object.entries(data.schema.fields)) {
      if (isMessagingField(k, f.category)) continue
      const c = f.category || 'other'
      by.set(c, [...(by.get(c) || []), [k, f]])
    }
    const order = data.schema.category_order
    return [...by.entries()].sort(([a], [b]) => {
      const ia = order.indexOf(a)
      const ib = order.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
    })
  }, [data])

  const needle = q.trim().toLowerCase()
  const hits = useMemo(
    () =>
      needle && data
        ? Object.entries(data.schema.fields)
            .filter(([k, f]) => !isMessagingField(k, f.category) && (k.toLowerCase().includes(needle) || (f.description || '').toLowerCase().includes(needle)))
            .slice(0, 80)
        : [],
    [needle, data]
  )

  const save = async (key: string, value: unknown, all: boolean) => {
    haptic()
    const ok = await forProfiles(all ? '*' : scope, p => api('PUT', `/api/config?${qs({ profile: p })}`, { config: nest(key, value) }, { profile: false }))
    if (ok) {
      toast(`Saved${all ? ' for all bots' : ''}`)
      reload()
      if (key === 'model' || key.startsWith('model.')) void loadProfiles()
      if (key.startsWith('agent.reasoning') || key === 'model' || key.startsWith('model.')) void loadDefaultModel()
    }
    return ok
  }

  const row = ([k, f]: [string, Field]) => {
    const v = getPath(data?.config, k)
    if (f.type === 'boolean')
      return (
        <ToggleRow
          key={k}
          title={<span className="key-name">{k}</span>}
          sub={f.description}
          on={Boolean(v)}
          onChange={next => {
            // Optimistic flip; reload corrects it if the save failed.
            setData(d => (d ? { ...d, config: { ...d.config, ...deepSet(d.config, k, next) } } : d))
            void save(k, next, false)
          }}
        />
      )
    return <Row key={k} title={<span className="key-name">{k}</span>} sub={f.description} value={show(v)} chevron onClick={() => setEdit(k)} />
  }

  return (
    <>
      <ProfileChips value={scope} onChange={setScope} label="Settings for" />
      <label className="set-search">
        <span aria-hidden="true">🔍</span>
        <input placeholder={`Search ${data ? Object.entries(data.schema.fields).filter(([k, f]) => !isMessagingField(k, f.category)).length : ''} settings`} value={q} onChange={e => setQ(e.target.value)} />
      </label>
      <Status loading={loading} error={error} empty={!data} emptyText="" />
      {needle ? (
        <Section title="Results">{hits.length ? hits.map(row) : <div className="dim pad">No matches</div>}</Section>
      ) : (
        cats.map(([c, fields]) => (
          <Section key={c}>
            <Row title={titleCase(c)} value={<span className="set-count">{fields.length}</span>} trailing={<span className="set-chev">{open === c ? '⌄' : '›'}</span>} onClick={() => setOpen(open === c ? null : c)} />
            {open === c && fields.map(row)}
          </Section>
        ))
      )}
      {edit && data && (
        <ConfigSheet
          k={edit}
          field={data.schema.fields[edit]}
          value={getPath(data.config, edit)}
          scope={scope}
          onClose={() => setEdit(null)}
          onSave={(v, all) => save(edit, v, all)}
        />
      )}
    </>
  )
}

function deepSet(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  if (path in obj) return { [path]: value }
  const [head, ...rest] = path.split('.')
  if (!rest.length) return { [head]: value }
  const child = (obj[head] && typeof obj[head] === 'object' ? obj[head] : {}) as Record<string, unknown>
  return { [head]: { ...child, ...deepSet(child, rest.join('.'), value) } }
}

function ConfigSheet({ k, field, value, scope, onClose, onSave }: { k: string; field: Field; value: unknown; scope: string; onClose: () => void; onSave: (v: unknown, all: boolean) => Promise<boolean> }) {
  const isJson = field.type === 'list' || (value != null && typeof value === 'object')
  const [text, setText] = useState(value == null ? '' : isJson ? JSON.stringify(value, null, 2) : String(value))
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const parse = (): unknown => {
    if (field.type === 'number') {
      const n = Number(text)
      if (text.trim() === '' || !Number.isFinite(n)) throw new Error('Enter a number')
      return n
    }
    if (isJson) {
      if (!text.trim()) return []
      try {
        return JSON.parse(text)
      } catch {
        // Convenience: one item per line for simple string lists.
        return text
          .split('\n')
          .map(s => s.trim())
          .filter(Boolean)
      }
    }
    return text
  }
  return (
    <Sheet title={k} onClose={onClose}>
      <div className="sheet-scroll">
        {field.description && <div className="dim small">{field.description}</div>}
        {field.type === 'select' ? (
          <div className="picker-list inline">
            {(field.options || []).map(o => (
              <button key={o} className={`picker-opt${o === text ? ' on' : ''}`} onClick={() => setText(o)}>
                <span className="set-text">
                  <span className="set-title">{o || '(default)'}</span>
                </span>
                <span className="picker-check">{o === text ? '✓' : ''}</span>
              </button>
            ))}
          </div>
        ) : isJson ? (
          <textarea className="sheet-input mono" rows={8} value={text} onChange={e => setText(e.target.value)} placeholder="JSON, or one item per line" />
        ) : (
          <input className="sheet-input mono" inputMode={field.type === 'number' ? 'decimal' : undefined} value={text} onChange={e => setText(e.target.value)} />
        )}
        <Section footer={`Saving to ${all ? 'every profile' : scope}. New chats use it.`}>
          <ToggleRow title="Apply to all bots" on={all} onChange={setAll} />
        </Section>
      </div>
      <div className="sheet-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => {
            let v: unknown
            try {
              v = parse()
            } catch (e) {
              toast(errText(e), 'error')
              return
            }
            setBusy(true)
            void onSave(v, all).then(ok => (ok ? onClose() : setBusy(false)))
          }}
        >
          Save
        </button>
      </div>
    </Sheet>
  )
}

// ── App ──────────────────────────────────────────────────────

/** Read-aloud voice: engine, voice, speed and pitch (Android TextToSpeech). */
function VoiceSettings() {
  const catalog = useVoice(v => v.catalog)
  const [cfg, setCfg] = useState<TtsConfig>(ttsConfig)
  const [autoRead, setAutoReadState] = useState(autoReadOn)
  useEffect(() => {
    if (ttsAvailable()) loadVoices()
  }, [])
  // Every hook above this early return (React calls them in the same order on each render).
  const [livePause, setLivePauseState] = useState(getLivePause)
  if (!ttsAvailable()) return <Section footer="Voice options are available in the Android app."><Row title="Voice" value="Not available here" /></Section>

  const update = (patch: Partial<TtsConfig>, reload = false) => {
    const next = { ...cfg, ...patch }
    setCfg(next)
    saveTtsConfig(next)
    if (reload) loadVoices()
  }
  const engine = cfg.engine || catalog?.engine || ''
  const voices = catalog?.voices ?? []
  // Group by language (the phone's own language first). Google names look like "nl-nl-x-bmh-local":
  // show them as "Voice 1 · on-device" / "online" instead, and hide the "-language" placeholders.
  const real = voices.filter(v => !/-language$/i.test(v.name))
  const mine = (navigator.language || 'en').slice(0, 2).toLowerCase()
  const byLang = new Map<string, typeof voices>()
  for (const v of real) byLang.set(v.label, [...(byLang.get(v.label) ?? []), v])
  const langs = [...byLang.keys()].sort((a, b) => {
    const am = byLang.get(a)![0].locale.toLowerCase().startsWith(mine) ? 0 : 1
    const bm = byLang.get(b)![0].locale.toLowerCase().startsWith(mine) ? 0 : 1
    return am - bm || a.localeCompare(b)
  })
  const label = (list: typeof voices, v: (typeof voices)[number]) => {
    const m = v.name.match(/-x-([a-z0-9]+)-(local|network)$/i)
    if (!m) {
      // Other engines (e.g. ElevenReader) name voices with opaque ids like "elevenlabs:iUqvz…": show the tail only.
      const id = v.name.includes(':') ? v.name.split(':').pop() || v.name : v.name
      const brand = v.name.includes(':') ? v.name.split(':')[0].replace(/[-_]/g, ' ') : ''
      const nice = brand.toLowerCase() === 'elevenlabs' ? 'ElevenLabs' : `${brand.charAt(0).toUpperCase()}${brand.slice(1)}`
      const pretty = brand ? `${nice} voice · …${id.slice(-5)}` : v.name.replace(/[-_]/g, ' ')
      return pretty + (v.online ? ' · online' : '')
    }
    const ids = [...new Set(list.map(x => x.name.match(/-x-([a-z0-9]+)-/i)?.[1]))].sort()
    return `Voice ${ids.indexOf(m[1]) + 1} · ${m[2].toLowerCase() === 'local' ? 'on-device' : 'online'}`
  }

  const engineOptions: Option[] = (catalog?.engines ?? []).map(e => ({ value: e.name, label: e.label }))
  const voiceOptions: Option[] = [
    { value: '', label: 'Default for my language' },
    ...langs.flatMap(lang => byLang.get(lang)!.map(v => ({ value: v.name, label: label(byLang.get(lang)!, v), group: lang })))
  ]
  const engineLabel = catalog?.engines.find(e => e.name === engine)?.label || 'this engine'
  const opener = (window.HermesAndroid as unknown as { openTtsEngineApp?: (p: string) => void } | undefined)?.openTtsEngineApp
  return (
    <>
      <Section title="Read aloud">
        <ToggleRow icon="🔊" tone="gold" title="Read every reply aloud" sub="In all chats. Turn it on for a single chat from its ⋮ menu." on={autoRead} onChange={v => { setAutoReadState(v); setAutoRead(v) }} />
      </Section>
      <Section
        title="Voice"
        footer={
          engine && engine !== 'com.google.android.tts'
            ? real.length <= 1
              ? `${engineLabel} only offers Android the one voice selected inside its own app, so other voices can’t be listed here. Pick the voice there and it is used here.`
              : `Voices come from ${engineLabel}.`
            : undefined
        }
      >
        <SelectRow icon="🗣" tone="teal" title="Speech engine" options={engineOptions} value={engine} placeholder="Phone default" onChange={v => update({ engine: v, voice: '' }, true)} />
        <SelectRow icon="🎙" tone="purple" title="Voice" options={voiceOptions} value={cfg.voice} placeholder="Default for my language" onChange={v => update({ voice: v })} />
        {engine && engine !== 'com.google.android.tts' && opener && <Row icon="↗" tone="blue" title={`Open ${engineLabel} to change its voice`} chevron onClick={() => opener(engine)} />}
      </Section>
      <Section title="Sound">
        <SliderRow icon="⏩" tone="blue" title="Speed" value={cfg.rate} min={0.5} max={2} step={0.05} format={v => `${v.toFixed(2)}×`} onChange={v => update({ rate: v })} />
        <SliderRow icon="🎚" tone="green" title="Pitch" value={cfg.pitch} min={0.5} max={2} step={0.05} format={v => v.toFixed(2)} onChange={v => update({ pitch: v })} />
      </Section>
      <Section title="Live mode" footer="How long you stay silent before Live mode sends what you said.">
        <SliderRow icon="⏱" tone="purple" title="Pause before sending" value={livePause} min={0.5} max={6} step={0.5} format={v => `${v.toFixed(1)} s`} onChange={v => { setLivePauseState(v); setLivePause(v) }} />
      </Section>
      <AssistantSection />
      <Section>
        <Row icon="▶" tone="gold" title="Test voice" sub="Plays a sample sentence with these settings" onClick={() => testVoice()} />
        <Row icon="↺" tone="gray" title="Reset voice settings" onClick={() => update({ engine: '', voice: '', rate: 1, pitch: 1 }, true)} />
      </Section>
    </>
  )
}

/** Hermes as the phone's digital assistant: the assist gesture (long-press power, corner swipe) opens Live mode.
 *  Android doesn't let an app take that role itself, so the row opens the system picker and re-checks on return. */
function AssistantSection() {
  const bridge = window.HermesAndroid
  const check = () => Boolean(bridge?.isAssistant?.())
  const [on, setOn] = useState(check)
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === 'visible') setOn(check())
    }
    document.addEventListener('visibilitychange', again)
    return () => document.removeEventListener('visibilitychange', again)
  }, [])
  if (!bridge?.openAssistantSettings) return null
  return (
    <Section
      title="Phone assistant"
      footer={
        on
          ? 'Long-press the power button (or swipe in from a bottom corner) to talk to Hermes in Live mode. If it still opens another assistant, set the power-button shortcut to the assistant in the phone’s settings.'
          : 'Choose Hermes under “Digital assistant app”. Then long-pressing the power button opens Hermes in Live mode, from any app.'
      }
    >
      <Row icon="✦" tone="gold" title="Use Hermes as phone assistant" value={on ? 'On' : 'Off'} chevron onClick={() => bridge.openAssistantSettings?.()} />
    </Section>
  )
}

/** Theme swatches: a tiny preview of each look. */
const THEMES: Array<{ id: Theme; label: string; bg: string; bar: string; user: string; dim: string }> = [
  { id: 'default', label: 'Default', bg: '#0e1115', bar: '#1d222a', user: '#d9a441', dim: '#3a414d' },
  { id: 'oled', label: 'OLED black', bg: '#000000', bar: '#15161a', user: '#d9a441', dim: '#2b2d33' },
  { id: 'light', label: 'Light', bg: '#ffffff', bar: '#ebe9e2', user: '#b57a10', dim: '#d6d3c8' },
  { id: 'system', label: 'System', bg: 'linear-gradient(135deg,#000000 50%,#ffffff 50%)', bar: '#8a8a8a', user: '#c48f1c', dim: '#777777' }
]
const THEME_NAME: Record<Theme, string> = { default: 'Default', oled: 'OLED black', light: 'Light', system: 'System' }

function AppearancePage() {
  const scale = useStore(s => s.textScale)
  const [theme, setThemeState] = useState<Theme>(savedTheme)
  return (
    <>
      <Section title="Theme" footer="System follows your phone: OLED black when it is in dark mode, Light when it is not.">
        <div className="theme-grid">
          {THEMES.map(t => (
            <button
              key={t.id}
              className={`theme-card${theme === t.id ? ' on' : ''}`}
              onClick={() => {
                haptic()
                setThemeState(t.id)
                setTheme(t.id)
              }}
            >
              <div className="theme-prev" style={{ background: t.bg }}>
                <i className="a" style={{ background: t.bar }} />
                <i className="b" style={{ background: t.user }} />
                <i className="c" style={{ background: t.dim }} />
              </div>
              <div className="theme-name">
                {t.label}
                {theme === t.id && <span className="tick">✓</span>}
              </div>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Text size">
        <div className="size-preview">The quick brown fox jumps over the lazy dog.</div>
        <Segmented
          options={[0.9, 1, 1.1, 1.2, 1.35].map(v => ({ value: v, label: `${Math.round(v * 100)}%` }))}
          value={[0.9, 1, 1.1, 1.2, 1.35].find(v => Math.abs(v - scale) < 0.01) ?? 1}
          onChange={v => {
            setState({ textScale: v })
            try {
              localStorage.setItem('hm.textScale', String(v))
            } catch {
              /* ignore */
            }
          }}
        />
      </Section>
    </>
  )
}

// ── screen: a hub of grouped rows, each opening its own page ─

type Page = 'hub' | 'appearance' | 'voice' | 'models' | 'accounts' | 'keys' | 'config'
const PAGE_TITLE: Record<Page, string> = { hub: 'Settings', appearance: 'Appearance', voice: 'Voice', models: 'Default models', accounts: 'Subscriptions & accounts', keys: 'API keys', config: 'Advanced settings' }

function Hub({ go }: { go: (p: Page) => void }) {
  const conn = useStore(s => s.conn)
  // The open chat knows the version; without one, the health check (/api/status) does.
  const hermesVersion = useStore(s => s.active?.info?.version || s.health?.version || '')
  const [theme] = useState<Theme>(savedTheme)
  const [autoRead, setAutoReadState] = useState(autoReadOn)
  const connLabel = conn === 'open' ? 'Connected' : conn === 'connecting' ? 'Connecting…' : 'Offline'
  return (
    <>
      <Section title="Appearance">
        <Row icon="🎨" tone="purple" title="Appearance" sub="Theme and text size" value={THEME_NAME[theme]} chevron onClick={() => go('appearance')} />
      </Section>
      <Section title="Voice">
        <ToggleRow icon="🔊" tone="gold" title="Read every reply aloud" sub="In all chats" on={autoRead} onChange={v => { setAutoReadState(v); setAutoRead(v) }} />
        <Row icon="🗣" tone="teal" title="Voice" sub="Engine, voice, speed and pitch" chevron onClick={() => go('voice')} />
      </Section>
      <Section title="Hermes">
        <Row icon="✨" tone="gold" title="Default models" sub="Which model each bot starts with" chevron onClick={() => go('models')} />
        <Row icon="👤" tone="green" title="Subscriptions & accounts" sub="ChatGPT, Claude, Grok, Nous Portal sign-ins" chevron onClick={() => go('accounts')} />
        <Row icon="🔑" tone="blue" title="API keys" sub="Providers and tools" chevron onClick={() => go('keys')} />
        <Row icon="⚙️" tone="gray" title="Advanced settings" sub="Every Hermes option" chevron onClick={() => go('config')} />
      </Section>
      <Section title="Connection">
        <Row icon="📶" tone="green" title="Status" value={connLabel} chevron onClick={() => setState({ sheet: 'status' })} />
        <Row icon="↻" tone="blue" title="Reconnect / start Hermes" onClick={() => { reconnectNow(); toast('Reconnecting…') }} />
        <Row icon="✓" tone="teal" title="Setup check" sub="Permissions, background running, the plugin" chevron onClick={() => setState({ screen: 'setup' })} />
      </Section>
      <Section title="About">
        <Row title="App" value={appVersion()} />
        <UpdateRow />
        <Row title="Hermes" value={hermesVersion ? `v${String(hermesVersion).replace(/^v/, '')}` : '—'} />
      </Section>
    </>
  )
}

/** "Check for updates" / "Update to x.y.z": one tap downloads the newest release and opens the system installer. */
function UpdateRow() {
  const u = useUpdate()
  useEffect(() => {
    void checkForUpdate()
  }, [])
  const busy = u.phase === 'checking' || u.phase === 'downloading' || u.phase === 'installing'
  const title = u.phase === 'available' || u.phase === 'permission' ? `Update to ${u.latest}` : 'Check for updates'
  const sub =
    u.phase === 'checking' ? 'Checking…'
    : u.phase === 'uptodate' ? "You're on the latest version"
    : u.phase === 'available' ? 'A newer version is ready. Tap to download and install'
    : u.phase === 'downloading' ? `Downloading… ${u.pct}%`
    : u.phase === 'installing' ? 'Confirm in the Android installer'
    : u.phase === 'permission' || u.phase === 'error' ? u.msg
    : undefined
  return (
    <Row
      icon="⬆️"
      tone={u.phase === 'available' ? 'gold' : 'blue'}
      title={title}
      sub={sub}
      disabled={busy}
      onClick={() => {
        haptic()
        if (u.phase === 'available' || u.phase === 'permission') startUpdate()
        else void checkForUpdate(true)
      }}
    />
  )
}

export function SettingsScreen() {
  const current = useStore(s => s.profile)
  const opened = useStore(s => s.screenProfile)
  const [page, setPage] = useState<Page>(() => (opened ? 'keys' : 'hub'))
  const [scope, setScope] = useState(opened || current)
  useEffect(() => {
    void loadProfiles()
  }, [])
  useBackHandler(() => setPage('hub'), page !== 'hub') // Back on a sub-page returns to the hub
  return (
    <ScreenShell title={PAGE_TITLE[page]} onBack={page === 'hub' ? undefined : () => setPage('hub')}>
      {page === 'hub' && <Hub go={setPage} />}
      {page === 'appearance' && <AppearancePage />}
      {page === 'voice' && <VoiceSettings />}
      {page === 'models' && <ModelsTab />}
      {page === 'accounts' && (
        <>
          <ProfileChips value={scope} onChange={setScope} label="Sign-ins for" />
          <AccountsList profile={scope} title="Use a plan you already pay for" />
          <div className="dim small pad">ChatGPT, Grok, Nous and MiniMax sign in right here. Claude opens Termux, because Hermes only does that sign-in in a terminal. API keys are under Settings → API keys.</div>
        </>
      )}
      {page === 'keys' && <KeysTab scope={scope} setScope={setScope} />}
      {page === 'config' && <ConfigTab scope={scope} setScope={setScope} />}
    </ScreenShell>
  )
}
