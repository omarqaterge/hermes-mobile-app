// @vitest-environment happy-dom
// AutoButton.pick: reads current lockView() and currentApprovalsMode() after awaits instead of stale render values.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  setAccess: vi.fn(),
  newSession: vi.fn(),
  confirmFullAccess: vi.fn()
}))

vi.mock('./api', () => ({
  api: (...args: unknown[]) => mocks.api(...args)
}))
vi.mock('./access-confirm', () => ({
  confirmFullAccess: () => mocks.confirmFullAccess()
}))
vi.mock('./gateway', () => ({
  accessOf: (a: { info?: { yolo?: boolean }; autoAccess?: boolean } | null | undefined) => (!a?.info?.yolo ? 'off' : a.autoAccess ? 'auto' : 'full'),
  defaultAccess: () => 'off',
  errText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  newSession: () => mocks.newSession(),
  setAccess: (...args: unknown[]) => mocks.setAccess(...args),
  setDefaultAccess: vi.fn()
}))

import { AutoButton } from './components/AutoAccess'
import { readProfileConfig, resetApprovalsModeForTest } from './approvals-mode'
import { getState, setState, type ActiveSession } from './store'

const chat = (yolo: boolean): ActiveSession => ({
  runtimeId: 'rt-pick',
  storedId: 's-pick',
  profile: 'default',
  title: 'Pick test',
  info: { model: 'm', provider: 'p', yolo } as ActiveSession['info'],
  items: [],
  running: false,
  status: '',
  usage: null,
  ctx: null,
  tps: null,
  todos: [],
  openAssistantId: null,
  attachments: [],
  turnStart: null,
  goal: null
})

describe('AutoButton.pick live state after awaits', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.api.mockReset()
    mocks.setAccess.mockReset()
    mocks.newSession.mockReset()
    mocks.confirmFullAccess.mockReset()
    resetApprovalsModeForTest()
    window.hermesLockView?.(false)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    window.hermesLockView?.(false)
    resetApprovalsModeForTest()
    setState({ active: null, opening: null, toasts: [] })
  })

  it('uses the updated approvals.mode in the Off toast when mode changes during setAccess', async () => {
    setState({ conn: 'open', profile: 'default', active: chat(true), opening: null, toasts: [] })
    mocks.api.mockResolvedValueOnce({ approvals: { mode: 'manual' } })
    await readProfileConfig('default')

    let finishAccess!: (v: 'off') => void
    mocks.setAccess.mockImplementationOnce(() => new Promise<'off'>(r => { finishAccess = r }))

    await act(async () => {
      root.render(<AutoButton />)
    })
    const btn = host.querySelector('button.auto-btn') as HTMLButtonElement
    // Clicking Auto triggers recheckApprovalsMode(); make that return 'off'.
    mocks.api.mockResolvedValueOnce({ approvals: { mode: 'off' } })
    await act(async () => {
      btn.click()
    })
    const offOpt = [...host.querySelectorAll('.picker-opt')].find(el => el.textContent?.includes('Off')) as HTMLButtonElement
    expect(offOpt).toBeTruthy()
    await act(async () => {
      offOpt.click()
    })
    // Mode updates to 'smart' while setAccess is still awaiting.
    mocks.api.mockResolvedValueOnce({ approvals: { mode: 'smart' } })
    await act(async () => {
      await readProfileConfig('default')
    })

    await act(async () => {
      finishAccess('off')
      await Promise.resolve()
    })
    const lastToast = getState().toasts.at(-1)?.text || ''
    expect(lastToast).toContain('low-risk commands by itself')
    expect(lastToast).not.toContain('asks before risky commands')
  })

  it('stays neutral in the Off toast if lockView turns on during setAccess', async () => {
    setState({ conn: 'open', profile: 'default', active: chat(true), opening: null, toasts: [] })
    mocks.api.mockResolvedValueOnce({ approvals: { mode: 'off' } })
    await readProfileConfig('default')

    let finishAccess!: (v: 'off') => void
    mocks.setAccess.mockImplementationOnce(() => new Promise<'off'>(r => { finishAccess = r }))

    await act(async () => {
      root.render(<AutoButton />)
    })
    mocks.api.mockResolvedValueOnce({ approvals: { mode: 'off' } })
    await act(async () => {
      ;(host.querySelector('button.auto-btn') as HTMLButtonElement).click()
    })
    const offOpt = [...host.querySelectorAll('.picker-opt')].find(el => el.textContent?.includes('Off')) as HTMLButtonElement
    await act(async () => {
      offOpt.click()
    })
    // Phone locks while setAccess is awaiting.
    await act(async () => {
      window.hermesLockView?.(true)
    })
    await act(async () => {
      finishAccess('off')
      await Promise.resolve()
    })
    const lastToast = getState().toasts.at(-1)?.text || ''
    expect(lastToast).toContain('follows the approvals setting')
    expect(lastToast).not.toContain('every command without asking')
  })

  it('does not start a session or switch to Full access if lockView turns on during confirmFullAccess', async () => {
    setState({ conn: 'open', profile: 'default', active: null, opening: null, toasts: [] })
    mocks.api.mockResolvedValue({ approvals: { mode: 'manual' } })
    let finishConfirm!: (v: boolean) => void
    mocks.confirmFullAccess.mockImplementationOnce(() => new Promise<boolean>(r => { finishConfirm = r }))

    await act(async () => {
      root.render(<AutoButton />)
    })
    await act(async () => {
      ;(host.querySelector('button.auto-btn') as HTMLButtonElement).click()
    })
    const fullOpt = [...host.querySelectorAll('.picker-opt')].find(el => el.textContent?.includes('Full access')) as HTMLButtonElement
    await act(async () => {
      fullOpt.click()
    })
    await act(async () => {
      window.hermesLockView?.(true)
    })
    await act(async () => {
      finishConfirm(true)
      await Promise.resolve()
    })
    expect(mocks.newSession).not.toHaveBeenCalled()
    expect(mocks.setAccess).not.toHaveBeenCalled()
  })
})
