// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { BACK_GRACE_MS, firstUnseen, isAway, lastBack, lastVisit, markVisit, newWhileAway, noteAway, noteBack, onBack } from './visit'
import type { ChatItem } from './store'

const u = (id: string, at?: number): ChatItem => ({ kind: 'user', id, text: id, at })
const a = (id: string, at?: number): ChatItem => ({ kind: 'assistant', id, text: id, reasoning: '', streaming: false, at })
const tool = (id: string): ChatItem => ({ kind: 'tool', id, name: 't', status: 'done' } as unknown as ChatItem)

describe('firstUnseen', () => {
  const items = [u('1', 100), a('2', 200), u('3', 300), a('4', 400)]
  it('is -1 without a last visit', () => expect(firstUnseen(items, null)).toBe(-1))
  it('is -1 when the first item is already new', () => expect(firstUnseen(items, 50)).toBe(-1))
  it('finds the first newer message', () => {
    expect(firstUnseen(items, 250)).toBe(2)
    expect(firstUnseen(items, 100)).toBe(1)
  })
  it('is -1 when everything was seen', () => expect(firstUnseen(items, 400)).toBe(-1))
  it('skips items without a time', () => {
    expect(firstUnseen([u('1', 100), tool('t'), a('2'), a('3', 300)], 150)).toBe(3)
  })
})

describe('visit marks', () => {
  beforeEach(() => localStorage.clear())
  it('stores and reads a time', () => {
    expect(lastVisit('s-1')).toBeNull()
    markVisit('s-1', 1234)
    expect(lastVisit('s-1')).toBe(1234)
    markVisit('s-1')
    expect(lastVisit('s-1')!).toBeGreaterThan(1234)
  })
  it('keeps the newest 500', () => {
    for (let i = 0; i < 510; i++) markVisit(`c${i}`, i + 1)
    expect(lastVisit('c0')).toBeNull()
    expect(lastVisit('c9')).toBeNull()
    expect(lastVisit('c10')).toBe(11)
    expect(Object.keys(JSON.parse(localStorage.getItem('hm.visit.v1')!))).toHaveLength(500)
  })
  it('survives broken storage content', () => {
    localStorage.setItem('hm.visit.v1', '[1')
    expect(lastVisit('x')).toBeNull()
    markVisit('x', 5)
    expect(lastVisit('x')).toBe(5)
  })
})

describe('away and back with the same chat open', () => {
  beforeEach(() => localStorage.clear())
  it('newWhileAway finds the first message stamped while away (and in the grace after coming back)', () => {
    const items = [u('1', 100), a('2', 200), u('3', 300), a('4', 400)]
    expect(newWhileAway(items, 250, 280)).toBe(2)
    expect(newWhileAway(items, 350, 350)).toBe(3)
    expect(newWhileAway(items, 350, 400 - BACK_GRACE_MS - 1)).toBe(-1) // came back long before it: watched
    expect(newWhileAway(items, 50, 60)).toBe(-1) // never index 0
    expect(newWhileAway([u('1', 100), tool('t'), a('2', 500)], 200, 300)).toBe(2)
  })
  it('noteAway marks the visit once; noteBack tells listeners which chat and when', () => {
    const seen: Array<ReturnType<typeof lastBack>> = []
    const off = onBack(() => seen.push(lastBack()))
    noteBack() // not away: nothing
    expect(seen).toHaveLength(0)
    noteAway('s-1')
    const t = lastVisit('s-1')
    expect(isAway()).toBe(true)
    expect(t).not.toBeNull()
    noteAway('s-2') // second signal (visibilitychange after hermesPause) is ignored
    expect(lastVisit('s-2')).toBeNull()
    noteBack()
    noteBack() // second return signal is ignored
    expect(isAway()).toBe(false)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.chat).toBe('s-1')
    expect(seen[0]?.at).toBe(t)
    off()
  })
})
