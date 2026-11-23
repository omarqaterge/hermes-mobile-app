// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  accessSummary,
  approvalsModeNote,
  autoButtonLabel,
  autoButtonText,
  defaultAccessSub,
  doneOffToast,
  isLooseApprovals,
  offOptionSub,
  parseApprovalsMode
} from './approvals-mode'

describe('parseApprovalsMode', () => {
  it('reads manual, smart and off from nested or dotted config', () => {
    expect(parseApprovalsMode({ approvals: { mode: 'manual' } })).toBe('manual')
    expect(parseApprovalsMode({ approvals: { mode: 'smart' } })).toBe('smart')
    expect(parseApprovalsMode({ approvals: { mode: 'OFF' } })).toBe('off')
    expect(parseApprovalsMode({ approvals: { mode: '  Smart ' } })).toBe('smart')
    expect(parseApprovalsMode({ 'approvals.mode': 'smart' })).toBe('smart')
  })

  it('returns null for missing, invalid or non-object input', () => {
    expect(parseApprovalsMode(null)).toBeNull()
    expect(parseApprovalsMode(undefined)).toBeNull()
    expect(parseApprovalsMode({})).toBeNull()
    expect(parseApprovalsMode({ approvals: {} })).toBeNull()
    expect(parseApprovalsMode({ approvals: { mode: 'yolo' } })).toBeNull()
    expect(parseApprovalsMode({ approvals: { mode: 1 } })).toBeNull()
  })
})

describe('approvals mode wording', () => {
  it('keeps manual and unknown quiet and unchanged', () => {
    for (const m of ['manual', null] as const) {
      expect(isLooseApprovals(m)).toBe(false)
      expect(autoButtonText('off', m)).toBe('Auto')
      expect(autoButtonLabel('off', m)).toBe('Auto is off')
      expect(offOptionSub(m)).toBe('Hermux asks before risky commands')
      expect(doneOffToast(m)).toBe('Auto off: Hermux asks before risky commands again')
      expect(accessSummary('off', m)).toBe('Auto off')
      expect(defaultAccessSub('off', m)).toBe('Off')
    }
  })

  it('says plainly when Hermes is in smart mode without implying every risky command asks', () => {
    expect(isLooseApprovals('smart')).toBe(true)
    expect(autoButtonText('off', 'smart')).toBe('Auto · smart')
    expect(autoButtonLabel('off', 'smart')).toContain('low-risk commands by itself')
    expect(offOptionSub('smart')).toContain('low-risk commands by itself')
    expect(offOptionSub('smart')).not.toBe('Hermux asks before risky commands')
    expect(doneOffToast('smart')).toContain('low-risk commands by itself')
    expect(accessSummary('off', 'smart')).toBe('Smart approvals')
    expect(defaultAccessSub('off', 'smart')).toContain('low-risk commands by itself')
    expect(approvalsModeNote('smart')).toMatchObject({ title: 'Hermes approvals mode', value: 'Smart' })
    expect(approvalsModeNote('smart').sub).toContain('approvals.mode')
  })

  it('says plainly when Hermes approvals are off', () => {
    expect(isLooseApprovals('off')).toBe(true)
    expect(autoButtonText('off', 'off')).toBe('Approvals off')
    expect(autoButtonLabel('off', 'off')).toContain('approves every command')
    expect(offOptionSub('off')).toContain('approves every command')
    expect(doneOffToast('off')).toContain('approves every command')
    expect(accessSummary('off', 'off')).toBe('Approvals off')
    expect(defaultAccessSub('off', 'off')).toContain('approves every command')
    expect(approvalsModeNote('off')).toMatchObject({ title: 'Hermes approvals mode', value: 'Off' })
    expect(approvalsModeNote('off').sub).toContain('approvals.mode')
  })

  it('keeps chat-level Auto access and Full access labels when those are active', () => {
    expect(autoButtonText('auto', 'smart')).toBe('Auto')
    expect(autoButtonText('full', 'off')).toBe('Full access')
    expect(autoButtonLabel('auto', 'smart')).toBe('Auto access is on')
    expect(autoButtonLabel('full', 'off')).toBe('Full access is on')
    expect(accessSummary('auto', 'smart')).toBe('Auto access')
    expect(accessSummary('full', 'off')).toBe('Full access')
    expect(defaultAccessSub('auto', 'smart')).toBe('Auto access')
    expect(defaultAccessSub('full', 'off')).toBe('Full access')
  })
})
