// A card's Query() client: saved answers for 15 min, at most 30 network calls per client, errors as MCP isError results.
import { expect, test } from 'vitest'
import { makeToolClient, type ToolStore } from './openui-query'

const MIN = 60_000

function setup() {
  const map = new Map<string, unknown>()
  const store: ToolStore = { load: (k) => map.get(k), save: (k, v) => void map.set(k, v) }
  let t = 1_000_000
  const clock = { now: () => t, advance: (ms: number) => void (t += ms) }
  const seen: [string, Record<string, unknown>][] = []
  let answer: (name: string, args: Record<string, unknown>) => unknown = (name, args) => ({ name, args })
  const call = async (name: string, args: Record<string, unknown>) => (seen.push([name, args]), answer(name, args))
  return { map, store, clock, seen, call, setAnswer: (f: typeof answer) => void (answer = f) }
}

test('a fresh call goes to the network and returns structuredContent', async () => {
  const s = setup()
  const c = makeToolClient(s.call, 'chat1', s.store, s.clock.now)
  const r = await c.callTool({ name: 'web_search', arguments: { query: 'x' } })
  expect(r).toEqual({ structuredContent: { name: 'web_search', args: { query: 'x' } }, content: [] })
  expect(s.seen).toEqual([['web_search', { query: 'x' }]])
})

test('missing arguments are sent as {}', async () => {
  const s = setup()
  const c = makeToolClient(s.call, 'chat1', s.store, s.clock.now)
  await c.callTool({ name: 'session_search' })
  expect(s.seen).toEqual([['session_search', {}]])
})

test('a new client within 15 min gets the saved answer without calling; a repeat from the same client (Refresh) calls', async () => {
  const s = setup()
  const first = await makeToolClient(s.call, 'chat1', s.store, s.clock.now).callTool({ name: 'web_search', arguments: { query: 'x' } })
  s.clock.advance(15 * MIN - 1)
  const c = makeToolClient(s.call, 'chat1', s.store, s.clock.now)
  expect(await c.callTool({ name: 'web_search', arguments: { query: 'x' } })).toEqual(first)
  expect(s.seen.length).toBe(1)
  await c.callTool({ name: 'web_search', arguments: { query: 'x' } })
  expect(s.seen.length).toBe(2)
})

test('the saved answer survives a new client (reopening the chat) with the same cache key', async () => {
  const s = setup()
  await makeToolClient(s.call, 'chat1', s.store, s.clock.now).callTool({ name: 'web_search', arguments: { query: 'x' } })
  s.clock.advance(5 * MIN)
  const r = await makeToolClient(s.call, 'chat1', s.store, s.clock.now).callTool({ name: 'web_search', arguments: { query: 'x' } })
  expect(r).toEqual({ structuredContent: { name: 'web_search', args: { query: 'x' } }, content: [] })
  expect(s.seen.length).toBe(1)
})

test('after 15 min a new client calls again and saves the new answer', async () => {
  const s = setup()
  const mk = () => makeToolClient(s.call, 'chat1', s.store, s.clock.now)
  const args = { name: 'web_search', arguments: { query: 'x' } }
  await mk().callTool(args)
  s.clock.advance(15 * MIN)
  s.setAnswer(() => ({ fresh: true }))
  expect(await mk().callTool(args)).toEqual({ structuredContent: { fresh: true }, content: [] })
  expect(s.seen.length).toBe(2)
  s.clock.advance(MIN)
  expect(await mk().callTool(args)).toEqual({ structuredContent: { fresh: true }, content: [] })
  expect(s.seen.length).toBe(2)
})

test('different cache key, tool name or args are different calls', async () => {
  const s = setup()
  await makeToolClient(s.call, 'chat1', s.store, s.clock.now).callTool({ name: 'web_search', arguments: { query: 'x' } })
  await makeToolClient(s.call, 'chat2', s.store, s.clock.now).callTool({ name: 'web_search', arguments: { query: 'x' } })
  const c = makeToolClient(s.call, 'chat1', s.store, s.clock.now)
  await c.callTool({ name: 'session_search', arguments: { query: 'x' } })
  await c.callTool({ name: 'web_search', arguments: { query: 'y' } })
  expect(s.seen.length).toBe(4)
})

test('the save gets the time as its own argument', async () => {
  const s = setup()
  const saves: [string, Record<string, unknown>, number][] = []
  const store: ToolStore = { load: s.store.load, save: (k, v, now) => (saves.push([k, v, now]), s.store.save(k, v, now)) }
  await makeToolClient(s.call, 'chat1', store, s.clock.now).callTool({ name: 'web_search', arguments: { query: 'x' } })
  expect(saves.length).toBe(1)
  expect(saves[0][2]).toBe(s.clock.now())
  expect(saves[0][1]).toEqual({ at: s.clock.now(), v: { name: 'web_search', args: { query: 'x' } } })
})

test('the 31st network call of one client is refused without calling', async () => {
  const s = setup()
  const c = makeToolClient(s.call, 'chat1', s.store, s.clock.now)
  for (let i = 0; i < 30; i++) expect((await c.callTool({ name: 'web_search', arguments: { query: `q${i}` } })).isError).toBeUndefined()
  const r = await c.callTool({ name: 'web_search', arguments: { query: 'q30' } })
  expect(r).toEqual({ isError: true, content: [{ type: 'text', text: 'This card asked for data too often. Ask Hermes to refresh it.' }] })
  expect(s.seen.length).toBe(30)
  // a new client (page reload) has its own budget and is served the saved answer
  expect(await makeToolClient(s.call, 'chat1', s.store, s.clock.now).callTool({ name: 'web_search', arguments: { query: 'q0' } })).toEqual({ structuredContent: { name: 'web_search', args: { query: 'q0' } }, content: [] })
  expect((await makeToolClient(s.call, 'chat1', s.store, s.clock.now).callTool({ name: 'web_search', arguments: { query: 'q30' } })).isError).toBeUndefined()
  expect(s.seen.length).toBe(31)
})

test('a refresh loop on one call stops after 30 network calls', async () => {
  const s = setup()
  const c = makeToolClient(s.call, 'chat1', s.store, s.clock.now)
  for (let i = 0; i < 40; i++) {
    await c.callTool({ name: 'web_search', arguments: { query: 'x' } })
    s.clock.advance(15 * MIN)
  }
  expect(s.seen.length).toBe(30)
})

test('a thrown error becomes isError with its message and is not saved', async () => {
  const s = setup()
  const c = makeToolClient(s.call, 'chat1', s.store, s.clock.now)
  s.setAnswer(() => { throw new Error('tool not allowed') })
  expect(await c.callTool({ name: 'terminal', arguments: {} })).toEqual({ isError: true, content: [{ type: 'text', text: 'tool not allowed' }] })
  expect(s.map.size).toBe(0)
  s.setAnswer(() => { throw 'plain string' })
  expect(await c.callTool({ name: 'terminal', arguments: {} })).toEqual({ isError: true, content: [{ type: 'text', text: 'plain string' }] })
  s.setAnswer(() => ({ ok: 1 }))
  expect(await c.callTool({ name: 'terminal', arguments: {} })).toEqual({ structuredContent: { ok: 1 }, content: [] })
  expect(s.seen.length).toBe(3)
})

test('a broken saved entry is ignored', async () => {
  const s = setup()
  const c = makeToolClient(s.call, 'chat1', s.store, s.clock.now)
  await c.callTool({ name: 'web_search', arguments: { query: 'x' } })
  for (const k of s.map.keys()) s.map.set(k, 'junk')
  await c.callTool({ name: 'web_search', arguments: { query: 'x' } })
  expect(s.seen.length).toBe(2)
})

test('a cache key given as a function is read at call time (a new chat learns its id after the card mounted)', async () => {
  const s = setup()
  let id = ''
  const c = makeToolClient(s.call, () => id, s.store, s.clock.now)
  id = 'chat1' // the id arrives before the first call
  await c.callTool({ name: 'web_search', arguments: { query: 'x' } })
  await makeToolClient(s.call, 'chat1', s.store, s.clock.now).callTool({ name: 'web_search', arguments: { query: 'x' } })
  expect(s.seen.length).toBe(1)
})
