// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// What the plugin is asked: by the chat's newest stored id after a compression (it follows a compression back, not forward).
const asked: string[] = []
vi.mock('./api', () => ({
  api: vi.fn(async (_m: string, path: string) => {
    asked.push(path)
    return { children: [{ id: 'kid-1', parent: 'new', goal: 'g', model: 'm', effort: '', started: 1, ended: 0, reason: '', messages: 1 }] }
  })
}))

const { getSubAgent, loadStored, moveChat, nestedOf, noteEvent, resetSubAgents, storedChildIds, subAgentsOf, useChatsWithAgents, useNested, useRunningChats } =
  await import('./subagents')

const start = (chat: string, id: string, goal = 'Work') => noteEvent(chat, 'subagent.start', { subagent_id: id, goal })

beforeEach(() => {
  resetSubAgents()
  asked.length = 0
})

describe('a compression gives the chat a new stored id', () => {
  it('the records move there, and the old id still finds them', () => {
    start('old', 'a')
    moveChat('old', 'new')
    expect(subAgentsOf('new').map(a => a.key)).toEqual(['a'])
    expect(nestedOf('old').live).toBe(1)
    expect(getSubAgent('old', 'a')?.goal).toBe('Work')
  })
  it('an event filed under the old id lands on the same record', () => {
    start('old', 'a')
    moveChat('old', 'new')
    noteEvent('old', 'subagent.complete', { subagent_id: 'a', goal: 'Work', status: 'completed' })
    expect(subAgentsOf('new')).toHaveLength(1)
    expect(nestedOf('new').live).toBe(0)
    expect(nestedOf('old').live).toBe(0)
  })
  it('merges with what the new id already had, keeping the record heard of last', () => {
    start('old', 'a')
    start('old', 'b')
    noteEvent('new', 'subagent.complete', { subagent_id: 'a', goal: 'Work', status: 'completed' }, Date.now() + 1000)
    start('new', 'c')
    moveChat('old', 'new')
    const keys = subAgentsOf('new').map(a => a.key).sort()
    expect(keys).toEqual(['a', 'b', 'c'])
    expect(getSubAgent('new', 'a')?.state).toBe('done')
    expect(nestedOf('old').live).toBe(2)
  })
  it('a second compression is followed too', () => {
    start('s1', 'a')
    moveChat('s1', 's2')
    moveChat('s2', 's3')
    expect(nestedOf('s1').live).toBe(1)
    expect(subAgentsOf('s3')).toHaveLength(1)
  })
  it('the chat list knows the chat by either id', async () => {
    start('old', 'a')
    moveChat('old', 'new')
    let seen: { with: ReadonlySet<string>; running: string[]; old: number } = { with: new Set(), running: [], old: 0 }
    function Probe() {
      seen = { with: useChatsWithAgents(), running: useRunningChats(), old: useNested('old').live }
      return null
    }
    const root = createRoot(document.body.appendChild(document.createElement('div')))
    await act(async () => root.render(<Probe />))
    expect(seen.with.has('old') && seen.with.has('new')).toBe(true)
    expect(seen.running).toEqual(expect.arrayContaining(['old', 'new']))
    expect(seen.old).toBe(1)
    await act(async () => void noteEvent('old', 'subagent.complete', { subagent_id: 'a', goal: 'Work', status: 'completed' }))
    expect(seen.old).toBe(0)
    await act(async () => root.unmount())
  })
  it('Hermes is asked by the newest id', async () => {
    moveChat('old', 'new')
    start('new', 'a')
    await loadStored('old', 'default')
    expect(asked.at(-1)).toContain('session=new')
    expect([...(await storedChildIds('old', 'default'))!]).toEqual(['kid-1'])
    expect(asked.at(-1)).toContain('session=new')
  })
})
