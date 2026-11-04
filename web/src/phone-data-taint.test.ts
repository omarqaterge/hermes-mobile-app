// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { addressOf, isRemoteUrl, isTaintedItems } from './phone-data-taint'
import type { ChatItem } from './store'

const tool = (name: string, args: Record<string, unknown> | null = null, status: 'done' | 'error' = 'done'): ChatItem => ({ kind: 'tool', id: name + status, name, args, status })
const said = (text: string): ChatItem => ({ kind: 'assistant', id: 'a' + text, text, reasoning: '', streaming: false })

describe('isTaintedItems', () => {
  it('is false for no items and for chats with other tools', () => {
    expect(isTaintedItems(null)).toBe(false)
    expect(isTaintedItems([])).toBe(false)
    expect(isTaintedItems([said('hi'), tool('terminal'), tool('phone_app')])).toBe(false)
  })
  it('is true once a phone_data call exists, whatever its outcome', () => {
    expect(isTaintedItems([said('hi'), tool('phone_data')])).toBe(true)
    expect(isTaintedItems([tool('phone_data', { kind: 'sms' }, 'error')])).toBe(true)
  })
  it('sees a phone_data call made through the tool_call bridge', () => {
    expect(isTaintedItems([tool('tool_call', { calls: [{ name: 'read_file', arguments: {} }, { name: 'phone_data', arguments: {} }] })])).toBe(true)
    expect(isTaintedItems([tool('tool_call', { calls: [{ name: 'read_file' }] })])).toBe(false)
    expect(isTaintedItems([tool('tool_call', { calls: 'phone_data' })])).toBe(false)
  })
  it('is cheap on a long chat and follows a new array', () => {
    const long: ChatItem[] = Array.from({ length: 20000 }, (_, i) => said('m' + i))
    const t = performance.now()
    expect(isTaintedItems(long)).toBe(false)
    expect(isTaintedItems(long)).toBe(false)
    expect(performance.now() - t).toBeLessThan(200)
    expect(isTaintedItems([...long, tool('phone_data')])).toBe(true)
  })
})

describe('addresses', () => {
  it('tells remote addresses from local files and attachments', () => {
    expect(isRemoteUrl('https://x.example/a.png')).toBe(true)
    expect(isRemoteUrl('http://x.example/a.png?d=1')).toBe(true)
    expect(isRemoteUrl('//x.example/a.png')).toBe(true)
    for (const s of ['/sdcard/a.png', '~/a.png', 'file:///a.png', 'data:image/png;base64,AAAA', 'blob:abc', 'a.png']) expect(isRemoteUrl(s)).toBe(false)
  })
  it('splits host and query', () => {
    expect(addressOf('https://evil.example:8443/p/x.png?d=1&e=2#top')).toEqual({ host: 'evil.example:8443', full: 'https://evil.example:8443/p/x.png?d=1&e=2#top', query: '?d=1&e=2' })
    expect(addressOf('http://a.example/').query).toBe('')
    expect(addressOf('//a.example/x?q=1').host).toBe('a.example')
  })
})
