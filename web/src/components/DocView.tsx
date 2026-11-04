import { useMemo, type ReactNode } from 'react'
import { parseCsv } from '../text'
import type { DocType } from '../canvas'
import { Markdown } from './Markdown'
import { GuardCtx, useDocHeld } from '../phone-data-taint'
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

/** `from`: the stored id of the chat the document belongs to, when it is drawn out of that chat (the Gallery, Files: null when the
 *  chat is unknown). Left out inside the chat itself. A document of a chat that read phone data is held (see useDocHeld). */
export function DocView(props: { type: DocType; lang?: string; title: string; text: string; network: boolean; from?: string | null }) {
  const held = useDocHeld(props.from)
  const body = <DocBody {...props} held={held} />
  return held ? <GuardCtx.Provider value>{body}</GuardCtx.Provider> : body
}

/** Wraps text drawn out of its chat (a Files preview): links in it show their address first when its chat read phone data. */
export function HeldScope({ from, children }: { from: string | null; children: ReactNode }) {
  const held = useDocHeld(from)
  return held ? <GuardCtx.Provider value>{children}</GuardCtx.Provider> : <>{children}</>
}

function DocBody({ type, lang, title, text, network, held }: { type: DocType; lang?: string; title: string; text: string; network: boolean; held: boolean }) {
  switch (type) {
    case 'markdown':
      return (
        <div className="canvas-md">
          <Markdown text={text} guard={held} />
        </div>
      )
    case 'html':
      return <HtmlFrame html={text} network={network && !held} />
    case 'code':
      return <Markdown text={fenced(text, lang || '')} guard={held} />
    case 'json': {
      let pretty = text
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        /* show as written */
      }
      return <Markdown text={fenced(pretty, 'json')} guard={held} />
    }
    case 'mermaid':
      return <Markdown text={fenced(text, 'mermaid')} guard={held} />
    case 'csv':
      return <CsvTable text={text} />
    case 'svg':
      return <img className="canvas-svg" alt={title} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`} />
    default:
      return <pre className="canvas-text"><Linked text={text} /></pre>
  }
}
