// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('./api', () => ({
  api: vi.fn(async () => ({ children: [], segments: [] }))
}))

import { Composer } from './components/Composer'
import { client, interrupt, stopSubAgent } from './gateway'
import { setState, type ActiveSession } from './store'
import { nestedOf, noteEvent, noteRoster, resetSubAgents } from './subagents'

function makeChat(storedId: string, running: boolean): ActiveSession {
  return {
    runtimeId: `rt-${storedId}`,
    storedId,
    profile: 'default',
    title: storedId,
    info: { model: 'm', provider: 'p', yolo: false } as ActiveSession['info'],
    items: [],
    running,
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
}

describe('Composer Stop, interrupt() guards, and roster grace after Stop', () => {
  let calls: { method: string; params: Record<string, unknown> }[]

  beforeEach(() => {
    calls = []
    localStorage.clear()
    resetSubAgents()
    window.hermesLockView?.(false)
    vi.spyOn(client, 'request').mockImplementation(((method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params })
      if (method === 'subagent.list') return Promise.resolve({ subagents: [] })
      if (method === 'subagent.interrupt') return Promise.resolve({ found: true })
      return Promise.resolve({})
    }) as typeof client.request)
  })

  afterEach(() => {
    window.hermesLockView?.(false)
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  test('Composer disables Stop while another chat is opening', async () => {
    setState({
      active: makeChat('chat-a', true),
      opening: 'chat-b',
      preview: null,
      conn: 'open',
      profile: 'default'
    })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<Composer injected={null} onInjected={() => {}} />))
    const stop = host.querySelector('button[aria-label="Stop"]') as HTMLButtonElement | null
    expect(stop).not.toBeNull()
    expect(stop!.disabled).toBe(true)
    await act(async () => stop!.click())
    expect(calls.filter(c => c.method === 'session.interrupt')).toEqual([])
    await act(async () => root.unmount())
  })

  test('interrupt() returns early when view is not settled (switching chats)', async () => {
    setState({
      active: makeChat('chat-a', true),
      opening: 'chat-b',
      preview: null,
      conn: 'open',
      profile: 'default'
    })
    await interrupt()
    expect(calls.filter(c => c.method === 'session.interrupt')).toEqual([])
  })

  test('interrupt() refuses sub-agent-only Stop over the lock screen', async () => {
    setState({
      active: makeChat('chat-a', false),
      opening: null,
      preview: null,
      conn: 'open',
      profile: 'default'
    })
    noteEvent('chat-a', 'subagent.start', { subagent_id: 'sa-1', goal: 'Background task' })
    window.hermesLockView?.(true)
    await interrupt()
    expect(calls.filter(c => c.method === 'session.interrupt')).toEqual([])
  })

  test('interrupt() still stops a running reply over the lock screen', async () => {
    setState({
      active: makeChat('chat-a', true),
      opening: null,
      preview: null,
      conn: 'open',
      profile: 'default'
    })
    window.hermesLockView?.(true)
    await interrupt()
    expect(calls.filter(c => c.method === 'session.interrupt')).toHaveLength(1)
  })

  test('explicit Stop clears a sub-agent dropped from subagent.list without waiting for ROSTER_GRACE_MS', async () => {
    setState({
      active: makeChat('chat-a', false),
      opening: null,
      preview: null,
      conn: 'open',
      profile: 'default'
    })
    noteEvent('chat-a', 'subagent.start', { subagent_id: 'sa-1', goal: 'Fresh task' })
    expect(nestedOf('chat-a').live).toBe(1)

    // Normal roster sync still respects the 5 s grace window.
    noteRoster('chat-a', [])
    expect(nestedOf('chat-a').live).toBe(1)

    // Explicit composer Stop clears it immediately once subagent.list omits it.
    await interrupt()
    await new Promise(r => setTimeout(r, 20))
    expect(nestedOf('chat-a').live).toBe(0)

    // Same for stopping an individual sub-agent from its sheet.
    noteEvent('chat-a', 'subagent.start', { subagent_id: 'sa-2', goal: 'Second task' })
    expect(nestedOf('chat-a').live).toBe(1)
    await stopSubAgent('rt-chat-a', 'sa-2')
    await new Promise(r => setTimeout(r, 20))
    expect(nestedOf('chat-a').live).toBe(0)
  })
})
