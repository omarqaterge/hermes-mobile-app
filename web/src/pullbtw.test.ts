// @vitest-environment happy-dom
import { expect, test } from 'vitest'
import { PULL_GIVE, PULL_MAX_PX, PULL_TRIGGER_PX, rubber, shouldOpen } from './pullbtw'

test('the trigger is a firm pull: 230 px of finger travel (raised from 110, then 160)', () => {
  expect(PULL_TRIGGER_PX).toBe(230)
})

test('rubber band: starts near 40 % of the finger distance, grows monotonically, never passes the cap', () => {
  expect(rubber(0)).toBe(0)
  expect(rubber(-30)).toBe(0)
  expect(rubber(20)).toBeGreaterThan(6)
  expect(rubber(20)).toBeLessThan(9)
  let prev = 0
  for (let dy = 1; dy <= 2000; dy += 7) {
    const r = rubber(dy)
    expect(r).toBeGreaterThan(prev)
    expect(r).toBeLessThan(PULL_MAX_PX)
    prev = r
  }
})

test('heavier than before: the list follows less of the finger, but still visibly moves when armed', () => {
  expect(PULL_GIVE).toBeLessThan(0.55)
  const old = (dy: number) => PULL_MAX_PX * (1 - 1 / ((dy / PULL_MAX_PX) * 0.55 + 1))
  for (const dy of [20, 80, 160, 230, 400]) expect(rubber(dy)).toBeLessThan(old(dy))
  // At the moment it arms, the stretch is about what the old 160 px pull showed (~50 px), so the hint still reads.
  expect(rubber(PULL_TRIGGER_PX)).toBeGreaterThan(45)
  expect(rubber(PULL_TRIGGER_PX)).toBeLessThan(60)
})

test('opens only when pulled far enough, from the bottom, in an open chat', () => {
  expect(shouldOpen(PULL_TRIGGER_PX - 1, true, true)).toBe(false)
  expect(shouldOpen(40, true, true)).toBe(false)
  expect(shouldOpen(160, true, true)).toBe(false)
  expect(shouldOpen(PULL_TRIGGER_PX, true, true)).toBe(true)
  expect(shouldOpen(300, true, true)).toBe(true)
  expect(shouldOpen(300, false, true)).toBe(false)
  expect(shouldOpen(300, true, false)).toBe(false)
})
