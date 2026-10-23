import { describe, expect, test } from 'vitest'
import { orderChats, recentIds } from './chatorder'

const rows = [
  { id: 'a', started_at: 300 },
  { id: 'b', started_at: 200 },
  { id: 'c', started_at: 100 }
]

describe('chat order', () => {
  test('default order is creation time, newest first, whatever the server order', () => {
    expect(orderChats([rows[2], rows[0], rows[1]], null).map(r => r.id)).toEqual(['a', 'b', 'c'])
  })
  test('a new chat goes on top', () => {
    expect(orderChats([...rows, { id: 'n', started_at: 400 }], null).map(r => r.id)).toEqual(['n', 'a', 'b', 'c'])
  })
  test('custom order keeps places; chats missing from it go on top by creation', () => {
    const extra = [...rows, { id: 'n1', started_at: 400 }, { id: 'n2', started_at: 500 }]
    expect(orderChats(extra, ['c', 'a', 'b']).map(r => r.id)).toEqual(['n2', 'n1', 'c', 'a', 'b'])
  })
  test('recentIds snapshots activity once', () => {
    const act: Record<string, number> = { a: 1, b: 9, c: 5 }
    expect(recentIds(rows, r => act[r.id])).toEqual(['b', 'c', 'a'])
  })
})
