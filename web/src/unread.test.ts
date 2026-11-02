// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ background: false, unseen: [] as Array<{ id: string; title: string }[]> }))
vi.mock('./bridge', () => ({
  appInBackground: () => bridge.background,
  setUnseen: (_profile: string, rows: { id: string; title: string }[]) => bridge.unseen.push(rows)
}))

import { markSeen, noteSessions } from './unread'
import { getState, setState, type ActiveSession } from './store'
import type { SessionListRow } from '@hermes/shared/gateway-contract.generated'

const row = (id: string, n: number, started = 1): SessionListRow => ({ id, message_count: n, started_at: started } as SessionListRow)
const open = (id: string) => setState({ active: { storedId: id } as ActiveSession })
const lastUnseen = () => bridge.unseen[bridge.unseen.length - 1]?.map(r => r.id)

describe('unread chats and the Done chip', () => {
  beforeEach(() => {
    localStorage.clear()
    bridge.background = false
    bridge.unseen = []
    setState({ profile: `p${Math.random()}`, unread: [], sessions: [{ id: 'a' }, { id: 'b' }] as SessionListRow[] })
    noteSessions([row('a', 2), row('b', 2)]) // baseline: nothing unread
  })

  it('the open chat stays read while the app is on screen', () => {
    open('a')
    noteSessions([row('a', 4), row('b', 2)])
    expect(getState().unread).toEqual([])
  })

  it('a reply in the open chat while the app is away keeps it unread (the Done chip stays)', () => {
    open('a')
    bridge.background = true
    noteSessions([row('a', 4), row('b', 2)])
    expect(getState().unread).toEqual(['a'])
    expect(lastUnseen()).toEqual(['a'])
    noteSessions([row('a', 4), row('b', 2)]) // a later list while still away does not clear it
    expect(getState().unread).toEqual(['a'])
  })

  it('coming back to the app reads the open chat', () => {
    open('a')
    bridge.background = true
    noteSessions([row('a', 4), row('b', 2)])
    bridge.background = false
    document.dispatchEvent(new Event('visibilitychange'))
    expect(getState().unread).toEqual([])
    expect(lastUnseen()).toEqual([])
  })

  it('opening the chat reads it', () => {
    bridge.background = true
    noteSessions([row('a', 2), row('b', 5)])
    expect(getState().unread).toEqual(['b'])
    markSeen('b')
    expect(getState().unread).toEqual([])
  })

  it('a new chat started in the app and finished while away is unread', () => {
    const later = Date.now() / 1000 + 60
    setState({ sessions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as SessionListRow[] })
    open('c')
    bridge.background = true
    noteSessions([row('a', 2), row('b', 2), row('c', 2, later)])
    expect(getState().unread).toEqual(['c'])
  })
})
