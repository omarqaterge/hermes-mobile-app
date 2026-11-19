// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatItem } from './store'
import {
  QUOTED_MAX,
  askerOf,
  cleanNestedFeed,
  cleanStored,
  getSubAgent,
  groupWords,
  itemChanged,
  itemFields,
  listState,
  mergeEvent,
  nestedOf,
  noteEvent,
  noteItems,
  noteRoster,
  noteStored,
  plainLine,
  quotedGoal,
  resetSubAgents,
  setFeedKnownForTest,
  setNestedFeed,
  stateOf,
  subAgentsOf,
  subFoldMap,
  subGroups,
  withSubItems,
  type SubAgent,
  type SubItem
} from './subagents'
import { effortWord, firstRows, followsChat, inTreeOrder, modelShort, numbersLine, runsOn } from './subagents-view'
import { storedSteps, tailText } from './components/SubAgents'

const item = (id: string, status: string, more: Partial<SubItem> = {}): SubItem => ({ kind: 'subagent', id: `sub-${id}`, agent: id, goal: id, status, tools: 0, ...more })
const text = (id: string): ChatItem => ({ kind: 'assistant', id, text: 'words', reasoning: '', streaming: false })

beforeEach(resetSubAgents)

describe('state words and levels', () => {
  it('maps every status Hermes sends', () => {
    expect(['queued', 'running', 'completed', 'failed', 'error', 'timeout', 'interrupted'].map(s => stateOf(s, false))).toEqual(['waiting', 'working', 'done', 'failed', 'failed', 'timeout', 'stopped'])
  })
  it('never calls an unknown ending a success', () => {
    expect(stateOf('exploded', true)).toBe('failed')
    expect(stateOf(undefined, true)).toBe('done')
    expect(stateOf(7, false)).toBe('working')
  })
  it('names the level in words and does not guess one', () => {
    expect(['none', 'minimal', 'xhigh', 'max', ''].map(effortWord)).toEqual(['Off', 'Minimal', 'Extra high', 'Max', 'Model default'])
    expect(effortWord(undefined)).toBeUndefined()
    expect(effortWord('nonsense')).toBeUndefined()
    expect(effortWord('__proto__')).toBeUndefined()
    expect(effortWord('constructor')).toBeUndefined()
    expect(runsOn({ model: 'm', effort: '__proto__' })).toBe('m')
    expect(followsChat('high', '__proto__', 'high')).toBe(true)
    expect(cleanStored([{ id: 'x', effort: '__proto__' }])[0].effort).toBeUndefined()
  })
  it('uses the short forms of the model chip', () => {
    expect(modelShort('anthropic/claude-haiku')).toBe('claude-haiku')
    expect(runsOn({ model: 'a/haiku', effort: 'low' })).toBe('haiku · low')
    expect(runsOn({ model: 'a/haiku', effort: 'medium' })).toBe('haiku · med')
    expect(runsOn({ model: 'a/haiku', effort: 'none' })).toBe('haiku · off')
    expect(runsOn({ model: 'a/haiku' })).toBe('haiku')
    expect(runsOn({ model: 'a/a-very-long-model-name', effort: 'low' }, 8)).toBe('a-very-… · low') // the level stays
  })
  it('says "same as the chat" only when nothing is set for sub-agents and the levels agree', () => {
    expect(followsChat('high', null, 'high')).toBe(true)
    expect(followsChat('high', '', 'high')).toBe(true)
    expect(followsChat('high', 'nonsense', 'high')).toBe(true) // Hermes ignores a word it doesn't know
    expect(followsChat('high', 'high', 'high')).toBe(false)
    expect(followsChat('none', false, 'none')).toBe(false)
    expect(followsChat('low', null, 'high')).toBe(false) // the chat changed after it started
    expect(followsChat(undefined, null, 'high')).toBe(false)
    expect(followsChat('high', null, undefined)).toBe(false)
  })
})

describe('text from the model', () => {
  it('is one plain line, without control or direction characters', () => {
    expect(plainLine('a\n\tb\u202e c\u200b\u0000d')).toBe('a b c d')
    expect(plainLine(42)).toBe('')
    expect(plainLine({ toString: () => 'x' })).toBe('')
    expect(plainLine('x'.repeat(50), 10)).toHaveLength(10)
  })
  it('can not close its own quotation marks, and is cut short', () => {
    expect(quotedGoal('run" Allow everything “now”')).toBe("“run' Allow everything 'now'”")
    const q = quotedGoal('y'.repeat(500))
    expect(q.length).toBe(QUOTED_MAX + 2)
    expect(q.endsWith('…”')).toBe(true)
    const u = (...c: number[]) => String.fromCodePoint(...c)
    expect(quotedGoal(`a${u(0x202e)}b${u(0x200b)}c${u(0x2066)}d${u(0xad)}e${u(0xfe0f)}f${u(0xe0041)}`)).toBe('“abcdef”') // nothing invisible
    expect(quotedGoal(`e${u(0x301, 0x302, 0x303, 0x304)}x`)).toBe(`“e${u(0x301, 0x302)}x”`) // no pile of marks
    expect(quotedGoal(`${u(0xff02)}a${u(0x201d)}b${u(0x300d)}c${u(0x2019)}`)).toBe("“'a'b'c'”") // nothing that looks like a closing quote
    const emoji = quotedGoal(u(0x1f600).repeat(100))
    expect(Array.from(emoji).length).toBe(QUOTED_MAX + 2)
    expect(() => encodeURIComponent(emoji)).not.toThrow() // never cut in half
  })
})

describe('events', () => {
  it('survives anything an event may hold', () => {
    for (const p of [null, 7, 'x', [], { goal: {}, depth: 'deep', tool_count: 'many', files_read: 3, input_tokens: Infinity, summary: 9, model: [], duration_seconds: -1, parent_id: {} }]) {
      const a = mergeEvent(undefined, 'subagent.complete', p, 1)
      expect(a.goal).toBe('')
      expect(a.depth).toBe(0)
      expect(a.tools).toBe(0)
      expect(a.filesRead).toBe(0)
      expect(a.tokensIn).toBe(0)
      expect(a.summary).toBe('')
      expect(a.secs).toBe(0)
      expect(a.parent).toBeUndefined()
    }
  })
  it('keeps what it knew, follows the step, and stops taking messages at the end', () => {
    let a = mergeEvent(undefined, 'subagent.start', { subagent_id: 's', goal: 'G', model: 'm', child_session_id: 'c', depth: 1, parent_id: 'p' }, 5)
    expect(a).toMatchObject({ key: 's', id: 's', goal: 'G', child: 'c', depth: 1, parent: 'p', state: 'working', accepting: true, startedAt: 5 })
    a = mergeEvent(a, 'subagent.tool', { subagent_id: 's', tool_name: 'terminal', tool_preview: 'ls -la', tool_count: 1 }, 6)
    expect(a).toMatchObject({ step: 'ls -la', command: 'ls -la', tools: 1, goal: 'G' })
    a = mergeEvent(a, 'subagent.thinking', { subagent_id: 's', text: '(o_o) computing' }, 7)
    expect(a.step).toBe('ls -la')
    a = mergeEvent(a, 'subagent.complete', { subagent_id: 's', status: 'completed', summary: 'Done it', duration_seconds: 2, input_tokens: 10, output_tokens: 3, api_calls: 4, files_read: ['a'], files_written: ['b', 'c'] }, 8)
    expect(a).toMatchObject({ state: 'done', accepting: false, summary: 'Done it', secs: 2, startedAt: 5 })
    expect(numbersLine(a)).toBe('4 steps · 10 in · 3 out · 1 read · 2 written')
  })
  it('remembers for good that it read phone data', () => {
    let a = mergeEvent(undefined, 'subagent.tool', { subagent_id: 's', tool_name: 'phone_data' }, 1)
    a = mergeEvent(a, 'subagent.tool', { subagent_id: 's', tool_name: 'terminal' }, 2)
    expect(a.phoneData).toBe(true)
    expect(itemFields(a).phoneData).toBe(true)
  })
  it('changes the chat item only for what its group shows', () => {
    const a = noteEvent('c', 'subagent.start', { subagent_id: 's', goal: 'G' }, 1)
    const it: SubItem = { kind: 'subagent', id: 'sub-s', ...itemFields(a) }
    expect(itemChanged(it, noteEvent('c', 'subagent.tool', { subagent_id: 's', tool_preview: 'ls', tool_count: 3 }, 2))).toBe(false)
    expect(itemChanged(it, noteEvent('c', 'subagent.complete', { subagent_id: 's', status: 'failed' }, 3))).toBe(true)
  })
})

describe('the group in the chat', () => {
  it('joins items next to each other, and a nested one wherever it stands', () => {
    const items = [item('a', 'working'), item('b', 'done'), text('t'), item('a1', 'working', { parent: 'a', depth: 1 }), text('u'), item('z', 'done')]
    const g = subGroups(items)
    expect(g).toHaveLength(2)
    expect(g[0].keys).toEqual(['a', 'b', 'a1'])
    expect(g[1].keys).toEqual(['z'])
    const folds = subFoldMap(items)
    expect('head' in folds.get(0)!).toBe(true)
    expect(folds.get(1)).toEqual({ hidden: true })
    expect(folds.get(3)).toEqual({ hidden: true })
    expect(folds.has(2)).toBe(false)
  })
  it('says what is going on in one line', () => {
    expect(groupWords(subGroups([item('a', 'working'), item('b', 'working'), item('c', 'done')])[0])).toBe('3 sub-agents · 1 done')
    expect(groupWords(subGroups([item('a', 'working')])[0])).toBe('1 sub-agent')
    const end = subGroups([item('a', 'done', { started: 1000, secs: 30 }), item('b', 'failed', { started: 2000, secs: 120 })])[0]
    expect(end.failed).toBe(1)
    expect(groupWords(end)).toBe('Used 2 sub-agents · 2 min')
    expect(groupWords(subGroups([item('a', 'done')])[0])).toBe('Used 1 sub-agent')
  })
  it('reads items saved by an older version', () => {
    const old = { kind: 'subagent', id: 'sub-x', goal: 'G', status: 'completed', tools: 1 } as SubItem
    expect(subGroups([old])[0]).toMatchObject({ keys: ['x'], done: 1, running: 0 })
    noteItems('c', [old])
    expect(getSubAgent('c', 'x')?.state).toBe('done')
  })
})

describe('nesting', () => {
  const node = (key: string, order: number, more: Partial<SubAgent> = {}) => ({ key, order, depth: 0, ...more })
  it('puts each sub-agent under the one that started it', () => {
    const out = inTreeOrder([node('b', 2), node('a', 1), node('a2', 4, { parent: 'a1', depth: 2 }), node('a1', 3, { parent: 'a', depth: 1 })])
    expect(out.map(r => [r.agent.key, r.level])).toEqual([['a', 0], ['a1', 1], ['a2', 2], ['b', 0]])
  })
  it('follows the stored chat when there is no id, and the depth when the parent is unknown', () => {
    const out = inTreeOrder([node('c:1', 1, { child: '1' }), node('c:2', 2, { parentChild: '1', child: '2' }), node('lost', 3, { parent: 'gone', depth: 2 })])
    expect(out.map(r => [r.agent.key, r.level])).toEqual([['c:1', 0], ['c:2', 1], ['lost', 2]])
  })
  it('survives a chain that names itself', () => {
    const out = inTreeOrder([node('a', 1, { parent: 'b' }), node('b', 2, { parent: 'a' }), node('c', 3, { parent: 'c' })])
    expect(out.map(r => r.agent.key).sort()).toEqual(['a', 'b', 'c'])
  })
  it('shows running rows first when there are too many', () => {
    const rows = [{ agent: { state: 'done' as const }, n: 1 }, { agent: { state: 'working' as const }, n: 2 }, { agent: { state: 'failed' as const }, n: 3 }]
    expect(firstRows(rows, 2).map(r => r.n)).toEqual([2, 1])
  })
})

describe('the records', () => {
  it('counts, and tells running from finished', () => {
    noteEvent('c', 'subagent.start', { subagent_id: 'a' })
    noteEvent('c', 'subagent.start', { subagent_id: 'b' })
    noteEvent('c', 'subagent.complete', { subagent_id: 'b', status: 'timeout' })
    expect(nestedOf('c')).toMatchObject({ total: 2, running: 1, failed: 1 })
  })
  it('names the asker only when exactly one running sub-agent has that terminal command going', () => {
    const tool = (id: string, preview: string, name = 'terminal') => noteEvent('c', 'subagent.tool', { subagent_id: id, goal: id, tool_name: name, tool_preview: preview })
    tool('a', 'rm x')
    expect(askerOf('c', 'rm x')?.key).toBe('a')
    expect(askerOf('c', 'other')).toBeNull()
    expect(askerOf('c', 42)).toBeNull()
    tool('b', 'rm x')
    expect(askerOf('c', 'rm x')).toBeNull()
    noteEvent('c', 'subagent.complete', { subagent_id: 'b', status: 'completed' })
    expect(askerOf('c', 'rm x')?.key).toBe('a')
    tool('w', 'query', 'web_search')
    tool('f', '/a/file', 'write_file')
    expect(askerOf('c', 'query')).toBeNull()
    expect(askerOf('c', '/a/file')).toBeNull()
    noteEvent('c', 'subagent.thinking', { subagent_id: 'a', text: 'next' })
    expect(askerOf('c', 'rm x')).toBeNull() // that command is over
    tool('a', 'rm y')
    tool('a', 'query two', 'web_search')
    expect(askerOf('c', 'rm y')).toBeNull()
  })
  it('keeps the command through a list of who runs', () => {
    noteEvent('c', 'subagent.tool', { subagent_id: 'a', tool_name: 'terminal', tool_preview: 'rm x' })
    noteRoster('c', [{ subagent_id: 'a', goal: 'G', status: 'running' }])
    expect(askerOf('c', 'rm x')?.key).toBe('a')
  })
  it('takes only well-formed counts from the feed', () => {
    const m = cleanNestedFeed([{ session: 'c', running: 2 }, { session: 'd', running: 'x' }, { session: 5, running: 1 }, { session: 'e', running: -1 }, null, 'x'])
    expect([...m]).toEqual([['c', 2]])
    expect(cleanNestedFeed('nope').size).toBe(0)
  })
  it('takes the feed as a hint for the list only', () => {
    setFeedKnownForTest(true)
    noteEvent('c', 'subagent.start', { subagent_id: 'a' }, Date.now() - 60_000)
    setNestedFeed(new Map())
    expect(getSubAgent('c', 'a')?.state).toBe('working') // a missing entry ends nothing
    expect(nestedOf('c')).toMatchObject({ running: 0, live: 1 })
    expect(listState(getSubAgent('c', 'a')!, false)).toBe('ended')
    expect(listState(getSubAgent('c', 'a')!, true)).toBe('working')
    setNestedFeed(new Map([['forged', 9]]))
    expect(nestedOf('forged')).toMatchObject({ running: 9, live: 0, total: 9 })
  })
  it('ends a record only on its end or a list that leaves it out', () => {
    noteEvent('c', 'subagent.start', { subagent_id: 'a' }, 0)
    noteRoster('c', [{ subagent_id: 'a', status: 'running' }], 60_000)
    expect(getSubAgent('c', 'a')?.state).toBe('working')
    noteRoster('c', [], 120_000)
    expect(getSubAgent('c', 'a')?.state).toBe('ended')
  })
  it('never makes a running record from a saved item or a stored row', () => {
    noteItems('c', [item('saved', 'working')])
    expect(getSubAgent('c', 'saved')?.state).toBe('ended')
    expect(nestedOf('c').live).toBe(0)
    setNestedFeed(new Map([['c', 2]]))
    noteStored('c', [{ id: 'k', parent: 'c', goal: 'G', model: 'm', effort: 'low', started: 1, ended: 0, reason: '', steps: 1 }])
    const row = getSubAgent('c', 'c:k')!
    expect(row.state).toBe('ended')
    expect(nestedOf('c').live).toBe(0)
    expect(listState(row, true)).toBe('working') // the list may still show it as running
    expect(listState(row, false)).toBe('ended')
  })
  it('counts what the feed reports before any row is known', () => {
    setNestedFeed(new Map([['c', 3]]))
    expect(nestedOf('c')).toMatchObject({ total: 3, running: 3, live: 0, keys: [] })
  })
  it('keeps the true level from the stored chat, and only a known one', () => {
    noteEvent('c', 'subagent.start', { subagent_id: 'a', child_session_id: 'k', goal: 'G' })
    noteStored('c', cleanStored([{ id: 'k', effort: 'high' }]))
    expect(getSubAgent('c', 'a')?.effort).toBe('high')
    expect(cleanStored([{ id: 'x', effort: 'bogus' }])[0].effort).toBeUndefined()
    expect(cleanStored([{ id: 'x', effort: '' }])[0].effort).toBe('')
    expect(cleanStored([null, 3, { effort: 'low' }, { id: 7 }])).toEqual([])
    expect(cleanStored('nope')).toEqual([])
  })
  it('replaces a stored row by the live record of the same sub-agent', () => {
    noteStored('c', [{ id: 'k', parent: 'c', goal: 'G', model: 'm', effort: 'low', started: 1, ended: 0, reason: '', steps: 1 }])
    expect(subAgentsOf('c').map(a => a.key)).toEqual(['c:k'])
    noteEvent('c', 'subagent.tool', { subagent_id: 'a', child_session_id: 'k', goal: 'G' })
    expect(subAgentsOf('c').map(a => a.key)).toEqual(['a'])
    expect(getSubAgent('c', 'a')?.effort).toBe('low')
  })
  it('matches the roster to a stored row by its goal, and ends what it no longer lists', () => {
    noteStored('c', [{ id: 'k', parent: 'c', goal: 'G', model: 'm', effort: 'max', started: 1, ended: 0, reason: '', steps: 1 }])
    noteEvent('c', 'subagent.start', { subagent_id: 'old' }, 0)
    noteRoster('c', [{ subagent_id: 'a', goal: 'G', status: 'running', accepting_steer: true, started_at: 9 }, { goal: 'no id' }, null], 60_000)
    expect(getSubAgent('c', 'a')).toMatchObject({ child: 'k', effort: 'max', startedAt: 9000, accepting: true })
    expect(getSubAgent('c', 'c:k')).toBeUndefined()
    expect(getSubAgent('c', 'old')?.state).toBe('ended')
    noteRoster('c', 'nope', 120_000)
    expect(getSubAgent('c', 'a')?.state).toBe('ended')
  })
  it('puts sub-agents back after the call that started them when a chat is reopened', () => {
    const a = noteEvent('c', 'subagent.start', { subagent_id: 'a', goal: 'Do "it"', child_session_id: 'k' })
    const lost = noteEvent('c', 'subagent.start', { subagent_id: 'z', goal: 'Nobody named this' })
    const call: ChatItem = { kind: 'tool', id: 't', name: 'delegate_task', status: 'done', args: { tasks: [{ goal: 'Do "it"' }] } }
    const out = withSubItems([text('x'), call, text('y')], [a, lost])
    expect(out.map(i => i.id)).toEqual(['x', 't', 'sub-a', 'y'])
    expect(withSubItems(out, [a])).toBe(out)
    const ended = noteEvent('c', 'subagent.complete', { subagent_id: 'a', status: 'completed' })
    const next = withSubItems(out, [ended])
    expect((next[2] as SubItem).status).toBe('done') // an item follows its record, so no group shimmers for ever
  })
})

describe('what the sheet shows', () => {
  it('drops the transcript header and keeps only text', () => {
    expect(tailText('=== Hermes ===\ngoal: secret\n=====\n12:00 tool | ls\u0000\n12:01 done')).toBe('12:00 tool | ls\n12:01 done')
    expect(tailText(7)).toBe('')
    expect(tailText('line\n'.repeat(500)).split('\n').length).toBeLessThanOrEqual(60)
  })
  it('reads steps from a stored chat whatever it holds', () => {
    const s = storedSteps([
      { role: 'user', content: 'goal' },
      { role: 'assistant', content: '', tool_calls: JSON.stringify([{ function: { name: 'terminal', arguments: '{"command":"ls\\n-la"}' } }]) },
      { role: 'assistant', content: null, tool_calls: [{ function: { name: 'read', arguments: 'not json' } }, null, { function: {} }] },
      { role: 'assistant', content: 'The answer', tool_calls: 'not json' },
      null,
      7
    ])
    expect(s).toEqual({ steps: ['terminal: ls -la', 'read'], answer: 'The answer' })
    expect(storedSteps('nope')).toEqual({ steps: [], answer: '' })
  })
})
