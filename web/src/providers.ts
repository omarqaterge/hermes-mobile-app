// The model-provider catalog shown by Connect (first run) and Settings → Model providers.
//
// The list comes FROM Hermes at runtime, from the same two dashboard routes Hermes Desktop's Settings → Providers
// uses: GET /api/env (rows with category "provider", tagged by Hermes's unified provider_catalog() with
// provider / provider_label / provider_primary / provider_profiles) and GET /api/providers/oauth (account sign-ins).
// A provider a newer Hermes adds shows up by itself. This file only adds display extras (order, short names,
// blurbs, grouping a vendor's sign-in with its API key) and falls back to Hermes's own label for anything unknown.
// Pure functions: unit-tested in providers.test.ts against the pinned Hermes's real answers.

export interface EnvRow {
  is_set?: boolean
  redacted_value?: string | null
  description?: string
  url?: string | null
  category?: string
  is_password?: boolean
  advanced?: boolean
  channel_managed?: boolean
  provider?: string
  provider_label?: string
  provider_primary?: boolean
  provider_profiles?: { provider: string; provider_label: string; description?: string; url?: string | null; primary?: boolean }[]
}

export interface Account {
  id: string
  name: string
  flow: 'device_code' | 'external' | string
  cli_command: string
  docs_url?: string
  disconnectable?: boolean
  status?: { logged_in?: boolean; source_label?: string | null; free_tier?: boolean; error?: string | null }
}

export interface Endpoint {
  id: string
  name: string
  base_url: string
  model?: string
  models?: string[]
  has_api_key?: boolean
  is_current?: boolean
}

/** How the app runs a sign-in: in the app (device code), in Termux (`hermes auth add <id>`), or only as a command to copy. */
export type SignInKind = 'device' | 'termux' | 'command'

export interface SignIn {
  account: Account
  kind: SignInKind
  label: string
  on: boolean
}

export interface Field {
  env: string
  description: string
  set: boolean
  preview: string
  secret: boolean
}

export interface Preset {
  name: string
  base_url: string
  key_url?: string
  needs_key: boolean
}

export interface ProviderEntry {
  id: string
  name: string
  blurb: string
  /** Every Hermes provider slug in this row: the model picker shows only these. */
  slugs: string[]
  key?: Field
  /** Non-key settings (base URL, region, …) and alias keys that are set (so they can be cleared). */
  fields: Field[]
  signIns: SignIn[]
  url: string
  connected: boolean
  rank: number
  /** Not a Hermes provider: an OpenAI-compatible server the app saves as a custom endpoint. */
  preset?: Preset
  endpoint?: Endpoint
}

/** Popular first, in this order; everything else A–Z after them. */
export const POPULAR = ['anthropic', 'openai-api', 'gemini', 'openrouter', 'xai', 'deepseek', 'mistral', 'groq']

interface Extra {
  name?: string
  blurb?: string
  /** Show this sign-in inside another provider's row (same vendor). */
  group?: string
  signInLabel?: string
  /** `hermes auth add <id>` works in a phone terminal. */
  termux?: boolean
  /** Settings this provider can't work without (no key, or a local server address). */
  showFields?: boolean
}

const EXTRA: Record<string, Extra> = {
  anthropic: { name: 'Anthropic (Claude)', blurb: 'Claude API key, or sign in with Claude Pro / Max', signInLabel: 'Claude Pro / Max · opens Termux', termux: true },
  'claude-code': { group: 'anthropic', signInLabel: 'Claude Code token (claude setup-token)' },
  'openai-api': { name: 'OpenAI', blurb: 'API key, or sign in with ChatGPT Plus / Pro' },
  'openai-codex': { group: 'openai-api', name: 'ChatGPT / Codex', signInLabel: 'ChatGPT Plus / Pro or a Codex plan' },
  gemini: { name: 'Google Gemini', blurb: 'Google AI Studio key, has a free tier' },
  vertex: { blurb: 'Google Cloud: service-account JSON path', showFields: true },
  openrouter: { blurb: 'One key for hundreds of models' },
  xai: { name: 'xAI (Grok)', blurb: 'API key, or sign in with SuperGrok / X Premium+' },
  'xai-oauth': { group: 'xai', signInLabel: 'SuperGrok or X Premium+' },
  deepseek: { blurb: 'DeepSeek API key' },
  nous: { name: 'Nous Portal', blurb: 'Nous Research account', signInLabel: 'Nous Portal account' },
  minimax: { blurb: 'API key, or sign in with a MiniMax account' },
  'minimax-oauth': { group: 'minimax', signInLabel: 'MiniMax account' },
  alibaba: { blurb: 'DashScope key, or the Qwen CLI sign-in' },
  'qwen-oauth': { group: 'alibaba', signInLabel: 'Qwen CLI sign-in (needs the qwen CLI)' },
  copilot: { blurb: 'GitHub token with Copilot access' },
  'copilot-acp': { group: 'copilot', signInLabel: 'Copilot CLI (copilot login)' },
  lmstudio: { blurb: 'LM Studio server on your network: set its address', showFields: true },
  bedrock: { blurb: 'AWS region / profile (AWS credentials needed in Debian)', showFields: true },
  huggingface: { name: 'Hugging Face' }
}

/** OpenAI-compatible services Hermes has no built-in provider for: saved as a custom endpoint. */
export const PRESETS: Record<string, Preset & { blurb: string }> = {
  mistral: { name: 'Mistral', base_url: 'https://api.mistral.ai/v1', key_url: 'https://console.mistral.ai/api-keys', needs_key: true, blurb: 'Mistral API key (OpenAI-compatible endpoint)' },
  groq: { name: 'Groq', base_url: 'https://api.groq.com/openai/v1', key_url: 'https://console.groq.com/keys', needs_key: true, blurb: 'Groq API key (OpenAI-compatible endpoint)' },
  ollama: { name: 'Ollama (local)', base_url: 'http://127.0.0.1:11434/v1', needs_key: false, blurb: 'Ollama on this phone or your network' }
}

/** Hermes's virtual providers have nothing to connect. */
const SKIP = new Set(['moa', 'custom'])

const isKeyVar = (env: string, r: { is_password?: boolean }) => Boolean(r.is_password) || /(?:_API_KEY|_TOKEN|_KEY)$/.test(env)
const isUrlVar = (env: string) => /_URL$/.test(env)

/** «redacted:sk-o…f800» → sk-o…f800 */
export const redacted = (v?: string | null) => (v || '').replace(/^«redacted:(.*)»$/, '$1')

function kindOf(a: Account): SignInKind {
  if (a.flow === 'device_code') return 'device'
  if (a.flow === 'external' && EXTRA[a.id]?.termux && a.cli_command === `hermes auth add ${a.id}`) return 'termux'
  return 'command'
}

interface Draft {
  id: string
  name: string
  blurbs: string[]
  url: string
  rows: [string, EnvRow & { primary?: boolean }][]
  signIns: SignIn[]
  slugs: Set<string>
}

/** Merge Hermes's env catalog, its account sign-ins and the saved custom endpoints into one row per provider. */
export function buildCatalog(env: Record<string, EnvRow> | null | undefined, accounts: Account[] | null | undefined, endpoints: Endpoint[] = []): ProviderEntry[] {
  const drafts = new Map<string, Draft>()
  const draft = (id: string, label?: string): Draft => {
    let d = drafts.get(id)
    if (!d) drafts.set(id, (d = { id, name: EXTRA[id]?.name || label || id, blurbs: [], url: '', rows: [], signIns: [], slugs: new Set([id]) }))
    else if (!EXTRA[id]?.name && label && d.name === id) d.name = label
    return d
  }

  for (const [env_, info] of Object.entries(env || {})) {
    if (info.category !== 'provider' || info.channel_managed) continue
    // One credential can serve several providers (DASHSCOPE_API_KEY): one row per provider, same env var.
    const scoped = info.provider_profiles?.length
      ? info.provider_profiles.map(p => ({ ...info, provider: p.provider, provider_label: p.provider_label, description: p.description || info.description, url: p.url ?? info.url, primary: Boolean(p.primary) }))
      : [{ ...info, primary: Boolean(info.provider_primary) }]
    for (const s of scoped) {
      const id = (s.provider || '').trim()
      if (!id || SKIP.has(id)) continue // not tagged by Hermes's provider catalog (e.g. NOUS_BASE_URL)
      const d = draft(id, s.provider_label?.trim())
      d.rows.push([env_, s])
    }
  }

  for (const a of accounts || []) {
    if (!a?.id || SKIP.has(a.id)) continue
    const host = EXTRA[a.id]?.group || a.id
    const d = draft(host, host === a.id ? EXTRA[a.id]?.name || a.name : undefined)
    d.slugs.add(a.id)
    const on = Boolean(a.status?.logged_in) && a.status?.free_tier !== true
    d.signIns.push({ account: a, kind: kindOf(a), label: EXTRA[a.id]?.signInLabel || EXTRA[a.id]?.name || a.name, on })
    if (!d.url && a.docs_url) d.url = a.docs_url
  }

  const out: ProviderEntry[] = []
  for (const d of drafts.values()) {
    const keyRows = d.rows.filter(([k, r]) => isKeyVar(k, r) && !isUrlVar(k))
    const primary = keyRows.find(([, r]) => r.primary) || keyRows.find(([, r]) => !r.advanced) || keyRows[0]
    const field = ([k, r]: [string, EnvRow]): Field => ({ env: k, description: r.description || '', set: Boolean(r.is_set), preview: redacted(r.redacted_value), secret: isKeyVar(k, r) && !isUrlVar(k) })
    const key = primary ? field(primary) : undefined
    // Alias keys only while set (so they can be cleared): never a second "paste key" field.
    const fields = d.rows
      .filter(([k]) => k !== primary?.[0])
      .filter(([k, r]) => !(isKeyVar(k, r) && !isUrlVar(k)) || r.is_set)
      .map(field)
      .sort((a, b) => a.env.localeCompare(b.env))
    if (!key && !fields.length && !d.signIns.length) continue
    const keySet = d.rows.some(([k, r]) => r.is_set && isKeyVar(k, r) && !isUrlVar(k))
    // No key at all (Bedrock, Vertex): a set non-key setting is how it is configured.
    const fieldSet = !keyRows.length && fields.some(f => f.set)
    const url = (primary?.[1].url as string | undefined) || d.rows.find(([, r]) => r.url)?.[1].url || d.url || ''
    const desc = primary?.[1].description || d.rows[0]?.[1].description || ''
    const i = POPULAR.indexOf(d.id)
    out.push({
      id: d.id,
      name: d.name,
      blurb: EXTRA[d.id]?.blurb || desc || d.signIns[0]?.label || '',
      slugs: [...d.slugs],
      key,
      fields,
      signIns: d.signIns,
      url,
      connected: keySet || fieldSet || d.signIns.some(s => s.on),
      rank: i < 0 ? 100 : i
    })
  }

  // OpenAI-compatible services Hermes has no provider for, unless a newer Hermes added one with that id
  // or it is already saved as an endpoint (Hermes names the endpoint after it: "mistral").
  const savedUrl = (u: string) => u.replace(/\/+$/, '').toLowerCase()
  for (const [id, p] of Object.entries(PRESETS)) {
    if (out.some(e => e.id === id)) continue
    if ((endpoints || []).some(e => e?.id === id || savedUrl(e?.base_url || '') === savedUrl(p.base_url))) continue
    const i = POPULAR.indexOf(id)
    out.push({ id, name: p.name, blurb: p.blurb, slugs: [], fields: [], signIns: [], url: p.key_url || '', connected: false, rank: i < 0 ? 100 : i, preset: p })
  }

  for (const e of endpoints || []) {
    if (!e?.id || !e.base_url) continue
    out.push({
      id: `endpoint:${e.id}`,
      name: e.name || e.id,
      blurb: e.base_url,
      slugs: [e.id, `custom:${e.id}`, `custom:${(e.name || e.id).toLowerCase().replace(/ /g, '-')}`],
      fields: [],
      signIns: [],
      url: '',
      connected: true,
      rank: 100,
      endpoint: e
    })
  }

  return out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/** Open the settings at once: the provider can't work without them (no key, or a local server address). */
export const showFields = (e: ProviderEntry) => e.fields.length > 0 && (!e.key || Boolean(EXTRA[e.id]?.showFields))

/** Search over name, id, blurb, sign-in names and env var names. */
export function matches(e: ProviderEntry, q: string): boolean {
  const n = q.trim().toLowerCase()
  if (!n) return true
  const hay = [e.name, e.id, e.blurb, e.key?.env || '', ...e.fields.map(f => f.env), ...e.signIns.map(s => `${s.label} ${s.account.name} ${s.account.id}`), e.preset?.base_url || '', e.endpoint?.base_url || '']
  return hay.some(h => h.toLowerCase().includes(n))
}

/** How this row connects, for its subtitle: "API key", "Sign in", "API key or sign in". */
export function methods(e: ProviderEntry): string {
  if (e.endpoint) return 'Your endpoint'
  const k = Boolean(e.key || e.preset?.needs_key)
  const s = e.signIns.some(x => x.kind !== 'command')
  if (k && s) return 'Key or sign in'
  if (k) return 'API key'
  if (s) return 'Sign in'
  return 'Set up'
}

/** What is connected, for a connected row's subtitle. */
export function connectedText(e: ProviderEntry): string {
  if (e.endpoint) return `Connected · ${e.endpoint.model || e.endpoint.base_url}`
  const signed = e.signIns.find(s => s.on)
  const keySet = Boolean(e.key?.set) || e.fields.some(f => f.set && f.secret)
  const key = e.key?.set ? `key ${e.key.preview || 'set'}` : 'key set'
  if (signed) return `Signed in${signed.account.status?.source_label ? ` · ${signed.account.status.source_label}` : ''}${keySet ? ` · ${key}` : ''}`
  if (keySet) return `Connected · ${key}`
  return 'Connected'
}

/** Only these providers in the model picker (Hermes model.options slugs). No match (another spelling): all of them, never an empty picker. */
export function onlySlugs<T extends { slug: string }>(list: T[], slugs?: string[]): T[] {
  if (!slugs?.length) return list
  const want = new Set(slugs.map(s => s.toLowerCase()))
  const hit = list.filter(p => want.has(p.slug.toLowerCase()))
  return hit.length ? hit : list
}
