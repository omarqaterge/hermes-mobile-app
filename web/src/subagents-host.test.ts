// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { subAgentHost } from './components/SubAgentsCore'

// The lazy bundle gets what it imports from the app through subAgentHost: a name missing there would be undefined at run time.
const FILES: Array<[string, string]> = [['src/components/SubAgents.tsx', 'components'], ['src/subagents-view.ts', '']]
const OWN = new Set(['subagents-view', 'components/SubAgents'])

function keyOf(from: string, dir: string): string {
  if (!from.startsWith('.')) return from
  const parts = (dir ? `${dir}/${from}` : from).split('/')
  const out: string[] = []
  for (const p of parts) p === '..' ? out.pop() : p !== '.' && out.push(p)
  return out.join('/')
}

describe('the sub-agent bundle', () => {
  it('gets every name it imports from the app', () => {
    const host = subAgentHost()
    let checked = 0
    for (const [file, dir] of FILES) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/^import \{([^}]*)\} from '([^']+)'/gms)) {
        const key = keyOf(m[2], dir)
        if (OWN.has(key)) continue
        for (const raw of m[1].split(',')) {
          const name = raw.trim()
          if (!name || name.startsWith('type ')) continue
          expect(host[key]?.[name], `${name} from ${key}`).toBeDefined()
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(30)
  })
})
