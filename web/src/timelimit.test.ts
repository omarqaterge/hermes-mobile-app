import { afterEach, describe, expect, it, vi } from 'vitest'
import { timeLimit, TimeLimitError } from './timelimit'

describe('timeLimit', () => {
  afterEach(() => vi.useRealTimers())

  it('passes an answer that comes in time', async () => {
    await expect(timeLimit(Promise.resolve(3), 1000)).resolves.toBe(3)
  })

  it('passes a failure that comes in time', async () => {
    await expect(timeLimit(Promise.reject(new Error('HTTP 500')), 1000)).rejects.toThrow('HTTP 500')
  })

  it('ends a call that never answers with a TimeLimitError', async () => {
    vi.useFakeTimers()
    const p = timeLimit(new Promise(() => {}), 20000)
    vi.advanceTimersByTime(20000)
    await expect(p).rejects.toBeInstanceOf(TimeLimitError)
  })

  it('clears its timer once the call settles', async () => {
    vi.useFakeTimers()
    await timeLimit(Promise.resolve(1), 20000)
    expect(vi.getTimerCount()).toBe(0)
  })
})
