// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type { ChatItem } from './store'
import { metaSecs, thoughtSecs, trackThought, turnFoldMap, turnWorks, wholeTime, workLabel } from './turnfold'

const user = (id: string, at?: number): ChatItem => ({ kind: 'user', id, text: 'do it', at })
const tool = (id: string, status: 'done' | 'error' | 'running' = 'done', name = 'terminal', duration = 2): ChatItem => ({ kind: 'tool', id, name, status, duration })
const reply = (id: string, text: string, extra: Partial<Extract<ChatItem, { kind: 'assistant' }>> = {}): ChatItem => ({ kind: 'assistant', id, text, reasoning: '', streaming: false, ...extra })
const sub = (id: string, status: string): ChatItem => ({ kind: 'subagent', id, goal: 'g', status, tools: 0 })

describe('turnWorks', () => {
  it('folds everything before a finished turn’s answer', () => {
    const items = [user('u1'), reply('a0', '', { reasoning: 'hm' }), tool('t1'), reply('a1', 'Let me look.'), tool('t2'), reply('a2', 'Done.', { meta: '~41 tok/s · 1m 20s' })]
    const [w] = turnWorks(items, false)
    expect(w).toMatchObject({ key: 'u1', head: 1, members: [1, 2, 3, 4], final: 5, steps: 2, failed: 0, secs: 80 })
    expect(workLabel(w)).toBe('Worked 1m 20s · 2 steps')
  })

  it('never folds the turn that is running, and folds it once finished', () => {
    const items = [user('u1'), tool('t1'), tool('t2'), reply('a1', 'Done.')]
    expect(turnWorks(items, true)).toHaveLength(0)
    expect(turnWorks(items, false)).toHaveLength(1)
    // An earlier turn folds while a later one runs.
    expect(turnWorks([...items, user('u2'), tool('t3')], true).map(w => w.key)).toEqual(['u1'])
  })

  it('does not fold a turn with a step still live (a detached sub-agent)', () => {
    expect(turnWorks([user('u1'), tool('t1'), sub('s1', 'running'), reply('a1', 'Started them.')], false)).toHaveLength(0)
    expect(turnWorks([user('u1'), tool('t1'), sub('s1', 'completed'), reply('a1', 'Done.')], false)).toHaveLength(1)
    expect(turnWorks([user('u1'), tool('t1'), tool('t2'), reply('a1', 'Done.'), sub('s1', 'running')], false)).toHaveLength(0)
  })

  it('counts failed steps and names the first one', () => {
    const [w] = turnWorks([user('u1'), tool('t1'), tool('t2', 'error'), sub('s1', 'failed'), reply('a1', 'Partly.')], false)
    expect(w.failed).toBe(2)
    expect(w.firstFailed).toBe(2)
  })

  it('leaves out turns without an answer, and a single line of work with no thought', () => {
    expect(turnWorks([user('u1'), tool('t1'), tool('t2')], false)).toHaveLength(0)
    expect(turnWorks([user('u1'), tool('t1'), reply('a1', 'Done.')], false)).toHaveLength(0)
    expect(turnWorks([user('u1'), tool('t1'), reply('a1', 'Done.', { reasoning: 'thought' })], false)).toHaveLength(1)
    expect(turnWorks([user('u1'), reply('a0', 'Thinking aloud.'), reply('a1', 'Done.', { reasoning: 'x' })], false)).toHaveLength(0)
  })

  it('keeps what a person acts on outside: notices, canvas documents, pictures, cards and files', () => {
    const items: ChatItem[] = [
      user('u1'),
      tool('t1'),
      { kind: 'notice', id: 'n1', text: 'Steered', level: 'info' },
      tool('c1', 'done', 'canvas'),
      tool('i1', 'done', 'image_generate'),
      reply('a1', 'Here: ![chart](/tmp/c.png)'),
      reply('a2', '```openui\nx\n```'),
      reply('a3', 'MEDIA:/root/out.pdf'),
      tool('t2'),
      reply('a4', 'Done.')
    ]
    const [w] = turnWorks(items, false)
    expect(w.members).toEqual([1, 8])
    expect(w.steps).toBe(2)
  })

  it('takes the time from the reply’s stats, else the clock, else the tools', () => {
    expect(turnWorks([user('u1', 1000), tool('t1'), tool('t2'), reply('a1', 'x', { at: 13000 })], false)[0].secs).toBe(12)
    expect(turnWorks([user('u1'), tool('t1', 'done', 'terminal', 3), tool('t2', 'done', 'terminal', 4), reply('a1', 'x')], false)[0].secs).toBe(7)
    expect(workLabel({ secs: 0, steps: 1 })).toBe('Worked through 1 step')
  })
})

describe('turnFoldMap', () => {
  const items = [user('u1'), tool('t1'), tool('t2'), reply('a1', 'Done.', { reasoning: 'r' }), user('u2'), tool('t3'), tool('t4'), reply('a2', 'Done.')]
  const works = turnWorks(items, false)

  it('closes every finished turn by default: the line on the first step, the rest hidden, the answer’s thought too', () => {
    const f = turnFoldMap(works, new Map(), null)
    expect([...f.heads.keys()]).toEqual([1, 5])
    expect([...f.hidden]).toEqual([1, 2, 5, 6])
    expect(f.quiet.has(3)).toBe(true)
    expect(f.byIndex.get(2)?.key).toBe('u1')
  })

  it('opens a turn chosen open; a settling or later turn draws as it did, with no line', () => {
    const f = turnFoldMap(works, new Map<string, boolean | 'later'>([['u1', true], ['u2', 'later']]), null)
    expect(f.heads.get(1)?.open).toBe(true)
    expect(f.heads.has(5)).toBe(false)
    expect(f.hidden.size).toBe(0)
    expect(turnFoldMap(works, new Map(), 'u2').heads.has(5)).toBe(false)
  })
})

describe('numbers', () => {
  it('reads the stats’ duration', () => {
    expect(metaSecs('~41 tok/s · 1m 23s')).toBe(83)
    expect(metaSecs('20 tok/s · 3.2s')).toBe(3.2)
    expect(metaSecs('~41 tok/s')).toBe(0)
    expect(metaSecs(undefined)).toBe(0)
  })
  it('writes whole seconds', () => {
    expect(wholeTime(0.3)).toBe('1s')
    expect(wholeTime(12.4)).toBe('12s')
    expect(wholeTime(80)).toBe('1m 20s')
  })
})

describe('trackThought', () => {
  it('measures a thought from its first words to the reply’s text', () => {
    const r = (text: string, streaming = true) => [user('u1'), reply('a1', text, { reasoning: 'thinking', streaming })]
    trackThought(r(''), 1000)
    trackThought(r(''), 5000)
    expect(thoughtSecs('a1')).toBeUndefined()
    trackThought(r('Answer'), 13000)
    expect(thoughtSecs('a1')).toBe(12)
  })
  it('ends a thought when its part closes (a tool call follows)', () => {
    trackThought([user('u1'), reply('b1', '', { reasoning: 'x', streaming: true })], 0)
    trackThought([user('u1'), reply('b1', '', { reasoning: 'x', streaming: false }), tool('t1', 'running')], 4000)
    expect(thoughtSecs('b1')).toBe(4)
  })
})
