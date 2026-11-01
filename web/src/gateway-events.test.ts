// @vitest-environment happy-dom
// gateway.ts turns Hermes's streamed events into chat items. These tests feed event sequences shaped like the pinned
// Hermes's (the ones tools/web-e2e/mock.cjs plays and tools/hermes-contract compares) through the real client's event
// hub, with no socket, and check the items the chat would show.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { client } from './gateway'
import { getState, setState, type ActiveSession, type ChatItem } from './store'

const RT = 'rt-ev'
const STORED = 's-ev'

// The client's typed event hub (private in the vendored client): what a frame from the socket ends up calling.
const emit = (type: string, payload: Record<string, unknown> = {}, session_id = RT) =>
  (client as unknown as { events: { dispatch(e: unknown): void } }).events.dispatch({ type, session_id, payload })

function open(items: ChatItem[] = []): void {
  const a: ActiveSession = {
    runtimeId: RT,
    storedId: STORED,
    profile: 'default',
    title: 'Events',
    info: {} as ActiveSession['info'],
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
  }
  setState({ active: a })
}

const items = () => getState().active!.items
const shape = () =>
  items().map(i =>
    i.kind === 'assistant'
      ? { kind: i.kind, text: i.text, reasoning: i.reasoning, streaming: i.streaming }
      : i.kind === 'tool'
        ? { kind: i.kind, id: i.id, name: i.name, status: i.status, resultText: i.resultText }
        : { kind: i.kind }
  )

beforeEach(() => {
  vi.useFakeTimers()
  open()
})
afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

describe('a whole turn (the "read the note" flow)', () => {
  test('reasoning, a tool call and a streamed reply become three items', () => {
    emit('message.start')
    expect(getState().active!.running).toBe(true)
    emit('thinking.delta', { text: 'pondering' })
    expect(getState().active!.status).toBe('pondering')
    emit('reasoning.delta', { text: 'Look at ' })
    emit('reasoning.delta', { text: 'the note.' })
    emit('tool.generating', { name: 'read_file' })
    emit('tool.start', { tool_id: 'call_1', name: 'read_file', context: 'note.txt', args: { path: 'note.txt' } })
    emit('tool.complete', { tool_id: 'call_1', name: 'read_file', result: { content: 'hi' }, duration_s: 0.1 })
    emit('message.delta', { text: 'The note ' })
    emit('message.delta', { text: 'says hi.' })
    vi.advanceTimersByTime(200) // the batched deltas
    emit('message.complete', { text: 'The note says hi.', status: 'complete', usage: { total: 10 } })

    expect(shape()).toEqual([
      { kind: 'assistant', text: '', reasoning: 'Look at the note.', streaming: false },
      { kind: 'tool', id: 'call_1', name: 'read_file', status: 'done', resultText: JSON.stringify({ content: 'hi' }, null, 2) },
      { kind: 'assistant', text: 'The note says hi.', reasoning: '', streaming: false }
    ])
    const a = getState().active!
    expect(a.running).toBe(false)
    expect(a.status).toBe('')
    expect(a.openAssistantId).toBeNull()
    expect(a.usage).toEqual({ total: 10 })
  })

  test('message.complete flushes deltas that are still batched', () => {
    emit('message.start')
    emit('message.delta', { text: 'quick' })
    emit('message.complete', { status: 'complete' }) // no text: only the batched delta has it
    expect(shape()).toEqual([{ kind: 'assistant', text: 'quick', reasoning: '', streaming: false }])
  })

  test('a reply that only arrives in message.complete is still shown', () => {
    emit('message.start')
    emit('message.complete', { text: 'all at once', status: 'complete' })
    expect(shape()).toEqual([{ kind: 'assistant', text: 'all at once', reasoning: '', streaming: false }])
  })

  test('an empty assistant segment closed by a tool leaves no item', () => {
    emit('message.start')
    emit('tool.start', { tool_id: 'call_2', name: 'terminal' })
    expect(shape()).toEqual([{ kind: 'tool', id: 'call_2', name: 'terminal', status: 'running', resultText: undefined }])
  })

  test('an error ends the turn with an error notice', () => {
    emit('message.start')
    emit('message.complete', { error: 'model unavailable', status: 'error' })
    const last = items().at(-1)!
    expect(last).toMatchObject({ kind: 'notice', text: 'model unavailable', level: 'error' })
    expect(getState().active!.running).toBe(false)
  })
})

describe('tool cards', () => {
  test('tool.start replaces the generating placeholder of the same tool', () => {
    emit('tool.generating', { name: 'write_file' })
    expect(shape()).toEqual([{ kind: 'tool', id: expect.any(String), name: 'write_file', status: 'generating', resultText: undefined }])
    emit('tool.start', { tool_id: 'call_3', name: 'write_file' })
    expect(shape()).toEqual([{ kind: 'tool', id: 'call_3', name: 'write_file', status: 'running', resultText: undefined }])
  })

  test('a replayed tool.start adds no second card', () => {
    emit('tool.start', { tool_id: 'call_4', name: 'terminal' })
    emit('tool.start', { tool_id: 'call_4', name: 'terminal' })
    expect(items().filter(i => i.id === 'call_4')).toHaveLength(1)
  })

  test('tool.complete without a start adds a finished card', () => {
    emit('tool.complete', { tool_id: 'call_5', name: 'web_search', result_text: 'found' })
    expect(shape()).toEqual([{ kind: 'tool', id: 'call_5', name: 'web_search', status: 'done', resultText: 'found' }])
  })

  test('message.complete drops placeholders whose tool never started', () => {
    emit('message.start')
    emit('tool.generating', { name: 'patch' })
    emit('message.complete', { text: '', status: 'complete' })
    expect(items().some(i => i.kind === 'tool')).toBe(false)
  })
})

describe('events of other chats', () => {
  test('are not added to the open chat', () => {
    emit('message.start', {}, 'rt-other')
    emit('message.delta', { text: 'not here' }, 'rt-other')
    vi.advanceTimersByTime(200)
    emit('message.complete', { text: 'not here' }, 'rt-other')
    expect(items()).toEqual([])
    expect(getState().active!.running).toBe(false)
  })

  test('the stored id counts as the open chat too', () => {
    emit('message.start', {}, STORED)
    expect(getState().active!.running).toBe(true)
  })
})
