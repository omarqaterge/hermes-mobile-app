import { useMemo } from 'react'
import { parseCsv } from '../text'
import type { DocType } from '../canvas'
import { Markdown } from './Markdown'
import { HtmlFrame } from './HtmlFrame'
import { Linked } from './Linked'

/** A fence long enough that the document's own backticks can't close it. */
function fenced(text: string, lang: string): string {
  const run = Math.max(2, ...(text.match(/`+/g) || []).map(m => m.length)) + 1
  const f = '`'.repeat(run)
  return `${f}${lang}\n${text}\n${f}`
}


function CsvTable({ text }: { text: string }) {
  const rows = useMemo(() => parseCsv(text).slice(0, 2000), [text])
  if (!rows.length) return <div className="dim pad">Empty table</div>
  const [head, ...body] = rows
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i}>{head.map((_, j) => <td key={j}>{r[j] ?? ''}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DocView({ type, lang, title, text, network }: { type: DocType; lang?: string; title: string; text: string; network: boolean }) {
  switch (type) {
    case 'markdown':
      return (
        <div className="canvas-md">
          <Markdown text={text} />
        </div>
      )
    case 'html':
      return <HtmlFrame html={text} network={network} />
    case 'code':
      return <Markdown text={fenced(text, lang || '')} />
    case 'json': {
      let pretty = text
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        /* show as written */
      }
      return <Markdown text={fenced(pretty, 'json')} />
    }
    case 'mermaid':
      return <Markdown text={fenced(text, 'mermaid')} />
    case 'csv':
      return <CsvTable text={text} />
    case 'svg':
      return <img className="canvas-svg" alt={title} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`} />
    default:
      return <pre className="canvas-text"><Linked text={text} /></pre>
  }
}
