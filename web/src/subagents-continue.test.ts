// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mockApi = vi.hoisted(() => ({
  nested: (_session: string): Promise<unknown> => Promise.resolve({ children: [], segments: [] }),
  rename: (): Promise<unknown> => Promise.resolve({ ok: true })
}))

vi.mock('./api', () => ({
  api: vi.fn(async (method: string, path: string) => {
    if (method === 'GET' && path.includes('/nested?')) {
      const m = /session=([^&]+)/.exec(path)
      return mockApi.nested(m ? decodeURIComponent(m[1]) : '')
    }
    if (method === 'PATCH' && path.startsWith('/api/sessions/')) return mockApi.rename()
    return {}
  })
}))

import { client, continueSubAgent } from './gateway'
import { lineageOf, noteLineage, resetLineageForTests } from './lineage'
import { setState, type ActiveSession } from './store'
import { resetSubAgents } from './subagents'

function activeChat(storedId: string, yolo: boolean): ActiveSession {
  const a: ActiveSession = {
    runtimeId: `rt-${storedId}`,
    storedId,
    profile: 'default',
    title: storedId,
    info: { model: 'm', provider: 'p', yolo } as ActiveSession['info'],
    items: [],
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
  }
  setState({ active: a, conn: 'open', opening: null, requests: [], toasts: [], profile: 'default' })
  return a
}

const childRow = (id: string, parent: string) => ({
  id,
  parent,
  goal: 'Work',
  model: 'm',
  effort: 'low',
  started: 1,
  ended: 2,
  reason: 'agent_close',
  messages: 2
})

describe('continueSubAgent fail-closed parent chain and lock-screen checks', () => {
  let calls: { method: string; params: Record<string, unknown> }[]
  let resumeMessages: unknown[]
  let onResume: (() => void) | null
  let onBranch: (() => void) | null
  let tainted: Set<string>

  beforeEach(() => {
    calls = []
    resumeMessages = []
    onResume = null
    onBranch = null
    tainted = new Set()
    localStorage.clear()
    resetLineageForTests()
    resetSubAgents()
    window.hermesLockView?.(false)
    ;(window as unknown as { HermesAndroid?: unknown }).HermesAndroid = {
      phoneDataTainted: (id: string) => tainted.has(id)
    }
    mockApi.nested = async s => ({ children: [], segments: [s] })
    mockApi.rename = async () => ({ ok: true })
    vi.spyOn(client, 'request').mockImplementation(((method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params })
      if (method === 'session.resume') {
        onResume?.()
        return Promise.resolve({
          session_id: `rt-resumed-${calls.length}`,
          stored_session_id: String(params.session_id || ''),
          messages: resumeMessages,
          info: { model: 'm', provider: 'p', yolo: false, stored_session_id: String(params.session_id || '') }
        })
      }
      if (method === 'session.branch') {
        onBranch?.()
        return Promise.resolve({ stored_session_id: 'new-branched' })
      }
      return Promise.resolve({})
    }) as typeof client.request)
  })

  afterEach(() => {
    window.hermesLockView?.(false)
    delete (window as unknown as { HermesAndroid?: unknown }).HermesAndroid
    vi.restoreAllMocks()
  })

  test('new chat never gets more access than an earlier compressed segment in the real parent chain', async () => {
    activeChat('s2', true)
    localStorage.setItem('hm.defaultAccess.v1', 'full')
    localStorage.setItem('hm.yolo.v1', JSON.stringify({ s1: false, s2: true }))
    mockApi.nested = async () => ({ children: [childRow('sa1', 's2')], segments: ['s2', 's1'] })

    await continueSubAgent('s2', { child: 'sa1', goal: 'Work', phoneData: false })

    const yolo = JSON.parse(localStorage.getItem('hm.yolo.v1') || '{}')
    expect(yolo['new-branched']).toBe(false)
  })

  test('round 4, 1: the new chat is a different chat, never in the lineage group of the chat it came from', async () => {
    activeChat('s2', false)
    noteLineage(['s2', 's1'])
    mockApi.nested = async () => ({
      children: [childRow('sa1', 's2'), childRow('sa2', 'sa1')],
      segments: ['s2', 's1']
    })

    await continueSubAgent('s2', { child: 'sa2', goal: 'Deep', phoneData: false })

    expect(calls.some(c => c.method === 'session.branch')).toBe(true)
    for (const id of ['s2', 's1', 'sa1', 'sa2']) expect(lineageOf('new-branched')).not.toContain(id)
    expect(lineageOf('s2')).toEqual(['s1'])
    // A read in the new chat later marks only it: the app's record is asked about the parent's own ids alone.
    expect(lineageOf('s1')).not.toContain('new-branched')
  })

  test.each([
    ['missing', undefined],
    ['empty', []],
    ['not starting with the chat', ['s1', 's2']],
    ['longer than the plugin sends', ['s2', ...Array.from({ length: 17 }, (_, i) => `old${i}`)]],
    ['with an id that is not a string', ['s2', 42]],
    ['with an empty id', ['s2', '']],
    ['with a repeated id', ['s2', 's1', 's1']],
    ['not an array', 's2']
  ])('round 4, 2: refuses to continue when segments are %s', async (_name, segments) => {
    activeChat('s2', false)
    mockApi.nested = async () => ({ children: [childRow('sa1', 's2')], ...(segments === undefined ? {} : { segments }) })

    await expect(continueSubAgent('s2', { child: 'sa1', goal: 'Work', phoneData: false })).rejects.toThrow('couldn’t be confirmed')
    expect(calls.map(c => c.method)).toEqual([])
  })

  test('round 4, 2: refuses when the sub-agent\'s parent walk ends outside the chat\'s segments', async () => {
    activeChat('s2', false)
    mockApi.nested = async () => ({ children: [childRow('sa1', 'elsewhere')], segments: ['s2', 's1'] })

    await expect(continueSubAgent('s2', { child: 'sa1', goal: 'Work', phoneData: false })).rejects.toThrow('couldn’t be confirmed')
    expect(calls.map(c => c.method)).toEqual([])
  })

  test('round 4, 2: seventeen segments (the most the plugin sends) still continue', async () => {
    activeChat('s2', false)
    mockApi.nested = async () => ({
      children: [childRow('sa1', 's2')],
      segments: ['s2', ...Array.from({ length: 16 }, (_, i) => `old${i}`)]
    })

    await continueSubAgent('s2', { child: 'sa1', goal: 'Work', phoneData: false })
    expect(calls.some(c => c.method === 'session.branch')).toBe(true)
  })

  test('refuses to continue when a compressed segment in the real parent chain read phone data', async () => {
    activeChat('s2', false)
    tainted.add('s1')
    mockApi.nested = async () => ({ children: [childRow('sa1', 's2')], segments: ['s2', 's1'] })

    await expect(continueSubAgent('s2', { child: 'sa1', goal: 'Work', phoneData: false })).rejects.toThrow('phone data')
    expect(calls.map(c => c.method)).toEqual([])
  })

  test('refuses to continue when a stored parent sub-agent read phone data even if not in page memory', async () => {
    activeChat('s2', false)
    tainted.add('sa1')
    mockApi.nested = async () => ({
      children: [childRow('sa1', 's2'), childRow('sa2', 'sa1')],
      segments: ['s2']
    })

    await expect(continueSubAgent('s2', { child: 'sa2', goal: 'Deep', phoneData: false })).rejects.toThrow('phone data')
    expect(calls.map(c => c.method)).toEqual([])
  })

  test('refuses to continue when the sub-agent stored messages contain a phone_data tool call', async () => {
    activeChat('s2', false)
    mockApi.nested = async () => ({ children: [childRow('sa1', 's2')], segments: ['s2'] })
    resumeMessages = [
      { role: 'assistant', tool_calls: [{ id: 'tc1', function: { name: 'phone_data', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'tc1', name: 'phone_data', content: 'contacts' }
    ]

    await expect(continueSubAgent('s2', { child: 'sa1', goal: 'Work', phoneData: false })).rejects.toThrow('phone data')
    expect(calls.map(c => c.method)).toEqual(['session.resume', 'session.close'])
  })

  test('stops before session.resume if the phone locks while verifying the parent chain', async () => {
    activeChat('s2', false)
    mockApi.nested = async () => {
      window.hermesLockView?.(true)
      return { children: [childRow('sa1', 's2')], segments: ['s2'] }
    }

    await continueSubAgent('s2', { child: 'sa1', goal: 'Work', phoneData: false })
    expect(calls.map(c => c.method)).toEqual([])
  })

  test('stops before session.branch if the phone locks while resuming the sub-agent', async () => {
    activeChat('s2', false)
    mockApi.nested = async () => ({ children: [childRow('sa1', 's2')], segments: ['s2'] })
    onResume = () => window.hermesLockView?.(true)

    await continueSubAgent('s2', { child: 'sa1', goal: 'Work', phoneData: false })
    expect(calls.map(c => c.method)).toEqual(['session.resume', 'session.close'])
  })

  test('stops before opening the branched chat if the phone locks while renaming it', async () => {
    activeChat('s2', false)
    mockApi.nested = async () => ({ children: [childRow('sa1', 's2')], segments: ['s2'] })
    mockApi.rename = async () => {
      window.hermesLockView?.(true)
      return { ok: true }
    }

    await continueSubAgent('s2', { child: 'sa1', goal: 'Work', phoneData: false })
    expect(calls.filter(c => c.method === 'session.resume')).toHaveLength(1)
    expect(calls.map(c => c.method)).toEqual(['session.resume', 'session.branch', 'session.close'])
  })
})
