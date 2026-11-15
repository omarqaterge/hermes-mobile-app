// conn.ts: the connection's decisions (retry wait, banner, shell steps, liveness beat).
import { describe, expect, test } from 'vitest'
import { BEAT_MS, DEADLINE_MS, beatDecision, retryBanner, retryDelayMs, retryHermesSteps } from './conn'

describe('retry wait', () => {
  test('doubles from 0.6 s to the 15 s cap', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 12].map(n => retryDelayMs(n, false))).toEqual([600, 1200, 2400, 4800, 9600, 15_000, 15_000, 15_000])
  })
  test('is zero when Hermes was seen answering', () => {
    for (const n of [0, 1, 5, 12]) expect(retryDelayMs(n, true)).toBe(0)
  })
})

describe('banner', () => {
  test('Reconnecting for tries 1 and 2, Starting Hermux after', () => {
    expect([1, 2, 3, 6, 12].map(retryBanner)).toEqual([
      'Reconnecting…',
      'Reconnecting…',
      'Starting Hermux…',
      'Starting Hermux…',
      'Starting Hermux…'
    ])
  })
})

describe('shell steps', () => {
  test('watch on try 1; start on try 2 and every 6th', () => {
    expect(retryHermesSteps(1)).toEqual({ watch: true, start: false })
    expect(retryHermesSteps(2)).toEqual({ watch: false, start: true })
    expect(retryHermesSteps(5)).toEqual({ watch: false, start: false })
    expect(retryHermesSteps(6)).toEqual({ watch: false, start: true })
    expect(retryHermesSteps(12)).toEqual({ watch: false, start: true })
    expect(retryHermesSteps(7).start).toBe(false)
  })
})

describe('liveness beat', () => {
  const now = 1_000_000
  test('a normal beat with a recent frame pings', () => {
    expect(beatDecision(now, now - BEAT_MS, now - 1000)).toBe('ping')
  })
  test('silent for just under the deadline pings; exactly at it is dead', () => {
    expect(beatDecision(now, now - BEAT_MS, now - DEADLINE_MS + 1)).toBe('ping')
    expect(beatDecision(now, now - BEAT_MS, now - DEADLINE_MS)).toBe('dead')
  })
  test('a frozen gap gives a fresh window, even with old silence', () => {
    expect(beatDecision(now, now - BEAT_MS * 2 - 1, now - DEADLINE_MS * 3)).toBe('fresh-window')
  })
  test('a gap of exactly two beats is not frozen', () => {
    expect(beatDecision(now, now - BEAT_MS * 2, now - DEADLINE_MS)).toBe('dead')
    expect(beatDecision(now, now - BEAT_MS * 2, now - 1)).toBe('ping')
  })
})
