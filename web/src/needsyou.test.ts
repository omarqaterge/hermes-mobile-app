// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerRequest } from '@hermes/shared/json-rpc-channel'
import { SHEET_PAUSE_MS, aimAtNeed, currentRequest, mergeNeeds, needWords, needsPhrase, sameNeeds, setRequestChat, sheetBackInView, sheetCanAnswer, sheetShown } from './needsyou'
import { getState, setState, type ActiveSession, type WaitingItem } from './store'

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

describe('which request the sheet shows', () => {
  const chatT = { storedId: 'T', runtimeId: 'rt-T' } as ActiveSession
  const shown = () => currentRequest(getState())?.id
  const put = (...requests: ServerRequest[]) => {
    setState({ requests })
    return shown()
  }
  const forged: WaitingItem = { session: 'T', kind: 'approval', since: 1, until: 9e12 }
  beforeEach(() => {
    setRequestChat(chatOf)
    setState({ requests: [], waiting: [], needTarget: null, opening: null, active: null })
    shown()
  })
  const x = req('x', 'approval', 'rt-X')
  const y = req('y', 'clarify', 'rt-Y')
  const t = req('t', 'approval', 'rt-T')

  it('keeps the request on the sheet when the aimed chat asks', () => {
    setState({ opening: 'T' })
    aimAtNeed('T')
    expect(put(x)).toBe('x')
    expect(put(x, t)).toBe('x')
    setState({ opening: null, active: chatT })
    expect(shown()).toBe('x')
  })
  it('keeps it when Hermes hands the same request over again', () => {
    put(x)
    expect(put(req('t', 'approval', 'rt-T'), req('x', 'approval', 'rt-X'))).toBe('x')
  })
  it('takes the aimed chat next, before older requests, once the sheet is free', () => {
    setState({ opening: 'T' })
    aimAtNeed('T')
    put(x)
    put(x, y)
    put(x, y, t)
    setState({ opening: null, active: chatT })
    expect(put(y, t)).toBe('t')
    expect(getState().needTarget).toBeNull()
    expect(put(y)).toBe('y')
  })
  it('takes the oldest when nothing is aimed at', () => {
    put(x)
    expect(put(y, t)).toBe('y')
  })
  it('does not let a waiting entry keep the aim alive', () => {
    setState({ opening: 'T', waiting: [forged] })
    aimAtNeed('T')
    setState({ opening: null, active: chatT })
    expect(getState().needTarget).toBeNull()
    put(x)
    put(x, y, t)
    expect(put(y, t)).toBe('y')
  })
  it('drops the aim when the person goes elsewhere', () => {
    setState({ opening: 'T' })
    aimAtNeed('T')
    setState({ opening: 'other' })
    expect(getState().needTarget).toBeNull()
  })
  it('drops the aim when the opening fails', () => {
    setState({ opening: 'T' })
    aimAtNeed('T')
    setState({ opening: null })
    expect(getState().needTarget).toBeNull()
  })
})

describe('the pause after a sheet takes over', () => {
  let clock = 1_000_000
  const a = req('a', 'approval', 'rt-A')
  const b = req('b', 'approval', 'rt-B')
  const put = (...requests: ServerRequest[]) => {
    setState({ requests })
    return currentRequest(getState())?.id
  }
  beforeEach(() => {
    setRequestChat(chatOf)
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    put()
    clock += 60_000
  })
  afterEach(() => vi.restoreAllMocks())

  it('does not delay the first sheet after none', () => {
    put(a)
    expect(sheetCanAnswer('a', clock)).toBe(true)
  })
  it('ignores answers to the sheet that replaced another until the pause is over', () => {
    put(a, b)
    clock += 5000
    expect(put(b)).toBe('b')
    expect(sheetCanAnswer('b', clock + 60)).toBe(false)
    expect(sheetCanAnswer('b', clock + SHEET_PAUSE_MS - 1)).toBe(false)
    expect(sheetCanAnswer('b', clock + SHEET_PAUSE_MS)).toBe(true)
  })
  it('counts a tap made before the sheet appeared as too soon', () => {
    put(a, b)
    put(b)
    expect(sheetCanAnswer('b', clock - 10)).toBe(false)
  })
  it('counts from when the sheet is really on screen', () => {
    put(a, b)
    put(b)
    clock += 500
    sheetShown('b')
    expect(sheetCanAnswer('b', clock + 300)).toBe(false)
  })
  it('starts the pause again when the app returns to a sheet that replaced another', () => {
    put(a, b)
    put(b)
    clock += 60_000
    expect(sheetCanAnswer('b', clock)).toBe(true)
    sheetBackInView()
    expect(sheetCanAnswer('b', clock + 10)).toBe(false)
    expect(sheetCanAnswer('b', clock + SHEET_PAUSE_MS)).toBe(true)
  })
  it('does not pause a first sheet when the app returns', () => {
    put(a)
    clock += 60_000
    sheetBackInView()
    expect(sheetCanAnswer('a', clock)).toBe(true)
  })
  it('does not read the clock while no request is open', () => {
    const now = vi.mocked(performance.now)
    now.mockClear()
    for (let i = 0; i < 5; i++) currentRequest(getState())
    expect(now).not.toHaveBeenCalled()
  })
  it('does not pause a request that arrives once the sheet has closed', () => {
    put(a)
    put()
    clock += 100
    put(b)
    expect(sheetCanAnswer('b', clock)).toBe(true)
  })
})
