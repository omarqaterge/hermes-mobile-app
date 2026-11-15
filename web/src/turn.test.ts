// @vitest-environment happy-dom
// turn.ts: the steps of one turn, and what gateway.ts does with them (the status line's fields, the queue of follow-ups).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { client, resendFrom, sendPrompt } from './gateway'
import { clearQueue, enqueue, isPaused, queuedFor, setPaused } from './queue'
import { getState, setState, type ActiveSession } from './store'
import { noteTurnEnd, queueGoesOn, takeTurnEnd, turnOver, turnSent, turnStarted } from './turn'

describe('the steps', () => {
  test('a send starts the clock and clears what the last turn left', () => {
    expect(turnSent(1000)).toEqual({ running: true, status: '', tps: null, openAssistantId: null, turnStart: 1000 })
  })

  test("Hermes's start keeps the send's clock, and starts one for a turn the page didn't send", () => {
    expect(turnStarted({ turnStart: 1000 }, 5000)).toEqual({ running: true, tps: null, turnStart: 1000 })
    expect(turnStarted({ turnStart: null }, 5000)).toEqual({ running: true, tps: null, turnStart: 5000 })
  })

  test('the end leaves nothing of the live readout behind', () => {
    expect(turnOver()).toEqual({ running: false, status: '', tps: null, turnStart: null })
  })

  test('only a turn that finished normally lets the queue go on', () => {
    expect(queueGoesOn('done')).toBe(true)
    for (const how of ['failed', 'stopped', 'not-sent'] as const) expect(queueGoesOn(how)).toBe(false)
  })

  test('how a turn ended is read once', () => {
    expect(takeTurnEnd()).toBe('done')
    noteTurnEnd('stopped')
    expect(takeTurnEnd()).toBe('stopped')
    expect(takeTurnEnd()).toBe('done')
  })
})

const RT = 'rt-turn'
const STORED = 's-turn'
const emit = (type: string, payload: Record<string, unknown> = {}) =>
  (client as unknown as { events: { dispatch(e: unknown): void } }).events.dispatch({ type, session_id: RT, payload })

function open(patch: Partial<ActiveSession> = {}): void {
  const a: ActiveSession = {
    runtimeId: RT, storedId: STORED, profile: 'default', title: 'Turn', info: {} as ActiveSession['info'], items: [], running: false,
    status: '', usage: null, ctx: null, tps: null, todos: [], openAssistantId: null, attachments: [], turnStart: null, goal: null,
    ...patch
  }
  setState({ active: a, conn: 'open', opening: null, requests: [] })
}

describe('in the gateway', () => {
  let submits: string[]
  let failSubmit: boolean
  let onSubmit: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    submits = []
    failSubmit = false
    onSubmit = () => {}
    vi.spyOn(client, 'request').mockImplementation(((method: string, params: { text?: string }) => {
      if (method !== 'prompt.submit') return Promise.resolve({})
      submits.push(String(params.text))
      onSubmit()
      return failSubmit ? Promise.reject(new Error('no route')) : Promise.resolve({})
    }) as typeof client.request)
    setState({ active: null })
    open()
    takeTurnEnd()
  })
  afterEach(() => {
    clearQueue(STORED)
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('a finished turn sends the next queued message', async () => {
    enqueue(STORED, 'one')
    enqueue(STORED, 'two')
    setPaused(STORED, false)
    emit('message.start')
    emit('message.complete', { text: 'ok' })
    await vi.advanceTimersByTimeAsync(10)
    expect(submits).toEqual(['one'])
    expect(queuedFor(STORED).map(q => q.text)).toEqual(['two'])
    expect(getState().active!.running).toBe(true)
  })

  test('a queued message that could not be sent pauses the queue instead of using up the rest', async () => {
    enqueue(STORED, 'one')
    enqueue(STORED, 'two')
    enqueue(STORED, 'three')
    setPaused(STORED, false)
    failSubmit = true
    emit('message.start')
    emit('message.complete', { text: 'ok' })
    await vi.advanceTimersByTimeAsync(50)
    expect(submits).toEqual(['one'])
    expect(queuedFor(STORED).map(q => q.text)).toEqual(['two', 'three'])
    expect(isPaused(STORED)).toBe(true)
    expect(getState().active).toMatchObject({ running: false, status: '', tps: null, turnStart: null })
  })

  test('a send shows no speed from the turn before', async () => {
    open({ tps: 41 })
    await sendPrompt('hello')
    expect(getState().active).toMatchObject({ running: true, tps: null })
    expect(getState().active!.turnStart).not.toBeNull()
  })

  test('an edited message starts the clock at the send, like any other', async () => {
    open({ items: [{ kind: 'user', id: 'u1', text: 'first', rowId: 7 }], tps: 41 })
    await resendFrom('u1', 'second')
    expect(submits).toEqual(['second'])
    expect(getState().active).toMatchObject({ running: true, tps: null })
    expect(getState().active!.turnStart).not.toBeNull()
  })

  test('a send that fails after another chat was opened leaves that chat alone', async () => {
    failSubmit = true
    onSubmit = () => setState({ active: { ...getState().active!, runtimeId: 'rt-other', storedId: 's-other', running: true, turnStart: 5, status: 'Reading' } })
    await sendPrompt('hello')
    expect(getState().active).toMatchObject({ runtimeId: 'rt-other', running: true, turnStart: 5, status: 'Reading' })
    expect(takeTurnEnd()).toBe('done')
  })
})
