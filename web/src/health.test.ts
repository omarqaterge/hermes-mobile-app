// @vitest-environment happy-dom
// Battery: /api/status is expensive for Hermes under proot; the minute poll only pings, the status refreshes every 10 min.
import { expect, test, vi } from 'vitest'

const calls: string[] = []
vi.mock('./api', () => ({ api: vi.fn(async (_m: string, path: string) => (calls.push(path), { version: '1', components: { dashboard: { status: 'ok' } } })) }))
vi.mock('./gateway', () => ({ rpc: vi.fn(async (m: string) => (calls.push(m), {})) }))

test('the minute check pings; /api/status only when 10 min old or asked for', async () => {
  const { checkHealth } = await import('./health')
  const { setState, getState } = await import('./store')
  setState({ conn: 'open' })
  vi.useFakeTimers()
  await checkHealth() // full: the status sheet, the first check
  await checkHealth(false)
  await checkHealth(false)
  expect(calls.filter(c => c === '/api/status')).toHaveLength(1)
  expect(calls.filter(c => c === 'gateway.ping')).toHaveLength(3)
  expect(getState().health?.version).toBe('1') // kept between full checks
  vi.advanceTimersByTime(10 * 60_000)
  await checkHealth(false)
  expect(calls.filter(c => c === '/api/status')).toHaveLength(2)
  vi.useRealTimers()
})
