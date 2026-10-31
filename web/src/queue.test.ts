// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { QUEUE_MAX, clearQueue, editQueued, enqueue, isPaused, queuedFor, removeQueued, restoreFirst, setPaused, takeFirst } from './queue'

beforeEach(() => {
  localStorage.clear()
  clearQueue('c1')
  clearQueue('c2')
})

describe('queue', () => {
  it('keeps order and takes from the front', () => {
    enqueue('c1', 'a')
    enqueue('c1', 'b')
    enqueue('c2', 'x')
    expect(queuedFor('c1').map(q => q.text)).toEqual(['a', 'b'])
    expect(takeFirst('c1')?.text).toBe('a')
    expect(queuedFor('c1').map(q => q.text)).toEqual(['b'])
    expect(queuedFor('c2').map(q => q.text)).toEqual(['x'])
    expect(takeFirst('c1')?.text).toBe('b')
    expect(takeFirst('c1')).toBeNull()
  })
  it('edits and removes by id', () => {
    const a = enqueue('c1', 'a')!
    const b = enqueue('c1', 'b')!
    editQueued('c1', b.id, 'c')
    expect(removeQueued('c1', a.id)?.text).toBe('a')
    expect(removeQueued('c1', a.id)).toBeNull()
    expect(queuedFor('c1').map(q => q.text)).toEqual(['c'])
  })
  it('holds at most 10 messages per chat', () => {
    for (let i = 0; i < QUEUE_MAX; i++) expect(enqueue('c1', `m${i}`)).not.toBeNull()
    expect(enqueue('c1', 'one more')).toBeNull()
    expect(queuedFor('c1')).toHaveLength(QUEUE_MAX)
    expect(enqueue('c2', 'other chat')).not.toBeNull()
  })
  it('stores in localStorage hm.queue.v1', () => {
    enqueue('c1', 'kept')
    const m = JSON.parse(localStorage.getItem('hm.queue.v1') || '{}')
    expect(m.c1[0].text).toBe('kept')
    expect(typeof m.c1[0].id).toBe('string')
    expect(typeof m.c1[0].at).toBe('number')
  })
  it('reads what is stored, and treats corrupt JSON as empty', () => {
    localStorage.setItem('hm.queue.v1', JSON.stringify({ c1: [{ id: 'q1', text: 'from disk', at: 1 }, { nope: true }] }))
    expect(queuedFor('c1').map(q => q.text)).toEqual(['from disk'])
    localStorage.setItem('hm.queue.v1', '{not json')
    expect(queuedFor('c1')).toEqual([])
    expect(enqueue('c1', 'fresh')).not.toBeNull()
    expect(queuedFor('c1').map(q => q.text)).toEqual(['fresh'])
  })
  it('puts a failed message back at the front and clears a deleted chat', () => {
    enqueue('c1', 'b')
    restoreFirst('c1', { id: 'q-old', text: 'a', at: 1 })
    expect(queuedFor('c1').map(q => q.text)).toEqual(['a', 'b'])
    setPaused('c1', true)
    clearQueue('c1')
    expect(queuedFor('c1')).toEqual([])
    expect(isPaused('c1')).toBe(false)
    expect(JSON.parse(localStorage.getItem('hm.queue.v1') || '{}').c1).toBeUndefined()
  })
  it('pause is in memory only', () => {
    setPaused('c1', true)
    expect(isPaused('c1')).toBe(true)
    expect(localStorage.getItem('hm.queue.v1')).toBeNull()
    setPaused('c1', false)
    expect(isPaused('c1')).toBe(false)
  })
})
