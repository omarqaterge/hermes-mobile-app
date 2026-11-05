// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { lineageOf, noteLineage, noteListRow, resetLineageForTests } from './lineage'

beforeEach(() => {
  localStorage.clear()
  resetLineageForTests()
})

describe('lineage', () => {
  it('links the ids of one chat and answers for any of them', () => {
    noteLineage(['s1', 's2'], 'rt-1')
    expect(lineageOf('s2').sort()).toEqual(['rt-1', 's1'])
    expect(lineageOf('rt-1').sort()).toEqual(['s1', 's2'])
    expect(lineageOf('nobody')).toEqual([])
  })
  it('merges groups that meet, keeps a chat apart from another, ignores junk', () => {
    noteLineage(['a1', 'a2'])
    noteLineage(['b1', 'b2'])
    noteLineage(['a2', 'a3'], 'rt-a')
    expect(lineageOf('a3').sort()).toEqual(['a1', 'a2', 'rt-a'])
    expect(lineageOf('b1')).toEqual(['b2'])
    noteLineage([null, 5, '', 'x'.repeat(200)], 7)
    noteLineage(['lonely'])
    expect(lineageOf('lonely')).toEqual([])
  })
  it('survives a restart (kept in localStorage) and is bounded', () => {
    noteLineage(['p1', 'p2'])
    resetLineageForTests()
    expect(lineageOf('p1')).toEqual(['p2'])
    for (let i = 0; i < 40; i++) noteLineage(['chain', `seg-${i}`])
    expect(lineageOf('chain').length).toBeLessThanOrEqual(24)
    expect(lineageOf('seg-39')).toContain('chain')
  })
  it('reads a session list row: id, resolved id, parent and lineage ids', () => {
    noteListRow({ id: 'tip', resolved_id: 'root', parent_session_id: 'mid', _lineage_ids: ['root', 'mid', 'tip'] })
    expect(lineageOf('tip').sort()).toEqual(['mid', 'root'])
    noteListRow(null)
    noteListRow({ id: 'only' })
    expect(lineageOf('only')).toEqual([])
  })
})
