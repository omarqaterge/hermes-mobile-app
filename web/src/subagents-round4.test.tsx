// @vitest-environment happy-dom
// Security review 4 of the sub-agent work: findings 3 (approval confirmation after a compression) and 4 (a sub-agent sheet
// opened by the chat's new id after a compression). Findings 1, 2 and 5 are in subagents-continue.test.ts.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RpcHandler = (method: string, params: Record<string, unknown>) => unknown
let rpcHandler: RpcHandler = () => ({})

vi.mock('./api', () => ({
  api: vi.fn(async () => ({}))
}))

const { getState, setState } = await import('./store')
const { resetLineageForTests } = await import('./lineage')
const { moveChat, noteEvent, openSubSheet, resetSubAgents } = await import('./subagents')
const { client, compressChat, resumeSession, rpc } = await import('./gateway')
const { approvalNeedsConfirm, confirmAllow } = await import('./approval-lock')
const { chatTainted, docTainted } = await import('./phone-data-taint')
const { SubAgentSheet } = await import('./components/SubAgents')

type ActiveItems = NonNullable<ReturnType<typeof getState>['active']>['items']
const activeOf = (storedId: string, items: ActiveItems = []) => ({
  runtimeId: `rt-${storedId}`,
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
    if (method === 'subagent.list') return { subagents: [] }
    return {}
  }
  vi.spyOn(client, 'request').mockImplementation((async (method: string, params: Record<string, unknown> = {}) =>
    rpcHandler(method, params)) as typeof client.request)
})

afterEach(() => {
  delete (window as unknown as { HermesAndroid?: unknown }).HermesAndroid
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('round 4, 3: closing a compressed chat forgets the approval confirmation under every id it had', () => {
  it('an approval under the old id needs the fingerprint again after compress then close', async () => {
    const forgotten: string[] = []
    ;(window as unknown as { HermesAndroid?: unknown }).HermesAndroid = {
      approvalLockState: () => JSON.stringify({ on: true, secure: true }),
      confirmApproval: (id: number) => setTimeout(() => window.hermesApprovalConfirm?.(id, 'ok'), 0),
      forgetApproval: (session: string) => forgotten.push(session)
    }
    await resumeSession('s-old')
    expect(await confirmAllow('s-old', 'run ls')).toBe(true)
    expect(approvalNeedsConfirm('s-old')).toBe(false)

    rpcHandler = method => (method === 'session.compress' ? { compressed: true, stored_session_id: 's-new' } : {})
    await compressChat()
    await rpc('session.close', { session_id: 'rt-s-old' })

    expect(approvalNeedsConfirm('s-old')).toBe(true)
    expect(forgotten).toEqual(expect.arrayContaining(['s-old', 's-new']))
  })
})

describe('round 4, 4: the chat on screen counts as the chat whatever id it is asked by', () => {
  const phoneItems: ActiveItems = [{ kind: 'tool', id: 't1', name: 'phone_data', status: 'done' } as ActiveItems[number]]

  it('chatTainted and docTainted see the on-screen items when asked by the id a compression moved the chat to', () => {
    setState({ active: activeOf('s-old', phoneItems) })
    moveChat('s-old', 's-new') // the chat list now names s-new; active.storedId stays s-old
    expect(chatTainted('s-new')).toBe(true)
    expect(docTainted('s-new')).toBe(true)
    expect(chatTainted('s-other')).toBe(false)
  })

  it('a sub-agent sheet opened by the new id is guarded and offers no Continue', async () => {
    setState({ active: activeOf('s-old', phoneItems) })
    moveChat('s-old', 's-new')
    noteEvent('s-new', 'subagent.start', { subagent_id: 'sa1', goal: 'Done task', child_session_id: 'kid-1' })
    noteEvent('s-new', 'subagent.complete', { subagent_id: 'sa1', status: 'completed', child_session_id: 'kid-1' })
    openSubSheet('s-new', 'sa1')

    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<SubAgentSheet />))
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    const cont = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Continue in a new chat'))
    expect(cont).toBeUndefined()
    await act(async () => root.unmount())
  })
})
