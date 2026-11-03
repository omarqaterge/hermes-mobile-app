// @vitest-environment happy-dom
// Report a problem: the log scrubber, the GitHub fallback link, and sending through the relay.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fallbackUrl, issueText, removeChatText, REPORT_REPO, scrubLog, sendReport, type Report } from './report'

const details = { app: '1.4.0', android: '14', hermes: 'v0.21.5' }

describe('scrubLog', () => {
  it('removes tokens and keys', () => {
    const out = scrubLog(
      [
        'auth failed: Bearer abc.def-123',
        'key sk-ant-api03-ABCDEFGHIJKLMNOPQRST used',
        'github ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
        'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N',
        'token=abcdef123456 next',
        'api_key: "my secret value"',
        'AIzaSyA-1234567890abcdefghijklmnopqrstu'
      ].join('\n')
    )
    for (const leak of ['abc.def-123', 'sk-ant', 'ghp_', 'eyJhbGci', 'abcdef123456', 'my secret value', 'AIzaSy']) expect(out).not.toContain(leak)
    expect(out).toContain('Bearer [token]')
    expect(out).toContain('token=[removed]')
  })

  it('removes secrets under longer names and in other forms', () => {
    const out = scrubLog(
      [
        'access_token=abcdef123456',
        '{"refresh_token":"abc123def"}',
        'client_secret=abc123',
        'GITHUB_TOKEN=abc123',
        'authorization=abc123',
        'Authorization: Basic dXNlcjpwYXNz',
        'bot123456789:AAHabcdefghijklmnopqrstuvwxyz012345 failed',
        'AKIAABCDEFGHIJKLMNOP',
        'gsk_abcdefghijklmnopqrstuvwx',
        'https://hooks.slack.com/services/T000/B000/abcdefghijklmnopqrstuvwx'
      ].join('\n')
    )
    for (const leak of ['abcdef123456', 'abc123', 'dXNlcjpwYXNz', 'AAHabc', 'AKIA', 'gsk_', 'abcdefghijklmnopqrstuvwx']) expect(out).not.toContain(leak)
    expect(out).toContain('https://hooks.slack.com/services/T000/B000/[removed]')
  })

  it('removes emails, IP addresses and URL queries, but keeps the loopback address', () => {
    const out = scrubLog('mail me@example.org from 192.168.1.20 and fe80::1c2:3ff and 2001:db8:85a3:0:0:8a2e:370:7334\nGET https://user:pw@api.example.com/v1/x?key=SECRET#frag\nws://127.0.0.1:9119/api/ws?token=t0k')
    expect(out).not.toMatch(/me@example|192\.168|fe80|2001:db8|SECRET|user:pw|t0k/)
    expect(out).toContain('[email]')
    expect(out).toContain('https://api.example.com/v1/x?[removed]')
    expect(out).toContain('ws://127.0.0.1:9119/api/ws?[removed]')
  })

  it('keeps times of day', () => {
    expect(scrubLog('12:30:45 conn closed')).toBe('12:30:45 conn closed')
  })

  it('replaces home and storage paths, and the phone model', () => {
    const out = scrubLog('open /data/data/com.termux/files/home/notes/a.md\n/home/alex/x and /Users/alex/y\n/storage/emulated/0/Download/z.png\nMozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A) Chrome\n(Linux; U; Android 9; SM-G960F)')
    expect(out).not.toMatch(/alex|Pixel|SM-G960F|com\.termux\/files\/home|emulated|a\.md|z\.png/)
    expect(out).toContain('open ~\n')
    expect(out).toContain('[storage]\n')
    expect(out).toContain('(Linux; Android)')
  })

  it('removes chat text and long quoted text', () => {
    const chat = ['Please book a table for two at Luigi’s on Friday', 'short']
    const out = scrubLog('error sending "Please book a table for two at Luigi’s on Friday"\nwarn parse failed for \'a long quoted message that might be private\'\nshort stays', chat)
    expect(out).not.toMatch(/Luigi|might be private/)
    expect(out).toContain('short stays')
  })

  it('removes chat text however the log holds it', () => {
    const long = 'Please remember the appointment with my doctor '.repeat(12).trim()
    expect(scrubLog(`warn ${JSON.stringify(long).slice(0, 300)}`, [long])).toBe('warn "[chat text]')
    expect(scrubLog('sent call  my doctor   today', ['call my doctor today'])).toBe('sent [chat text]')
    expect(scrubLog('sent {"text":"say \\"hello there\\" to him"}', ['say "hello there" to him'])).toBe('sent {"text":"[chat text]"}')
    expect(removeChatText('a line\nkeep this', [])).toBe('a line\nkeep this')
  })

  it('removes long IDs and encoded data', () => {
    const out = scrubLog(`session ${'ab12'.repeat(10)} data ${'QUJD'.repeat(15)}==`)
    expect(out).toBe('session [id] data [data]')
  })
})

describe('fallbackUrl', () => {
  const report = (extra: Partial<Report> = {}): Report => ({ title: 'Voice stops', text: 'It stops after a second.', details, ...extra })

  it('fills GitHub’s new-issue page with the title, text and versions', () => {
    const url = new URL(fallbackUrl(report()))
    expect(`${url.origin}${url.pathname}`).toBe(`https://github.com/${REPORT_REPO}/issues/new`)
    expect(url.searchParams.get('title')).toBe('Voice stops')
    const body = url.searchParams.get('body')!
    expect(body).toContain('It stops after a second.')
    expect(body).toContain('- App: 1.4.0\n- Android: 14\n- Hermux agent: v0.21.5')
  })

  it('stays under the link length limit by dropping the oldest log lines first', () => {
    const log = Array.from({ length: 400 }, (_, i) => `12:00:00 warn line ${i} ${'x'.repeat(40)}`).join('\n')
    const url = fallbackUrl(report({ log }))
    expect(url.length).toBeLessThanOrEqual(7500)
    const body = new URL(url).searchParams.get('body')!
    expect(body).toContain('line 399')
    expect(body).not.toContain('line 0 ')
    expect(body).toContain('It stops after a second.')
  })

  it('cuts a text too long for a link and says so', () => {
    const url = fallbackUrl(report({ text: 'é'.repeat(6000), log: 'a\nb' }))
    expect(url.length).toBeLessThanOrEqual(7500)
    const body = new URL(url).searchParams.get('body')!
    expect(body).toContain('didn’t fit in the link')
    expect(body).toContain('- Hermux agent: v0.21.5')
  })

  it('survives text cut in the middle of an emoji', () => {
    for (let n = 1000; n < 1400; n += 7) {
      const url = fallbackUrl(report({ text: '😀'.repeat(n) }))
      expect(url.length).toBeLessThanOrEqual(7500)
    }
    expect(() => fallbackUrl(report({ log: `12:00:00 warn \uD83D` }))).not.toThrow()
  })

  it('carries a note, such as attaching the screenshot by hand', () => {
    expect(new URL(fallbackUrl(report(), 'NOTE')).searchParams.get('body')).toContain('NOTE')
  })

  it('keeps the log inside its code block', () => {
    const body = issueText(report({ log: 'a\n```\nb' }))
    expect(body.match(/^```/gm)?.length).toBe(2)
  })
})

describe('sendReport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })
  const r: Report = { title: 't', text: 'x', details }

  it('falls back without a relay URL, and sends nothing', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await sendReport(r)).toEqual({ kind: 'fallback', why: 'no-relay' })
    expect(f).not.toHaveBeenCalled()
  })

  it('returns the issue link, or why it fell back', async () => {
    sessionStorage.setItem('hm.devReportUrl', 'https://relay.test/')
    const answer = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
    answer(201, { url: `https://github.com/${REPORT_REPO}/issues/3`, screenshot: false })
    expect(await sendReport(r)).toEqual({ kind: 'sent', url: `https://github.com/${REPORT_REPO}/issues/3`, screenshot: false, log: false })
    answer(429, {})
    expect(await sendReport(r)).toEqual({ kind: 'fallback', why: 'limit' })
    answer(502, { error: 'x' })
    expect(await sendReport(r)).toEqual({ kind: 'fallback', why: 'failed' })
    answer(201, { url: 'https://evil.example/' }) // only a link to this repository's issues is shown
    expect(await sendReport(r)).toEqual({ kind: 'fallback', why: 'failed' })
  })

  it('sends a random install ID and nothing that names the phone', async () => {
    sessionStorage.setItem('hm.devReportUrl', 'https://relay.test/')
    const f = vi.fn(async () => new Response('{}', { status: 500 }))
    vi.stubGlobal('fetch', f)
    await sendReport(r)
    const sent = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(sent.installId).toMatch(/^[0-9a-f]{32}$/)
    expect(Object.keys(sent).sort()).toEqual(['details', 'installId', 'text', 'title'])
    expect(Object.keys(sent.details).sort()).toEqual(['android', 'app', 'hermes'])
  })
})
