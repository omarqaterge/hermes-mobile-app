// @vitest-environment happy-dom
// Helpers that live in modules touching window/localStorage at load time.
import { describe, expect, test } from 'vitest'
import { speakable, voiceErrorText } from './voice'
import { lineDiff } from './canvas'
import { getState, hydrate, splitAttachments, toast } from './store'
import { findHit, parseSnippet } from './jump'
import { ago } from './unread'
import { chatMarkdown } from './export'

test('speakable drops code, links, symbols', () => {
  const s = speakable('## Hi\n\nSee [docs](https://x.y) and `x`.\n\n```\ncode\n```\n\n- one ✅')
  expect(s.startsWith('Hi.\nSee docs and x.')).toBe(true)
  expect(s).toContain('(code omitted)')
  expect(s.endsWith('one')).toBe(true)
  expect(s).not.toMatch(/[#`✅\[\]]|https?:/)
})

describe('lineDiff', () => {
  test('changed line with context', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc')).toBe(' a\n-b\n+B\n c')
  })
  test('no changes', () => {
    expect(lineDiff('same', 'same')).toBe(' (no changes)')
  })
  test('far changes are split by @@', () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i}`)
    const b = [...a]
    b[1] = 'X'
    b[18] = 'Y'
    expect(lineDiff(a.join('\n'), b.join('\n'))).toContain('@@ … @@')
  })
})

describe('hydrate', () => {
  test('rows → items; hidden and empty rows skipped; tool diff kept', () => {
    const items = hydrate([
      { role: 'user', text: 'hi', row_id: 3 },
      { role: 'assistant', text: '', reasoning: 'thinking' },
      { role: 'assistant', text: '   ' },
      { role: 'user', text: 'secret', display_kind: 'hidden' },
      { role: 'tool', name: 'patch', tool_call_id: 'call1', display_metadata: { tool_result_metadata: { inline_diff: '--- a' } } }
    ] as never)
    expect(items.map(i => i.kind)).toEqual(['user', 'assistant', 'tool'])
    expect(items[0]).toMatchObject({ text: 'hi', rowId: 3 })
    expect(items[1]).toMatchObject({ reasoning: 'thinking' })
    expect(items[2]).toMatchObject({ id: 'call1', name: 'patch', inlineDiff: '--- a' })
  })
})

describe('message search', () => {
  test('parseSnippet', () => {
    expect(parseSnippet('…the >>>Blue<<< car and >>>blue<<< sky')).toEqual({ terms: ['blue'], plain: '…the Blue car and blue sky' })
  })
  test('findHit prefers the verbatim snippet, then the latest', () => {
    const items = [
      { kind: 'user', id: '1', text: 'blue things' },
      { kind: 'assistant', id: '2', text: 'the blue car and blue sky', reasoning: '', streaming: false },
      { kind: 'user', id: '3', text: 'more blue' }
    ] as never
    expect(findHit(items, ['blue'], '…the blue car and blue sky')).toBe(1)
    expect(findHit(items, ['blue'], 'nothing like it')).toBe(2)
    expect(findHit(items, ['green'], 'green')).toBe(-1)
  })
})

test('ago', () => {
  const now = Date.UTC(2026, 8, 30, 12)
  expect(ago(now - 10_000, now)).toBe('now')
  expect(ago(now - 5 * 60_000, now)).toBe('5 min')
  expect(ago(now - 3 * 3600_000, now)).toBe('3 h')
  expect(ago(now - 2 * 86400_000, now)).toBe('2 d')
  expect(ago(0, now)).toBe('')
})

test('chatMarkdown', () => {
  const md = chatMarkdown(
    {
      title: '⎇ Trip',
      items: [
        { kind: 'user', id: 'u', text: 'Plan it', images: ['a.png'] },
        { kind: 'tool', id: 't', name: 'web_search', context: 'flights', status: 'done' },
        { kind: 'assistant', id: 'a', text: 'Done.', reasoning: 'x', streaming: false }
      ]
    },
    new Date(0)
  )
  expect(md.startsWith('# Trip\n\n_Exported from Hermes on ')).toBe(true)
  expect(md).toContain('**You:**\n\nPlan it\n\n_Attached: a.png_\n\n_🔧 web_search: flights_\n\n**Hermes:**\n\nDone.\n')
})

describe('voiceChoice (live mode approvals)', async () => {
  const { voiceChoice } = await import('./live')
  const all = ['once', 'session', 'deny']
  test.each([
    ['yes', 'once'],
    ['okay go ahead', 'once'],
    ['allow it for this chat', 'session'],
    ['yes for the session', 'session'],
    ["no don't", 'deny'],
    ["don't allow that", 'deny'],
    ['deny', 'deny'],
    ['what is it doing', null]
  ])('%s → %s', (said, want) => {
    expect(voiceChoice(said, all)).toBe(want)
  })
  test('session falls back to once when not offered', () => {
    expect(voiceChoice('allow for this chat', ['once', 'deny'])).toBe('once')
  })
})

describe('splitAttachments', () => {
  test('turns stored photo and file references into chips', () => {
    expect(splitAttachments('what colour? One word\n@image:/root/.hermes/images/upload_1.png\n[screenshot]')).toEqual({
      text: 'what colour? One word',
      images: ['upload_1.png'],
      files: []
    })
    const f = splitAttachments('@file:.hermes/a/codeword.pdf @file:x/b.csv\n\nwhat is in it?\n\n--- Attached Context ---\n\n📎 @file:… binary')
    expect(f).toEqual({ text: 'what is in it?', images: [], files: ['codeword.pdf', 'b.csv'] })
  })
  test('leaves plain text alone', () => {
    expect(splitAttachments('mail me @ noon, see @image in docs')).toEqual({ text: 'mail me @ noon, see @image in docs', images: [], files: [] })
  })
})

describe('math inside raw HTML', () => {
  test('delimiters in an HTML fragment become math code, tags and prices stay', async () => {
    const { mathInHtml } = await import('./components/Markdown')
    const out = mathInHtml('<div style="color:red">Field $\\psi$ and\n$$\nx^2 < y\n$$\n<td>costs $5 and $10</td>')
    expect(out).toContain('<code class="language-math math-inline">\\psi</code>')
    expect(out).toContain('<code class="language-math math-display">x^2 &lt; y</code>')
    expect(out).toContain('<div style="color:red">')
    expect(out).toContain('costs $5 and $10')
  })
})

describe('voice input errors', () => {
  test('codes become plain advice', () => {
    expect(voiceErrorText('stt-5')).toContain('isn’t working on this phone (stt-5)')
    expect(voiceErrorText('stt-10')).toContain('Google app')
    expect(voiceErrorText('stt-2')).toContain('internet')
    expect(voiceErrorText('stt-unavailable')).toContain('no speech recognition')
    expect(voiceErrorText('mic-denied', true)).toBe('Allow the microphone to use live mode')
    expect(voiceErrorText('stt-99')).toBe('Voice input failed (stt-99)')
  })
  test('the same toast is not stacked twice', () => {
    toast('Voice input failed (x)', 'error')
    toast('Voice input failed (x)', 'error')
    expect(getState().toasts.filter(t => t.text === 'Voice input failed (x)').length).toBe(1)
  })
})
