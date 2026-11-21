// @vitest-environment happy-dom
// Security review 5 of the sub-agent work: finding 1 (the chat on screen judged by itself, not by what is drawn, and by every
// id of the chat asked about) and finding 2 (a fingerprint confirmation ends with every live session it came through).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RpcHandler = (method: string, params: Record<string, unknown>) => unknown
let rpcHandler: RpcHandler = () => ({})

vi.mock('./api', () => ({
  api: vi.fn(async () => ({}))
}))

const { getState, setState } = await import('./store')
const { noteLineage, resetLineageForTests } = await import('./lineage')
const { moveChat, resetSubAgents } = await import('./subagents')
const { answerRequest, client, requestChat, resumeSession, rpc } = await import('./gateway')
const { approvalNeedsConfirm } = await import('./approval-lock')
const { chatTainted, docTainted } = await import('./phone-data-taint')

type ActiveItems = NonNullable<ReturnType<typeof getState>['active']>['items']
const phoneItems: ActiveItems = [{ kind: 'tool', id: 't1', name: 'phone_data', status: 'done' } as ActiveItems[number]]
const activeOf = (storedId: string, items: ActiveItems = [], runtimeId = `rt-${storedId}`) => ({
  runtimeId,
  storedId,
  profile: 'default',
  title: `Chat ${storedId}`,
  info: {},
  items,
  running: false,
  status: '',
  usage: null,
  ctx: null,
  tps: null,
  todos: [],
  openAssistantId: null,
  attachments: [],
  turnStart: null,
  goal: null
})
const shell = (tainted: string[]) => {
  ;(window as unknown as { HermesAndroid?: unknown }).HermesAndroid = { phoneDataTainted: (id: string) => tainted.includes(id) }
}

beforeEach(() => {
  localStorage.clear()
  resetSubAgents()
  resetLineageForTests()
  setState({ conn: 'open', active: null, opening: null, preview: null, drawer: false, sheet: null, sessions: [], requests: [] })
  rpcHandler = (method, params) => {
    if (method === 'session.resume') {
      const sid = String(params.session_id || 's')
      return { session_id: `rt-${sid}`, stored_session_id: sid, messages: [], info: { title: `Chat ${sid}` } }
    }
    return {}
  }
  vi.spyOn(client, 'request').mockImplementation((async (method: string, params: Record<string, unknown> = {}) =>
    rpcHandler(method, params)) as typeof client.request)
})

afterEach(() => {
  delete (window as unknown as { HermesAndroid?: unknown }).HermesAndroid
  vi.restoreAllMocks()
})

describe('round 5, 1(a): while another chat opens, the active chat is judged by its own items, not the preview drawn', () => {
  it('docTainted and chatTainted see the phone_data item of the chat being left', () => {
    setState({
      active: activeOf('r5a-chat', phoneItems),
      opening: 'r5a-other',
      preview: { storedId: 'r5a-other', items: [] } as unknown as ReturnType<typeof getState>['preview']
    })
    expect(docTainted('r5a-chat')).toBe(true)
    expect(chatTainted('r5a-chat')).toBe(true)
    expect(docTainted('r5a-other')).toBe(false)
  })

  it('and the app\'s record for the active chat\'s live id, while another chat opens', () => {
    shell(['rt-r5a2-chat'])
    setState({
      active: activeOf('r5a2-chat'),
      opening: 'r5a2-other',
      preview: { storedId: 'r5a2-other', items: [] } as unknown as ReturnType<typeof getState>['preview']
    })
    expect(chatTainted('r5a2-chat')).toBe(true)
  })
})

describe('round 5, 1(b): the chat on screen never answers clean where docTainted would answer tainted', () => {
  it('an earlier id in the lineage of the id asked about, not in the active chat\'s own lineage', () => {
    shell(['r5b-earlier'])
    setState({ active: activeOf('r5b-old') })
    moveChat('r5b-old', 'r5b-new') // matched through resolveChat only
    noteLineage(['r5b-new', 'r5b-earlier'])
    expect(chatTainted('r5b-new')).toBe(true)
  })

  it('where a compression moved the id asked about, when only resolveChat links it', () => {
    shell(['r5c-tip'])
    setState({ active: activeOf('r5c-a1') })
    moveChat('r5c-a1', 'r5c-tip')
    moveChat('r5c-a0', 'r5c-tip')
    expect(chatTainted('r5c-a0')).toBe(true)
    expect(docTainted('r5c-a0')).toBe(true)
  })

  it('a clean chat on screen stays clean', () => {
    shell([])
    setState({ active: activeOf('r5d-chat') })
    expect(chatTainted('r5d-chat')).toBe(false)
  })
})

describe('round 5, 2: a fingerprint confirmation ends with every live session it was answered through', () => {
  let forgotten: string[]
  const lockShell = () => {
    forgotten = []
    ;(window as unknown as { HermesAndroid?: unknown }).HermesAndroid = {
      approvalLockState: () => JSON.stringify({ on: true, secure: true }),
      confirmApproval: (id: number) => setTimeout(() => window.hermesApprovalConfirm?.(id, 'ok'), 0),
      forgetApproval: (session: string) => forgotten.push(session)
    }
  }
  const approval = (n: string, runtime: string) => ({ id: n, method: 'approval', params: { session_id: runtime, command: 'ls' } }) as never
  const allow = async (n: string, runtime: string, chat: string) => {
    answerRequest(approval(n, runtime), { choice: 'once' })
    await vi.waitFor(() => expect(approvalNeedsConfirm(chat)).toBe(false))
  }
  beforeEach(() => lockShell())

  it('(a) a chat whose opening was overtaken goes warm unrecorded: its approvals still end when it closes', async () => {
    let resolveX!: () => void
    const base = rpcHandler
    rpcHandler = (method, params) =>
      method === 'session.resume' && params.session_id === 'r5-x'
        ? new Promise(r => (resolveX = () => r(base(method, params))))
        : base(method, params)
    const px = resumeSession('r5-x')
    await resumeSession('r5-y')
    resolveX()
    await px
    expect(getState().active?.storedId).toBe('r5-y')
    expect(requestChat(approval('q1', 'rt-r5-x'))).toBe('r5-x') // routed through the warm chats
    await allow('q1', 'rt-r5-x', 'r5-x')
    await rpc('session.close', { session_id: 'rt-r5-x' })
    expect(approvalNeedsConfirm('r5-x')).toBe(true)
  })

  it('(a) syncRunning replacing the chat on screen with a new live session forgets the old one', async () => {
    await resumeSession('r5-s')
    await allow('q2', 'rt-r5-s', 'r5-s')
    setState({ active: { ...getState().active!, running: true } })
    rpcHandler = method =>
      method === 'session.resume' ? { session_id: 'rt-r5-s-2', stored_session_id: 'r5-s', messages: [], running: false, info: {} } : {}
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(getState().active?.runtimeId).toBe('rt-r5-s-2'))
    expect(approvalNeedsConfirm('r5-s')).toBe(true)
  })

  it('(b) a resume of the same chat with a new live session forgets the old one', async () => {
    await resumeSession('r5-r')
    await allow('q3', 'rt-r5-r', 'r5-r')
    rpcHandler = method => (method === 'session.resume' ? { session_id: 'rt-r5-r-2', stored_session_id: 'r5-r', messages: [], info: {} } : {})
    await resumeSession('r5-r')
    expect(getState().active?.runtimeId).toBe('rt-r5-r-2')
    expect(approvalNeedsConfirm('r5-r')).toBe(true)
  })

  it('(b) a chat pushed out of the kept ones (past 50) forgets its confirmation', async () => {
    rpcHandler = (method, params) => {
      const sid = String(params.session_id || '')
      return method === 'session.resume' ? { session_id: `rt-${sid}`, stored_session_id: sid, messages: [], running: true, info: {} } : {}
    }
    await resumeSession('r5-k0')
    await allow('q4', 'rt-r5-k0', 'r5-k0')
    for (let i = 1; i <= 51; i++) await resumeSession(`r5-k${i}`)
    expect(approvalNeedsConfirm('r5-k0')).toBe(true)
    expect(forgotten).toContain('r5-k0')
  })

  it('(b) at most 64 live sessions are followed: the oldest goes and its confirmation with it', async () => {
    expect(requestChat(approval('q5', 'r5-b0'))).toBe('r5-b0')
    await allow('q5', 'r5-b0', 'r5-b0')
    for (let i = 1; i <= 64; i++) requestChat(approval(`q5-${i}`, `r5-b${i}`))
    expect(approvalNeedsConfirm('r5-b0')).toBe(true)
  })

  it('(b) at most 32 stored ids per live session: the oldest goes and its confirmation with it', async () => {
    await resumeSession('r5-c')
    await allow('q6', 'rt-r5-c', 'r5-c')
    for (let i = 1; i <= 32; i++)
      (client as unknown as { handleEvent: (ev: unknown) => void }).handleEvent({ type: 'session.info', session_id: 'rt-r5-c', payload: { stored_session_id: `r5-c${i}` } })
    expect(approvalNeedsConfirm('r5-c')).toBe(true)
  })
})
