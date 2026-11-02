// @vitest-environment happy-dom
// The /btw side chat's state: Clear empties it for good, so the next question carries no earlier side answers.
import { beforeEach, expect, test, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('./gateway', () => ({ rpc: (...a: unknown[]) => rpc(...a), errText: (e: unknown) => String(e) }))

import { askBtw, btwDone, clearBtw, closeBtw, openBtw, useBtw } from './btw'
import { setState, type ActiveSession } from './store'

// useBtw reads the module's state through useSyncExternalStore; outside React, its snapshot getter is what we need.
vi.mock('react', async orig => ({
  ...(await orig<typeof import('react')>()),
  useSyncExternalStore: (_s: unknown, get: () => unknown) => get(),
}))

const snap = () => useBtw()
let task = 0
beforeEach(() => {
  setState({ active: { runtimeId: 'rt-btw' } as ActiveSession })
  rpc.mockReset()
  rpc.mockImplementation(async () => ({ task_id: `t${++task}` }))
  openBtw()
  clearBtw()
})

test('Clear empties the side chat and the next question has no earlier answers', async () => {
  await askBtw('first?')
  expect(btwDone(`t${task}`, 'first answer')).toBe(true)
  expect(snap().msgs).toHaveLength(1)
  clearBtw()
  expect(snap().msgs).toEqual([])
  expect(snap().open).toBe(true)
  await askBtw('second?')
  expect(rpc).toHaveBeenLastCalledWith('prompt.btw', { session_id: 'rt-btw', text: 'second?' })
})

test('Clear survives closing and reopening on the same chat', async () => {
  await askBtw('q?')
  btwDone(`t${task}`, 'a')
  expect(snap().msgs).toHaveLength(1)
  clearBtw()
  closeBtw()
  openBtw()
  expect(snap().msgs).toEqual([])
})

test('an answer that arrives after Clear is dropped, not shown in the main chat or the side chat', async () => {
  await askBtw('slow?')
  const late = `t${task}`
  clearBtw()
  expect(btwDone(late, 'late answer')).toBe(true)
  expect(snap().msgs).toEqual([])
})
