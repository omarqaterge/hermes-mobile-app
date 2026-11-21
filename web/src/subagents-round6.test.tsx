// @vitest-environment happy-dom
// Security review 6 of the sub-agent work: every way a live session stops being followed by the page (on screen, warm, kept)
// ends the fingerprint confirmation made through it, so the next Allow in that chat asks again. One row per path; the
// reconnect rows are browser checks (25-approval-lock.cjs), since connect() needs a socket.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RpcHandler = (method: string, params: Record<string, unknown>) => unknown
let rpcHandler: RpcHandler = () => ({})

vi.mock('./api', () => ({
  api: vi.fn(async () => ({})),
  qs: () => ''
}))

const { getState, setState } = await import('./store')
const { resetLineageForTests } = await import('./lineage')
const { moveChat, resetSubAgents } = await import('./subagents')
const { answerRequest, client, deleteSession, newSession, requestChat, resumeSession, rpc, startDraft, switchProfile } = await import('./gateway')
const { approvalNeedsConfirm } = await import('./approval-lock')

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
const lockShell = () => {
  ;(window as unknown as { HermesAndroid?: unknown }).HermesAndroid = {
    approvalLockState: () => JSON.stringify({ on: true, secure: true }),
    confirmApproval: (id: number) => setTimeout(() => window.hermesApprovalConfirm?.(id, 'ok'), 0),
    forgetApproval: () => {}
  }
}
const approval = (runtime: string) => ({ id: `q${++n}`, method: 'approval', params: { session_id: runtime, command: 'ls' } }) as never
/** An Allow through this live session, confirmed with the fingerprint. */
const allow = async (runtime: string, chat: string) => {
  answerRequest(approval(runtime), { choice: 'once' })
  await vi.waitFor(() => expect(approvalNeedsConfirm(chat)).toBe(false))
}
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
  lockShell()
})

afterEach(() => {
  delete (window as unknown as { HermesAndroid?: unknown }).HermesAndroid
  vi.restoreAllMocks()
})

// Each row: put a confirmed chat in some state, take its live session out of the page's lists that way, and say which chat
// the next Allow belongs to. The check after each row: that Allow asks for the fingerprint again.
const paths: Array<[string, () => Promise<string>]> = [
  ['session.close of a chat left warm (closeLater, evicted from the warm ones)', async () => {
    await resumeSession('p1')
    await allow('rt-p1', 'p1')
    for (const c of ['p1-a', 'p1-b', 'p1-c']) await resumeSession(c)
    await vi.waitFor(() => expect(approvalNeedsConfirm('p1')).toBe(true), { timeout: 4500 })
    return 'p1'
  }],
  ['the chat on screen reopened with a new live session (resumeSession, same chat)', async () => {
    await resumeSession('p2')
    await allow('rt-p2', 'p2')
    runtimeOf.set('p2', 'rt-p2-new')
    await resumeSession('p2')
    return 'p2'
  }],
  ['the chat on screen, compressed (a1 -> a2), reopened under the new id with a new live session while working', async () => {
    running.add('p3')
    await resumeSession('p3')
    await allow('rt-p3', 'p3')
    moveChat('p3', 'p3-next')
    runtimeOf.set('p3-next', 'rt-p3-new')
    await resumeSession('p3-next')
    return 'p3'
  }],
  ['a warm chat reopened with a new live session (unwarm drops the old one)', async () => {
    await resumeSession('p4')
    await allow('rt-p4', 'p4')
    await resumeSession('p4-other') // p4 goes warm
    runtimeOf.set('p4', 'rt-p4-new')
    await resumeSession('p4')
    return 'p4'
  }],
  ['a kept chat reopened with a new live session (unwarm drops the kept one)', async () => {
    running.add('p5')
    await resumeSession('p5')
    await allow('rt-p5', 'p5')
    await resumeSession('p5-other') // p5 is kept: it is working
    runtimeOf.set('p5', 'rt-p5-new')
    await resumeSession('p5')
    return 'p5'
  }],
  ['a kept chat pushed out past the 50 kept ones', async () => {
    running.add('p6')
    await resumeSession('p6')
    await allow('rt-p6', 'p6')
    for (let i = 0; i < 51; i++) {
      running.add(`p6-${i}`)
      await resumeSession(`p6-${i}`)
    }
    return 'p6'
  }],
  ['an opening overtaken by another (it goes warm), then closed in turn', async () => {
    await overtaken('p7', 'p7-other')
    await allow('rt-p7', 'p7')
    for (const c of ['p7-a', 'p7-b']) await resumeSession(c)
    await vi.waitFor(() => expect(approvalNeedsConfirm('p7')).toBe(true), { timeout: 4500 })
    return 'p7'
  }],
  ['the start-up resume (auto) overtaken: its live session goes warm, then is closed in turn', async () => {
    await overtaken('p8', 'p8-other', { auto: true })
    await allow('rt-p8', 'p8')
    for (const c of ['p8-a', 'p8-b']) await resumeSession(c)
    await vi.waitFor(() => expect(approvalNeedsConfirm('p8')).toBe(true), { timeout: 4500 })
    return 'p8'
  }],
  ['syncRunning finds the chat on screen ended, under a new live session', async () => {
    running.add('p9')
    await resumeSession('p9')
    await allow('rt-p9', 'p9')
    running.delete('p9')
    runtimeOf.set('p9', 'rt-p9-new')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(getState().active?.runtimeId).toBe('rt-p9-new'))
    return 'p9'
  }],
  ['switching bots while the chat on screen works (left running, no longer followed)', async () => {
    running.add('p10')
    await resumeSession('p10')
    await allow('rt-p10', 'p10')
    await switchProfile('other')
    return 'p10'
  }],
  ['switching bots with an idle chat on screen (closed)', async () => {
    await resumeSession('p11')
    await allow('rt-p11', 'p11')
    await switchProfile('other')
    return 'p11'
  }],
  ['deleting the chat', async () => {
    await resumeSession('p12')
    await allow('rt-p12', 'p12')
    await deleteSession('p12')
    return 'p12'
  }],
  ['a new chat, then the one left closed in turn (newSession, retire)', async () => {
    await resumeSession('p13')
    await allow('rt-p13', 'p13')
    await newSession()
    await newSession()
    await newSession()
    await vi.waitFor(() => expect(approvalNeedsConfirm('p13')).toBe(true), { timeout: 4500 })
    return 'p13'
  }],
  ['the empty screen, then the chat left closed in turn (startDraft, retire)', async () => {
    await resumeSession('p14')
    await allow('rt-p14', 'p14')
    startDraft() // p14 goes warm; opening from the empty screen leaves nothing behind, so three more push it out
    for (const c of ['p14-a', 'p14-b', 'p14-c']) await resumeSession(c)
    await vi.waitFor(() => expect(approvalNeedsConfirm('p14')).toBe(true), { timeout: 4500 })
    return 'p14'
  }],
  ['a compression, then session.close (every stored id the session had)', async () => {
    await resumeSession('p15')
    await allow('rt-p15', 'p15')
    ;(client as unknown as { handleEvent: (ev: unknown) => void }).handleEvent({ type: 'session.info', session_id: 'rt-p15', payload: { stored_session_id: 'p15-next' } })
    await rpc('session.close', { session_id: 'rt-p15' })
    return 'p15'
  }]
]

describe('round 6: every path a live session leaves the page by ends its fingerprint confirmation', () => {
  it.each(paths)('%s', async (_name, run) => {
    const chat = await run()
    expect(approvalNeedsConfirm(chat)).toBe(true)
  }, 15_000)
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
