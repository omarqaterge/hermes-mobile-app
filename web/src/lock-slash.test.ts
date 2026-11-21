// @vitest-environment happy-dom
// Slash commands over the lock screen (gateway.ts sendPrompt and runSlash): judged before anything is sent, and again after
// every wait (the confirmation, Hermes's answer), since the phone can lock meanwhile. Quick commands and aliases wait.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const lock = vi.hoisted(() => ({ on: false, unlocks: 0, asked: 0, onConfirm: (() => true) as () => boolean }))
vi.mock('./lockview', async orig => ({
  ...(await orig<typeof import('./lockview')>()),
  lockView: () => lock.on,
  askUnlock: () => void lock.unlocks++
}))
vi.mock('./access-confirm', async orig => ({
  ...(await orig<typeof import('./access-confirm')>()),
  confirmLooseApprovals: async () => (lock.asked++, lock.onConfirm())
}))

import { askBtw, btwOpen, closeBtw } from './btw'
import { client, resendFrom, retryTurn, sendPrompt } from './gateway'
import { setState, type ActiveSession } from './store'

type Answer = (params: Record<string, unknown>) => unknown
let sent: string[]
let seen: Record<string, Record<string, unknown>>
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
  lock.asked = 0
  lock.onConfirm = () => true
  sent = []
  seen = {}
  closeBtw()
  answers = { 'commands.catalog': () => ({ categories: [], skills: {} }) }
  vi.spyOn(client, 'request').mockImplementation(((method: string, params: Record<string, unknown>) => {
    seen[method] = params
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

describe('over the lock screen, a catalog that can not be read in full', () => {
  test('a catalog with a warning (a loader failed) or one that is not well formed counts as not built in', async () => {
    lock.on = true
    const cases: unknown[] = [
      { categories: [], skills: {}, warning: 'quick_commands discovery unavailable: boom' },
      { categories: [], skills: {}, warning: 'skills named like a built-in: /status' },
      { categories: [], skills: {}, warning: 5 },
      null,
      'catalog',
      {},
      { skills: {} },
      { categories: 'User commands', skills: {} },
      { categories: [{ name: 'User commands' }], skills: {} },
      { categories: [{ name: 'User commands', pairs: ['/status'] }], skills: {} },
      { categories: [null], skills: {} },
      { categories: [] },
      { categories: [], skills: [] }
    ]
    for (const c of cases) {
      answers['commands.catalog'] = () => c
      sent = []
      await expect(sendPrompt('/status'), JSON.stringify(c)).rejects.toThrow('Unlock the phone')
      expect(sent).toEqual(['commands.catalog'])
    }
  })

  test('an empty warning is no warning', async () => {
    lock.on = true
    answers['commands.catalog'] = () => ({ categories: [{ name: 'Session', pairs: [['/status', 'x']] }], skills: {}, warning: '' })
    await sendPrompt('/status')
    expect(sent).toEqual(['commands.catalog', 'slash.exec status'])
  })
})

describe('over the lock screen with no chat open', () => {
  beforeEach(() => {
    lock.on = true
    setState({ active: null, profile: 'work' })
  })

  test('a command the catalog shadows, or one the catalog cannot vouch for, makes no chat', async () => {
    for (const c of [() => ({ categories: [{ name: 'User commands', pairs: [['/status', 'exec: x']] }], skills: {} }), fails('no catalog')]) {
      answers['commands.catalog'] = c
      sent = []
      await expect(sendPrompt('/status')).rejects.toThrow('Unlock the phone')
      expect(sent).toEqual(['commands.catalog'])
    }
    expect(seen['commands.catalog']).toEqual({ profile: 'work' })
  })

  test('/yolo with anything but off makes no chat', async () => {
    for (const text of ['/yolo', '/yolo on', '/yolo 1', '/yolo full', '/yolo offf'])
      await expect(sendPrompt(text), text).rejects.toThrow('Unlock the phone')
    expect(sent).toEqual([])
  })

  test('/btw makes no chat', async () => {
    await expect(sendPrompt('/btw what is this')).rejects.toThrow('Unlock the phone')
    expect(sent).toEqual([])
    expect(btwOpen()).toBe(false)
  })
})

describe('/btw and the side chat over the lock screen', () => {
  test('/btw typed just before the phone locks is not opened', async () => {
    queueMicrotask(() => {
      lock.on = true
    })
    await expect(sendPrompt('/btw what is this')).rejects.toThrow('Unlock the phone')
    expect(btwOpen()).toBe(false)
    expect(sent).toEqual([])
  })

  test('the side chat asks nothing while the phone is locked', async () => {
    lock.on = true
    await askBtw('a question')
    expect(sent).toEqual([])
    expect(lock.unlocks).toBe(1)
    lock.on = false
    await askBtw('a question')
    expect(sent).toEqual(['prompt.btw'])
  })

  test('/yolo off still goes over the lock screen', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
    lock.on = true
    await sendPrompt('/yolo off')
    expect(sent).toContain('config.set')
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

describe('/approvals off with characters JavaScript and Python read differently', () => {
  test('U+FEFF in front of the name: the warning is asked, and the command goes as Hermes will read it', async () => {
    lock.onConfirm = () => false
    for (const text of ['/\ufeffapprovals off', '/\ufeffapprovals smart', '/\ufeffap off', '/approvals \ufeffoff']) {
      sent = []
      await sendPrompt(text)
      expect(sent, JSON.stringify(text)).toEqual([])
    }
    expect(lock.asked).toBe(4)
  })

  test('what is sent keeps U+FEFF (Python keeps it), so it is never sent as a plain approvals off', async () => {
    await sendPrompt('/\ufeffapprovals off')
    expect(lock.asked).toBe(1)
    expect(seen['slash.exec']).toMatchObject({ command: '\ufeffapprovals off' })
  })

  test('separators only Python knows still ask', async () => {
    lock.onConfirm = () => false
    for (const c of ['\u001c', '\u001d', '\u001e', '\u001f', '\u0085']) await sendPrompt(`/approvals${c}off`)
    expect(lock.asked).toBe(5)
    expect(sent).toEqual([])
  })
})

describe('Edit and Retry over the lock screen', () => {
  const withTurn = (yolo: boolean, autoAccess = false) => {
    open()
    setState(s => ({
      active: s.active && {
        ...s.active,
        info: { ...s.active.info, yolo } as ActiveSession['info'],
        autoAccess,
        items: [
          { kind: 'user', id: 'u1', text: 'first', at: 1 },
          { kind: 'assistant', id: 'a1', text: 'answer', at: 2 }
        ] as ActiveSession['items']
      }
    }))
    answers['session.history'] = () => ({ messages: [{ role: 'user', text: 'first', row_id: 7 }] })
  }

  test('Edit and Retry send no turn over the lock screen, whatever the chat\'s access', async () => {
    lock.on = true
    for (const [yolo, auto] of [[false, false], [true, false], [true, true]] as const) {
      withTurn(yolo, auto)
      sent = []
      await expect(resendFrom('u1', 'edited')).rejects.toThrow('Unlock the phone to use this chat')
      await expect(retryTurn('a1')).rejects.toThrow('Unlock the phone to use this chat')
      expect(sent, `yolo ${yolo} auto ${auto}`).toEqual([])
    }
    expect(lock.unlocks).toBe(6)
  })

  test('the phone locking while the message is looked up sends nothing', async () => {
    withTurn(true)
    answers['session.history'] = () => {
      lock.on = true
      return { messages: [{ role: 'user', text: 'first', row_id: 7 }] }
    }
    await resendFrom('u1', 'edited')
    expect(sent).toContain('session.history')
    expect(sent).not.toContain('prompt.submit')
    expect(lock.unlocks).toBe(1)
  })

  test('unlocked, Edit and Retry send as before', async () => {
    withTurn(true)
    await resendFrom('u1', 'edited')
    expect(sent).toContain('prompt.submit')
    expect(seen['prompt.submit']).toMatchObject({ text: 'edited', truncate_before_row_id: 7 })
    withTurn(false)
    sent = []
    await retryTurn('a1')
    expect(sent).toContain('prompt.submit')
  })
})
