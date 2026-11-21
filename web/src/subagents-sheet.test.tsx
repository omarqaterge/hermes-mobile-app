// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { SheetBoundary } from './components/SubAgents'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Broken(): never {
  throw new Error('a bad value')
}

describe('the sub-agent sheet', () => {
  it('keeps a failure inside the sheet', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<div><p>the chat</p><SheetBoundary><Broken /></SheetBoundary></div>))
    expect(host.textContent).toContain('the chat')
    expect(host.textContent).toContain('This sub-agent can’t be shown.')
    await act(async () => root.unmount())
    quiet.mockRestore()
  })
})
