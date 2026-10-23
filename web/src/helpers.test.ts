// @vitest-environment happy-dom
// Helpers that live in modules touching window/localStorage at load time.
import { describe, expect, test } from 'vitest'
import { fmtClock, readingClock, speakable, voiceErrorText } from './voice'
import { lineDiff } from './canvas'
import { addsToScreen, getState, hydrate, setState, splitAttachments, toast } from './store'
import { findHit, parseSnippet } from './jump'
import { ago, markSeen, noteSessions } from './unread'
import { chatMarkdown } from './export'

test('speakable drops code, links, symbols', () => {
  const s = speakable('## Hi\n\nSee [docs](https://x.y) and `x`.\n\n```\ncode\n```\n\n- one ✅')
  expect(s.startsWith('Hi.\nSee docs and x.')).toBe(true)
  expect(s).toContain('(code omitted)')
  expect(s.endsWith('one')).toBe(true)
  expect(s).not.toMatch(/[#`✅\[\]]|https?:/)
})

test('speakable says a card is shown instead of reading openui-lang', () => {
  const s = speakable('Hi\n```openui-lang\nroot = Card([])\n```')
  expect(s).toContain('card shown in the app')
  expect(s).not.toContain('code omitted')
  expect(speakable('Hi\n```openui-lang\nroot = Card([')).not.toContain('Card')
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
  test('a mid-turn resume repeating the previous turn tail is shown once', () => {
    // What Hermes returned on the phone while turn 2 ran: turn 1's tool and reply again after turn 2's tool.
    const items = hydrate([
      { role: 'user', text: 'one', row_id: 1 },
      { role: 'tool', name: 'terminal', tool_call_id: 'c1' },
      { role: 'assistant', text: 'FIRST REPLY', row_id: 3 },
      { role: 'user', text: 'two', row_id: 4 },
      { role: 'tool', name: 'terminal', tool_call_id: 'c2' },
      { role: 'tool', name: 'terminal', tool_call_id: 'c1' },
      { role: 'assistant', text: 'FIRST REPLY', row_id: 3 }
    ] as never)
    expect(items.map(i => (i.kind === 'tool' ? i.id : i.kind === 'assistant' || i.kind === 'user' ? i.text : ''))).toEqual(['one', 'c1', 'FIRST REPLY', 'two', 'c2'])
  })
})

describe('addsToScreen', () => {
  const user = (id: string) => ({ kind: 'user', id, text: 'q' })
  const tool = (id: string) => ({ kind: 'tool', id, name: 'terminal', status: 'done' })
  const reply = (id: string, text: string) => ({ kind: 'assistant', id, text, reasoning: '', streaming: false })
  const notice = (id: string) => ({ kind: 'notice', id, text: 'n', level: 'info' })
  test('a tool call missed while away wins over a longer screen', () => {
    const shown = [user('u'), tool('c1'), notice('n1'), notice('n2')] as never
    expect(addsToScreen([user('x'), tool('c1'), tool('c2')] as never, shown)).toBe(true)
  })
  test('a reply missed while away wins', () => {
    expect(addsToScreen([user('x'), tool('c1'), reply('b', 'done')] as never, [user('u'), tool('c1')] as never)).toBe(true)
  })
  test('nothing new keeps the screen', () => {
    const shown = [user('u'), tool('c1'), reply('a', 'done'), notice('n1')] as never
    expect(addsToScreen([user('x'), tool('c1'), reply('b', 'done')] as never, shown)).toBe(false)
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

describe('approvalPrompt (live mode)', async () => {
  const live = await import('./live')
  test('asks the short question and never reads the command out', () => {
    const t = live.approvalPrompt(['once', 'session', 'deny'])
    expect(t).toBe('Hermes needs your permission. Allow or deny?')
    expect(t).not.toMatch(/\b(rm|chmod|command)\b/) // "permission" contains "rm"
  })
})

describe('resumed photos can be sent again (edit / retry)', async () => {
  const { imagesOf } = await import('./gateway')
  test('a stored @image: line gives the message its Hermes path', () => {
    const [u] = hydrate([{ role: 'user', text: 'what colour?\n@image:/root/.hermes/images/upload_1.png', row_id: 3 } as never])
    expect(u.kind === 'user' && u.imagePaths).toEqual(['/root/.hermes/images/upload_1.png'])
    expect(imagesOf(u)).toEqual([{ name: 'upload_1.png', path: '/root/.hermes/images/upload_1.png', url: undefined }])
  })
  test('a message without photos has none to resend', () => {
    expect(imagesOf({ kind: 'user', id: 'u1', text: 'hi' })).toEqual([])
  })
})

describe('splitAttachments', () => {
  test('turns stored photo and file references into chips', () => {
    expect(splitAttachments('what colour? One word\n@image:/root/.hermes/images/upload_1.png\n[screenshot]')).toEqual({
      text: 'what colour? One word',
      images: ['upload_1.png'],
      files: [],
      fileRefs: []
    })
    const f = splitAttachments('@file:.hermes/a/codeword.pdf @file:x/b.csv\n\nwhat is in it?\n\n--- Attached Context ---\n\n📎 @file:… binary')
    expect(f).toEqual({ text: 'what is in it?', images: [], files: ['codeword.pdf', 'b.csv'], fileRefs: ['@file:.hermes/a/codeword.pdf', '@file:x/b.csv'] })
  })
  test('leaves plain text alone', () => {
    expect(splitAttachments('mail me @ noon, see @image in docs')).toEqual({ text: 'mail me @ noon, see @image in docs', images: [], files: [], fileRefs: [] })
  })
  test('hydrate keeps the refs so Edit/Retry can send the files again', () => {
    const items = hydrate([{ role: 'user', text: '@file:ws/a.pdf\n\nsummarize' } as never])
    expect(items[0]).toMatchObject({ kind: 'user', text: 'summarize', files: ['a.pdf'], fileRefs: ['@file:ws/a.pdf'] })
  })
  test('filesOf pairs names with refs and skips unknown refs', async () => {
    const { filesOf } = await import('./gateway')
    expect(filesOf({ kind: 'user', id: 'u', text: 't', files: ['a.pdf', 'b.txt'], fileRefs: ['@file:ws/a.pdf', ''] })).toEqual([{ name: 'a.pdf', ref: '@file:ws/a.pdf' }])
    expect(filesOf({ kind: 'user', id: 'u', text: 't', files: ['a.pdf'] })).toEqual([])
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
    expect(voiceErrorText('tts-unavailable')).toContain('Read-aloud isn’t working')
  })
  test('the same toast is not stacked twice', () => {
    toast('Voice input failed (x)', 'error')
    toast('Voice input failed (x)', 'error')
    expect(getState().toasts.filter(t => t.text === 'Voice input failed (x)').length).toBe(1)
  })
})

describe('read-aloud errors', () => {
  test('a TTS failure is shown as read-aloud, not passed to dictation', () => {
    window.__hmVoice?.('error', 'tts-unavailable')
    expect(getState().toasts.some(t => t.text.startsWith('Read-aloud isn’t working'))).toBe(true)
  })
})

describe('read-aloud controls shared with the notification', async () => {
  const v = await import('./voice')
  const calls: string[][] = []
  const fake = {
    speak: (text: string, cfg: string) => void calls.push(['speak', text, cfg]),
    stopSpeaking: () => void calls.push(['stop']),
    ttsControl: (cmd: string) => void calls.push(['ctl', cmd])
  }
  const setNative = (on: boolean) => ((window as unknown as { HermesAndroid?: unknown }).HermesAndroid = on ? fake : undefined)
  const text = 'One sentence here. ' + 'Another sentence follows. '.repeat(20)

  test('tts-paused from the card pauses the player at that chunk; tts-resumed plays on', () => {
    setNative(true)
    calls.length = 0
    v.speak('item1', text)
    const cfg = JSON.parse(calls[0][2])
    expect(cfg.notify).toBe(true)
    expect(typeof cfg.title).toBe('string')
    window.__hmVoice?.('tts-paused', '120')
    expect(v.voiceState().player).toMatchObject({ id: 'item1', paused: true, pos: 120 })
    window.__hmVoice?.('tts-done', '') // the engine reporting the stop: the player stays
    expect(v.voiceState().player?.paused).toBe(true)
    window.__hmVoice?.('tts-resumed', '')
    expect(v.voiceState().player?.paused).toBe(false)
    v.stopSpeaking()
  })

  test('tts-seek (card back / forward 10 s) moves the player without a pace measurement', () => {
    setNative(true)
    v.speak('item3', text)
    window.__hmVoice?.('tts-seg', '0,50')
    window.__hmVoice?.('tts-seek', '120')
    expect(v.voiceState().player?.pos).toBe(120)
    expect(v.voiceState().player?.paused).toBe(false)
    window.__hmVoice?.('tts-seek', '99999') // never past the end
    expect(v.voiceState().player?.pos).toBeLessThanOrEqual(v.voiceState().player?.total ?? 0)
    window.__hmVoice?.('tts-seek', 'x') // garbage is ignored
    v.stopSpeaking()
    window.__hmVoice?.('tts-seek', '5') // no player: nothing happens
    expect(v.voiceState().player).toBeNull()
  })

  test('the in-app pause / resume go through ttsControl, not a re-speak', () => {
    setNative(true)
    v.speak('item2', text)
    calls.length = 0
    v.pauseSpeaking()
    expect(calls).toEqual([['ctl', 'pause']])
    expect(v.voiceState().player?.paused).toBe(true)
    window.__hmVoice?.('tts-paused', '19')
    calls.length = 0
    v.resumeSpeaking()
    expect(calls).toEqual([['ctl', 'play']])
    window.__hmVoice?.('tts-resumed', '')
    // a seek while paused moves the place natively unknown to Voice.java: resume re-speaks from there
    v.pauseSpeaking()
    window.__hmVoice?.('tts-paused', '19')
    v.seekSpeaking(200)
    calls.length = 0
    v.resumeSpeaking()
    expect(calls[0][0]).toBe('speak')
    expect(calls[0][1]).toBe(speakable(text).slice(200))
    v.stopSpeaking()
  })

  test('stop from the card drops even a paused player', () => {
    setNative(true)
    v.speak('item3', text)
    window.__hmVoice?.('tts-paused', '0')
    window.__hmVoice?.('tts-done', 'stop')
    expect(v.voiceState().player).toBe(null)
    expect(v.voiceState().speakingId).toBe(null)
  })

  test('the voice test asks for no notification; a pause in Live mode makes a minimal player', () => {
    setNative(true)
    calls.length = 0
    v.testVoice()
    expect(JSON.parse(calls[0][2]).notify).toBe(false)
    v.speak('live', 'Hello there, this is live mode.')
    expect(v.voiceState().player).toBe(null)
    window.__hmVoice?.('tts-paused', '6')
    expect(v.voiceState().player).toMatchObject({ id: 'live', paused: true, pos: 6 })
    v.stopSpeaking()
    setNative(false)
  })
})

describe('unread list is mirrored to the Android service', () => {
  test('setUnseen is called once per change of the unread list', () => {
    const calls: unknown[][] = []
    const w = window as unknown as { HermesAndroid?: unknown }
    w.HermesAndroid = { setUnseen: (...a: unknown[]) => void calls.push(a) }
    const profile = getState().profile
    const row = (id: string, n: number) => ({ id, title: 'T' + id, message_count: n, started_at: 1 }) as never
    setState({ sessions: [{ id: 'a1', title: 'Chat one' }] as never })
    noteSessions([row('a1', 2)]) // first list: baseline, nothing unread
    expect(calls.length).toBe(0)
    noteSessions([row('a1', 4)]) // grew: unread
    expect(calls).toEqual([[profile, JSON.stringify([{ id: 'a1', title: 'Chat one' }])]])
    noteSessions([row('a1', 4)]) // unchanged: no call
    expect(calls.length).toBe(1)
    markSeen('a1')
    expect(calls.length).toBe(2)
    expect(calls[1][1]).toBe('[]')
    w.HermesAndroid = undefined
  })
})

describe('reading clock', () => {
  test('fmtClock formats m:ss and h:mm:ss', () => {
    expect(fmtClock(0)).toBe('0:00')
    expect(fmtClock(72.4)).toBe('1:12')
    expect(fmtClock(3725)).toBe('1:02:05')
    expect(fmtClock(NaN)).toBe('0:00')
  })
  test('readingClock = elapsed / ~total at the given pace', () => {
    expect(readingClock(120, 1000, 10)).toBe('0:12 / ~1:40')
  })
})
