// @vitest-environment happy-dom
// The diagnostic log's rule: free text can't get in, on any path, and the text a report may send is scrubbed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkedFields, clearMemoryEvents, logEvent, memoryEvents, noteConn, noteRpc, routeName, stackFrames } from './diaglog'
import { diagnosticsText } from './diagnostics'

const CANARIES = [
  'call my doctor about the results',
  '/sdcard/Documents/private.pdf',
  'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
  'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  'me@example.org',
  'https://example.org/a?token=x',
  'line\nbreak'
]

beforeEach(() => clearMemoryEvents())
afterEach(() => localStorage.clear())

describe('logEvent', () => {
  it('turns anything but a short code into ?', () => {
    for (const c of CANARIES) {
      clearMemoryEvents()
      logEvent('area', 'event', { field: c })
      expect(memoryEvents()[0]).toMatch(/ area event field=\?$/)
    }
    expect(checkedFields({ code: 401, ok: true, name: 'TimeoutError', v: '1.4.0+devtools', none: null })).toEqual(['code', '401', 'ok', 'true', 'name', 'TimeoutError', 'v', '1.4.0+devtools'])
  })

  it('keeps only names of the right shape', () => {
    logEvent('Bad Area', 'an event', { 'a key': 1 })
    expect(memoryEvents()[0]).toMatch(/ unknown unknown unknown=1$/)
  })

  it('allows a stack only in `at`', () => {
    expect(checkedFields({ at: 'index-abc.js:1:22,other.js:3:4' })[1]).toBe('index-abc.js:1:22,other.js:3:4')
    expect(checkedFields({ other: 'index-abc.js:1:22,other.js:3:4' })[1]).toBe('?')
    expect(checkedFields({ at: 'see /sdcard/x for me@example.org' })[1]).toBe('?')
  })

  it('writes nothing while the log is off', () => {
    localStorage.setItem('hm.diagOff', '1')
    logEvent('a', 'b')
    expect(memoryEvents()).toEqual([])
  })

  it('keeps a date and no year, and stays bounded', () => {
    for (let i = 0; i < 350; i++) logEvent('a', 'b', { n: i })
    expect(memoryEvents()).toHaveLength(300)
    expect(memoryEvents()[299]).toMatch(/^\d\d-\d\d \d\d:\d\d:\d\d a b n=349$/)
  })
})

describe('what is taken from an error', () => {
  it('keeps file places, not the words', () => {
    const e = new TypeError('Cannot read /sdcard/Documents/private.pdf for me@example.org')
    e.stack = `TypeError: Cannot read /sdcard/Documents/private.pdf for me@example.org\n    at send (file:///android_asset/assets/index-abc.js:12:34)\n    at file:///android_asset/assets/index-abc.js:56:78\n    at file:///android_asset/assets/index-abc.js:56:78`
    expect(stackFrames(e)).toBe('index-abc.js:12:34,index-abc.js:56:78')
    const msg = new Error('could not open my_private_diary.ts:12:3')
    msg.stack = `Error: could not open my_private_diary.ts:12:3\n    at run (file:///a/index-abc.js:1:2)`
    expect(stackFrames(msg)).toBe('index-abc.js:1:2')
    const inApp = new Error('x')
    inApp.stack = 'Error: x\n    at run (file:///android_asset/www/index.html:2:81234)\n    at file:///android_asset/www/index.html:2:555'
    expect(stackFrames(inApp)).toBe('index.html:2:81234,index.html:2:555')
    const noStack = new Error('words')
    noStack.stack = ''
    expect(stackFrames(noStack)).toBe('none')
  })

  it('a failed call keeps its method and code, never its words', () => {
    noteRpc('session.list', 5, Object.assign(new Error('call my doctor about the results'), { code: -32000 }))
    noteRpc('prompt.submit', 5, new TypeError('me@example.org'))
    noteRpc('session.list', 5, 'a plain string with call my doctor')
    expect(memoryEvents().map(l => l.slice(15))).toEqual([
      'rpc fail method=session.list ms=5 code=-32000',
      'rpc fail method=prompt.submit ms=5 code=TypeError',
      'rpc fail method=session.list ms=5 code=other'
    ])
  })

  it('a quick answer is not logged, a slow one is', () => {
    noteRpc('session.list', 200)
    expect(memoryEvents()).toEqual([])
    noteRpc('session.list', 12_000)
    expect(memoryEvents()[0]).toMatch(/rpc slow method=session\.list ms=12000$/)
  })

  it('an outage is two lines, however many tries it took', () => {
    noteConn('closed')
    noteConn('error')
    noteConn('closed')
    noteConn('open')
    const lines = memoryEvents().map(l => l.slice(15))
    expect(lines[0]).toBe('conn lost state=closed')
    expect(lines[1]).toMatch(/^conn open down_s=\d+ tries=3$/)
    expect(lines).toHaveLength(2)
  })

  it('a route is only its first part', () => {
    expect(routeName('/api/plugins/hermes-mobile/canvas/doc?id=My%20secret%20note')).toBe('canvas')
    expect(routeName('/api/profiles/work-private?x=1')).toBe('profiles')
    expect(routeName('/api/plugins/hermes-mobile/')).toBe('other')
    expect(routeName('/Weird/Path')).toBe('other')
  })
})

describe('the text a report may send', () => {
  const native = { enabled: true, phone: { maker: 'somemaker', api: 34 }, lines: ['11-03 12:00:00 app start version=1.4.0', '11-03 12:00:01 crash java type=RuntimeException thread=main at=MainActivity.onCreate:12'] }
  const plugin = {
    enabled: true,
    facts: { python: '3.12.1' },
    services: [{ name: 'dashboard', alive: false, log_kb: 3 }],
    crashes: [{ service: 'dashboard', type: 'ValueError', at: ['gateway/run.py:12'], count: 2 }],
    events: ['11-03 12:00:02 turn end secs=3']
  }

  it('has every section, with the phone last so a cut keeps it', () => {
    const t = diagnosticsText(native, plugin, [], [])
    expect(t.indexOf('# Agent side')).toBeLessThan(t.indexOf('# App events'))
    expect(t.indexOf('# App events')).toBeLessThan(t.indexOf('# Phone'))
    expect(t).toContain('maker=somemaker api=34')
    expect(t).toContain('at=MainActivity.onCreate:12')
    expect(t).toContain('crash service=dashboard type=ValueError count=2 at=gateway/run.py:12')
    expect(t).toContain('service name=dashboard alive=false log_kb=3')
  })

  it('a crash type of the wrong shape from the plugin is not shown', () => {
    const t = diagnosticsText(native, { ...plugin, crashes: [{ service: 'dashboard', type: 'Alice my private message', at: [], count: 1 }] }, [], [])
    expect(t).toContain('type=unknown')
    expect(t).not.toContain('Alice')
  })

  it('scrubs every section, so a line that got past the rules is still caught', () => {
    const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'
    const chat = 'please call my doctor about the results'
    const t = diagnosticsText(
      { ...native, lines: [`x ${key}`, `y ${chat}`, 'z me@example.org'] },
      { ...plugin, events: [`a ${key}`, `b ${chat}`], crashes: [] },
      [chat],
      []
    )
    expect(t).not.toContain(key)
    expect(t).not.toContain('call my doctor')
    expect(t).not.toContain('me@example.org')
  })

  it('a phone-side version survives the scrubber', () => {
    const t = diagnosticsText({ ...native, phone: { webview: '140.0.7339.207', termux: '0.118.1', android: '14' } }, null, [], [])
    expect(t).toContain('webview=140.0.7339.207 termux=0.118.1 android=14')
  })

  it('says when the agent side is missing', () => {
    expect(diagnosticsText(native, null, [], [])).toContain('Not available')
  })

  it('in a plain browser it has the memory events and no phone section', () => {
    const t = diagnosticsText(null, plugin, [], ['11-03 12:00:00 conn lost state=closed'])
    expect(t).toContain('conn lost')
    expect(t).not.toContain('# Phone')
  })

  it('stays under what the relay takes, even with every section full', () => {
    const many = Array.from({ length: 2000 }, (_, i) => `11-03 12:00:00 fill the_log number=${i} aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`)
    const t = diagnosticsText({ ...native, lines: many }, { ...plugin, events: many }, [], [])
    expect(t.length).toBeLessThanOrEqual(60_000)
    expect(t).toContain('# Phone')
    expect(t).toContain('number=1999')
  })
})
