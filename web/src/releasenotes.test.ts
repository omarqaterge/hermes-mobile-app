import { describe, expect, it } from 'vitest'
import { afterUpdatePlan, headlines, isReleaseVersion, notesSince } from './releasenotes'

const LOG = `# What's new

## Unreleased

- **Not out yet.**

## v0.8.70 (2026-11-03)

- **Newest.**

## v0.8.69 (2026-11-02)

- **Middle.**
- Second line.

## v0.8.68 (2026-11-01)

- **Installed.**
`

describe('notesSince', () => {
  it('lists the versions after the installed one, up to the newest release, newest first', () => {
    const n = notesSince(LOG, '0.8.68', '0.8.70')
    expect(n.map(r => r.version)).toEqual(['0.8.70', '0.8.69'])
    expect(n[1]).toEqual({ version: '0.8.69', date: '2026-11-02', text: '- **Middle.**\n- Second line.' })
  })
  it('leaves out Unreleased, versions past the release and the installed one', () => {
    expect(notesSince(LOG, '0.8.68', '0.8.69').map(r => r.version)).toEqual(['0.8.69'])
    expect(notesSince(LOG, '0.8.70', '0.8.70')).toEqual([])
  })
  it('a skipped version with no section is simply absent', () => {
    expect(notesSince(LOG, '0.8.60', '0.8.71').map(r => r.version)).toEqual(['0.8.70', '0.8.69', '0.8.68'])
  })
})

describe('headlines', () => {
  it('keeps one short line per change: the bold headline, else the first sentence', () => {
    const g = headlines('- **Big thing.** Details\n  over two lines.\n- A plain bullet, e.g. this one. With more.\n- **Uses `code`.**')
    expect(g).toEqual([{ title: '', items: ['Big thing', 'A plain bullet, e.g. this one', 'Uses code'] }])
  })
  it('groups under ### headings and drops empty groups', () => {
    const g = headlines('- **Main.** x\n\n### Smaller changes and fixes\n\n- **Small.** y\n\n### Empty\n')
    expect(g).toEqual([{ title: '', items: ['Main'] }, { title: 'Smaller changes and fixes', items: ['Small'] }])
  })
  it('shortens a very long first sentence', () => {
    const [g] = headlines('- ' + 'word '.repeat(40))
    expect(g.items[0].length).toBe(120)
    expect(g.items[0].endsWith('…')).toBe(true)
  })
})

describe('afterUpdatePlan', () => {
  it('remembers silently on a fresh install', () => {
    expect(afterUpdatePlan(null, '0.9.7')).toBe('remember')
    expect(afterUpdatePlan('garbage', '0.9.7')).toBe('remember')
  })
  it('shows after an update, stays quiet on the same version or a downgrade', () => {
    expect(afterUpdatePlan('0.9.6', '0.9.7')).toBe('show')
    expect(afterUpdatePlan('0.9.7', '0.9.7')).toBe('quiet')
    expect(afterUpdatePlan('0.9.8', '0.9.7')).toBe('quiet')
  })
  it('stays quiet in builds without a release version', () => {
    expect(afterUpdatePlan('0.9.6', 'web-dev')).toBe('quiet')
    expect(afterUpdatePlan(null, 'test')).toBe('quiet')
    expect(isReleaseVersion('v1.2.3')).toBe(true)
    expect(isReleaseVersion('1')).toBe(false)
  })
})
