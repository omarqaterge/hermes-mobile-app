// @vitest-environment happy-dom
// setAccess and the chat-open step in gateway.ts: when a /yolo switch or the plugin's Auto write fails, the chat ends in
// a mode the screen shows truthfully, never a safer one than Hermes runs.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const put = vi.hoisted(() => ({ calls: [] as { mode: string }[], fail: false, approvalsMode: null as string | null }))
vi.mock('./api', () => ({
  api: vi.fn(async (method: string, path: string, body?: { mode?: string }) => {
    if (method === 'PUT' && path.endsWith('/auto')) {
      put.calls.push({ mode: String(body?.mode ?? '') })
      if (put.fail) throw new Error('plugin down')
    }
    if (method === 'GET' && path.startsWith('/api/config')) {
      return put.approvalsMode ? { approvals: { mode: put.approvalsMode } } : {}
    }
    return {}
  })
}))

import { accessOf, client, setAccess } from './gateway'
import { readProfileConfig, resetApprovalsModeForTest } from './approvals-mode'
import { runChatOpen } from './chatopen'
import { getState, setState, type ActiveSession } from './store'

let n = 0
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0))
}

function open(yolo: boolean): ActiveSession {
  const a: ActiveSession = {
    runtimeId: `rt-acc-${++n}`, storedId: `s-acc-${n}`, profile: 'default', title: 'Access', info: { model: 'm', provider: 'p', yolo } as ActiveSession['info'],
    items: [], running: false, status: '', usage: null, ctx: null, tps: null, todos: [],
    openAssistantId: null, attachments: [], turnStart: null, goal: null
  }
  setState({ active: a, conn: 'open', opening: null, requests: [], toasts: [] })
  return a
}
const shown = () => accessOf(getState().active)
const notices = () => getState().active!.items.filter(i => i.kind === 'notice')

describe('access after a failed switch', () => {
  let yolo: { value: string; answer: 'ok' | 'fail' }[]
  let answers: ('ok' | 'fail')[]
  beforeEach(() => {
    yolo = []
    answers = []
    put.calls = []
    put.fail = false
    put.approvalsMode = null
    resetApprovalsModeForTest()
    window.hermesLockView?.(false)
    localStorage.clear()
    vi.spyOn(client, 'request').mockImplementation(((method: string, params: { key?: string; value?: string }) => {
      if (method !== 'config.set' || params.key !== 'yolo') return Promise.resolve({})
      const answer = answers.shift() ?? 'ok'
      yolo.push({ value: String(params.value), answer })
      return answer === 'ok' ? Promise.resolve({ value: params.value }) : Promise.reject(new Error('timed out'))
    }) as typeof client.request)
  })
  afterEach(() => vi.restoreAllMocks())

  test('a resumed chat whose Auto entry cannot be written again goes to Off, and the user is told', async () => {
    const a = open(true)
    localStorage.setItem('hm.yolo.v1', JSON.stringify({ [a.storedId]: 'auto' }))
    put.fail = true
    runChatOpen({ chat: a, kind: 'resume' })
    await flush()
    expect(yolo.map(y => y.value)).toEqual(['0'])
    expect(shown()).toBe('off')
    expect(notices().length).toBe(1)
  })

  test('a resumed chat whose Auto entry is written again stays in Auto access', async () => {
    const a = open(true)
    localStorage.setItem('hm.yolo.v1', JSON.stringify({ [a.storedId]: 'auto' }))
    runChatOpen({ chat: a, kind: 'resume' })
    await flush()
    expect(yolo).toEqual([])
    expect(shown()).toBe('auto')
    expect(notices()).toEqual([])
  })

  test('a /yolo switch whose answer is lost is undone: /yolo off and no Auto entry', async () => {
    const a = open(false)
    answers = ['fail', 'ok']
    await expect(setAccess(a, 'full')).rejects.toThrow('timed out')
    expect(yolo.map(y => y.value)).toEqual(['1', '0'])
    expect(put.calls.at(-1)?.mode).toBe('')
    expect(shown()).toBe('off')
    expect(notices().length).toBe(1)
  })

  test('when Off cannot be confirmed either, the Auto entry is written back and the screen says Auto access', async () => {
    const a = open(false)
    answers = ['fail', 'fail']
    await expect(setAccess(a, 'auto')).rejects.toThrow('timed out')
    expect(yolo.map(y => y.value)).toEqual(['1', '0'])
    expect(put.calls.at(-1)?.mode).toBe('auto')
    expect(shown()).toBe('auto')
    expect(notices().length).toBe(1)
  })

  test('when nothing can be confirmed, the screen says Full access', async () => {
    const a = open(true)
    answers = ['fail', 'fail']
    put.fail = true
    await expect(setAccess(a, 'off')).rejects.toThrow()
    expect(shown()).toBe('full')
    expect(notices().length).toBe(1)
  })

  test('a switch that works is unchanged', async () => {
    const a = open(false)
    expect(await setAccess(a, 'auto')).toBe('auto')
    expect(yolo.map(y => y.value)).toEqual(['1'])
    expect(shown()).toBe('auto')
    expect(notices()).toEqual([])
  })

  test('settleAccess off notice reflects approvals.mode (smart, off, manual, unknown) and hides mode in lockView', async () => {
    const a1 = open(false)
    put.approvalsMode = 'smart'
    await readProfileConfig('default')
    answers = ['fail', 'ok']
    await expect(setAccess(a1, 'full')).rejects.toThrow('timed out')
    const n1 = (notices()[0] as { text: string }).text
    expect(n1).toContain('low-risk commands by itself')
    expect(n1).not.toContain('asks before risky commands')

    const a2 = open(false)
    put.approvalsMode = 'off'
    await readProfileConfig('default')
    answers = ['fail', 'ok']
    await expect(setAccess(a2, 'full')).rejects.toThrow('timed out')
    const n2 = (notices()[0] as { text: string }).text
    expect(n2).toContain('every command without asking')
    expect(n2).not.toContain('asks before risky commands')

    const a3 = open(true)
    window.hermesLockView?.(true)
    answers = ['fail', 'ok']
    await expect(setAccess(a3, 'off')).rejects.toThrow('timed out')
    const n3 = (notices()[0] as { text: string }).text
    expect(n3).toContain('follows the approvals setting')
    expect(n3).not.toContain('every command without asking')
    expect(n3).not.toContain('asks before risky commands')
    window.hermesLockView?.(false)

    const a4 = open(false)
    put.approvalsMode = 'manual'
    await readProfileConfig('default')
    answers = ['fail', 'ok']
    await expect(setAccess(a4, 'full')).rejects.toThrow('timed out')
    expect((notices()[0] as { text: string }).text).toContain('Hermux asks before risky commands')
  })
})
