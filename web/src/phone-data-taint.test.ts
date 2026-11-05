// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { addressOf, dropRemoteStrings, isRemoteUrl, isTaintedItems } from './phone-data-taint'
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
  it('sees through odd spellings of a remote address', () => {
    for (const s of ['https:evil.example/?d=1', 'HTTPS://evil.example', '\thttps://evil.example', 'ht\ntps://evil.example', ' //evil.example', '\\\\evil.example', 'http:/evil.example']) expect(isRemoteUrl(s)).toBe(true)
  })
  it('splits host and query', () => {
    expect(addressOf('https://evil.example:8443/p/x.png?d=1&e=2#top')).toEqual({ host: 'evil.example:8443', full: 'https://evil.example:8443/p/x.png?d=1&e=2#top', query: '?d=1&e=2' })
    expect(addressOf('http://a.example/').query).toBe('')
    expect(addressOf('//a.example/x?q=1').host).toBe('a.example')
  })
})

describe('subagents', () => {
  const sub = (phoneData?: boolean): ChatItem => ({ kind: 'subagent', id: 'sub-1', goal: 'look', status: 'running', tools: 1, ...(phoneData ? { phoneData: true } : {}) })
  it('counts only a subagent whose own events named phone_data', () => {
    expect(isTaintedItems([said('x'), sub()])).toBe(false)
    expect(isTaintedItems([said('y'), sub(true)])).toBe(true)
  })
})

describe('dropRemoteStrings', () => {
  it('empties remote addresses in a card and keeps the rest', () => {
    const code = 'root = Card([a, b, c])\na = Image("https://x.example/p.png?d=1", "alt")\nb = ImageBlock("//x.example/q.png")\nc = TextContent("hello https://x.example")'
    const out = dropRemoteStrings(code)
    expect(out).toContain('Image("", "alt")')
    expect(out).toContain('ImageBlock("")')
    expect(out).toContain('TextContent("hello https://x.example")')
    expect(out).not.toContain('p.png')
  })
  it('keeps the address of a button that opens it (the dialog shows it first)', () => {
    const code = 'go = Button("Go", @OpenUrl("https://x.example/c?d=1"), "primary")'
    expect(dropRemoteStrings(code)).toBe(code)
  })
  it('also empties addresses without slashes, in any case, with control characters or escapes', () => {
    for (const a of ['https:evil.example/?d=', 'HTTPS://evil.example', '\\thttps://evil.example', '//evil.example', '\\\\\\\\evil.example']) {
      expect(dropRemoteStrings(`a = Image("${a}")`), a).toBe('a = Image("")')
    }
  })
  it('returns the same text when nothing is remote', () => {
    const code = 'a = Image("/sdcard/a.png")'
    expect(dropRemoteStrings(code)).toBe(code)
  })
})

describe('nativeTainted', () => {
  it('asks the shell and keeps a yes', async () => {
    const { nativeTainted } = await import('./phone-data-taint')
    const calls: string[] = []
    ;(window as unknown as { HermesAndroid: unknown }).HermesAndroid = { phoneDataTainted: (id: string) => (calls.push(id), id === 'known') }
    expect(nativeTainted('known')).toBe(true)
    expect(nativeTainted('known')).toBe(true)
    expect(nativeTainted('other')).toBe(false)
    expect(nativeTainted('')).toBe(false)
    expect(calls).toEqual(['known', 'other'])
    delete (window as unknown as { HermesAndroid?: unknown }).HermesAndroid
    expect(nativeTainted('never-asked')).toBe(false)
  })
})

describe('nativeTainted failing closed', () => {
  const setBridge = (b: unknown) => ((window as unknown as { HermesAndroid?: unknown }).HermesAndroid = b)
  it('a throwing bridge method means tainted, and is asked again next time', async () => {
    const { nativeTainted } = await import('./phone-data-taint')
    let n = 0
    setBridge({
      phoneDataTainted: () => {
        n++
        throw new Error('boom')
      }
    })
    expect(nativeTainted('t-throw')).toBe(true)
    expect(nativeTainted('t-throw')).toBe(true)
    expect(n).toBe(2)
    setBridge(undefined)
  })
  it('a shell without the method: tainted only for what the page cannot judge; no shell: not tainted', async () => {
    const { nativeTainted, docTainted } = await import('./phone-data-taint')
    setBridge({})
    expect(nativeTainted('t-missing')).toBe(false)
    expect(nativeTainted('t-missing', true)).toBe(true)
    expect(docTainted('t-doc-chat')).toBe(true)
    expect(docTainted(null)).toBe(true)
    setBridge(undefined)
    expect(nativeTainted('t-none', true)).toBe(false)
    expect(docTainted('t-doc-chat')).toBe(false)
    expect(docTainted(null)).toBe(false)
  })
  it("a document is judged by its own chat and that chat's lineage; an unknown chat by whether any read was recorded", async () => {
    const { docTainted } = await import('./phone-data-taint')
    const { noteLineage } = await import('./lineage')
    noteLineage(['seg-1', 'seg-2'], 'rt-9')
    setBridge({ phoneDataTainted: (id: string) => id === 'seg-1', phoneDataAnyRead: () => false })
    expect(docTainted('seg-2')).toBe(true)
    expect(docTainted('other-chat')).toBe(false)
    expect(docTainted(null)).toBe(false)
    setBridge({ phoneDataTainted: () => false, phoneDataAnyRead: () => true })
    expect(docTainted(null)).toBe(true)
    setBridge(undefined)
  })
})
