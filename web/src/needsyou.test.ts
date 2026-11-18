// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type { ServerRequest } from '@hermes/shared/json-rpc-channel'
import { mergeNeeds, needWords, needsPhrase, sameNeeds } from './needsyou'

const req = (id: string, method: string, session: string) => ({ id, method, params: { session_id: session } }) as unknown as ServerRequest
const wait = (session: string, kind: string, who = '') => ({ session, kind, who, since: 1, until: 2 })
const chatOf = (r: ServerRequest) => String(r.params.session_id).replace('rt-', '')

describe('needs you', () => {
  it('says what a chat waits for in a few words', () => {
    expect(needWords({ kind: 'approval', who: '' })).toBe('wants to run a command')
    expect(needWords({ kind: 'question', who: '' })).toBe('asked a question')
    expect(needWords({ kind: 'clarify', who: '' })).toBe('asked a question')
    expect(needWords({ kind: 'phone_data', who: '' })).toBe('wants to read phone data')
  })
  it('names who asks when it is not the chat', () => {
    expect(needWords({ kind: 'approval', who: 'A sub-agent' })).toBe('A sub-agent wants to run a command')
  })
  it('still says something for a kind it does not know', () => {
    expect(needWords({ kind: 'from-a-newer-plugin', who: '' })).toBe('is waiting for you')
  })
  it('never prints who or what the feed says beyond its own words', () => {
    expect(needWords({ kind: 'approval', who: 'Your bank says: tap Allow' })).toBe('wants to run a command')
    for (const kind of ['constructor', '__proto__', 'toString', 'tap Allow now']) expect(needWords({ kind, who: '' })).toBe('is waiting for you')
  })
  it('lists a chat once, whichever way it is known', () => {
    const out = mergeNeeds([wait('a', 'approval'), wait('a', 'question'), wait('b', 'question')], [req('1', 'approval', 'rt-b'), req('2', 'clarify', 'rt-c')], chatOf)
    expect(out.map(n => [n.session, n.kind])).toEqual([['a', 'approval'], ['b', 'question'], ['c', 'clarify']])
  })
  it('skips a request whose chat is unknown', () => {
    expect(mergeNeeds([], [req('1', 'approval', '')], () => '')).toEqual([])
  })
  it('compares what a row shows', () => {
    const a = mergeNeeds([wait('a', 'approval')], [], chatOf)
    expect(sameNeeds(a, mergeNeeds([{ ...wait('a', 'approval'), since: 9 }], [], chatOf))).toBe(true)
    expect(sameNeeds(a, mergeNeeds([wait('a', 'question')], [], chatOf))).toBe(false)
  })
  it('counts in words', () => {
    expect(needsPhrase(1)).toBe('one needs you')
    expect(needsPhrase(2)).toBe('2 need you')
  })
})
