// @vitest-environment happy-dom
// Claude sign-in status: Hermes's account list misses a Claude login that lives only in the credential pool (where
// `hermes auth add anthropic` and the in-app login save it); withPoolStatus fills it in.
import { describe, expect, test } from 'vitest'
import { withPoolStatus } from './components/SignIn'

const card = (id: string, logged_in = false) => ({ id, status: { logged_in } })

describe('withPoolStatus', () => {
  test('an OAuth Claude login in the pool marks the Claude card signed in, with its label', () => {
    const [c] = withPoolStatus([card('anthropic')], { anthropic: [{ label: 'claude-sub', auth_type: 'oauth', source: 'manual:hermes_pkce' }] })
    expect(c.status).toMatchObject({ logged_in: true, source: 'credential_pool', source_label: 'claude-sub' })
  })
  test("an API key or Claude Code's own login does not count as the Claude subscription", () => {
    const pool = { anthropic: [{ label: 'k', auth_type: 'api_key', source: 'env:ANTHROPIC_API_KEY' }, { label: 'claude_code', auth_type: 'oauth', source: 'claude_code' }] }
    expect(withPoolStatus([card('anthropic')], pool)[0].status.logged_in).toBe(false)
  })
  test("Hermes's own answer wins; other providers are untouched; no pool = unchanged", () => {
    const signed = { id: 'anthropic', status: { logged_in: true, source_label: 'Hermes PKCE' } }
    expect(withPoolStatus([signed], { anthropic: [{ label: 'x', auth_type: 'oauth', source: 'manual:hermes_pkce' }] })[0]).toBe(signed)
    const other = card('openai-codex')
    expect(withPoolStatus([other], { 'openai-codex': [{ auth_type: 'oauth', source: 'manual:device_code' }] })[0]).toBe(other)
    expect(withPoolStatus([card('anthropic')], {})[0].status.logged_in).toBe(false)
  })
})
