// @vitest-environment happy-dom
// While Hermes is away the page retries with backoff; the shell's "Hermes answers" signal (window.__hmHermesReady, bridge
// watchHermes) cuts the wait short. A fresh gateway module per test: its connection state lives in module variables.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const bridge = vi.hoisted(() => ({
  wsUrl: vi.fn(async (): Promise<string | null> => null),
  watchHermes: vi.fn(),
  startHermes: vi.fn()
}))

vi.mock('./bridge', async original => ({ ...(await original<typeof import('./bridge')>()), ...bridge }))

const settle = () => vi.advanceTimersByTimeAsync(0)
const tries = () => bridge.wsUrl.mock.calls.length

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  vi.clearAllMocks()
  bridge.wsUrl.mockImplementation(async () => null)
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

/** Start the gateway with Hermes away: the first try has failed and the next one waits for its backoff. */
async function hermesAway() {
  const gateway = await import('./gateway')
  void gateway.connect()
  await settle()
  expect(tries()).toBe(1)
  return gateway
}

describe('reconnecting when Hermes answers', () => {
  test('the signal reconnects at once instead of waiting for the backoff', async () => {
    await hermesAway()
    await vi.advanceTimersByTimeAsync(100)
    expect(tries()).toBe(1)
    window.__hmHermesReady?.()
    await settle()
    expect(tries()).toBe(2)
  })

  test('it replaces the waiting try: no second one when that timer would have run', async () => {
    await hermesAway()
    bridge.wsUrl.mockImplementation(() => new Promise(() => {})) // the try the signal starts stays under way
    window.__hmHermesReady?.()
    await settle()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(tries()).toBe(2)
  })

  test('without the signal the backoff still retries: 0.6, 1.2, 2.4 s', async () => {
    await hermesAway()
    await vi.advanceTimersByTimeAsync(599)
    expect(tries()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(tries()).toBe(2)
    await vi.advanceTimersByTimeAsync(1200)
    expect(tries()).toBe(3)
    await vi.advanceTimersByTimeAsync(2400)
    expect(tries()).toBe(4)
  })

  test('the shell is asked to watch once per outage, not on every try', async () => {
    await hermesAway()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(tries()).toBeGreaterThan(4)
    expect(bridge.watchHermes).toHaveBeenCalledTimes(1)
  })

  test('a user reconnect asks again: the earlier watch may have ended', async () => {
    const gateway = await hermesAway()
    gateway.reconnectNow(false)
    await settle()
    expect(bridge.watchHermes).toHaveBeenCalledTimes(2)
  })

  test('a signal during a try that then fails: the next try goes at once, later ones back off again', async () => {
    const gateway = await import('./gateway')
    let fail = (_: string | null) => {}
    bridge.wsUrl.mockImplementationOnce(() => new Promise(resolve => (fail = resolve)))
    void gateway.connect()
    await settle()
    window.__hmHermesReady?.()
    fail(null)
    await settle()
    await settle()
    expect(tries()).toBe(2)
    await vi.advanceTimersByTimeAsync(1199)
    expect(tries()).toBe(2) // back to the backoff (attempt 2: 1.2 s)
    await vi.advanceTimersByTimeAsync(1)
    expect(tries()).toBe(3)
  })

  test('a dashboard that answers while the socket keeps failing does not loop', async () => {
    await hermesAway()
    window.__hmHermesReady?.()
    await settle()
    expect(tries()).toBe(2)
    await vi.advanceTimersByTimeAsync(1199)
    expect(tries()).toBe(2) // the backoff did not start over
    expect(bridge.watchHermes).toHaveBeenCalledTimes(1)
  })

  test('nothing happens before the first connect or with the socket open', async () => {
    const gateway = await import('./gateway')
    const { setState } = await import('./store')
    window.__hmHermesReady?.()
    await settle()
    expect(tries()).toBe(0)
    void gateway.connect()
    await settle()
    setState({ conn: 'open' })
    window.__hmHermesReady?.()
    await settle()
    expect(tries()).toBe(1)
  })
})
