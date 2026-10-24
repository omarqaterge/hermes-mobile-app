// @vitest-environment happy-dom
import { expect, test } from 'vitest'
import { PULL_MAX_PX, PULL_TRIGGER_PX, rubber, shouldOpen } from './pullbtw'

test('the trigger is about 110 px of finger travel', () => {
  expect(PULL_TRIGGER_PX).toBe(110)
})

test('rubber band: starts near half the finger distance, grows monotonically, never passes the cap', () => {
  expect(rubber(0)).toBe(0)
  expect(rubber(-30)).toBe(0)
  expect(rubber(20)).toBeGreaterThan(8)
  expect(rubber(20)).toBeLessThan(12)
  let prev = 0
  for (let dy = 1; dy <= 2000; dy += 7) {
    const r = rubber(dy)
    expect(r).toBeGreaterThan(prev)
    expect(r).toBeLessThan(PULL_MAX_PX)
    prev = r
  }
})

test('opens only when pulled far enough, from the bottom, in an open chat', () => {
  expect(shouldOpen(PULL_TRIGGER_PX - 1, true, true)).toBe(false)
  expect(shouldOpen(40, true, true)).toBe(false)
  expect(shouldOpen(PULL_TRIGGER_PX, true, true)).toBe(true)
  expect(shouldOpen(300, true, true)).toBe(true)
  expect(shouldOpen(300, false, true)).toBe(false)
  expect(shouldOpen(300, true, false)).toBe(false)
})
