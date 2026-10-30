import { expect, test } from 'vitest'
import { currentMark, nearestMark, userMarks } from './scrub'
import type { ChatItem } from './store'

const u = (id: string, text: string, extra: Record<string, unknown> = {}) => ({ kind: 'user', id, text, ...extra }) as ChatItem
const a = (id: string) => ({ kind: 'assistant', id, text: 'x', reasoning: '', streaming: false }) as ChatItem

test('userMarks keeps only user items, with their item index', () => {
  const m = userMarks([u('1', 'one'), a('2'), u('3', 'three')])
  expect(m).toEqual([{ idx: 0, text: 'one' }, { idx: 2, text: 'three' }])
})

test('userMarks uses the first non-empty line and shortens to 80 characters', () => {
  const m = userMarks([u('1', '\n  first line  \nsecond'), u('2', 'x'.repeat(200))])
  expect(m[0].text).toBe('first line')
  expect(m[1].text.length).toBe(80)
  expect(m[1].text.endsWith('…')).toBe(true)
})

test('userMarks names attachment-only messages', () => {
  const m = userMarks([u('1', '', { imagePaths: ['/x/y/photo.jpg'] }), u('2', '', { files: ['notes.txt'] }), u('3', '', { images: ['data:'] })])
  expect(m.map(x => x.text)).toEqual(['🖼 photo.jpg', '📎 notes.txt', '🖼 photo'])
})

test('nearestMark clamps and rounds', () => {
  const marks = Array.from({ length: 11 }, (_, i) => ({ idx: i, text: String(i) }))
  expect(nearestMark(marks, 0)).toBe(0)
  expect(nearestMark(marks, 1)).toBe(10)
  expect(nearestMark(marks, 0.5)).toBe(5)
  expect(nearestMark(marks, -3)).toBe(0)
  expect(nearestMark(marks, 7)).toBe(10)
  expect(nearestMark(marks, NaN)).toBe(0)
  expect(nearestMark([{ idx: 4, text: 'a' }], 0.9)).toBe(0)
  expect(nearestMark([], 0.5)).toBe(0)
})

test('currentMark is the last mark at or above the top item', () => {
  const marks = [{ idx: 2, text: 'a' }, { idx: 6, text: 'b' }, { idx: 10, text: 'c' }]
  expect(currentMark(marks, 0)).toBe(0)
  expect(currentMark(marks, 2)).toBe(0)
  expect(currentMark(marks, 7)).toBe(1)
  expect(currentMark(marks, 10)).toBe(2)
  expect(currentMark(marks, 99)).toBe(2)
})
