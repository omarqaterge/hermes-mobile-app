import { describe, expect, it } from 'vitest'
import { customCandidate, customSlug, withCustoms } from './custommodels'

const rows = [
  { slug: 'openrouter', models: ['openai/gpt-5', 'anthropic/claude-x'] },
  { slug: 'jev', models: [] as string[] }
]

describe('custom models', () => {
  it('a typed id is anything without whitespace', () => {
    expect(customSlug('  org/model:tag ')).toBe('org/model:tag')
    expect(customSlug('two words')).toBeNull()
    expect(customSlug('   ')).toBeNull()
  })
  it('offers the typed id only when no provider lists it exactly', () => {
    expect(customCandidate('openai/gpt-6', rows)).toBe('openai/gpt-6')
    expect(customCandidate('OpenAI/GPT-5', rows)).toBeNull()
    expect(customCandidate('gpt', rows)).toBe('gpt') // a partial match still lets you use the typed id
    expect(customCandidate('', rows)).toBeNull()
  })
  it('adds remembered ids to their own provider only, once', () => {
    const out = withCustoms(rows, [{ p: 'jev', m: 'jev-large' }, { p: 'openrouter', m: 'openai/gpt-5' }, { p: 'gone', m: 'x' }])
    expect(out.find(r => r.slug === 'jev')?.models).toEqual(['jev-large'])
    expect(out.find(r => r.slug === 'openrouter')?.models).toEqual(['openai/gpt-5', 'anthropic/claude-x'])
    expect(withCustoms(rows, [])).toBe(rows)
  })
})
