// Settings → Hermes settings: the Hermes options that matter on a phone (hermes-settings.ts), grouped, in words, with
// proper controls, limits and a way back to Hermes's default. Same routes as Advanced settings: GET /api/config for the
// bot's values, GET /api/config/defaults (once per run) for the defaults, PUT /api/config with the value nested under its
// path; Hermes validates and stores it. Options the running Hermes doesn't know are left out.
import { useEffect, useMemo, useState } from 'react'
import { api, qs } from '../api'
import { haptic } from '../bridge'
import { HERMES_SETTINGS, hasPath, inputText, nested, parseInput, readPath, sameValue, shown, type HSetting, type Json } from '../hermes-settings'
import { setKnownHermesKeys } from '../settings-search'
import { toast } from '../store'
import { Sheet, Status, useLoader } from './Screens'
import { ProfileChips, forProfiles } from './Settings'
import { Row, Section, Toggle, ToggleRow } from './ui'

let defaultsCache: Record<string, unknown> | null = null
let zonesCache: string[] | null = null

export function HermesSettingsPage({ scope, setScope }: { scope: string; setScope: (s: string) => void }) {
  const { data, error, loading, reload, setData } = useLoader(async () => {
    defaultsCache ??= await api<Record<string, unknown>>('GET', '/api/config/defaults', undefined, { profile: false })
    // The time zone list comes from Hermes's schema (it knows which zones Python has); without it any text is taken.
    zonesCache ??= await api<{ fields?: Record<string, { options?: string[] }> }>('GET', '/api/config/schema', undefined, { profile: false })
      .then(r => r.fields?.timezone?.options || [])
      .catch(() => [])
    const config = await api<Record<string, unknown>>('GET', `/api/config?${qs({ profile: scope })}`, undefined, { profile: false })
    return { defaults: defaultsCache, config, zones: zonesCache }
  }, [scope])
  const [edit, setEdit] = useState<HSetting | null>(null)

  const groups = useMemo(
    () => (data ? HERMES_SETTINGS.map(g => ({ ...g, items: g.items.filter(s => hasPath(data.defaults, s.key) || hasPath(data.config, s.key)) })).filter(g => g.items.length) : []),
    [data]
  )
  // Settings search lists only the options this Hermes has.
  useEffect(() => {
    if (data) setKnownHermesKeys(k => hasPath(data.defaults, k) || hasPath(data.config, k))
  }, [data])
  const value = (s: HSetting): Json | undefined => (data && hasPath(data.config, s.key) ? readPath(data.config, s.key) : readPath(data?.defaults, s.key))
  const def = (s: HSetting) => readPath(data?.defaults, s.key)
  const changed = (s: HSetting) => hasPath(data?.defaults, s.key) && !sameValue(value(s), def(s))

  const save = async (s: HSetting, v: Json, all: boolean) => {
    haptic()
    const ok = await forProfiles(all ? '*' : scope, p => api('PUT', `/api/config?${qs({ profile: p })}`, { config: nested(s.key, v) }, { profile: false }))
    if (ok) {
      toast(`${s.label}: ${shown(s, v)}${all ? ' for all bots' : ''}`)
      reload()
    }
    return ok
  }

  const title = (s: HSetting) => (
    <span className="key-line">
      <span>{s.label}</span>
      {changed(s) && <span className="hs-changed">Changed</span>}
    </span>
  )
  const row = (s: HSetting) =>
    s.kind === 'toggle' ? (
      <div key={s.key} className="set-row static">
        <span className="set-text">
          <span className="set-title">{title(s)}</span>
          <span className="set-sub">{`${s.help} Default: ${def(s) ? 'on' : 'off'}.`}</span>
        </span>
        <Toggle
          on={Boolean(value(s))}
          label={s.label}
          onChange={next => {
            if (!data) return
            // At once; the reload after the save puts it back if Hermes refused.
            setData({ ...data, config: merge(data.config, s.key, next) as Record<string, unknown> })
            void save(s, next, false).then(ok => !ok && reload())
          }}
        />
      </div>
    ) : (
      <Row key={s.key} title={title(s)} sub={s.help} value={shown(s, value(s))} chevron onClick={() => setEdit(s)} />
    )

  return (
    <>
      <ProfileChips value={scope} onChange={setScope} label="Settings for" />
      <Status loading={loading} error={error} empty={!data} emptyText="" onRetry={reload} />
      {groups.map(g => (
        <Section key={g.title} title={g.title} footer={g.footer}>
          {g.items.map(row)}
        </Section>
      ))}
      {data && <div className="dim small pad">Every other Hermux option, by its name in config.yaml, is under Settings → Advanced settings.</div>}
      {edit && data && <SettingSheet s={edit} value={value(edit)} def={def(edit)} zones={data.zones} scope={scope} onClose={() => setEdit(null)} onSave={(v, all) => save(edit, v, all)} />}
    </>
  )
}

/** `obj` with `path` set to `value` (a copy of each level on the way). */
function merge(obj: unknown, path: string, value: Json): unknown {
  const [head, ...rest] = path.split('.')
  const o = obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : {}
  return { ...o, [head]: rest.length ? merge(o[head], rest.join('.'), value) : value }
}

/** One option: its explanation, the control, its default (with Use default) and Apply to all bots. */
function SettingSheet({ s, value, def, zones, scope, onClose, onSave }: { s: HSetting; value: Json | undefined; def: Json | undefined; zones: string[]; scope: string; onClose: () => void; onSave: (v: Json, all: boolean) => Promise<boolean> }) {
  const [choice, setChoice] = useState<Json | undefined>(value)
  const [text, setText] = useState(inputText(s, value))
  // A number that may be null ("No limit" / "Off"): the switch says whether a number is set at all.
  const nullable = s.kind === 'number' && s.nullLabel != null
  const [isNull, setIsNull] = useState(nullable && value == null)
  const [all, setAll] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const result = (): { value: Json } | { error: string } => {
    if (s.kind === 'choice') return { value: choice ?? null }
    if (isNull) return { value: null }
    return parseInput(s, text, zones)
  }
  const useDefault = () => {
    haptic()
    setErr('')
    setChoice(def)
    setText(inputText(s, def))
    setIsNull(nullable && def == null)
  }
  const submit = () => {
    const r = result()
    if ('error' in r) return setErr(r.error)
    setBusy(true)
    void onSave(r.value, all).then(ok => (ok ? onClose() : setBusy(false)))
  }
  const range = s.kind === 'number' ? (s.percent ? `${s.min * 100}–${s.max * 100} %` : `${s.min.toLocaleString('en-US')}–${s.max.toLocaleString('en-US')}${s.unit ? ` ${s.unit}` : ''}`) : ''

  return (
    <Sheet title={s.label} onClose={onClose}>
      <div className="sheet-scroll">
        <div className="dim small pad">{s.help}</div>
        {s.kind === 'choice' && (
          <div className="picker-list inline">
            {s.options.map(o => (
              <button key={JSON.stringify(o.value)} className={`picker-opt${sameValue(o.value, choice) ? ' on' : ''}`} onClick={() => { haptic(); setChoice(o.value) }}>
                <span className="set-text">
                  <span className="set-title">{o.label}</span>
                </span>
                <span className="picker-check">{sameValue(o.value, choice) ? '✓' : ''}</span>
              </button>
            ))}
          </div>
        )}
        {nullable && (
          <Section>
            <div className="set-row static">
              <span className="set-text">
                <span className="set-title">{s.kind === 'number' ? s.nullLabel : ''}</span>
              </span>
              <Toggle on={isNull} onChange={v => { setIsNull(v); setErr('') }} label={s.kind === 'number' ? s.nullLabel || '' : ''} />
            </div>
          </Section>
        )}
        {s.kind === 'list' && <textarea className="sheet-input mono" rows={6} value={text} placeholder={s.placeholder} onChange={e => { setText(e.target.value); setErr('') }} aria-label={s.label} />}
        {(s.kind === 'text' || (s.kind === 'number' && !isNull)) && (
          <div className="hs-input">
            <input
              className="sheet-input mono"
              inputMode={s.kind === 'number' ? 'decimal' : undefined}
              autoCapitalize="off"
              autoCorrect="off"
              value={text}
              placeholder={s.kind === 'text' ? s.placeholder : ''}
              aria-label={s.label}
              onChange={e => { setText(e.target.value); setErr('') }}
              onKeyDown={e => e.key === 'Enter' && submit()}
            />
            {s.kind === 'number' && <span className="dim small">{s.percent ? '%' : s.unit || ''}</span>}
          </div>
        )}
        {range && !isNull && <div className="dim small pad">{range}{s.kind === 'number' && s.zeroLabel ? ` · 0 = ${s.zeroLabel.toLowerCase()}` : ''}</div>}
        {err && <div className="notice notice-error">{err}</div>}
        <Section>
          <Row title="Use default" sub={`Hermux’s default: ${shown(s, def)}`} onClick={useDefault} />
        </Section>
        <Section footer={`Saving to ${all ? 'every bot' : scope}. New chats use it.`}>
          <ToggleRow title="Apply to all bots" on={all} onChange={setAll} />
        </Section>
      </div>
      <div className="sheet-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy} onClick={submit}>
          Save
        </button>
      </div>
    </Sheet>
  )
}
