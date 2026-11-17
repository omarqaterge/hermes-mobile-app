// @vitest-environment happy-dom
// The composer's tray (tray.ts): when it is open, the first-send close, the one-time hint and the Model bar setting.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { HINT_MS, dismissTrayHint, modelBarMode, resetTrayForTests, setModelBarMode, setTrayOpen, takeTrayJump, trayFirstSend, trayForChat, trayState } from './tray'

beforeEach(() => {
  localStorage.clear()
  resetTrayForTests()
})
afterEach(() => vi.useRealTimers())

test('a new chat starts open and its first message closes it; a chat from the list starts closed', () => {
  trayForChat('new')
  expect(trayState().open).toBe(true)
  trayFirstSend()
  expect(trayState().open).toBe(false)
  trayForChat('carry') // the new chat became a real one: it stays as it is
  expect(trayState().open).toBe(false)
  trayForChat('listed')
  expect(trayState().open).toBe(false)
  trayFirstSend() // not a new chat: nothing happens
  expect(trayState().open).toBe(false)
})

test('opened or closed by hand, it stays so: later sends change nothing', () => {
  trayForChat('listed')
  setTrayOpen(true)
  trayFirstSend()
  expect(trayState().open).toBe(true)
  trayForChat('new')
  setTrayOpen(false)
  setTrayOpen(true) // the person opened it again on the new chat: the first message leaves it open
  trayFirstSend()
  expect(trayState().open).toBe(true)
  setTrayOpen(false)
  trayFirstSend()
  expect(trayState().open).toBe(false)
})

test('the hint shows the first time ever the tray closes by itself, then never again', () => {
  vi.useFakeTimers()
  trayForChat('new')
  trayFirstSend()
  expect(trayState().hint).toBe(true)
  expect(localStorage.getItem('hm.trayHint.v1')).toBe('1')
  vi.advanceTimersByTime(HINT_MS)
  expect(trayState().hint).toBe(false)
  trayForChat('new')
  trayFirstSend()
  expect(trayState().hint).toBe(false)
})

test('the hint leaves on a touch, and a hand on the handle takes it away too', () => {
  trayForChat('new')
  trayFirstSend()
  expect(trayState().hint).toBe(true)
  dismissTrayHint()
  expect(trayState().hint).toBe(false)
  localStorage.clear()
  trayForChat('new')
  trayFirstSend()
  setTrayOpen(true)
  expect(trayState().hint).toBe(false)
})

test('Model bar: Tucked away by default; Always open keeps the tray open, with no hint, and is remembered', () => {
  expect(modelBarMode()).toBe('tucked')
  setModelBarMode('open')
  expect(localStorage.getItem('hm.modelBar')).toBe('open')
  trayForChat('listed')
  expect(trayState()).toEqual({ mode: 'open', open: true, hint: false })
  trayForChat('new')
  trayFirstSend()
  expect(trayState()).toEqual({ mode: 'open', open: true, hint: false })
  expect(localStorage.getItem('hm.trayHint.v1')).toBe(null) // the hint is kept for when the tray can close
  setModelBarMode('tucked')
  expect(localStorage.getItem('hm.modelBar')).toBe('tucked')
  expect(trayState().open).toBe(false) // the first message had closed it
  resetTrayForTests()
  expect(modelBarMode()).toBe('tucked')
  localStorage.setItem('hm.modelBar', 'open')
  resetTrayForTests()
  expect(modelBarMode()).toBe('open')
})

test('a change that comes with another chat is taken at once (no movement); one by hand moves', () => {
  trayForChat('new')
  takeTrayJump()
  trayForChat('listed')
  expect(takeTrayJump()).toBe(true)
  expect(takeTrayJump()).toBe(false)
  trayForChat('listed') // nothing changes: nothing to jump
  expect(takeTrayJump()).toBe(false)
  trayForChat('new')
  setTrayOpen(false)
  expect(takeTrayJump()).toBe(false)
})
