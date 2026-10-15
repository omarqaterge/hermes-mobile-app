// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from 'vitest'
import { bootMark, bootSummary, lastBoot, resetBootForTest } from './boot'

describe('start-up timing marks', () => {
  beforeEach(() => {
    localStorage.clear()
    resetBootForTest()
  })
  test('each stage is kept once (the first time), in order, and survives a reload', () => {
    bootMark('script', 120)
    bootMark('token', 900)
    bootMark('token', 5000) // a reconnect later doesn't move the start-up mark
    bootMark('socket', 1430)
    expect(lastBoot()).toEqual([
      ['script', 120],
      ['token', 900],
      ['socket', 1430]
    ])
    expect(JSON.parse(localStorage.getItem('hm.boot.v1') || '{}').marks).toHaveLength(3)
  })
  test('summary for Settings → About', () => {
    bootMark('script', 120)
    bootMark('chat-live', 2460)
    expect(bootSummary(lastBoot())).toBe('script 0.1s · chat-live 2.5s')
    expect(bootSummary([])).toBe('')
  })
  test('a broken stored value reads as no marks', () => {
    localStorage.setItem('hm.boot.v1', '{oops')
    expect(lastBoot()).toEqual([])
  })
})
