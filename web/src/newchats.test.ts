// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

vi.mock('./gateway', () => ({ startDraft: vi.fn() }))

describe('Applies to new chats', () => {
  it('says so and offers New chat, which closes the page and starts a chat', async () => {
    const { toastNewChats } = await import('./newchats')
    const { getState, setState } = await import('./store')
    const { startDraft } = await import('./gateway')
    setState({ screen: 'settings' })
    toastNewChats('Dynamic UI on')
    const t = getState().toasts.at(-1)!
    expect(t.text).toBe('Dynamic UI on. Applies to new chats.')
    expect(t.action?.label).toBe('New chat')
    t.action!.run()
    expect(getState().screen).toBe(null)
    expect(startDraft).toHaveBeenCalledOnce()
  })
  it('keeps a text that already names new chats', async () => {
    const { toastNewChats } = await import('./newchats')
    const { getState } = await import('./store')
    toastNewChats('New chats use model-x')
    expect(getState().toasts.at(-1)!.text).toBe('New chats use model-x')
  })
})
