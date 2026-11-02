// Provider rotation: what Hermes does when a model or a key stops working.
//
// Two of Hermes's own mechanisms, read and written through the dashboard routes it has (no route of the app's own):
// - The fallback chain (`fallback_providers` in config.yaml): models Hermes switches to, in order, when the main one is
//   rate-limited, out of credit, refuses the key or is gone. Read with GET /api/config, written whole with PUT /api/config
//   (a list replaces the old one). Entries keep any routing keys the user wrote by hand (base_url, key_env, …).
// - The credential pool (auth.json): several keys or logins per provider, rotated by the strategy in
//   `credential_pool_strategies.<provider>`. Listed with GET /api/credentials/pool, keys added with POST and removed with
//   DELETE /api/credentials/pool/<provider>/<index>. Hermes only reports each entry's last status (ok, exhausted, dead)
//   and how often it was used: no cooldown end, and no route says which entry a running chat holds, so "In use" / "Next"
//   is worked out from the strategy the way Hermes picks.
import { useMemo, useState } from 'react'
import { api, qs } from '../api'
import { haptic } from '../bridge'
import { confirmDialog } from '../dialog'
import { errText } from '../gateway'
import { toast, useStore } from '../store'
import type { ProviderEntry } from '../providers'
import { ModelPicker } from './Settings'
import { loadPool, type PoolEntry } from './SignIn'
import { Status, useLoader } from './Screens'
import { Row, Section, SelectRow } from './ui'

/** Hermes's SUPPORTED_POOL_STRATEGIES (agent/credential_pool.py); a missing or unknown value means fill_first. */
export const STRATEGIES = [
  { value: 'fill_first', label: 'In order', sub: 'Uses the first key until it is rate-limited or out of credit, then the next' },
  { value: 'round_robin', label: 'Take turns', sub: 'Moves on to the next key after each use' },
  { value: 'least_used', label: 'Least used', sub: 'Picks the key used least so far' },
  { value: 'random', label: 'Random', sub: 'Picks a key at random each time' }
]

export interface FallbackEntry {
  provider: string
  model: string
  [k: string]: unknown
}

interface RotationConfig {
  fallback_providers?: unknown
  fallback_model?: unknown
  credential_pool_strategies?: Record<string, string> | null
}

/** Config list → entries, like Hermes's reader: only dicts with a provider and a model (it skips anything else). */
export function chainOf(raw: unknown): FallbackEntry[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []
  const out: FallbackEntry[] = []
  for (const x of list) {
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      const r = x as Record<string, unknown>
      const provider = String(r.provider ?? '').trim()
      const model = String(r.model ?? '').trim()
      if (provider && model) out.push({ ...r, provider, model })
    }
  }
  return out
}

export const strategyOf = (cfg: RotationConfig | null | undefined, provider: string) => {
  const s = String(cfg?.credential_pool_strategies?.[provider] || '').trim().toLowerCase()
  return STRATEGIES.some(x => x.value === s) ? s : 'fill_first'
}

const usable = (e: PoolEntry) => e.last_status !== 'exhausted' && e.last_status !== 'dead'

/** The entry Hermes would pick next, as its pool does: none for random (nobody can tell). */
export function nextUp(entries: PoolEntry[], strategy: string): PoolEntry | undefined {
  const ok = entries.filter(usable)
  if (!ok.length || strategy === 'random') return undefined
  if (strategy === 'least_used') return ok.reduce((a, b) => ((b.request_count || 0) < (a.request_count || 0) ? b : a))
  return [...ok].sort((a, b) => (a.priority || 0) - (b.priority || 0) || (a.index || 0) - (b.index || 0))[0]
}

/** Where an entry came from, in words. */
export function sourceText(e: PoolEntry): string {
  const s = e.source || ''
  if (s.startsWith('env:')) return `Saved key (${s.slice(4)})`
  if (s === 'manual') return 'Added here'
  if (s === 'claude_code') return 'Claude Code’s login'
  if (s.startsWith('manual:') || e.auth_type === 'oauth') return 'Sign-in'
  if (s.startsWith('config:') || s.startsWith('custom')) return 'From the config file'
  return s || 'Key'
}

/** Badge for one entry: its last status, or In use / Next. */
function Badge({ e, next, strategy }: { e: PoolEntry; next?: PoolEntry; strategy: string }) {
  if (e.last_status === 'dead') return <span className="pool-badge dead">Stopped working</span>
  if (e.last_status === 'exhausted') return <span className="pool-badge cooling">Cooling down</span>
  if (next && e.id === next.id) return <span className="pool-badge on">{strategy === 'fill_first' ? 'In use' : 'Next'}</span>
  return null
}

/** Every pool entry of these provider ids, with the provider each belongs to (removal needs it). */
const entriesFor = (pool: Record<string, PoolEntry[]>, slugs: string[]) =>
  slugs.flatMap(s => (pool[s] || []).map(e => ({ ...e, provider: s })))

/** All keys of a provider cooling down or dead: Hermes moves on to the next model in the chain. */
const cooling = (pool: Record<string, PoolEntry[]> | undefined, provider: string) => {
  const list = pool?.[provider] || []
  return list.length > 0 && !list.some(usable)
}

/**
 * Hermes removes by position, and positions move (Take turns reorders the pool on every use): find the entry's current
 * index by its id right before deleting, so a key that moved meanwhile is never mistaken for another.
 */
async function removeById(profile: string, e: PoolEntry & { provider: string }) {
  const now = (await loadPool(profile))[e.provider] || []
  const cur = e.id ? now.find(x => x.id === e.id) : now.find(x => x.index === e.index)
  if (!cur?.index) throw new Error('That key is already gone. The list is up to date now.')
  return api<{ hints?: string[] }>('DELETE', `/api/credentials/pool/${encodeURIComponent(e.provider)}/${cur.index}?${qs({ profile })}`, undefined, { profile: false })
}

const saveConfig = (profile: string, config: Record<string, unknown>) => api('PUT', `/api/config?${qs({ profile })}`, { config }, { profile: false })

/**
 * Settings → Model providers: the fallback chain. The bot's main model first (not movable here: it is the default model),
 * then each fallback with ↑ ↓ and ✕, and "Add a fallback model" (the model picker of every connected provider).
 * `version` changes when something on the page was connected or removed, so the cooling-down notes are re-read.
 */
export function FallbackSection({ profile, version = 0 }: { profile: string; version?: number }) {
  const { data, error, loading, setData } = useLoader(
    async () => {
      const [cfg, pool] = await Promise.all([api<RotationConfig>('GET', `/api/config?${qs({ profile })}`, undefined, { profile: false }), loadPool(profile)])
      return { cfg, pool }
    },
    [profile, version]
  )
  const prof = useStore(s => s.profiles.find(p => p.name === profile))
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const chain = useMemo(() => chainOf(data?.cfg.fallback_providers), [data])
  // Hermes also tries the older single `fallback_model` after the list; this page can't delete it (PUT /api/config merges).
  const legacy = useMemo(() => chainOf(data?.cfg.fallback_model).filter(l => !chain.some(c => same(c, l))), [data, chain])

  const write = (next: FallbackEntry[], ok?: string) => {
    if (!data) return Promise.resolve(false)
    const before = data
    setData({ ...data, cfg: { ...data.cfg, fallback_providers: next } }) // at once; put back if Hermes refuses
    setBusy(true)
    return saveConfig(profile, { fallback_providers: next })
      .then(() => {
        if (ok) toast(ok)
        return true
      })
      .catch(e => {
        setData(before)
        toast(`Couldn’t save: ${errText(e)}`, 'error', 6000)
        return false
      })
      .finally(() => setBusy(false))
  }
  const move = (i: number, by: number) => {
    haptic()
    const next = [...chain]
    const [x] = next.splice(i, 1)
    next.splice(i + by, 0, x)
    void write(next)
  }
  const remove = (i: number) => {
    haptic()
    void write(
      chain.filter((_, j) => j !== i),
      `${chain[i].model} is no longer a fallback`
    )
  }

  const status = (provider: string) => (cooling(data?.pool, provider) ? <span className="pool-badge cooling">Keys cooling down</span> : null)
  const mainProvider = (prof?.provider || '').trim()
  return (
    <Section
      title="Fallback models"
      footer="When the main model is rate-limited, out of credit, refuses its key or is gone, Hermes switches to the next model in this list and goes back to the main one once it works again."
    >
      {error ? (
        <div className="notice notice-error">{error}</div>
      ) : !data ? (
        <Status loading={loading} error="" empty emptyText="" />
      ) : (
        <>
          <Row
            title={
              <span className="chain-title">
                <span className="chain-n">1</span>
                {prof?.model || 'No model set'}
              </span>
            }
            sub={
              <span className="key-line">
                Main model{mainProvider ? ` · ${mainProvider.replace(/^custom:/, '')}` : ''}
                {mainProvider ? status(mainProvider) : null}
              </span>
            }
          />
          {chain.map((c, i) => (
            <Row
              key={`${c.provider}/${c.model}/${i}`}
              title={
                <span className="chain-title">
                  <span className="chain-n">{i + 2}</span>
                  {c.model}
                </span>
              }
              sub={
                <span className="key-line">
                  {c.provider.replace(/^custom:/, '')}
                  {status(c.provider)}
                </span>
              }
              trailing={
                <span className="chain-ctl">
                  <button className="icon-btn" aria-label={`Move ${c.model} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button className="icon-btn" aria-label={`Move ${c.model} down`} disabled={busy || i === chain.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </button>
                  <button className="icon-btn" aria-label={`Remove ${c.model}`} disabled={busy} onClick={() => remove(i)}>
                    ✕
                  </button>
                </span>
              }
            />
          ))}
          {legacy.map(c => (
            <Row key={`legacy-${c.provider}/${c.model}`} title={c.model} sub={`${c.provider} · tried last, from the older fallback_model setting (Advanced settings)`} />
          ))}
          <Row icon="＋" tone="gold" title="Add a fallback model" sub={chain.length ? 'Tried after the ones above' : 'Any model of a connected provider'} chevron disabled={busy} onClick={() => setAdding(true)} />
        </>
      )}
      {adding && (
        <ModelPicker
          profile={profile}
          target="fallback"
          noEffort
          onClose={() => setAdding(false)}
          onPick={async (provider, model) => {
            const e = { provider, model }
            if (chain.some(c => same(c, e)) || (provider === mainProvider && model === prof?.model)) {
              toast(`${model} is already in the list`)
              return
            }
            if (!(await write([...chain, e], `${model} added as a fallback`))) throw new Error('Cancelled')
          }}
        />
      )}
    </Section>
  )
}

const same = (a: FallbackEntry, b: FallbackEntry) => a.provider.toLowerCase() === b.provider.toLowerCase() && a.model.toLowerCase() === b.model.toLowerCase() && String(a.base_url || '').replace(/\/+$/, '') === String(b.base_url || '').replace(/\/+$/, '')

/**
 * Inside a provider's sheet: every key and login in its credential pool, with status and how often each was used, the
 * rotation strategy (with two or more), Remove per entry and "Add another key". Only for providers with an API key or
 * pool entries; own endpoints keep their one key.
 */
export function KeyPoolSection({ entry: p, profile, onChanged }: { entry: ProviderEntry; profile: string; onChanged: () => void }) {
  const { data, error, reload, setData } = useLoader(
    async () => {
      const [pool, cfg] = await Promise.all([loadPool(profile), api<RotationConfig>('GET', `/api/config?${qs({ profile })}`, undefined, { profile: false }).catch(() => null)])
      return { pool, cfg }
    },
    [profile, p.key?.set, p.key?.preview] // saving or replacing the main key in this sheet changes the pool
  )
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const slugs = p.endpoint ? [] : p.slugs.length ? p.slugs : [p.id]
  const list = data ? entriesFor(data.pool, slugs) : []
  // The pool keys belong to the provider id itself (OPENROUTER_API_KEY → openrouter): new keys and the strategy go there.
  const strategy = strategyOf(data?.cfg, p.id)
  const own = list.filter(e => e.provider === p.id) // the strategy only rotates these (not a grouped sign-in's pool)
  const next = nextUp(own, strategy)
  // Hermes deliberately keeps a raw Copilot token out of the pool (it gets 400s): no extra keys there.
  const canAdd = Boolean(p.key) && p.id !== 'copilot'
  if (p.endpoint || (!p.key && !list.length)) return null

  const done = (what: Promise<unknown>, ok: string | ((r: unknown) => string)) => {
    setBusy(true)
    return what
      .then(r => {
        toast(typeof ok === 'string' ? ok : ok(r))
        reload()
        onChanged()
        return true
      })
      .catch(e => {
        toast(errText(e), 'error', 6000)
        return false
      })
      .finally(() => setBusy(false))
  }
  const add = () => {
    haptic()
    void done(api('POST', `/api/credentials/pool?${qs({ profile })}`, { provider: p.id, api_key: key.trim() }, { profile: false }), `Key added to ${p.name}`).then(ok => ok && setKey(''))
  }
  const remove = (e: PoolEntry & { provider: string }) =>
    void confirmDialog({
      title: `Remove ${e.label || 'this key'}?`,
      message: e.source?.startsWith('env:') ? `Hermes deletes ${e.source.slice(4)} from this bot’s .env and stops using it.` : 'Hermes forgets it and stops using it.',
      confirmLabel: 'Remove',
      danger: true
    }).then(
      ok =>
        ok &&
        done(removeById(profile, e), r => {
          const hint = (r as { hints?: string[] } | null)?.hints?.[0]
          return `${e.label || 'Key'} removed${hint ? `. ${hint}` : ''}`
        })
    )
  const pickStrategy = (s: string) => {
    if (!data) return
    haptic()
    const before = data
    setData({ ...data, cfg: { ...(data.cfg || {}), credential_pool_strategies: { ...(data.cfg?.credential_pool_strategies || {}), [p.id]: s } } })
    saveConfig(profile, { credential_pool_strategies: { [p.id]: s } }).catch(e => {
      setData(before)
      toast(`Couldn’t save: ${errText(e)}`, 'error', 6000)
    })
  }

  return (
    <Section
      title={`Keys and logins · ${list.length}`}
      footer="Hermes switches to another key here when one is rate-limited or out of credit, and to the next fallback model when none is left. Status is from each key’s last use."
    >
      {error && <div className="notice notice-error">{error}</div>}
      {list.map(e => (
        <Row
          key={`${e.provider}/${e.id || e.index}`}
          title={
            <span className="key-line">
              <span>{e.label || `Key ${e.index}`}</span>
              <Badge e={e} next={e.provider === p.id ? next : undefined} strategy={strategy} />
            </span>
          }
          sub={
            <>
              {e.token_preview && <span className="mono small">{e.token_preview} · </span>}
              {sourceText(e)} · {e.request_count || 0} {e.request_count === 1 ? 'use' : 'uses'}
            </>
          }
          trailing={
            e.index ? (
              <button className="btn" disabled={busy} onClick={() => remove(e)}>
                Remove
              </button>
            ) : undefined
          }
        />
      ))}
      {own.length > 1 && (
        <SelectRow
          title="Which key to use"
          options={STRATEGIES.map(s => ({ value: s.value, label: s.label, sub: s.sub }))}
          value={strategy}
          onChange={pickStrategy}
        />
      )}
      {canAdd && (
        <div className="provider-key">
          <input className="mono" type="password" autoComplete="off" value={key} onChange={ev => setKey(ev.target.value)} placeholder="Add another key" aria-label={`Another ${p.name} key`} />
          <button className="btn" disabled={busy || !key.trim() || !data} onClick={add}>
            Add
          </button>
        </div>
      )}
    </Section>
  )
}
