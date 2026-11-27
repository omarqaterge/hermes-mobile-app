// @vitest-environment happy-dom
// Chat deletion (F3): deletes must stick across localStorage cache, in-flight session.list races,
// warm/closeLater/detached live runtimes (error 4023), and must never report success when Hermes rejects.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  api: vi.fn(async () => ({})),
  qs: () => ''
}))

const load = async () => ({
  ...(await import('./store')),
  ...(await import('./gateway'))
})
let M = await load()

type RpcHandler = (method: string, params: Record<string, unknown>) => unknown
let rpcHandler: RpcHandler = () => ({})

const spyClient = () =>
  vi.spyOn(M.client, 'request').mockImplementation((async (method: string, params: Record<string, unknown> = {}) =>
    rpcHandler(method, params)) as typeof M.client.request)

const row = (id: string, title = `Chat ${id}`) => ({ id, title, preview: 'hi', message_count: 2, started_at: 1_700_000_000, source: 'mobile' })

beforeEach(() => {
  localStorage.clear()
  M.setState({ conn: 'open', active: null, opening: null, requests: [], profile: 'default', sessions: [], sessionsLoading: false })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('deleteSession sticks and never fails silently', () => {
  it('updates localStorage hm.sessions.v1.<profile> and discards an in-flight session.list started before delete', async () => {
    let finishList!: (v: unknown) => void
    const listPending = new Promise(resolve => {
      finishList = resolve
    })
    rpcHandler = (method, params) => {
      if (method === 'session.list') return listPending
      if (method === 'session.delete') return { deleted: params.session_id }
      return {}
    }
    spyClient()
    const initial = [row('c-1'), row('c-2')]
    M.setState({ sessions: initial })
    localStorage.setItem('hm.sessions.v1.default', JSON.stringify(initial))

    // Start session.list BEFORE deleting c-1.
    const loading = M.loadSessions()
    await M.deleteSession('c-1')

    // Cache and store both drop c-1 right away.
    expect(M.getState().sessions.map(s => s.id)).toEqual(['c-2'])
    expect(M.cachedSessions('default').map(s => s.id)).toEqual(['c-2'])

    // Now the stale session.list (still containing c-1) resolves: it must NOT bring c-1 back.
    finishList({ sessions: initial })
    await loading
    expect(M.getState().sessions.map(s => s.id)).toEqual(['c-2'])
    expect(M.cachedSessions('default').map(s => s.id)).toEqual(['c-2'])
  })

  it('closes a detached live session via session.active_list and retries once on error 4023', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    let deleteTries = 0
    rpcHandler = (method, params) => {
      calls.push({ method, params })
      if (method === 'session.delete') {
        deleteTries++
        if (deleteTries === 1) throw Object.assign(new Error('cannot delete an active session'), { code: 4023 })
        return { deleted: params.session_id }
      }
      if (method === 'session.active_list') {
        return { sessions: [{ id: 'rt-detached-c3', session_key: 'c-3' }] }
      }
      return {}
    }
    spyClient()
    M.setState({ sessions: [row('c-3')] })

    await M.deleteSession('c-3')
    expect(deleteTries).toBe(2)
    expect(calls.some(c => c.method === 'session.close' && c.params.session_id === 'rt-detached-c3')).toBe(true)
    expect(M.getState().sessions).toEqual([])
  })

  it('throws and keeps local state intact when session.delete rejects or answers { deleted: false }', async () => {
    rpcHandler = method => {
      if (method === 'session.delete') return { deleted: false }
      return {}
    }
    spyClient()
    const initial = [row('c-4')]
    M.setState({ sessions: initial })
    localStorage.setItem('hm.sessions.v1.default', JSON.stringify(initial))

    await expect(M.deleteSession('c-4')).rejects.toThrow()
    expect(M.getState().sessions.map(s => s.id)).toEqual(['c-4'])
    expect(M.cachedSessions('default').map(s => s.id)).toEqual(['c-4'])
  })

  it('cancels and closes a warm chat already handed to closeLater before deleting it', async () => {
    const closed: string[] = []
    rpcHandler = (method, params) => {
      if (method === 'session.resume') {
        const sid = String(params.session_id)
        return { session_id: `rt-${sid}`, stored_session_id: sid, messages: [], running: false, info: { title: sid } }
      }
      if (method === 'session.close') {
        closed.push(String(params.session_id))
        return {}
      }
      if (method === 'session.delete') return { deleted: params.session_id }
      return {}
    }
    spyClient()
    // Open 4 chats in turn: WARM=2 keeps 2 warm and sends the first (c-a) to closeLater(3000ms).
    await M.resumeSession('c-a')
    await M.resumeSession('c-b')
    await M.resumeSession('c-c')
    await M.resumeSession('c-d')
    expect(closed).not.toContain('rt-c-a')

    await M.deleteSession('c-a')
    expect(closed).toContain('rt-c-a')
  })

  it('scopes live-runtime closing to the deleted chat profile and never closes another profile session with the same id', async () => {
    const closed: Array<{ id: string; profile: unknown }> = []
    let deleteTries = 0
    rpcHandler = (method, params) => {
      if (method === 'session.resume') {
        const sid = String(params.session_id)
        const prof = String(params.profile || M.getState().profile)
        return { session_id: `rt-${prof}-${sid}`, stored_session_id: sid, messages: [], running: false, info: { title: sid, profile: prof } }
      }
      if (method === 'session.close') {
        closed.push({ id: String(params.session_id), profile: params.profile })
        return {}
      }
      if (method === 'session.active_list') {
        return {
          sessions: [
            { id: 'rt-default-shared', session_key: 'shared', profile: 'default' },
            { id: 'rt-work-shared', session_key: 'shared', profile: 'work' }
          ]
        }
      }
      if (method === 'session.delete') {
        deleteTries++
        if (deleteTries === 1) throw Object.assign(new Error('cannot delete an active session'), { code: 4023 })
        return { deleted: params.session_id }
      }
      return {}
    }
    spyClient()
    // Open chat 'shared' in 'default' so it is active on screen in 'default'.
    await M.resumeSession('shared')
    expect(M.getState().active?.runtimeId).toBe('rt-default-shared')

    // Deleting chat 'shared' in profile 'work' must NOT close default's active session or clear default's active state,
    // and on 4023 must only close work's detached runtime.
    await M.deleteSession('shared', 'work')
    expect(closed.map(c => c.id)).toEqual(['rt-work-shared'])
    expect(M.getState().active?.runtimeId).toBe('rt-default-shared')
  })

  it('does not invalidate an in-flight session.list or stick sessionsLoading when deleting in another profile', async () => {
    let finishList!: (v: unknown) => void
    const listPending = new Promise(resolve => {
      finishList = resolve
    })
    rpcHandler = (method, params) => {
      if (method === 'session.list') return listPending
      if (method === 'session.delete') return { deleted: params.session_id }
      return {}
    }
    spyClient()
    localStorage.setItem('hm.sessions.v1.work', JSON.stringify([row('w-1')]))

    // Start loading 'default' sessions while deleting a chat in 'work'.
    const loading = M.loadSessions()
    expect(M.getState().sessionsLoading).toBe(true)
    await M.deleteSession('w-1', 'work')

    // Work's cache dropped w-1, while default's in-flight list still finishes cleanly and clears sessionsLoading.
    expect(M.cachedSessions('work')).toEqual([])
    finishList({ sessions: [row('d-1')] })
    await loading
    expect(M.getState().sessions.map(s => s.id)).toEqual(['d-1'])
    expect(M.getState().sessionsLoading).toBe(false)
  })
})
