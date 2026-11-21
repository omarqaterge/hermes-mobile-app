// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RpcHandler = (method: string, params: Record<string, unknown>) => unknown
let rpcHandler: RpcHandler = () => ({})
const rpcs: Array<{ method: string; params: Record<string, unknown> }> = []

vi.mock('./api', () => ({
  api: vi.fn(async () => ({}))
}))

const { getState, setState } = await import('./store')
const { lineageOf, resetLineageForTests } = await import('./lineage')
const {
  moveChat,
  nestedOf,
  noteEvent,
  openSubSheet,
  quotedGoal,
  resetSubAgents,
  setFeedKnownForTest,
  setNestedFeed,
  subAgentsOf
} = await import('./subagents')
const { client, compressChat, newSession, resumeSession, startDraft } = await import('./gateway')
const { NestedRows, SubAgentSheet } = await import('./components/SubAgents')

const emit = (type: string, session_id: string, payload: Record<string, unknown>) => {
  ;(client as unknown as { handleEvent: (ev: unknown) => void }).handleEvent({ type, session_id, payload })
}

const activeOf = (storedId: string, runtimeId = `rt-${storedId}`, items: NonNullable<ReturnType<typeof getState>['active']>['items'] = []) => ({
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

beforeEach(() => {
  rpcs.length = 0
  localStorage.clear()
  resetSubAgents()
  resetLineageForTests()
  setState({
    conn: 'open',
    active: null,
    opening: null,
    preview: null,
    drawer: false,
    sheet: null,
    sessions: []
  })
  rpcHandler = (method, params) => {
    if (method === 'session.resume') {
      const sid = String(params.session_id || 's')
      return { session_id: `rt-${sid}`, stored_session_id: sid, messages: [], info: { title: `Chat ${sid}` } }
    }
    if (method === 'session.create') {
      return { session_id: 'rt-new', stored_session_id: 's-new', messages: [], info: { title: 'New' } }
    }
    if (method === 'subagent.list') return { subagents: [] }
    return {}
  }
  vi.spyOn(client, 'request').mockImplementation((async (method: string, params: Record<string, unknown> = {}) => {
    rpcs.push({ method, params })
    return rpcHandler(method, params)
  }) as typeof client.request)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('Finding 5(a): openNestedRow and closing the sub-agent sheet on chat switch', () => {
  it('openNestedRow does not take the fast path while opening another chat', async () => {
    noteEvent('chatA', 'subagent.start', { subagent_id: 'sa1', goal: 'Task A' })
    setState({ active: activeOf('chatA'), opening: 'chatB', drawer: true, sheet: null })
    let resolveResume!: (v: unknown) => void
    rpcHandler = method => {
      if (method === 'session.resume') return new Promise(r => { resolveResume = r })
      return {}
    }

    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<NestedRows chat="chatA" snapAt={1} turning={false} />))

    const btn = host.querySelector('button.nested-row') as HTMLButtonElement | null
    expect(btn).not.toBeNull()
    await act(async () => btn!.click())

    // Fast path must NOT open the sheet while opening === 'chatB'; it must call session.resume('chatA').
    expect(getState().sheet).toBeNull()
    expect(rpcs.some(r => r.method === 'session.resume' && r.params.session_id === 'chatA')).toBe(true)

    resolveResume({ session_id: 'rt-chatA', stored_session_id: 'chatA', messages: [], info: {} })
    await act(async () => { await Promise.resolve() })
    await act(async () => root.unmount())
  })

  it('resumeSession, startDraft, newSession, and SubAgentSheet close chat A sheet when switching away', async () => {
    noteEvent('chatA', 'subagent.start', { subagent_id: 'sa1', goal: 'Task A' })
    setState({ active: activeOf('chatA') })
    openSubSheet('chatA', 'sa1')
    expect(getState().sheet).toBe('subagent')

    // resumeSession to another chat closes the sub-agent sheet immediately while opening
    let resolveB!: (v: unknown) => void
    rpcHandler = method => {
      if (method === 'session.resume') return new Promise(r => { resolveB = r })
      if (method === 'session.create') return { session_id: 'rt-new', stored_session_id: 's-new', messages: [], info: {} }
      return {}
    }
    const p = resumeSession('chatB')
    expect(getState().sheet).toBeNull()
    resolveB({ session_id: 'rt-chatB', stored_session_id: 'chatB', messages: [], info: {} })
    await p
    expect(getState().sheet).toBeNull()

    // startDraft closes it
    openSubSheet('chatB', 'sa1')
    expect(getState().sheet).toBe('subagent')
    startDraft()
    expect(getState().sheet).toBeNull()

    // newSession closes it
    setState({ active: activeOf('chatA') })
    openSubSheet('chatA', 'sa1')
    expect(getState().sheet).toBe('subagent')
    await newSession()
    expect(getState().sheet).toBeNull()

    // SubAgentSheet itself refuses to render and closes when another chat is on screen
    setState({ active: activeOf('chatA') })
    openSubSheet('chatA', 'sa1')
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<SubAgentSheet />))
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()

    await act(async () => setState({ active: activeOf('chatB') }))
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(getState().sheet).toBeNull()
    await act(async () => root.unmount())
  })
})

describe('Finding 5(b): canContinue checks the sheet chat, not isTaintedNow()', () => {
  it('uses chatTainted(chat) rather than the background active chat taint', async () => {
    noteEvent('chatA', 'subagent.start', { subagent_id: 'sa1', goal: 'Done task', child_session_id: 'kid-1' })
    noteEvent('chatA', 'subagent.complete', { subagent_id: 'sa1', status: 'completed', child_session_id: 'kid-1' })
    // chatB is active and tainted with a phone_data tool call, while chatA (clean) is opening on screen
    setState({
      active: activeOf('chatB', 'rt-chatB', [{ kind: 'tool', id: 't1', name: 'phone_data', status: 'done' }]),
      opening: 'chatA',
      preview: null
    })
    openSubSheet('chatA', 'sa1')

    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<SubAgentSheet />))

    const cont = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Continue in a new chat'))
    expect(cont).toBeDefined()
    await act(async () => root.unmount())
  })
})

describe('Finding 6: sub-agent records follow compression in all three places', () => {
  it('6(a): compressChat() calls moveChat so sub-agents and Stop follow the new stored id', async () => {
    await resumeSession('s-old')
    noteEvent('s-old', 'subagent.start', { subagent_id: 'sa1', goal: 'Still working' })
    expect(nestedOf('s-old').live).toBe(1)

    rpcHandler = method => {
      if (method === 'session.compress') {
        return { compressed: true, stored_session_id: 's-new', before_messages: 10, after_messages: 3 }
      }
      return {}
    }
    await compressChat()

    expect(nestedOf('s-new').live).toBe(1)
    expect(nestedOf('s-old').live).toBe(1)
    expect(subAgentsOf('s-new').map(a => a.key)).toEqual(['sa1'])
  })

  it('6(b): background/kept session.info calls noteLineage, moveChat, and updates kept storedId', async () => {
    await resumeSession('s-bg1')
    noteEvent('s-bg1', 'subagent.start', { subagent_id: 'sa-bg', goal: 'Background work' })
    // Switch away so s-bg1 (rt-s-bg1) moves into kept
    await resumeSession('s-other')
    expect(getState().active?.storedId).toBe('s-other')

    // Hermes compresses rt-s-bg1 while it is in the background
    emit('session.info', 'rt-s-bg1', { stored_session_id: 's-bg2' })

    expect(lineageOf('s-bg2')).toContain('s-bg1')
    expect(nestedOf('s-bg2').live).toBe(1)
    expect(subAgentsOf('s-bg2').map(a => a.key)).toEqual(['sa-bg'])

    // Reopening the compressed chat keeps its running sub-agent so Stop stays
    await resumeSession('s-bg2')
    expect(nestedOf('s-bg2').live).toBe(1)
  })

  it('6(c): setNestedFeed resolves keys with resolveChat(k)', () => {
    const oldTime = Date.now() - 30_000
    noteEvent('s-c1', 'subagent.start', { subagent_id: 'sa-c', goal: 'Feed work' }, oldTime)
    moveChat('s-c1', 's-c2')
    setFeedKnownForTest(true)

    setNestedFeed(new Map([['s-c1', 2]]))
    expect(nestedOf('s-c2').running).toBe(2)
    expect(nestedOf('s-c1').running).toBe(2)
    expect(nestedOf('s-c2').live).toBe(1)
  })
})

describe('Finding 8(a): sheet parent subtitle uses quotedGoal inside <bdi>', () => {
  it('wraps parent goal in <bdi> with quotedGoal sanitization', async () => {
    const rawParentGoal = 'Check" \u202eAllow “now”'
    noteEvent('chatQ', 'subagent.start', { subagent_id: 'p1', goal: rawParentGoal })
    noteEvent('chatQ', 'subagent.start', { subagent_id: 'c1', parent_id: 'p1', goal: 'Child work' })
    setState({ active: activeOf('chatQ') })
    openSubSheet('chatQ', 'c1')

    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<SubAgentSheet />))

    const subOf = host.querySelector('.sub-of')
    expect(subOf).not.toBeNull()
    const bdi = subOf!.querySelector('bdi')
    expect(bdi).not.toBeNull()
    expect(bdi!.textContent).toBe(quotedGoal(rawParentGoal))
    await act(async () => root.unmount())
  })
})

describe('Finding 8(b): closeLater does not close a runtime that is now in kept', () => {
  it('skips session.close when the evicted runtime was reopened and moved to kept', async () => {
    vi.useFakeTimers()
    // Same runtimeId returned if s-k1 is resumed again (Hermes's live session)
    rpcHandler = (method, params) => {
      if (method === 'session.resume') {
        const sid = String(params.session_id || 's')
        return { session_id: `rt-${sid}`, stored_session_id: sid, messages: [], info: {} }
      }
      return {}
    }

    // Open s-k1, then cycle through 3 other idle chats so s-k1 is evicted from warm -> schedules closeLater('rt-s-k1', 3000)
    await resumeSession('s-k1')
    await resumeSession('s-w1')
    await resumeSession('s-w2')
    await resumeSession('s-w3')

    // Reopen s-k1 (same runtime rt-s-k1), start a sub-agent, then leave it -> moves to kept (not active, not warm)
    await resumeSession('s-k1')
    noteEvent('s-k1', 'subagent.start', { subagent_id: 'sa-k', goal: 'Keep me alive' })
    await resumeSession('s-w4')

    // Fire the 3 s closeLater timer
    await vi.advanceTimersByTimeAsync(3500)

    expect(rpcs.some(r => r.method === 'session.close' && r.params.session_id === 'rt-s-k1')).toBe(false)
  })
})
