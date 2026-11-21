// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { ServerRequest } from '@hermes/shared/json-rpc-channel'
import { RequestSheet } from './components/RequestSheet'
import { setState, type ActiveSession, type WaitingItem } from './store'
import { noteEvent, resetSubAgents } from './subagents'
import { SUB_AGENT, noteArrived } from './waiting'

const active: ActiveSession = {
  runtimeId: 'rt-chat-1',
  storedId: 'chat-1',
  profile: 'default',
  title: 'Main',
  info: { model: 'm', provider: 'p', yolo: false } as ActiveSession['info'],
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

let seq = 0
function makeReq(command: string, at: number): ServerRequest {
  const id = `req-${++seq}`
  noteArrived(id, at)
  return {
    id,
    method: 'approval',
    params: { session_id: 'rt-chat-1', command, description: 'test', choices: ['once', 'deny'] },
    respond: () => {},
    fail: () => {}
  }
}

async function renderSheet(req: ServerRequest, waiting: WaitingItem[]): Promise<string> {
  setState({ active, waiting, sessions: [], opening: null, preview: null, profile: 'default' })
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<RequestSheet req={req} />))
  const text = host.textContent || ''
  await act(async () => root.unmount())
  host.remove()
  return text
}

describe('RequestSheet AskedBy only shows when subAgentAsks is true', () => {
  beforeEach(() => {
    resetSubAgents()
    window.hermesLockView?.(false)
    noteEvent('chat-1', 'subagent.tool', {
      subagent_id: 'sa-1',
      goal: 'Tidy folder',
      tool_name: 'terminal',
      tool_preview: 'chmod 777 x'
    })
  })

  afterEach(() => {
    window.hermesLockView?.(false)
    document.body.innerHTML = ''
  })

  test('shows nothing when the main chat also has an open waiting entry', async () => {
    const req = makeReq('chmod 777 x', 100)
    const text = await renderSheet(req, [
      { session: 'chat-1', kind: 'approval', who: SUB_AGENT, since: 99, last: 99, until: 500, open: 1 },
      { session: 'chat-1', kind: 'approval', who: '', since: 100, last: 100, until: 500, open: 1 }
    ])
    expect(text).not.toMatch(/Asked by/)
  })

  test('shows nothing when the feed has no matching approval (coincidental command match or phone_data)', async () => {
    const req1 = makeReq('chmod 777 x', 100)
    expect(await renderSheet(req1, [])).not.toMatch(/Asked by/)

    const req2 = makeReq('chmod 777 x', 100)
    expect(
      await renderSheet(req2, [{ session: 'chat-1', kind: 'phone_data', who: SUB_AGENT, since: 100, last: 100, until: 500, open: 1 }])
    ).not.toMatch(/Asked by/)

    const req3 = makeReq('chmod 777 x', 100)
    expect(
      await renderSheet(req3, [{ session: 'chat-1', kind: 'approval', who: SUB_AGENT, since: 50, last: 50, until: 500, open: 1 }])
    ).not.toMatch(/Asked by/)
  })

  test('shows the named or generic sub-agent line when subAgentAsks is true', async () => {
    const req1 = makeReq('chmod 777 x', 100)
    expect(
      await renderSheet(req1, [{ session: 'chat-1', kind: 'approval', who: SUB_AGENT, since: 99, last: 99, until: 500, open: 1 }])
    ).toContain('Asked by the sub-agent working on')

    const req2 = makeReq('other command', 100)
    expect(
      await renderSheet(req2, [{ session: 'chat-1', kind: 'approval', who: SUB_AGENT, since: 99, last: 99, until: 500, open: 1 }])
    ).toContain('Asked by a sub-agent')
  })
})
