// Coloured unified-diff view, shared by tool cards (patch results, live inline diffs, `git diff`
// output) and ```diff blocks in chat: green/red rows, blue hunk headers, bold file headers and
// yellow `!` lines.

import { Linked } from './Linked'

/** Hermes renders inline diffs for its terminal UI: strip the ANSI colour codes. */
// eslint-disable-next-line no-control-regex
export const stripAnsi = (t: string) => t.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

/** True when the text reads like a unified diff (a hunk or git header plus changed lines). */
export function looksLikeDiff(raw: string): boolean {
  const text = stripAnsi(raw)
  if (!/^(@@ .* @@|diff --git |--- \S)/m.test(text)) return false
  return /^[+-](?![+-]{2} )/m.test(text)
}

function lineClass(l: string): string {
  if (l.startsWith('@@')) return 'hunk'
  if (/^\s*┊/.test(l)) return 'meta'
  if (/^a\/.* → b\//.test(l)) return 'file'
  if (/^(diff --git |index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) )/.test(l)) return 'file'
  if (l.startsWith('+')) return 'add'
  if (l.startsWith('-')) return 'del'
  if (l.startsWith('!')) return 'warn'
  if (l.startsWith('\\')) return 'meta'
  return 'ctx'
}

export function DiffView({ text: raw, max = 20000 }: { text: string; max?: number }) {
  const text = stripAnsi(raw)
  const body = text.length > max ? text.slice(0, max) : text
  const lines = body
    .replace(/\n$/, '')
    .split('\n')
    .filter(l => !/^\s*┊ review diff\s*$/.test(l))
  return (
    <pre className="diff-view">
      {lines.map((l, i) => (
        <span key={i} className={`dl dl-${lineClass(l)}`}>
          {l ? <Linked text={l} /> : ' '}
        </span>
      ))}
      {body !== text && <span className="dl dl-meta">… (truncated)</span>}
    </pre>
  )
}
