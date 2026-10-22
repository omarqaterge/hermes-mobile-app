// @vitest-environment happy-dom
// Background app: state parsing, per-chat matching, the frame loop (one request in flight, ≥500 ms apart, only while wanted + visible).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const asked: Array<{ id: number; w: number }> = []
vi.mock('./bridge', () => ({
  bgState: () => '',
  bgFrameAsync: (id: number, w: number) => (asked.push({ id, w }), true)
}))

import { bgForChat, frameDelay, parseBg, setBg, wantFrames } from './bgapp'
import { getState } from './store'

const st = { session: 's-1', pkg: 'com.keep', label: 'Keep', action: 'tapping "New note"', since: 1000 }
const reply = (id: number) => (window as unknown as { __hmBgFrame: (i: number, d: string) => void }).__hmBgFrame(id, 'data:image/jpeg;base64,AA==')

describe('parseBg', () => {
  test('accepts an object or its JSON, fills defaults', () => {
    expect(parseBg(st)).toEqual(st)
    expect(parseBg(JSON.stringify(st))).toEqual(st)
    expect(parseBg({ session: 's-2', pkg: 'a.b' })).toEqual({ session: 's-2', pkg: 'a.b', label: 'a.b', action: '', since: 0 })
  })
  test('nothing / junk / no session = null', () => {
    for (const x of [null, undefined, '', 'nope', '[]', 5, {}, { session: '' }, { pkg: 'a' }]) expect(parseBg(x)).toBeNull()
  })
})

test('bgForChat only matches the chat that started it', () => {
  expect(bgForChat(st, 's-1')).toBe(st)
  expect(bgForChat(st, 's-2')).toBeNull()
  expect(bgForChat(st, null)).toBeNull()
  expect(bgForChat(null, 's-1')).toBeNull()
})

test('frameDelay waits out the rest of the interval', () => {
  expect(frameDelay(0)).toBe(500)
  expect(frameDelay(120)).toBe(380)
  expect(frameDelay(900)).toBe(0)
})

describe('frame loop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    asked.length = 0
  })
  afterEach(() => {
    setBg(null)
    vi.advanceTimersByTime(10_000) // lets an unanswered request time out, so the next test starts with none in flight
    vi.useRealTimers()
  })

  test('no state or no consumer: no requests', () => {
    const off = wantFrames(200)
    vi.advanceTimersByTime(3000)
    expect(asked).toHaveLength(0) // consumer but no bg state
    off()
    setBg(st)
    vi.advanceTimersByTime(3000)
    expect(asked).toHaveLength(0) // state but no consumer
  })

  test('one request in flight, next one 500 ms after the previous started, asks the widest consumer', () => {
    setBg(st)
    const off = wantFrames(200)
    vi.advanceTimersByTime(1)
    expect(asked).toHaveLength(1)
    expect(asked[0].w).toBe(200)
    vi.advanceTimersByTime(2000) // unanswered: never a second request
    expect(asked).toHaveLength(1)
    reply(asked[0].id) // answered late (>500 ms): the next one goes out at once
    vi.advanceTimersByTime(1)
    expect(asked).toHaveLength(2)
    reply(asked[1].id) // answered fast: waits out the rest of the 500 ms
    vi.advanceTimersByTime(100)
    expect(asked).toHaveLength(2)
    vi.advanceTimersByTime(500)
    expect(asked).toHaveLength(3)
    const off2 = wantFrames(540)
    reply(asked[2].id)
    vi.advanceTimersByTime(600)
    expect(asked[3].w).toBe(540)
    off2()
    off()
  })

  test('stops when released, when the state clears and when the page is hidden', () => {
    setBg(st)
    const off = wantFrames(200)
    vi.advanceTimersByTime(1)
    reply(asked[0].id)
    off()
    vi.advanceTimersByTime(3000)
    expect(asked).toHaveLength(1)

    const off2 = wantFrames(200)
    vi.advanceTimersByTime(1)
    expect(asked).toHaveLength(2)
    reply(asked[1].id)
    setBg(null)
    vi.advanceTimersByTime(3000)
    expect(asked).toHaveLength(2)
    expect(getState().bg).toBeNull()

    setBg(st)
    vi.advanceTimersByTime(1)
    expect(asked).toHaveLength(3)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    reply(asked[2].id)
    vi.advanceTimersByTime(3000)
    expect(asked).toHaveLength(3)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(1)
    expect(asked).toHaveLength(4)
    off2()
  })

  test('an equal state keeps the same object', () => {
    setBg(st)
    const a = getState().bg
    setBg({ ...st })
    expect(getState().bg).toBe(a)
  })
})
