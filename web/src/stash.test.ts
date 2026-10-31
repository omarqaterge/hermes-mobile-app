// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { STASH_MAX, clearStashes, pushStash, stashes, takeStash } from './stash'

beforeEach(() => localStorage.clear())

describe('stash', () => {
  it('keeps the newest first and takes by id', () => {
    const a = pushStash('a', null)
    const b = pushStash('b', 'c1')
    expect(stashes().map(s => s.text)).toEqual(['b', 'a'])
    expect(stashes()[0].chat).toBe('c1')
    expect(takeStash(a.id)?.text).toBe('a')
    expect(stashes().map(s => s.id)).toEqual([b.id])
  })
  it('drops the oldest beyond the cap', () => {
    for (let i = 0; i < STASH_MAX + 3; i++) pushStash(`t${i}`, null)
    const l = stashes()
    expect(l).toHaveLength(STASH_MAX)
    expect(l[0].text).toBe(`t${STASH_MAX + 2}`)
    expect(l[l.length - 1].text).toBe('t3')
  })
  it('returns null for an unknown id', () => {
    pushStash('a', null)
    expect(takeStash('nope')).toBeNull()
    expect(stashes()).toHaveLength(1)
  })
  it('gives [] for corrupt storage and clears', () => {
    localStorage.setItem('hm.stash.v1', '{bad')
    expect(stashes()).toEqual([])
    localStorage.setItem('hm.stash.v1', '{"a":1}')
    expect(stashes()).toEqual([])
    pushStash('a', null)
    clearStashes()
    expect(stashes()).toEqual([])
  })
})
