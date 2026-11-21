// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// When the sub-agent bundle is asked for. Its arrival shows as its <style> element; each test starts with the app's modules fresh.
vi.mock('./subagents-ui-entry', () => ({
  default: { SubGroupRows: () => null, NestedRows: () => null, SubAgentSheet: () => null, css: '' }
}))

const CHAT = 'c1'
const agent = { subagent_id: 'a', goal: 'Read the docs' }
const arrived = () => !!document.getElementById('hm-subagents-css')
const settle = () => act(async () => void (await new Promise(r => setTimeout(r, 60))))

let root: Root
async function modules() {
  vi.resetModules()
  const [core, subagents, store] = await Promise.all([import('./components/SubAgentsCore'), import('./subagents'), import('./store')])
  return { ...core, ...subagents, ...store }
}
const draw = (node: React.ReactNode) => act(async () => root.render(node))

beforeEach(() => {
  localStorage.setItem('hm.sideHidden.v1', '1') // the test page is wide: without this the list would count as docked and showing
  document.getElementById('hm-subagents-css')?.remove()
  root = createRoot(document.body.appendChild(document.createElement('div')))
})
afterEach(() => act(async () => root.unmount()))

describe('when the sub-agent bundle loads', () => {
  it('not for a chat with finished sub-agents while the list is closed; then when the list shows', async () => {
    const m = await modules()
    m.setState({ drawer: false })
    m.noteEvent(CHAT, 'subagent.complete', { ...agent, status: 'completed' })
    await draw(<m.NestedRows chat={CHAT} snapAt={0} turning={false} />)
    await settle()
    expect(arrived()).toBe(false)
    await act(async () => m.setState({ drawer: true }))
    await vi.waitFor(() => expect(arrived()).toBe(true))
  })

  it("when a chat's rows are about to open, so they are ready with the list", async () => {
    const m = await modules()
    m.setState({ drawer: false })
    m.setNestedFeed(new Map([[CHAT, 1]]))
    await draw(<m.NestedRows chat={CHAT} snapAt={0} turning={false} />)
    await vi.waitFor(() => expect(arrived()).toBe(true))
  })

  it("as soon as a group's line shows, before it can be tapped, even when nothing runs", async () => {
    const m = await modules()
    m.setState({ drawer: false })
    await draw(<m.SubGroupHead id="g" words="Used 1 sub-agent" failed={0} running={false} shimmer={false} open={false} onToggle={() => {}} />)
    await vi.waitFor(() => expect(arrived()).toBe(true))
  })
})
