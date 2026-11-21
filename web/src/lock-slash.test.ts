// @vitest-environment happy-dom
// Slash commands over the lock screen (gateway.ts sendPrompt and runSlash): judged before anything is sent, and again after
// every wait (the confirmation, Hermes's answer), since the phone can lock meanwhile. Quick commands and aliases wait.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const lock = vi.hoisted(() => ({ on: false, unlocks: 0, onConfirm: (() => true) as () => boolean }))
vi.mock('./lockview', async orig => ({
  ...(await orig<typeof import('./lockview')>()),
  lockView: () => lock.on,
  askUnlock: () => void lock.unlocks++
}))
vi.mock('./access-confirm', async orig => ({
  ...(await orig<typeof import('./access-confirm')>()),
  confirmLooseApprovals: async () => lock.onConfirm()
}))

import { client, sendPrompt } from './gateway'
import { setState, type ActiveSession } from './store'

type Answer = (params: Record<string, unknown>) => unknown
let sent: string[]
let answers: Record<string, Answer>

function open(): void {
  const a: ActiveSession = {
    runtimeId: 'rt-lock', storedId: 's-lock', profile: 'default', title: 'Lock', info: {} as ActiveSession['info'], items: [], running: false,
    status: '', usage: null, ctx: null, tps: null, todos: [], openAssistantId: null, attachments: [], turnStart: null, goal: null
  }
  setState({ active: a, conn: 'open', opening: null, requests: [] })
}

beforeEach(() => {
  lock.on = false
  lock.unlocks = 0
  lock.onConfirm = () => true
  sent = []
  answers = { 'commands.catalog': () => ({ categories: [], skills: {} }) }
  vi.spyOn(client, 'request').mockImplementation(((method: string, params: Record<string, unknown>) => {
    sent.push(method === 'slash.exec' ? `slash.exec ${params.command}` : method === 'command.dispatch' ? `command.dispatch ${params.name}` : method)
    try {
      return Promise.resolve(answers[method] ? answers[method](params) : {})
    } catch (e) {
      return Promise.reject(e)
    }
  }) as typeof client.request)
  open()
})
afterEach(() => vi.restoreAllMocks())

const fails = (why: string) => () => {
  throw new Error(why)
}

describe('over the lock screen', () => {
  test('a command not on the list sends nothing at all, not even a new chat', async () => {
    lock.on = true
    setState({ active: null })
    for (const text of ['/approvals off', '/ap smart', '/myquick', '/v', '/tasks', '/ctx', '/stat', '/bp daily', '/kanban swarm x'])
      await expect(sendPrompt(text), text).rejects.toThrow('Unlock the phone')
    expect(sent).toEqual([])
    expect(lock.unlocks).toBe(9)
  })

  test('a command on the list runs when the catalog has no quick command, plugin command or skill of that name', async () => {
    lock.on = true
    await sendPrompt('/status')
    expect(sent).toEqual(['commands.catalog', 'slash.exec status'])
  })

  test('a quick command, a plugin command or a skill of that name waits, and so does a catalog that cannot answer', async () => {
    lock.on = true
    const cases: Answer[] = [
      () => ({ categories: [{ name: 'User commands', pairs: [['/status', 'exec: curl …']] }] }),
      () => ({ categories: [{ name: 'Plugin commands', pairs: [['/STATUS', 'x']] }] }),
      () => ({ categories: [], skills: { '/status': {} } }),
      fails('no catalog')
    ]
    for (const c of cases) {
      answers['commands.catalog'] = c
      sent = []
      await expect(sendPrompt('/status')).rejects.toThrow('Unlock the phone')
      expect(sent).toEqual(['commands.catalog'])
    }
  })

  test("a worker that fails isn't followed by command.dispatch, where a quick command runs first", async () => {
    lock.on = true
    answers['slash.exec'] = fails('slash worker failed')
    await sendPrompt('/help')
    expect(sent).toEqual(['commands.catalog', 'slash.exec help'])
  })

  test('an answer that is an alias or a prompt to send goes no further', async () => {
    lock.on = true
    for (const answer of [{ type: 'alias', target: '/approvals off' }, { type: 'send', message: 'do it' }, { type: 'skill', message: 'x' }]) {
      answers['slash.exec'] = () => answer
      sent = []
      await sendPrompt('/help')
      expect(sent, answer.type).toEqual(['commands.catalog', 'slash.exec help'])
    }
    expect(lock.unlocks).toBe(3)
  })
})

describe('when the phone locks while a command waits', () => {
  test('/approvals off confirmed after the phone locked is not sent', async () => {
    lock.onConfirm = () => {
      lock.on = true
      return true
    }
    await sendPrompt('/approvals off')
    expect(sent).toEqual([])
    expect(lock.unlocks).toBe(1)
  })

  test('/approvals off confirmed while unlocked still goes, as before', async () => {
    await sendPrompt('/approvals off')
    expect(sent).toEqual(['slash.exec approvals off'])
  })

  test('a worker that fails after the phone locked is not followed by command.dispatch', async () => {
    answers['slash.exec'] = () => {
      lock.on = true
      throw new Error('slash worker failed')
    }
    await sendPrompt('/help')
    expect(sent).toEqual(['slash.exec help'])
  })

  test('an alias step after the phone locked is not taken', async () => {
    answers['slash.exec'] = fails('slash worker failed')
    answers['command.dispatch'] = () => {
      lock.on = true
      return { type: 'alias', target: '/help' }
    }
    await sendPrompt('/myalias')
    expect(sent).toEqual(['slash.exec myalias', 'command.dispatch myalias'])
    expect(lock.unlocks).toBe(1)
  })

  test('an alias step while unlocked goes on, as before', async () => {
    answers['slash.exec'] = (p: Record<string, unknown>) => {
      if (p.command === 'myalias') throw new Error('slash worker failed')
      return { output: 'ok' }
    }
    answers['command.dispatch'] = () => ({ type: 'alias', target: '/help' })
    await sendPrompt('/myalias')
    expect(sent).toEqual(['slash.exec myalias', 'command.dispatch myalias', 'slash.exec help'])
  })
})
