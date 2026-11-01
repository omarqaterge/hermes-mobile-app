import { describe, expect, it } from 'vitest'
import { notesSince } from './releasenotes'

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
