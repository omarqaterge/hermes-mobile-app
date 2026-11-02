// @vitest-environment happy-dom
// Usage stats: nothing without an app key, nothing without a yes; only the listed fields; bounded retries; off forgets.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const fetches = vi.fn()
const load = async () => {
  vi.resetModules()
  return import('./stats')
}
const sent = () => fetches.mock.calls.flatMap(c => JSON.parse(c[1].body) as Array<Record<string, unknown>>)
const KEY = 'A-EU-1234567890'

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  sessionStorage.clear()
  fetches.mockReset()
  fetches.mockResolvedValue({ status: 200 })
  vi.stubGlobal('fetch', fetches)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('no key: not offered, and nothing is sent even after a yes', async () => {
  const s = await load()
  expect(s.statsAvailable()).toBe(false)
  s.setStatsChoice(true)
  s.startStats()
  s.track('app_start')
  await vi.advanceTimersByTimeAsync(3_600_000)
  expect(s.statsOn()).toBe(false)
  expect(fetches).not.toHaveBeenCalled()
})

test('a key from an unknown region counts as no key', async () => {
  sessionStorage.setItem('hm.devStatsKey', 'A-XX-1')
  expect((await load()).statsAvailable()).toBe(false)
})

test('a key without a yes: nothing is sent and no ID is made', async () => {
  sessionStorage.setItem('hm.devStatsKey', KEY)
  const s = await load()
  expect(s.statsAvailable()).toBe(true)
  s.startStats()
  s.track('app_start')
  s.markStatsAsked()
  s.track('screen_open', { screen: 'settings' })
  await vi.advanceTimersByTimeAsync(3_600_000)
  expect(s.statsOn()).toBe(false)
  expect(s.statsUndecided()).toBe(false)
  expect(fetches).not.toHaveBeenCalled()
  expect(localStorage.getItem('hm.statsId')).toBeNull()
})

test('after a yes: one batch to the key\'s host with only the listed fields', async () => {
  sessionStorage.setItem('hm.devStatsKey', KEY)
  const s = await load()
  s.setStatsChoice(true)
  s.track('screen_open', { screen: 'settings' })
  s.answerStatsSource('Reddit')
  await vi.advanceTimersByTimeAsync(30_000)
  expect(fetches).toHaveBeenCalledTimes(1)
  const [url, init] = fetches.mock.calls[0]
  expect(url).toBe('https://eu.aptabase.com/api/v0/events')
  expect(init.headers['App-Key']).toBe(KEY)
  expect(init.credentials).toBe('omit')
  const events = sent()
  expect(events.map(e => e.eventName)).toEqual(['app_start', 'screen_open', 'heard_from'])
  expect(events[2].props).toEqual({ source: 'Reddit' })
  for (const e of events) {
    expect(Object.keys(e).sort()).toEqual(['eventName', 'props', 'sessionId', 'systemProps', 'timestamp'])
    expect(Object.keys(e.systemProps as object).sort()).toEqual(['appVersion', 'isDebug', 'osName', 'osVersion', 'sdkVersion'])
    expect(e.sessionId).toBe(localStorage.getItem('hm.statsId'))
    expect(e.sessionId).toMatch(/^[0-9a-f]{32}$/)
  }
})

test('storage that cannot be written still shows the card once', async () => {
  sessionStorage.setItem('hm.devStatsKey', KEY)
  const s = await load()
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
  expect(s.statsUndecided()).toBe(true)
  s.markStatsAsked()
  expect(s.statsUndecided()).toBe(false)
  set.mockRestore()
})

test('the question counts as asked once it is on screen', async () => {
  const s = await load()
  expect(s.statsSourceAsked()).toBe(false)
  s.markStatsSourceAsked()
  expect(s.statsSourceAsked()).toBe(true)
})

test('anything off the list is dropped', async () => {
  sessionStorage.setItem('hm.devStatsKey', KEY)
  const s = await load()
  s.setStatsChoice(true)
  s.track('screen_open', { screen: 'my private file.pdf' })
  s.track('screen_open', { path: 'settings' })
  s.track('heard_from', { source: 'a free text answer' })
  s.track('app_start', { extra: 'x' })
  await vi.advanceTimersByTimeAsync(30_000)
  expect(sent().map(e => e.eventName)).toEqual(['app_start'])
})

test('opening a screen counts once; the chat is not a screen', async () => {
  sessionStorage.setItem('hm.devStatsKey', KEY)
  const s = await load()
  const store = await import('./store')
  s.setStatsChoice(true)
  s.startStats()
  store.setState({ screen: 'gallery' })
  store.setState({ drawer: true })
  store.setState({ screen: null })
  await vi.advanceTimersByTimeAsync(30_000)
  expect(sent().filter(e => e.eventName === 'screen_open').map(e => e.props)).toEqual([{ screen: 'gallery' }])
  store.setState({ drawer: false })
})

test('a failure is silent and tried once more, then dropped; no loop', async () => {
  sessionStorage.setItem('hm.devStatsKey', KEY)
  fetches.mockRejectedValue(new Error('offline'))
  const s = await load()
  s.setStatsChoice(true)
  await vi.advanceTimersByTimeAsync(24 * 3_600_000)
  expect(fetches).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
})

test('a rejected request (bad key) is not tried again', async () => {
  sessionStorage.setItem('hm.devStatsKey', KEY)
  fetches.mockResolvedValue({ status: 401 })
  const s = await load()
  s.setStatsChoice(true)
  await vi.advanceTimersByTimeAsync(3_600_000)
  expect(fetches).toHaveBeenCalledTimes(1)
})

test('a request that never answers gives up after 10 s', async () => {
  sessionStorage.setItem('hm.devStatsKey', KEY)
  let signal: AbortSignal | undefined
  fetches.mockImplementationOnce((_u, init) => {
    signal = init.signal
    return new Promise((_ok, no) => init.signal.addEventListener('abort', () => no(new Error('aborted'))))
  })
  const s = await load()
  s.setStatsChoice(true)
  await vi.advanceTimersByTimeAsync(40_000)
  expect(signal?.aborted).toBe(true)
})

test('turning it off drops what is waiting, stops sending and forgets the ID; a later yes gets a new ID', async () => {
  sessionStorage.setItem('hm.devStatsKey', KEY)
  const s = await load()
  s.setStatsChoice(true)
  s.track('screen_open', { screen: 'settings' })
  const first = localStorage.getItem('hm.statsId')
  expect(first).toBeTruthy()
  s.setStatsChoice(false)
  expect(localStorage.getItem('hm.statsId')).toBeNull()
  s.track('screen_open', { screen: 'settings' })
  await vi.advanceTimersByTimeAsync(3_600_000)
  expect(fetches).not.toHaveBeenCalled()
  s.setStatsChoice(true)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(sent().map(e => e.eventName)).toEqual(['app_start'])
  expect(sent()[0].sessionId).not.toBe(first)
})

test('going to the background sends what is waiting at once, and never keeps a timer there', async () => {
  sessionStorage.setItem('hm.devStatsKey', KEY)
  const s = await load()
  s.setStatsChoice(true)
  s.startStats()
  Object.defineProperty(document, 'hidden', { configurable: true, value: true })
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(0)
  expect(fetches).toHaveBeenCalledTimes(1)
  expect(fetches.mock.calls[0][1].keepalive).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
})

