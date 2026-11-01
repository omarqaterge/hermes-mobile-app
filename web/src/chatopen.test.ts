import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatOpenSteps, onChatOpen, runChatOpen, type ChatOpen } from './chatopen'
import type { ActiveSession } from './store'

const chat = { runtimeId: 'rt-1', storedId: 's-1' } as ActiveSession
let removers: (() => void)[] = []
const add = (name: string, run: (o: ChatOpen) => void) => removers.push(onChatOpen(name, run))

afterEach(() => {
  removers.forEach(r => r())
  removers = []
  vi.restoreAllMocks()
})

describe('chat-open steps', () => {
  it('runs every step in the order added, with the chat and how it opened', () => {
    const seen: string[] = []
    add('a', o => seen.push(`a:${o.kind}:${o.chat.storedId}`))
    add('b', o => seen.push(`b:${o.kind}`))
    runChatOpen({ chat, kind: 'resume' })
    runChatOpen({ chat, kind: 'new' })
    expect(seen).toEqual(['a:resume:s-1', 'b:resume', 'a:new:s-1', 'b:new'])
  })

  it('adding a name again replaces that step in its place', () => {
    const seen: string[] = []
    add('a', () => seen.push('old a'))
    add('b', () => seen.push('b'))
    add('a', () => seen.push('new a'))
    expect(chatOpenSteps()).toEqual(['a', 'b'])
    runChatOpen({ chat, kind: 'new' })
    expect(seen).toEqual(['new a', 'b'])
  })

  it('a remover takes its step out, and only its own', () => {
    const seen: string[] = []
    const off = onChatOpen('a', () => seen.push('a'))
    add('b', () => seen.push('b'))
    off()
    off() // twice is harmless
    runChatOpen({ chat, kind: 'new' })
    expect(seen).toEqual(['b'])
    expect(chatOpenSteps()).toEqual(['b'])
  })

  it('a step that throws does not stop the others or the opening', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const seen: string[] = []
    add('bad', () => {
      throw new Error('boom')
    })
    add('good', () => seen.push('good'))
    expect(() => runChatOpen({ chat, kind: 'resume' })).not.toThrow()
    expect(seen).toEqual(['good'])
    expect(warn).toHaveBeenCalledWith('chat-open step bad failed', expect.any(Error))
  })

  it('a step removing itself while running does not skip the next one', () => {
    const seen: string[] = []
    let off = () => {}
    off = onChatOpen('once', () => {
      seen.push('once')
      off()
    })
    add('after', () => seen.push('after'))
    runChatOpen({ chat, kind: 'new' })
    runChatOpen({ chat, kind: 'new' })
    expect(seen).toEqual(['once', 'after', 'after'])
  })
})
