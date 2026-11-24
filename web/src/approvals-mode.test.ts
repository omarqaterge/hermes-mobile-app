// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.fn()
vi.mock('./api', () => ({
  api: (...args: unknown[]) => apiMock(...args)
}))

import {
  accessSummary,
  approvalsModeNote,
  autoButtonLabel,
  autoButtonText,
  currentApprovalsMode,
  defaultAccessSub,
  doneOffToast,
  isLooseApprovals,
  offOptionSub,
  parseApprovalsMode,
  readProfileConfig,
  recheckApprovalsMode,
  resetApprovalsModeForTest
} from './approvals-mode'
import { setState } from './store'
import { openSettingsOn, takeSettingsStart } from './settings-open'

describe('parseApprovalsMode', () => {
  it('reads manual, smart and off from nested or dotted config', () => {
    expect(parseApprovalsMode({ approvals: { mode: 'manual' } })).toBe('manual')
    expect(parseApprovalsMode({ approvals: { mode: 'smart' } })).toBe('smart')
    expect(parseApprovalsMode({ approvals: { mode: 'OFF' } })).toBe('off')
    expect(parseApprovalsMode({ 'approvals.mode': ' smart ' })).toBe('smart')
  })

  it('returns null for missing, invalid or non-object input', () => {
    expect(parseApprovalsMode(null)).toBeNull()
    expect(parseApprovalsMode({})).toBeNull()
    expect(parseApprovalsMode({ approvals: {} })).toBeNull()
    expect(parseApprovalsMode({ approvals: { mode: 'bogus' } })).toBeNull()
    expect(parseApprovalsMode({ approvals: { mode: 123 } })).toBeNull()
  })
})

describe('approvals mode wording', () => {
  it('uses asking wording only for confirmed manual mode', () => {
    expect(isLooseApprovals('manual')).toBe(false)
    expect(autoButtonText('off', 'manual')).toBe('Auto')
    expect(autoButtonLabel('off', 'manual')).toBe('Auto is off')
    expect(offOptionSub('manual')).toBe('Hermux asks before risky commands')
    expect(doneOffToast('manual')).toBe('Auto off: Hermux asks before risky commands again')
    expect(accessSummary('off', 'manual')).toBe('Auto off')
    expect(defaultAccessSub('off', 'manual')).toBe('Off')
  })

  it('keeps unknown / offline neutral and never implies Hermux asks', () => {
    expect(isLooseApprovals(null)).toBe(false)
    expect(autoButtonText('off', null)).toBe('Auto')
    expect(autoButtonLabel('off', null)).toBe('Auto is off')
    expect(offOptionSub(null)).not.toContain('asks before risky commands')
    expect(offOptionSub(null)).toContain('approvals setting')
    expect(doneOffToast(null)).not.toContain('asks before risky commands')
    expect(doneOffToast(null)).toContain('approvals setting')
    expect(accessSummary('off', null)).toBe('')
    expect(defaultAccessSub('off', null)).toContain('approvals setting')
  })

  it('says plainly when Hermes is in smart mode without implying every risky command asks', () => {
    expect(isLooseApprovals('smart')).toBe(true)
    expect(autoButtonText('off', 'smart')).toBe('Auto · smart')
    expect(autoButtonLabel('off', 'smart')).toContain('low-risk commands by itself')
    expect(offOptionSub('smart')).toContain('low-risk commands by itself')
    expect(offOptionSub('smart')).not.toContain('Hermux asks before risky commands')
    expect(doneOffToast('smart')).toContain('low-risk commands by itself')
    expect(accessSummary('off', 'smart')).toBe('Smart approvals')
    expect(defaultAccessSub('off', 'smart')).toContain('low-risk commands by itself')
    expect(approvalsModeNote('smart').value).toBe('Smart')
  })

  it('says plainly when Hermes approvals are off', () => {
    expect(isLooseApprovals('off')).toBe(true)
    expect(autoButtonText('off', 'off')).toBe('Approvals off')
    expect(autoButtonLabel('off', 'off')).toContain('every command without asking')
    expect(offOptionSub('off')).toContain('every command without asking')
    expect(doneOffToast('off')).toContain('every command without asking')
    expect(accessSummary('off', 'off')).toBe('Approvals off')
    expect(defaultAccessSub('off', 'off')).toContain('every command without asking')
    expect(approvalsModeNote('off').value).toBe('Off')
  })

  it('keeps chat-level Auto access and Full access labels when those are active', () => {
    for (const m of [null, 'manual', 'smart', 'off'] as const) {
      expect(autoButtonText('auto', m)).toBe('Auto')
      expect(autoButtonText('full', m)).toBe('Full access')
      expect(autoButtonLabel('auto', m)).toBe('Auto access is on')
      expect(autoButtonLabel('full', m)).toBe('Full access is on')
      expect(accessSummary('auto', m)).toBe('Auto access')
      expect(accessSummary('full', m)).toBe('Full access')
      expect(defaultAccessSub('auto', m)).toBe('Auto access')
      expect(defaultAccessSub('full', m)).toBe('Full access')
    }
  })
})

describe('approvals mode state and ordering', () => {
  beforeEach(() => {
    apiMock.mockReset()
    setState({ conn: 'open', profile: 'default' })
    resetApprovalsModeForTest()
  })

  afterEach(() => {
    resetApprovalsModeForTest()
  })

  it('never caches null on a failed read and retries on the next recheck', async () => {
    apiMock.mockResolvedValueOnce({ approvals: { mode: 'manual' } })
    await readProfileConfig('default')
    expect(currentApprovalsMode('default')).toBe('manual')

    apiMock.mockRejectedValueOnce(new Error('network'))
    await readProfileConfig('default')
    expect(currentApprovalsMode('default')).toBeNull()

    apiMock.mockResolvedValueOnce({ approvals: { mode: 'smart' } })
    recheckApprovalsMode('default')
    await vi.waitFor(() => expect(currentApprovalsMode('default')).toBe('smart'))
  })

  it('lets a newer recheck win over an earlier in-flight read', async () => {
    let resolveOld!: (v: unknown) => void
    let resolveNew!: (v: unknown) => void
    apiMock.mockImplementationOnce(() => new Promise(r => { resolveOld = r }))
    apiMock.mockImplementationOnce(() => new Promise(r => { resolveNew = r }))

    const oldRead = readProfileConfig('default')
    const newRead = readProfileConfig('default')
    resolveNew({ approvals: { mode: 'off' } })
    await newRead
    expect(currentApprovalsMode('default')).toBe('off')

    resolveOld({ approvals: { mode: 'manual' } })
    await oldRead
    expect(currentApprovalsMode('default')).toBe('off')
  })

  it('ignores a reply from before a reconnect', async () => {
    let resolvePre!: (v: unknown) => void
    apiMock.mockImplementationOnce(() => new Promise(r => { resolvePre = r }))

    const pre = readProfileConfig('default')
    setState({ conn: 'closed' })
    setState({ conn: 'open' })
    resolvePre({ approvals: { mode: 'manual' } })
    await pre
    expect(currentApprovalsMode('default')).toBeNull()
  })

  it('tracks approvals.mode independently per bot', async () => {
    apiMock.mockImplementation((_m: string, path: string) =>
      Promise.resolve({ approvals: { mode: path.includes('profile=work') ? 'smart' : 'manual' } })
    )
    await readProfileConfig('default')
    await readProfileConfig('work')
    expect(currentApprovalsMode('default')).toBe('manual')
    expect(currentApprovalsMode('work')).toBe('smart')
  })

  it('shares one in-flight request when force is false', async () => {
    let resolveCfg!: (v: unknown) => void
    apiMock.mockImplementationOnce(() => new Promise(r => { resolveCfg = r }))
    const a = readProfileConfig('default', { force: false })
    const b = readProfileConfig('default', { force: false })
    expect(apiMock).toHaveBeenCalledTimes(1)
    resolveCfg({ approvals: { mode: 'smart' } })
    await Promise.all([a, b])
    expect(currentApprovalsMode('default')).toBe('smart')
  })
})

describe('openSettingsOn over the lock screen', () => {
  afterEach(() => {
    window.hermesLockView?.(false)
    takeSettingsStart()
    setState({ screen: null })
  })

  it('does nothing in lock view and leaves no pending target for the next Settings open', () => {
    window.hermesLockView?.(true)
    openSettingsOn('config', 'close', 'approvals.mode')
    expect(takeSettingsStart()).toBeNull()
    window.hermesLockView?.(false)
    expect(takeSettingsStart()).toBeNull()
  })
})
