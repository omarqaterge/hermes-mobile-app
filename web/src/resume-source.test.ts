// @vitest-environment happy-dom
// Resumed chats must carry source: 'mobile' on session.resume (just like session.create), so Hermes runs the resumed
// agent with platform 'mobile' and background read-aloud works on resumed chats as well as brand-new ones.
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { client, resumeSession } from './gateway'
import { setState } from './store'

describe('session.resume source', () => {
  beforeEach(() => {
    localStorage.clear()
    setState({ conn: 'open', active: null, opening: null, preview: null, drawer: false, sheet: null, sessions: [], requests: [], profile: 'default' })
  })

  test('resumeSession sends source: mobile so resumed chats keep platform mobile', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    vi.spyOn(client, 'request').mockImplementation((async (method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params })
      if (method === 'session.resume') {
        return { session_id: 'rt-1', resumed: String(params.session_id || ''), messages: [], info: {} }
      }
      if (method === 'subagent.list') return { subagents: [] }
      return {}
    }) as typeof client.request)

    await resumeSession('s-existing')
    const resume = calls.find(c => c.method === 'session.resume')
    expect(resume?.params).toMatchObject({ session_id: 's-existing', source: 'mobile' })
  })
})
