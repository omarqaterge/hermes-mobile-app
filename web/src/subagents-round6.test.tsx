// @vitest-environment happy-dom
// Security review 6 of the sub-agent work, finding 3: approvals of a kept chat name it. The fingerprint confirmation is
// filed under the live session now, so the paths a live session leaves the page by need no forgetting; their table is
// approval-confirm-session.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RpcHandler = (method: string, params: Record<string, unknown>) => unknown
let rpcHandler: RpcHandler = () => ({})

vi.mock('./api', () => ({
  api: vi.fn(async () => ({})),
  qs: () => ''
}))

const { getState, setState } = await import('./store')
const { resetLineageForTests } = await import('./lineage')
const { resetSubAgents } = await import('./subagents')
const { client, requestChat, resumeSession, switchProfile } = await import('./gateway')

let n = 0
let running = new Set<string>() // chats Hermes answers as still working
let runtimeOf = new Map<string, string>() // the live session Hermes answers a resume of this chat with
const resumeReply = (sid: string) => ({
  session_id: runtimeOf.get(sid) ?? `rt-${sid}`,
  stored_session_id: sid,
  messages: [],
  running: running.has(sid),
  info: { title: `Chat ${sid}` }
})
const approval = (runtime: string) => ({ id: `q${++n}`, method: 'approval', params: { session_id: runtime, command: 'ls' } }) as never
/** Opens `chat`, but another chat is opened before Hermes answers: `chat` was overtaken. */
const overtaken = async (chat: string, other: string, opts: { auto?: boolean } = {}) => {
  let answer!: () => void
  const base = rpcHandler
  rpcHandler = (method, params) =>
    method === 'session.resume' && params.session_id === chat ? new Promise(r => (answer = () => r(base(method, params)))) : base(method, params)
  const p = resumeSession(chat, opts)
  await resumeSession(other)
  rpcHandler = base
  answer()
  await p
}

beforeEach(() => {
  localStorage.clear()
  resetSubAgents()
  resetLineageForTests()
  running = new Set()
  runtimeOf = new Map()
  setState({ conn: 'open', active: null, opening: null, preview: null, drawer: false, sheet: null, sessions: [], requests: [], profile: 'default' })
  rpcHandler = (method, params) => {
    if (method === 'session.resume') return resumeReply(String(params.session_id || ''))
    if (method === 'session.create') return { session_id: `rt-new${++n}`, stored_session_id: `s-new${n}`, messages: [], info: {} }
    return {}
  }
  vi.spyOn(client, 'request').mockImplementation((async (method: string, params: Record<string, unknown> = {}) =>
    rpcHandler(method, params)) as typeof client.request)
})

afterEach(() => {
  delete (window as unknown as { HermesAndroid?: unknown }).HermesAndroid
  vi.restoreAllMocks()
})

describe('round 6, 3: approvals of a kept chat name it', () => {
  it('a kept chat whose opening was overtaken is found through the kept ones', async () => {
    running.add('k1')
    await overtaken('k1', 'k1-other') // goes kept without the chat-open step: not in chatOfRuntime
    expect(requestChat(approval('rt-k1'))).toBe('k1')
  })

  it('syncRunning records the new live session, so it is named after it leaves the lists', async () => {
    running.add('k2')
    await resumeSession('k2')
    running.delete('k2')
    runtimeOf.set('k2', 'rt-k2-new')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(getState().active?.runtimeId).toBe('rt-k2-new'))
    setState({ active: { ...getState().active!, running: true } })
    await switchProfile('other2') // left running, no longer followed: only its route is kept
    expect(requestChat(approval('rt-k2-new'))).toBe('k2')
  })
})
