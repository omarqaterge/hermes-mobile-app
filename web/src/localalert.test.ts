// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_ALERT_TEXT, TRY_LIMIT_MS, localAlert, onLocalAlert, parseLocalAlert, tryAgain } from './localalert'
import { setState } from './store'

describe('local authentication alert', () => {
  beforeEach(() => onLocalAlert(null))

  it('takes only the closed set of kinds, and null for none', () => {
    expect(parseLocalAlert('dashboard')).toBe('dashboard')
    expect(parseLocalAlert('events')).toBe('events')
    expect(parseLocalAlert(null)).toBeNull()
    for (const v of [undefined, '', 'Dashboard', 'dashboard ', 'ticker', '<b>x</b>', 0, 1, true, {}, [], ['dashboard'], () => 'dashboard', Symbol('x')])
      expect(parseLocalAlert(v)).toBeUndefined()
  })

  it('the shell callback is installed on window and shows a kind', () => {
    expect(typeof window.__hmLocalAlert).toBe('function')
    window.__hmLocalAlert!('dashboard')
    expect(localAlert()).toBe('dashboard')
    window.__hmLocalAlert!('events')
    expect(localAlert()).toBe('events')
  })

  it('ignores anything else, without throwing, and keeps what it shows', () => {
    onLocalAlert('dashboard')
    const bad: unknown[] = [undefined, 'x', 42, {}, { toString: () => 'events' }, Symbol('s'), new Proxy({}, { get: () => { throw new Error('no') } })]
    for (const v of bad) expect(() => onLocalAlert(v)).not.toThrow()
    expect(localAlert()).toBe('dashboard')
  })

  it('clears on null, and repeated calls change nothing', () => {
    for (let i = 0; i < 50; i++) onLocalAlert('events')
    expect(localAlert()).toBe('events')
    onLocalAlert(null)
    onLocalAlert(null)
    expect(localAlert()).toBeNull()
  })

  it('never logs the argument', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => {}))
    onLocalAlert('dashboard')
    onLocalAlert('not-a-kind')
    onLocalAlert(null)
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled()
      s.mockRestore()
    }
  })

  it('only the shell clears it: the connection opening after an alert leaves it on', () => {
    // The shell cleared (a token verified), a later hello failed and the alert came on before the socket opened.
    setState({ conn: 'connecting' })
    onLocalAlert(null)
    onLocalAlert('dashboard')
    setState({ conn: 'open' })
    expect(localAlert()).toBe('dashboard')
    setState({ conn: 'closed' })
    setState({ conn: 'open' })
    expect(localAlert()).toBe('dashboard')
    onLocalAlert('events')
    setState({ conn: 'closed' })
    setState({ conn: 'open' })
    expect(localAlert()).toBe('events')
    onLocalAlert(null)
    expect(localAlert()).toBeNull()
  })

  it('Try again runs one try at a time', async () => {
    let finish = (): void => {}
    const run = vi.fn(() => new Promise<void>(r => (finish = r)))
    const first = tryAgain(run)
    void tryAgain(run)
    void tryAgain(run)
    await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(1)
    finish()
    await first
    await tryAgain(async () => {})
    const again = tryAgain(run)
    await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(2)
    finish()
    await again
  })

  it('a failed or stuck try ends, so the next tap tries again', async () => {
    await tryAgain(() => Promise.reject(new Error('no')))
    await tryAgain(() => {
      throw new Error('sync')
    })
    const ran = vi.fn(async () => {})
    await tryAgain(ran)
    expect(ran).toHaveBeenCalledTimes(1)

    vi.useFakeTimers()
    try {
      const stuck = tryAgain(() => new Promise(() => {}))
      const blocked = vi.fn(async () => {})
      await tryAgain(blocked)
      expect(blocked).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(TRY_LIMIT_MS)
      await stuck
      await tryAgain(blocked)
      expect(blocked).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('has the fixed texts, and Try again only for the dashboard', () => {
    expect(LOCAL_ALERT_TEXT.dashboard.title).toBe('Hermux stopped talking to Hermes')
    expect(LOCAL_ALERT_TEXT.dashboard.body).toBe('Something else on this phone answered instead of Hermes, so Hermux sent it nothing. Restart the phone to fix it.')
    expect(LOCAL_ALERT_TEXT.dashboard.more).toBe('If this comes back, an app installed recently may be the cause.')
    expect(LOCAL_ALERT_TEXT.events.title).toBe("Hermux can't hear from Hermes")
    expect(LOCAL_ALERT_TEXT.events.body).toBe('Another app on this phone is using the connection Hermux listens on. Restart the phone to fix it.')
    expect(LOCAL_ALERT_TEXT.dashboard.retry).toBe(true)
    expect(LOCAL_ALERT_TEXT.events.retry).toBe(false)
  })
})
