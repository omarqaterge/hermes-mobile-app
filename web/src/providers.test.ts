import { describe, expect, test } from 'vitest'
import fixture from '../../tools/web-e2e/fixtures/hermes-providers.json'
import { buildCatalog, connectedText, matches, methods, onlySlugs, POPULAR, type Account, type EnvRow } from './providers'

// The pinned Hermes's real answers (tools/hermes-provider-fixture.py), nothing set, nobody signed in.
const env = fixture.env as Record<string, EnvRow>
const accounts = fixture.oauth.providers as Account[]
const byId = (list: ReturnType<typeof buildCatalog>, id: string) => list.find(e => e.id === id)

describe('buildCatalog (runtime list from the pinned Hermes)', () => {
  const list = buildCatalog(env, accounts)

  test('every provider the pinned Hermes can connect has a row', () => {
    const want = new Set<string>()
    for (const r of Object.values(env)) {
      for (const p of r.provider_profiles?.length ? r.provider_profiles.map(x => x.provider) : [r.provider || '']) if (p) want.add(p)
    }
    const covered = new Set(list.flatMap(e => e.slugs))
    for (const a of accounts) want.add(a.id)
    const missing = [...want].filter(s => !covered.has(s))
    expect(missing).toEqual([])
    expect(want.size).toBeGreaterThan(45) // 53 catalog providers minus moa/custom, plus claude-code
  })

  test('big ones first, in order, then the rest A–Z', () => {
    expect(list.slice(0, POPULAR.length).map(e => e.id)).toEqual(POPULAR)
    const rest = list.slice(POPULAR.length).map(e => e.name.toLowerCase())
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)))
  })

  test('a vendor sign-in sits in the same row as its API key', () => {
    const openai = byId(list, 'openai-api')!
    expect(openai.name).toBe('OpenAI')
    expect(openai.key?.env).toBe('OPENAI_API_KEY')
    expect(openai.signIns.map(s => [s.account.id, s.kind])).toEqual([['openai-codex', 'device']])
    expect(openai.slugs).toEqual(expect.arrayContaining(['openai-api', 'openai-codex']))
    expect(byId(list, 'openai-codex')).toBeUndefined()
    const claude = byId(list, 'anthropic')!
    expect(claude.key?.env).toBe('ANTHROPIC_API_KEY')
    expect(claude.signIns.map(s => [s.account.id, s.kind])).toEqual([['anthropic', 'termux'], ['claude-code', 'command']])
    expect(byId(list, 'xai')!.signIns[0].account.id).toBe('xai-oauth')
    expect(byId(list, 'minimax')!.signIns[0].kind).toBe('device')
  })

  test('alias keys are not a second paste field; base URLs are settings', () => {
    const gem = byId(list, 'gemini')!
    expect(gem.key?.env).toBe('GOOGLE_API_KEY')
    expect(gem.fields.map(f => f.env)).toEqual(['GEMINI_BASE_URL'])
    expect(gem.fields[0].secret).toBe(false)
  })

  test('a shared key (DASHSCOPE_API_KEY) gives each provider that uses it a row', () => {
    for (const id of ['alibaba', 'alibaba-cn', 'alibaba-coding-plan', 'alibaba-coding-plan-cn']) expect(byId(list, id), id).toBeTruthy()
    expect(byId(list, 'alibaba')!.key?.env).toBe('DASHSCOPE_API_KEY')
    expect(byId(list, 'alibaba-coding-plan')!.key?.env).toBe('ALIBABA_CODING_PLAN_API_KEY')
  })

  test('sign-in-only and key-less providers still get a row', () => {
    expect(byId(list, 'nous')!.signIns[0].kind).toBe('device')
    expect(byId(list, 'nous')!.key).toBeUndefined()
    expect(byId(list, 'bedrock')!.fields.map(f => f.env)).toEqual(['AWS_PROFILE', 'AWS_REGION'])
    expect(byId(list, 'vertex')!.fields.map(f => f.env)).toEqual(['VERTEX_CREDENTIALS_PATH'])
    expect(byId(list, 'lmstudio')!.fields.map(f => f.env)).toEqual(['LM_BASE_URL'])
    expect(methods(byId(list, 'bedrock')!)).toBe('Set up')
  })

  test('virtual providers are left out', () => {
    expect(byId(list, 'moa')).toBeUndefined()
    expect(byId(list, 'custom')).toBeUndefined()
  })

  test('Mistral and Groq (no built-in provider) are OpenAI-compatible presets', () => {
    expect(byId(list, 'mistral')!.preset?.base_url).toBe('https://api.mistral.ai/v1')
    expect(byId(list, 'groq')!.preset?.base_url).toBe('https://api.groq.com/openai/v1')
    expect(byId(list, 'ollama')!.preset?.needs_key).toBe(false)
  })

  test('nothing is connected on an empty Hermes', () => {
    expect(list.filter(e => e.connected).map(e => e.id)).toEqual([])
  })
})

describe('buildCatalog merge rules', () => {
  test('a key set or a sign-in marks the row connected; the free tier does not', () => {
    const e = { ...env, DEEPSEEK_API_KEY: { ...env.DEEPSEEK_API_KEY, is_set: true, redacted_value: '«redacted:sk-d…1234»' } }
    const a = accounts.map(x => (x.id === 'openai-codex' ? { ...x, status: { logged_in: true, source_label: 'OpenAI Codex' } } : x.id === 'nous' ? { ...x, status: { logged_in: true, free_tier: true } } : x))
    const list = buildCatalog(e, a)
    expect(byId(list, 'deepseek')!.connected).toBe(true)
    expect(connectedText(byId(list, 'deepseek')!)).toBe('Connected · key sk-d…1234')
    expect(byId(list, 'openai-api')!.connected).toBe(true)
    expect(connectedText(byId(list, 'openai-api')!)).toBe('Signed in · OpenAI Codex')
    expect(byId(list, 'nous')!.connected).toBe(false)
  })

  test('a set alias key counts and stays visible so it can be cleared', () => {
    const list = buildCatalog({ ...env, GEMINI_API_KEY: { ...env.GEMINI_API_KEY, is_set: true } }, accounts)
    const gem = byId(list, 'gemini')!
    expect(gem.connected).toBe(true)
    expect(gem.fields.map(f => f.env)).toEqual(['GEMINI_API_KEY', 'GEMINI_BASE_URL'])
  })

  test('a provider a newer Hermes adds shows up with its own label and blurb', () => {
    const list = buildCatalog(
      {
        ...env,
        ZETA_API_KEY: { category: 'provider', provider: 'zeta', provider_label: 'Zeta AI', provider_primary: true, is_password: true, description: 'Zeta key', url: 'https://zeta.example/keys' },
        ZETA_BASE_URL: { category: 'provider', provider: 'zeta', provider_label: 'Zeta AI', advanced: true, is_password: false }
      },
      [...accounts, { id: 'omega-oauth', name: 'Omega Account', flow: 'device_code', cli_command: 'hermes auth add omega-oauth', status: { logged_in: false } }, { id: 'sigma', name: 'Sigma', flow: 'external', cli_command: 'hermes auth add sigma', status: {} }]
    )
    const z = byId(list, 'zeta')!
    expect([z.name, z.blurb, z.url, z.key?.env, z.rank]).toEqual(['Zeta AI', 'Zeta key', 'https://zeta.example/keys', 'ZETA_API_KEY', 100])
    expect(byId(list, 'omega-oauth')!.signIns[0].kind).toBe('device')
    // An unknown terminal login is only offered as a command to copy (it may need another CLI).
    expect(byId(list, 'sigma')!.signIns[0].kind).toBe('command')
  })

  test('a newer Hermes with a real Mistral provider replaces the preset', () => {
    const list = buildCatalog({ ...env, MISTRAL_API_KEY: { category: 'provider', provider: 'mistral', provider_label: 'Mistral AI', provider_primary: true, is_password: true } }, accounts)
    const m = list.filter(e => e.id === 'mistral')
    expect(m).toHaveLength(1)
    expect(m[0].preset).toBeUndefined()
    expect(m[0].key?.env).toBe('MISTRAL_API_KEY')
  })

  test('untagged provider rows, messaging-managed keys and empty answers are safe', () => {
    expect(buildCatalog(null, null).every(e => e.preset)).toBe(true)
    const list = buildCatalog({ NOUS_BASE_URL: { category: 'provider' }, X_KEY: { category: 'tool', provider: 'x' } }, [])
    expect(list.every(e => e.preset)).toBe(true)
  })

  test('a preset saved as an endpoint (real pinned answer: id "mistral") is one connected row, not two', () => {
    const list = buildCatalog(env, accounts, [{ id: 'mistral', name: 'Mistral', base_url: 'https://api.mistral.ai/v1', model: 'mistral-large-latest', has_api_key: true }])
    const m = list.filter(e => e.name === 'Mistral')
    expect(m.map(e => [e.id, e.connected])).toEqual([['endpoint:mistral', true]])
    expect(onlySlugs([{ slug: 'nous' }, { slug: 'mistral' }], m[0].slugs).map(p => p.slug)).toEqual(['mistral'])
  })

  test('saved custom endpoints are connected rows that match their model-picker slug', () => {
    const list = buildCatalog(env, accounts, [{ id: 'my-box', name: 'My Box', base_url: 'http://192.168.1.5:8080/v1', model: 'llama' }])
    const e = byId(list, 'endpoint:my-box')!
    expect(e.connected).toBe(true)
    expect(connectedText(e)).toBe('Connected · llama')
    expect(onlySlugs([{ slug: 'anthropic' }, { slug: 'custom:my-box' }], e.slugs).map(p => p.slug)).toEqual(['custom:my-box'])
  })
})

describe('search and picker filter', () => {
  const list = buildCatalog(env, accounts)
  test('search finds by name, vendor sign-in and env var', () => {
    expect(list.filter(e => matches(e, 'chatgpt')).map(e => e.id)).toEqual(['openai-api'])
    expect(list.filter(e => matches(e, 'DEEPSEEK_API')).map(e => e.id)).toEqual(['deepseek'])
    expect(list.filter(e => matches(e, 'groq')).map(e => e.id)).toEqual(['groq'])
    expect(list.filter(e => matches(e, '  ')).length).toBe(list.length)
  })
  test('the model picker falls back to every provider when none match', () => {
    const avail = [{ slug: 'openrouter' }, { slug: 'openai-codex' }]
    expect(onlySlugs(avail, byId(list, 'openai-api')!.slugs).map(p => p.slug)).toEqual(['openai-codex'])
    expect(onlySlugs(avail, ['nothing'])).toEqual(avail)
    expect(onlySlugs(avail, undefined)).toEqual(avail)
  })
})
