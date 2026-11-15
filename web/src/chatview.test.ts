// chatview.ts: which chat the screen shows, from the store's `opening`, `preview` and `active`.
import { describe, expect, test } from 'vitest'
import { screenChat, shownItems, shownKey, shownTitle, viewKind, viewSettled } from './chatview'
import type { ActiveSession, AppState, ChatItem } from './store'

const msg = (id: string): ChatItem => ({ kind: 'user', id, text: id })
const chat = (storedId: string, items: ChatItem[] = [msg(`${storedId}-1`)]) => ({ storedId, title: `Title ${storedId}`, items }) as ActiveSession
const sessions = [{ id: 'a', title: 'Listed A' }, { id: 'b', title: 'Listed B' }] as AppState['sessions']
const state = (p: Partial<Pick<AppState, 'opening' | 'preview' | 'active'>>) => ({ opening: null, preview: null, active: null, sessions, ...p })

const A = chat('a')
const previewB = { storedId: 'b', title: 'Seen B', items: [msg('b-old')] }

describe('the kinds', () => {
  test('nothing open is the new-chat screen', () => {
    const s = state({})
    expect(viewKind(s)).toBe('home')
    expect(viewSettled(s)).toBe(true)
    expect(screenChat(s)).toBe('')
    expect(shownItems(s)).toBeNull()
    expect(shownKey(s)).toBeUndefined()
    expect(shownTitle(s)).toBe('')
  })

  test('an open chat shows itself', () => {
    const s = state({ active: A })
    expect(viewKind(s)).toBe('open')
    expect(viewSettled(s)).toBe(true)
    expect(screenChat(s)).toBe('a')
    expect(shownItems(s)).toBe(A.items)
    expect(shownKey(s)).toBe('a')
    expect(shownTitle(s)).toBe('Title a')
  })

  test('a chat reloading after a reconnect stays open and usable', () => {
    const s = state({ active: A, opening: 'a' })
    expect(viewKind(s)).toBe('open')
    expect(viewSettled(s)).toBe(true)
    expect(shownItems(s)).toBe(A.items)
  })

  test('a chat reloading with nothing to show yet is the skeleton', () => {
    expect(viewKind(state({ active: chat('a', []), opening: 'a' }))).toBe('loading')
  })

  test('at a cold start the last chat opens with nothing behind it', () => {
    const s = state({ opening: 'b' })
    expect(viewKind(s)).toBe('loading')
    expect(viewSettled(s)).toBe(false)
    expect(screenChat(s)).toBe('b')
    expect(shownTitle(s)).toBe('Listed B')
  })
})

describe('one chat opening over another', () => {
  test('with a preview: everything shown is the new chat as last seen', () => {
    const s = state({ active: A, opening: 'b', preview: previewB })
    expect(viewKind(s)).toBe('preview')
    expect(viewSettled(s)).toBe(false)
    expect(screenChat(s)).toBe('b')
    expect(shownItems(s)).toBe(previewB.items)
    expect(shownKey(s)).toBe('b')
    expect(shownTitle(s)).toBe('Seen B')
  })

  test('without a preview: the skeleton, under the new chat\'s title and not the one being left', () => {
    const s = state({ active: A, opening: 'b' })
    expect(viewKind(s)).toBe('loading')
    expect(viewSettled(s)).toBe(false)
    expect(screenChat(s)).toBe('b')
    expect(shownTitle(s)).toBe('Listed B')
  })

  test('a preview kept for another chat does not count', () => {
    const s = state({ active: A, opening: 'c', preview: previewB })
    expect(viewKind(s)).toBe('loading')
    expect(shownTitle(s)).toBe('')
  })

  test('a preview left over once the chat is open is ignored', () => {
    const s = state({ active: A, preview: previewB })
    expect(viewKind(s)).toBe('open')
    expect(shownItems(s)).toBe(A.items)
  })
})
