// Connecting Hermes to a model provider: a searchable list of every provider the phone's Hermes supports (its own
// provider catalog, read at runtime: see providers.ts), each with "Paste API key" and/or "Sign in", plus your own
// OpenAI-compatible server. Used by the first-run model step (Connect.tsx WelcomeBody, the whole list) and Settings → Models
// (the connected providers on the page, the rest under Add a provider).
//
// Writes go through the dashboard REST routes Hermes Desktop uses, scoped with ?profile=: keys → PUT/DELETE /api/env
// (the profile's .env), sign-ins → /api/providers/oauth (device code in the app; Claude in Termux via the bridge's
// signInTermux, the existing entry point), own servers → /api/providers/custom-endpoints. Keys only ever travel in a
// JSON body, never in a URL, and are never logged.
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, qs } from '../api'
import { copyText, haptic, openExternal, signInTermux } from '../bridge'
import { confirmDialog, promptDialog } from '../dialog'
import { errText, loadDefaultModel } from '../gateway'
import { buildCatalog, connectedText, matches, methods, showFields, type Account, type Endpoint, type EnvRow, type Field, type Preset, type ProviderEntry, type SignIn } from '../providers'
import { toast } from '../store'
import { DeviceLoginSheet, cliFor, type OAuthProvider } from './Connect'
import { KeyPoolSection } from './Rotation'
import { ClaudeSignInSheet, afterSignIn, loadPool, withPoolStatus } from './SignIn'
import { Sheet, Status, useLoader } from './Screens'
import { ModelPicker, setProfileModel } from './Settings'
import { Row, Section, SelectRow } from './ui'
import { Icon } from './icons'
import { modelsChanged } from '../modelcache'

const loadCatalog = async (profile: string) => {
  const p = qs({ profile })
  const [env, oauth, ends, pool] = await Promise.all([
    api<Record<string, EnvRow>>('GET', `/api/env?${p}`, undefined, { profile: false }),
    api<{ providers: Account[] }>('GET', `/api/providers/oauth?${p}`, undefined, { profile: false }).catch(() => ({ providers: [] as Account[] })),
    api<{ endpoints?: Endpoint[] }>('GET', `/api/providers/custom-endpoints?${p}`, undefined, { profile: false }).catch(() => ({ endpoints: [] as Endpoint[] })),
    // A Claude login lives only in the credential pool: /api/providers/oauth keeps saying not signed in (SignIn.tsx).
    loadPool(profile).catch(() => ({}))
  ])
  return buildCatalog(env, withPoolStatus(oauth.providers, pool), ends.endpoints || [])
}

const OWN: Preset = { name: '', base_url: '', needs_key: false }

/** The provider catalog for one bot (env keys, sign-ins, own endpoints), loaded once per bot; `reload` after a change. */
export const useCatalog = (profile: string) => useLoader(() => loadCatalog(profile), [profile])
export type Catalog = ReturnType<typeof useCatalog>

/** Which part of the list to show: `all` (the setup flow's model step: connected, popular, all, your own server),
 *  `connected` (Settings → Models: one row per connected provider) or `add` (Settings → Models → Add a provider: the
 *  catalog minus what is connected, as Sign in, Use an API key and Your own server). */
export type ProviderPart = 'all' | 'connected' | 'add'

interface ListProps {
  profile: string
  /** After anything was connected or removed. */
  onChange?: () => void
  /** After a model was picked from a provider's sheet (or from the picker that opened by itself). */
  onPicked?: () => void
  part?: ProviderPart
  /** Asked when a provider sheet opens: true when the bot has no model yet, so a successful connect opens the model
   *  picker at once, limited to that provider. Without it the sheet's "Choose a model" button is the way, as before. */
  needsModel?: () => boolean
}

/** Every provider for one profile, with its own catalog load. */
export function ProviderList(props: ListProps) {
  const cat = useCatalog(props.profile)
  return <ProviderListView {...props} cat={cat} />
}

/** The list over a catalog the caller loaded (Settings → Models shares it with its empty state). */
export function ProviderListView({ cat, profile, onChange, onPicked, part = 'all', needsModel }: ListProps & { cat: Catalog }) {
  const { data, error, loading, reload } = cat
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [custom, setCustom] = useState<Preset | null>(null)
  const [auto, setAuto] = useState<string[] | null>(null) // the picker opened by itself after a first connect: its slugs
  const waitingTermux = useRef(false)
  const needed = useRef(false) // the bot had no model when the sheet opened

  const changed = () => {
    reload()
    onChange?.()
    void loadDefaultModel()
  }
  // A provider was just connected (key saved, sign-in approved, endpoint saved): with no model yet, choose one now.
  const connectedNow = (slugs: string[]) => {
    if (!needed.current) return
    needed.current = false
    setOpenId(null)
    setCustom(null)
    setAuto(slugs)
  }

  // Back from Termux (Claude sign-in): see whether the login landed, and say so.
  useEffect(() => {
    const on = () => {
      if (document.visibilityState !== 'visible' || !waitingTermux.current) return
      waitingTermux.current = false
      void loadCatalog(profile)
        .then(list => {
          const e = list.find(x => x.id === 'anthropic')
          if (e?.connected) {
            toast('Signed in to Claude')
            afterSignIn()
            connectedNow(e.slugs)
          } else toast('Claude is not signed in. If Termux showed an error, try again.', 'error', 6000)
        })
        .catch(() => {})
        .finally(changed)
    }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, onChange, profile])

  const list = data || []
  const shown = useMemo(() => list.filter(e => matches(e, q)), [list, q])
  const connected = shown.filter(e => e.connected)
  const popular = shown.filter(e => !e.connected && e.rank < 100)
  const rest = shown.filter(e => !e.connected && e.rank >= 100)
  const open = openId ? list.find(e => e.id === openId) || null : null

  const tap = (e: ProviderEntry) => {
    needed.current = Boolean(needsModel?.()) && !e.connected
    if (e.preset && !e.endpoint) return setCustom(e.preset)
    setOpenId(e.id)
  }
  const ownServer = () => {
    needed.current = Boolean(needsModel?.())
    setCustom(OWN)
  }
  const row = (e: ProviderEntry, sub?: string) => (
    <Row
      key={e.id}
      title={
        <span className="key-line">
          <span className={e.connected ? 'dot-set' : 'dot-unset'} />
          <span>{e.name}</span>
        </span>
      }
      sub={sub ?? (e.connected ? connectedText(e) : e.blurb)}
      value={e.connected || sub ? undefined : methods(e)}
      chevron
      onClick={() => tap(e)}
    />
  )
  const search = (
    <label className="set-search">
      <span aria-hidden="true"><Icon n="search" /></span>
      <input placeholder="Search providers (e.g. deepseek, groq)" value={q} onChange={e => setQ(e.target.value)} />
    </label>
  )
  const own = data && (
    <Section title="Your own server" footer="Any OpenAI-compatible API: vLLM, llama.cpp, LocalAI, a company gateway…">
      <Row icon="plus" tone="gold" title="Add an OpenAI-compatible endpoint" sub="Its address, and a key if it needs one" chevron onClick={ownServer} />
    </Section>
  )

  // Add a provider: the providers that offer a sign-in in the app first, then those with a key (popular, then the rest).
  const signInable = (e: ProviderEntry) => e.signIns.some(s => s.kind !== 'command')
  const keyed = (e: ProviderEntry) => Boolean(e.key || e.preset || e.fields.length) || !signInable(e)
  const signInSub = (e: ProviderEntry) => e.signIns.filter(s => s.kind !== 'command').map(s => s.label).join(' · ')
  const addSignIn = [...popular, ...rest].filter(signInable)
  const addPopular = popular.filter(keyed)
  const addRest = rest.filter(keyed)

  return (
    <div className="providers">
      {part === 'connected' ? (
        <>
          <Status loading={loading} error={error} empty={false} emptyText="" onRetry={reload} />
          {connected.length > 0 && <Section title="Connected">{connected.map(e => row(e))}</Section>}
        </>
      ) : part === 'add' ? (
        <>
          {search}
          <Status loading={loading} error={error} empty={!loading && !error && !popular.length && !rest.length} emptyText="No provider matches. Try your own server below." onRetry={reload} />
          {addSignIn.length > 0 && <Section title="Sign in with an account you have" footer="Use a subscription you already pay for: no key needed.">{addSignIn.map(e => row(e, signInSub(e)))}</Section>}
          {addPopular.length > 0 && <Section title="Use an API key">{addPopular.map(e => row(e))}</Section>}
          {addRest.length > 0 && <Section title={q.trim() ? 'More' : `All providers · ${addRest.length}`}>{addRest.map(e => row(e))}</Section>}
          {own}
        </>
      ) : (
        <>
          {search}
          <Status loading={loading} error={error} empty={!loading && !error && !shown.length} emptyText="No provider matches. Try your own server below." onRetry={reload} />
          {connected.length > 0 && <Section title={`Connected · ${connected.length}`}>{connected.map(e => row(e))}</Section>}
          {popular.length > 0 && <Section title="Popular">{popular.map(e => row(e))}</Section>}
          {rest.length > 0 && <Section title={q.trim() ? 'More' : `All providers · ${rest.length}`}>{rest.map(e => row(e))}</Section>}
          {own}
        </>
      )}
      {open && (
        <ProviderSheet
          entry={open}
          profile={profile}
          onClose={() => setOpenId(null)}
          onChanged={changed}
          onConnected={() => connectedNow(open.slugs)}
          onTermux={() => (waitingTermux.current = true)}
          onPicked={() => {
            setOpenId(null)
            onPicked?.()
          }}
        />
      )}
      {custom && (
        <EndpointSheet
          preset={custom}
          profile={profile}
          onClose={() => setCustom(null)}
          onSaved={name => {
            setCustom(null)
            changed()
            const id = name.toLowerCase().replace(/ /g, '-')
            connectedNow([name, id, `custom:${id}`])
          }}
        />
      )}
      {auto && (
        <ModelPicker
          profile={profile}
          target="new chats"
          refresh
          only={auto}
          onClose={() => setAuto(null)}
          onPick={async (provider, model, effort) => {
            await setProfileModel(profile, provider, model, effort)
            toast(`New chats use ${model}`)
            onPicked?.()
          }}
        />
      )}
    </div>
  )
}

/** One provider: its sign-ins, its API key, its other settings, then the model picker for it. */
function ProviderSheet({ entry: e, profile, onClose, onChanged, onConnected, onTermux, onPicked }: { entry: ProviderEntry; profile: string; onClose: () => void; onChanged: () => void; onConnected: () => void; onTermux: () => void; onPicked: () => void }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [device, setDevice] = useState<OAuthProvider | null>(null)
  const [claude, setClaude] = useState(false)
  const [picking, setPicking] = useState(false)
  const [more, setMore] = useState(showFields(e))
  const p = qs({ profile })

  const putEnv = (name: string, value: string) => api('PUT', `/api/env?${p}`, { key: name, value }, { profile: false })
  const delEnv = (name: string) => api('DELETE', `/api/env?${p}`, { key: name }, { profile: false })
  const run = (what: Promise<unknown>, ok: string) => {
    setBusy(true)
    return what
      .then(() => {
        toast(ok)
        modelsChanged() // the chat's model picker fetches its live list again on its next open
        onChanged()
        return true
      })
      .catch(err => {
        toast(errText(err), 'error', 6000)
        return false
      })
      .finally(() => setBusy(false))
  }

  const saveKey = () => {
    if (!e.key) return
    haptic()
    void run(putEnv(e.key.env, key.trim()), `${e.name} connected`).then(ok => {
      if (!ok) return
      setKey('')
      onConnected()
    })
  }
  const removeField = (f: Field) =>
    void confirmDialog({ title: `Remove ${f.env}?`, message: 'The saved value is deleted from this bot’s .env.', confirmLabel: 'Remove', danger: true }).then(ok => ok && run(delEnv(f.env), `${f.env} removed`))
  const editField = (f: Field) =>
    void promptDialog({ title: f.env, message: f.description || undefined, value: f.secret ? '' : f.preview, placeholder: f.secret ? 'Paste here' : 'Value', confirmLabel: 'Save' }).then(v => {
      if (v == null) return
      void run(v ? putEnv(f.env, v) : delEnv(f.env), v ? `${f.env} saved` : `${f.env} removed`)
    })

  const signIn = (s: SignIn) => {
    haptic()
    const a = s.account
    if (s.kind === 'device') return setDevice(a as OAuthProvider)
    if (s.kind === 'termux' && a.id === 'anthropic') return setClaude(true) // in the app; Termux is its fallback
    termux(s)
  }
  const termux = (s: SignIn) => {
    const a = s.account
    if (s.kind === 'termux' && signInTermux(a.id, profile)) {
      onTermux()
      toast('Follow the steps in Termux, then come back here')
      return
    }
    void copyText(cliFor(a as OAuthProvider, profile))
    toast(
      s.kind === 'termux'
        ? 'Couldn’t open Termux. The command is copied: paste it in Termux inside Debian (~/bin/hermes-debian opens it)'
        : 'Command copied: run it in Termux inside Debian (~/bin/hermes-debian opens it). It needs that provider’s own CLI.',
      s.kind === 'termux' ? 'error' : 'info',
      8000
    )
  }
  const signOut = (s: SignIn) => {
    haptic()
    void run(api('DELETE', `/api/providers/oauth/${encodeURIComponent(s.account.id)}?${p}`, undefined, { profile: false }), `Signed out of ${s.label}`)
  }
  const removeEndpoint = () =>
    void confirmDialog({ title: `Remove ${e.name}?`, message: 'Hermux forgets this endpoint and its key.', confirmLabel: 'Remove', danger: true }).then(
      ok => ok && e.endpoint && run(api('DELETE', `/api/providers/custom-endpoints/${encodeURIComponent(e.endpoint.id)}?${p}`, undefined, { profile: false }), `${e.name} removed`).then(done => done && onClose())
    )

  const extra = e.fields.length > 0
  return (
    <>
    <Sheet title={e.name} onClose={onClose}>
      <div className="sheet-scroll">
        <div className="dim small pad">{e.connected ? connectedText(e) : e.blurb}</div>
        {e.endpoint && (
          <Section title="Endpoint">
            <Row title="Address" sub={<span className="mono small">{e.endpoint.base_url}</span>} />
            {e.endpoint.model && <Row title="Model" sub={e.endpoint.model} />}
            <Row title="API key" sub={e.endpoint.has_api_key ? 'Saved in Hermux’s .env' : 'None'} />
            <Row title="Remove this endpoint" danger onClick={removeEndpoint} />
          </Section>
        )}
        {e.signIns.length > 0 && (
          <Section title="Sign in" footer={e.signIns.some(s => s.kind === 'command' && !s.on) ? 'Some sign-ins need that provider’s own program in Debian: the app copies the command for Termux.' : undefined}>
            {e.signIns.map(s => (
              <Row
                key={s.account.id}
                title={s.label}
                sub={s.on ? `Signed in${s.account.status?.source_label ? ` · ${s.account.status.source_label}` : ''}` : s.kind === 'command' ? <span className="mono small">{s.account.cli_command}</span> : s.kind === 'termux' ? (s.account.id === 'anthropic' ? 'Sign in right here (or in Termux)' : 'Opens Termux for this sign-in') : 'Sign in with a code, right here'}
                trailing={
                  s.on ? (
                    s.account.disconnectable ? (
                      <button className="btn" disabled={busy} onClick={() => signOut(s)}>
                        Sign out
                      </button>
                    ) : undefined
                  ) : (
                    <button className={s.kind === 'command' ? 'btn' : 'btn primary'} onClick={() => signIn(s)}>
                      {s.kind === 'command' ? 'Copy command' : 'Sign in'}
                    </button>
                  )
                }
              />
            ))}
          </Section>
        )}
        {e.key && (
          <Section title="API key" footer={`Saved in Hermux’s .env on this phone (${e.key.env}). It never leaves the phone except to call ${e.name}.`}>
            {e.key.set && (
              <Row
                title="Saved key"
                sub={<span className="mono small">{e.key.preview || 'set'}</span>}
                trailing={
                  <button className="btn" disabled={busy} onClick={() => e.key && removeField(e.key)}>
                    Remove
                  </button>
                }
              />
            )}
            <div className="provider-key">
              <input className="mono" type="password" autoComplete="off" value={key} onChange={ev => setKey(ev.target.value)} placeholder={e.key.set ? 'Paste a new key to replace it' : 'Paste API key'} aria-label={`${e.name} API key`} />
              <button className="btn primary" disabled={busy || !key.trim()} onClick={saveKey}>
                Save
              </button>
            </div>
            {e.url && <Row title="Get a key" trailing={<Icon n="external" />} sub={hostOf(e.url)} onClick={() => openExternal(e.url)} />}
          </Section>
        )}
        <KeyPoolSection entry={e} profile={profile} onChanged={onChanged} />
        {extra && !more && <Row title="More settings" sub="Base URL and other options" chevron onClick={() => setMore(true)} />}
        {extra && more && (
          <Section title="Settings">
            {e.fields.map(f => (
              <Row
                key={f.env}
                title={<span className="mono small">{f.env}</span>}
                sub={f.set ? f.preview || 'set' : f.description || 'Not set'}
                chevron={!f.secret}
                trailing={
                  f.secret ? (
                    <button className="btn" disabled={busy} onClick={() => removeField(f)}>
                      Remove
                    </button>
                  ) : undefined
                }
                onClick={f.secret ? undefined : () => editField(f)}
              />
            ))}
          </Section>
        )}
        {!e.key && !e.signIns.length && !e.endpoint && e.url && <Row title="Sign-up / docs" trailing={<Icon n="external" />} sub={hostOf(e.url)} onClick={() => openExternal(e.url)} />}
      </div>
      <div className="sheet-actions">
        <button className="btn primary block" disabled={!e.connected} onClick={() => { haptic(); setPicking(true) }}>
          {e.connected ? 'Choose a model' : 'Connect it first, then choose a model'}
        </button>
      </div>
    </Sheet>
      {claude && (
        <ClaudeSignInSheet
          profile={profile}
          onClose={() => setClaude(false)}
          onDone={() => {
            setClaude(false)
            afterSignIn()
            onChanged()
            onConnected()
          }}
          onTermux={() => {
            setClaude(false)
            const s = e.signIns.find(x => x.kind === 'termux' && x.account.id === 'anthropic')
            if (s) termux(s)
          }}
        />
      )}
      {device && (
        <DeviceLoginSheet
          provider={device}
          profile={profile}
          onClose={() => setDevice(null)}
          onDone={() => {
            setDevice(null)
            onChanged()
            onConnected()
          }}
        />
      )}
      {picking && (
        <ModelPicker
          profile={profile}
          target="new chats"
          refresh
          only={e.slugs}
          onClose={() => setPicking(false)}
          onPick={async (provider, model, effort) => {
            await setProfileModel(profile, provider, model, effort)
            toast(`New chats use ${model}`)
            onPicked()
          }}
        />
      )}
    </>
  )
}

interface Validate {
  ok?: boolean
  message?: string
  models?: string[]
  resolved_base_url?: string
}

/** An OpenAI-compatible server (Mistral, Groq, Ollama presets, or your own): address + key, ask it for its models, save. */
function EndpointSheet({ preset, profile, onClose, onSaved }: { preset: Preset; profile: string; onClose: () => void; onSaved: (name: string) => void }) {
  const [name, setName] = useState(preset.name)
  const [url, setUrl] = useState(preset.base_url)
  const [key, setKey] = useState('')
  const [models, setModels] = useState<string[] | null>(null)
  const [model, setModel] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const body = () => ({ name: name.trim(), base_url: url.trim(), model: model.trim(), ...(key.trim() ? { api_key: key.trim() } : {}) })

  const find = () => {
    haptic()
    setBusy(true)
    setNote('')
    api<Validate>('POST', '/api/providers/custom-endpoints/validate', body(), { profile: false })
      .then(r => {
        const ids = r.models || []
        setModels(ids)
        if (r.resolved_base_url) setUrl(r.resolved_base_url)
        if (ids.length && !ids.includes(model)) setModel(ids[0])
        setNote(r.message || (ids.length ? `Found ${ids.length} model${ids.length === 1 ? '' : 's'}.` : 'It answered but listed no models: type the model name.'))
      })
      .catch(err => setNote(errText(err)))
      .finally(() => setBusy(false))
  }
  const save = () => {
    haptic()
    setBusy(true)
    api('POST', `/api/providers/custom-endpoints?${qs({ profile })}`, { ...body(), discover_models: true, ...(models?.length ? { models } : {}) }, { profile: false })
      .then(() => {
        toast(`${name.trim()} connected`)
        onSaved(name.trim())
      })
      .catch(err => toast(errText(err), 'error', 6000))
      .finally(() => setBusy(false))
  }
  const ready = name.trim() && /^https?:\/\/\S+$/.test(url.trim()) && model.trim() && (!preset.needs_key || key.trim())

  return (
    <Sheet title={preset.name ? `Connect ${preset.name}` : 'Your own endpoint'} onClose={onClose}>
      <div className="sheet-scroll">
        {!preset.base_url && <div className="dim small pad">Any server that speaks the OpenAI API. Hermux runs on this phone, so 127.0.0.1 is the phone itself.</div>}
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={ev => setName(ev.target.value)} placeholder="My server" />
        </label>
        <label className="field">
          <span>Address (base URL)</span>
          <input className="mono" inputMode="url" autoCapitalize="off" autoCorrect="off" value={url} onChange={ev => setUrl(ev.target.value)} placeholder="http://192.168.1.20:8000/v1" />
        </label>
        <label className="field">
          <span>API key{preset.needs_key ? '' : ' (if it needs one)'}</span>
          <input className="mono" type="password" autoComplete="off" value={key} onChange={ev => setKey(ev.target.value)} placeholder="Paste here" />
        </label>
        {preset.key_url && (
          <button className="btn" onClick={() => openExternal(preset.key_url!)}>
            Get a key <Icon n="external" />
          </button>
        )}
        <button className="btn block" disabled={busy || !/^https?:\/\/\S+$/.test(url.trim())} onClick={find}>
          Find its models
        </button>
        {note && <div className="dim small pad">{note}</div>}
        {models && models.length > 0 ? (
          <Section>
            <SelectRow title="Default model" options={models.map(m => ({ value: m, label: m }))} value={model} onChange={setModel} />
          </Section>
        ) : (
          <label className="field">
            <span>Model</span>
            <input className="mono" autoCapitalize="off" autoCorrect="off" value={model} onChange={ev => setModel(ev.target.value)} placeholder="e.g. mistral-large-latest" />
          </label>
        )}
        <div className="dim small">The key is saved in Hermux’s .env on this phone, not in its config file.</div>
      </div>
      <div className="sheet-actions">
        <button className="btn primary" disabled={busy || !ready} onClick={save}>
          Save
        </button>
      </div>
    </Sheet>
  )
}

const hostOf = (u: string) => {
  try {
    return new URL(u).host
  } catch {
    return u
  }
}
