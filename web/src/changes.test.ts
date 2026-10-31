import { describe, expect, it } from 'vitest'
import { diffCounts, shortPath, turnChanges } from './changes'
import type { ChatItem } from './store'

const user = (id: string): ChatItem => ({ kind: 'user', id, text: id })
const asst = (id: string): ChatItem => ({ kind: 'assistant', id, text: 'x', reasoning: '', streaming: false })
const tool = (id: string, name: string, args: Record<string, unknown> | null, inlineDiff?: string, status: 'done' | 'error' = 'done'): ChatItem => ({
  kind: 'tool',
  id,
  name,
  args,
  status,
  inlineDiff
})
const D1 = '--- a/a.txt\n+++ b/a.txt\n@@ -0,0 +1,2 @@\n+x\n+y'
const D2 = '--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-old\n+new'

describe('diffCounts', () => {
  it('ignores file and hunk headers', () => {
    expect(diffCounts(D1)).toEqual({ added: 2, removed: 0 })
    expect(diffCounts(D2)).toEqual({ added: 1, removed: 1 })
  })
})

describe('turnChanges', () => {
  it('keys a turn with edits at its last item and skips others', () => {
    const items = [user('u1'), asst('a1'), user('u2'), tool('t1', 'write_file', { path: '/p/a.txt', content: 'x\ny' }, D1), tool('t2', 'patch', { path: '/p/b.txt' }, D2), asst('a2')]
    const m = turnChanges(items, false)
    expect([...m.keys()]).toEqual([5])
    const c = m.get(5)!
    expect(c.files.map(f => f.path)).toEqual(['/p/a.txt', '/p/b.txt'])
    expect([c.added, c.removed]).toEqual([3, 1])
  })
  it('skips a running last turn but not earlier ones', () => {
    const items = [user('u1'), tool('t1', 'write_file', { path: '/a', content: 'x' }), asst('a1'), user('u2'), tool('t2', 'write_file', { path: '/b', content: 'x' })]
    expect([...turnChanges(items, true).keys()]).toEqual([2])
    expect([...turnChanges(items, false).keys()]).toEqual([2, 4])
  })
  it('ignores failed edits, other tools and edits without a path', () => {
    const items = [user('u'), tool('t1', 'patch', { path: '/a' }, D2, 'error'), tool('t2', 'terminal', { command: 'ls' }), tool('t3', 'patch', null, D2), asst('a')]
    expect(turnChanges(items, false).size).toBe(0)
  })
  it('counts from the arguments without a diff', () => {
    const items = [user('u'), tool('t1', 'write_file', { path: '/a', content: 'x\ny\nz' }), tool('t2', 'patch', { path: '/b', old_string: 'o', new_string: 'n1\nn2' }), asst('a')]
    const c = turnChanges(items, false).get(3)!
    expect(c.files.map(f => [f.added, f.removed, f.rewritten, f.diffs.length])).toEqual([
      [3, 0, true, 0],
      [2, 1, false, 0]
    ])
  })
  it('merges the same file edited twice', () => {
    const items = [user('u'), tool('t1', 'write_file', { path: '/a', content: 'x\ny' }, D1), tool('t2', 'patch', { path: '/a' }, D2), asst('a')]
    const c = turnChanges(items, false).get(3)!
    expect(c.files).toHaveLength(1)
    expect(c.files[0]).toMatchObject({ added: 3, removed: 1, rewritten: true })
    expect(c.files[0].diffs).toEqual([D1, D2])
  })
  it('caps a huge diff', () => {
    const big = '+' + 'x'.repeat(150000)
    const items = [user('u'), tool('t1', 'patch', { path: '/a' }, big), tool('t2', 'patch', { path: '/a' }, big), asst('a')]
    const text = turnChanges(items, false).get(3)!.files[0].diffs.join('')
    expect(text.length).toBeLessThan(200100)
    expect(text.endsWith('… (truncated)')).toBe(true)
  })
})

describe('shortPath', () => {
  it('keeps short paths and shortens long ones', () => {
    expect(shortPath('/root/projects/site/a.txt')).toBe('~/projects/site/a.txt')
    expect(shortPath('/root/projects/some/very/deep/folder/tree/here/name.ext')).toBe('~/…/here/name.ext')
  })
})
