import { describe, expect, it } from 'vitest'
import { ENDED_HOLD_S, SUB_AGENT, cleanActivity, cleanWaiting, forgetEnded, noteEnded, visibleWaiting, type EndedChat } from './waiting'
import type { WaitingItem } from './store'

const entry = (session: string, open = 1, since = 100, last = since, kind = 'approval'): WaitingItem => ({ session, kind, since, last, open, until: 900 })
const shown = (list: WaitingItem[], ended: Map<string, EndedChat>, now: number) => visibleWaiting(list, ended, now).map(w => w.session)

describe('what the feed still counts after a request ended here', () => {
  it('hides a chat whose only request ended, before the plugin has heard', () => {
    const ended = new Map<string, EndedChat>()
    noteEnded(ended, 'a', [entry('a')], 200)
    expect(shown([entry('a'), entry('b')], ended, 200.5)).toEqual(['b'])
  })
  it('keeps a chat listed while another request of the same kind is open', () => {
    const ended = new Map<string, EndedChat>()
    noteEnded(ended, 'a', [entry('a', 2)], 200)
    expect(shown([entry('a', 2)], ended, 200.5)).toEqual(['a']) // the plugin has not heard yet
    expect(shown([entry('a', 1)], ended, 201)).toEqual(['a']) // it has
  })
  it('hides it when the second ends too', () => {
    const ended = new Map<string, EndedChat>()
    noteEnded(ended, 'a', [entry('a', 2)], 200)
    noteEnded(ended, 'a', [entry('a', 2)], 201)
    expect(shown([entry('a', 2)], ended, 201.5)).toEqual([])
    expect(shown([entry('a', 1)], ended, 201.5)).toEqual([])
  })
  it('counts open requests of every kind in the chat', () => {
    const ended = new Map<string, EndedChat>()
    const both = [entry('a', 1, 100, 100, 'approval'), entry('a', 1, 110, 110, 'question')]
    noteEnded(ended, 'a', both, 200)
    expect(shown(both, ended, 200.5)).toEqual(['a', 'a'])
  })
  it('shows a request that began after the end', () => {
    const ended = new Map<string, EndedChat>()
    noteEnded(ended, 'a', [entry('a')], 200)
    expect(shown([entry('a', 1, 100, 200.2)], ended, 200.5)).toEqual(['a'])
  })
  it('does not count on a feed it never saw for long: the feed is believed again', () => {
    const ended = new Map<string, EndedChat>()
    noteEnded(ended, 'a', [], 200) // the feed had not listed it yet
    expect(shown([entry('a', 1)], ended, 200.5)).toEqual([])
    expect(shown([entry('a', 2)], ended, 200.5)).toEqual(['a'])
    expect(shown([entry('a', 1)], ended, 200 + ENDED_HOLD_S)).toEqual(['a'])
  })
  it('forgets what is over', () => {
    const ended = new Map<string, EndedChat>()
    noteEnded(ended, 'a', [entry('a')], 200)
    noteEnded(ended, 'b', [entry('b')], 200)
    noteEnded(ended, 'c', [entry('c')], 100)
    forgetEnded(ended, [entry('a'), entry('c')], 201)
    expect([...ended.keys()]).toEqual(['a'])
  })
})

describe('what is taken from the feed', () => {
  const good = { session: 's', kind: 'approval', who: '', profile: 'p', since: 1, until: 2, open: 2, last: 1.5 }
  it('keeps a well-formed entry as it is', () => expect(cleanWaiting([good])).toEqual([good]))
  it('takes only the exact who', () => {
    expect(cleanWaiting([{ ...good, who: SUB_AGENT }])[0].who).toBe(SUB_AGENT)
    for (const who of ['Your bank', 'a sub-agent', ['A sub-agent'], 7]) expect(cleanWaiting([{ ...good, who }])[0].who).toBe('')
  })
  it('turns a kind it does not know, or one only requests have, into none', () => {
    for (const kind of ['tap Allow', 'sudo', 'constructor', 5]) expect(cleanWaiting([{ ...good, kind }])[0].kind).toBe('')
  })
  it('skips what is not an entry', () => {
    const bad = [null, 'x', 3, [], { ...good, session: '' }, { ...good, session: 1 }, { ...good, since: 'x' }, { ...good, until: Infinity }, { ...good, until: NaN }]
    expect(cleanWaiting(bad)).toEqual([])
    for (const raw of [undefined, null, 'x', {}]) expect(cleanWaiting(raw)).toEqual([])
  })
  it('falls back on counts that make no sense', () => {
    const w = cleanWaiting([{ ...good, open: -1, last: 'x' }])[0]
    expect([w.open, w.last]).toEqual([1, 1])
  })
})

describe('the work list from the feed', () => {
  const good = { session: 's', text: 'Thinking', short: 'Thinking', profile: 'p', review: false, ts: 5 }
  it('keeps a well-formed line, and only its known fields', () => expect(cleanActivity([{ ...good, extra: { a: 1 } }])).toEqual([good]))
  it('accepts what an older plugin leaves out', () => {
    expect(cleanActivity([{ session: 's', text: 't', ts: 1 }])).toEqual([{ session: 's', text: 't', short: undefined, profile: undefined, review: false, ts: 1 }])
  })
  it('skips anything React could not draw or the banner could not use', () => {
    const bad = [null, 'x', { ...good, text: { a: 1 } }, { ...good, text: null }, { ...good, session: ['s'] }, { ...good, session: '' }, { ...good, short: 5 }, { ...good, profile: {} }, { ...good, ts: 'x' }]
    expect(cleanActivity(bad)).toEqual([])
    for (const raw of [undefined, null, {}, 'x']) expect(cleanActivity(raw)).toEqual([])
  })
})
