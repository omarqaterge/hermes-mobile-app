// @vitest-environment happy-dom
// setModel in gateway.ts: two quick picks on one chat reach Hermes in order, and the screen keeps showing the newest pick.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { client, setModel } from './gateway'
import { getState, setState, type ActiveSession } from './store'

let n = 0 // a new live chat id per test: the gateway keeps its switch bookkeeping per runtime id
const flush = () => new Promise(r => setTimeout(r, 0))

function open(): void {
  const a: ActiveSession = {
    runtimeId: `rt-model-${++n}`, storedId: 's-model', profile: 'default', title: 'Model', info: { model: 'm0', provider: 'p' } as ActiveSession['info'],
    items: [{ kind: 'user', id: 'u1', text: 'hi', at: 1 }], running: false, status: '', usage: null, ctx: null, tps: null, todos: [],
    openAssistantId: null, attachments: [], turnStart: null, goal: null
  }
  setState({ active: a, conn: 'open', opening: null, requests: [], toasts: [] })
}
const shown = () => getState().active!.info.model

describe('two quick model picks on one chat', () => {
  let sets: { value: string; ok: () => void; fail: () => void }[]
  beforeEach(() => {
    sets = []
    vi.spyOn(client, 'request').mockImplementation(((method: string, params: { key?: string; value?: string }) => {
      if (method !== 'config.set' || params.key !== 'model') return Promise.resolve({})
      return new Promise<unknown>((ok, rej) => sets.push({ value: String(params.value), ok: () => ok({}), fail: () => rej(new Error('refused')) }))
    }) as typeof client.request)
    open()
  })
  afterEach(() => vi.restoreAllMocks())

  test('the second config.set is sent only after the first answered', async () => {
    const a = setModel('p', 'm1')
    const b = setModel('p', 'm2')
    await flush()
    expect(sets.map(s => s.value)).toEqual(['m1 --provider p --session'])
    sets[0].ok()
    await a
    await flush()
    expect(sets.map(s => s.value)).toEqual(['m1 --provider p --session', 'm2 --provider p --session'])
    sets[1].ok()
    await b
    expect(shown()).toBe('m2')
  })

  test('a late failure of the first pick does not change the screen from the second pick', async () => {
    const a = setModel('p', 'm1')
    const b = setModel('p', 'm2')
    await flush()
    sets[0].fail()
    await expect(a).rejects.toThrow('refused')
    await flush()
    expect(shown()).toBe('m2')
    sets[1].ok()
    await b
    expect(shown()).toBe('m2')
  })

  test('when both fail the screen goes back to the model the chat really runs on', async () => {
    const a = setModel('p', 'm1')
    const b = setModel('p', 'm2')
    await flush()
    sets[0].fail()
    await expect(a).rejects.toThrow()
    await flush()
    sets[1].fail()
    await expect(b).rejects.toThrow()
    expect(shown()).toBe('m0')
  })

  test('a failed pick on its own goes back to the earlier model', async () => {
    const a = setModel('p', 'm1')
    await flush()
    sets[0].fail()
    await expect(a).rejects.toThrow()
    expect(shown()).toBe('m0')
  })

  test('a failed pick goes back to the model the chat has now, also when it changed since the last pick', async () => {
    const a = setModel('p', 'm1')
    await flush()
    sets[0].ok()
    await a
    // Hermes moved the chat to another model meanwhile (a slash command, a fallback): the screen follows it.
    setState({ active: { ...getState().active!, info: { ...getState().active!.info, model: 'm9' } } })
    const b = setModel('p', 'm2')
    await flush()
    sets[1].fail()
    await expect(b).rejects.toThrow('refused')
    expect(shown()).toBe('m9')
  })
})
