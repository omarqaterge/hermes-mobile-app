// @vitest-environment happy-dom
// Battery: spinners share one 8 Hz tick (one redraw per step for all of them), and it stops with the last one.
import { afterEach, expect, test, vi } from 'vitest'
import { spinnersTicking, trackSpinner } from './components/Spinner'
import { bannerItems } from './activity'

afterEach(() => vi.useRealTimers())

test('spinners turn together on one tick that stops with the last spinner', () => {
  vi.useFakeTimers()
  const a = document.createElement('span')
  const b = document.createElement('span')
  const stopA = trackSpinner(a)
  vi.advanceTimersByTime(250)
  const stopB = trackSpinner(b)
  expect(b.style.transform).toBe(a.style.transform) // a late spinner joins the same step
  vi.advanceTimersByTime(125)
  expect(a.style.transform).toBe(b.style.transform)
  expect(a.style.transform).not.toBe('')
  stopA()
  expect(spinnersTicking()).toBe(true)
  stopB()
  expect(spinnersTicking()).toBe(false)
})

test("the banner (and the fast activity poll) leaves out the open chat's own live turn", () => {
  const items = [
    { session: 'open', text: 'Thinking…', short: '', profile: 'default', review: false, ts: 1 },
    { session: 'open', text: 'Learning', short: '', profile: 'default', review: true, ts: 2 },
    { session: 'other', text: 'Running ls', short: '', profile: 'default', review: false, ts: 3 }
  ]
  expect(bannerItems(items, 'open', true).map(i => i.session + i.review)).toEqual(['opentrue', 'otherfalse'])
  expect(bannerItems(items.slice(0, 1), 'open', true)).toEqual([])
  expect(bannerItems(items.slice(0, 1), 'open', false)).toHaveLength(1)
})
