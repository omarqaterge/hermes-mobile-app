import { describe, expect, it } from 'vitest'
import { ENDED_HOLD_S, forgetEnded, noteEnded, visibleWaiting, type EndedChat } from './waiting'
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
