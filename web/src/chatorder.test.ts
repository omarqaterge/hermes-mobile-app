import { describe, expect, test } from 'vitest'
import { activityTimes, dayLabel, frozenActivity, mergeListed, orderChats, recentIds, sameTimes } from './chatorder'

const rows = [
  { id: 'a', started_at: 300 },
  { id: 'b', started_at: 200 },
  { id: 'c', started_at: 100 }
]
const H = 3_600_000

describe('chat order', () => {
  test('without activity times the default order is creation time, newest first, whatever the server order', () => {
    expect(orderChats([rows[2], rows[0], rows[1]], null).map(r => r.id)).toEqual(['a', 'b', 'c'])
  })
  test('the default order is last activity, newest first: a chat created long ago that got a message comes first', () => {
    const act: Record<string, number> = { a: 1000, b: 2000, c: 9000 }
    expect(orderChats(rows, null, r => act[r.id]).map(r => r.id)).toEqual(['c', 'b', 'a'])
  })
  test('the same activity time falls back to the newer creation, then the id, so the order is stable', () => {
    expect(orderChats([rows[2], rows[1], rows[0]], null, () => 5).map(r => r.id)).toEqual(['a', 'b', 'c'])
    const twins = [{ id: 'y', started_at: 1 }, { id: 'x', started_at: 1 }]
    expect(orderChats(twins, null, () => 5).map(r => r.id)).toEqual(['x', 'y'])
  })
  test('a new chat goes on top', () => {
    const act = (r: { id: string; started_at?: number }) => (r.started_at || 0) * 1000
    expect(orderChats([...rows, { id: 'n', started_at: 400 }], null, act).map(r => r.id)).toEqual(['n', 'a', 'b', 'c'])
  })
  test('a custom order keeps its places whatever the activity; chats missing from it go on top by creation', () => {
    const extra = [...rows, { id: 'n1', started_at: 400 }, { id: 'n2', started_at: 500 }]
    const act: Record<string, number> = { a: 1, b: 99999, c: 5, n1: 7, n2: 3 }
    expect(orderChats(extra, ['c', 'a', 'b'], r => act[r.id]).map(r => r.id)).toEqual(['n2', 'n1', 'c', 'a', 'b'])
  })
  test('recentIds snapshots activity once', () => {
    const act: Record<string, number> = { a: 1, b: 9, c: 5 }
    expect(recentIds(rows, r => act[r.id])).toEqual(['b', 'c', 'a'])
  })
})

describe('the snapshot', () => {
  test('frozen times keep the order while the live activity changes; a chat listed after it uses its time now', () => {
    const live: Record<string, number> = { a: 3, b: 2, c: 1 }
    const snap = activityTimes(rows, r => live[r.id])
    const frozen = frozenActivity(snap, (r: { id: string }) => live[r.id])
    live.c = 100 // a reply lands in c
    expect(orderChats(rows, null, frozen).map(r => r.id)).toEqual(['a', 'b', 'c'])
    live.n = 50
    expect(orderChats([...rows, { id: 'n', started_at: 1 }], null, frozen).map(r => r.id)).toEqual(['n', 'a', 'b', 'c'])
    // The next snapshot takes the reply in.
    const next = frozenActivity(activityTimes(rows, r => live[r.id]), (r: { id: string }) => live[r.id])
    expect(orderChats(rows, null, next).map(r => r.id)).toEqual(['c', 'a', 'b'])
  })
  test('sameTimes: a snapshot with the same chats and times is the same (opening the panel then re-renders nothing)', () => {
    const a = new Map([['x', 1], ['y', 2]])
    expect(sameTimes(a, new Map([['y', 2], ['x', 1]]))).toBe(true)
    expect(sameTimes(a, new Map([['x', 1], ['y', 3]]))).toBe(false)
    expect(sameTimes(a, new Map([['x', 1]]))).toBe(false)
    expect(sameTimes(a, new Map([['x', 1], ['z', 2]]))).toBe(false)
  })
  test('mergeListed: chats already in the snapshot keep their times; older ones from a longer page join at the bottom', () => {
    const times = new Map([['a', 300], ['b', 200]])
    const live: Record<string, number> = { a: 999, b: 998, old: 50 }
    const merged = mergeListed(times, [{ id: 'a' }, { id: 'b' }, { id: 'old', started_at: 0.01 }], r => live[r.id])
    expect([...merged]).toEqual([['a', 300], ['b', 200], ['old', 50]])
  })
  test('mergeListed: an old chat that came into the page with a new message waits at its creation time, not on top', () => {
    const times = new Map([['a', 300_000], ['b', 200_000]])
    const back = { id: 'back', started_at: 100 } // created at 100 s, new message at 900 s
    const merged = mergeListed(times, [{ id: 'a' }, back, { id: 'b' }], r => (r.id === 'back' ? 900_000 : 0))
    expect(merged.get('back')).toBe(100_000)
    expect(orderChats([{ id: 'a' }, back, { id: 'b' }], null, r => merged.get(r.id)!).map(r => r.id)).toEqual(['a', 'b', 'back'])
  })
  test('mergeListed: a chat no longer listed (deleted, archived, off the page) drops out', () => {
    expect([...mergeListed(new Map([['a', 3], ['b', 2]]), [{ id: 'b' }], () => 0)]).toEqual([['b', 2]])
  })
})

describe('date groups', () => {
  const now = new Date(2026, 10, 17, 10, 0).getTime()
  test('the group follows the last activity, as of the snapshot', () => {
    expect(dayLabel(now - 1 * H, now)).toBe('Today')
    expect(dayLabel(new Date(2026, 10, 16, 23, 59).getTime(), now)).toBe('Yesterday')
    expect(dayLabel(now - 5 * 24 * H, now)).toBe('This week')
    expect(dayLabel(now - 20 * 24 * H, now)).toBe('This month')
    expect(dayLabel(now - 40 * 24 * H, now)).toBe('Older')
    expect(dayLabel(0, now)).toBe('Older')
  })
  test('a chat created long ago with a new message is under Today', () => {
    const created = { id: 'old', started_at: (now - 40 * 24 * H) / 1000 }
    const frozen = frozenActivity(new Map([['old', now - 60_000]]), () => 0)
    expect(dayLabel(frozen(created), now)).toBe('Today')
  })
})
