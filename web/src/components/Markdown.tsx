import { Children, cloneElement, createContext, isValidElement, memo, useContext, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { visit } from 'unist-util-visit'
import type { Root, Element } from 'hast'
import { copyText, haptic, openExternal } from '../bridge'
import { openSessionFromNotification } from '../gateway'
import { FileChip, Media } from './Media'
import { backgroundLuminance, chatLinks, mediaKind, prepare } from '../text'
import { DiffView, looksLikeDiff } from './Diff'
import { toast } from '../store'
import { createDoc } from '../canvas'
import { useBackHandler } from '../backstack'
import { hashText, setTask, subscribeTasks, useTask } from '../tasks'
import { runLazy } from '../lazy'
import { OpenUIBlock, OpenUICtx } from './OpenUIBlock'
import { HtmlFrame } from './HtmlFrame'

/** True while the reply being rendered is still arriving (a context, so code blocks aren't rebuilt per stream batch). */
const StreamingCtx = createContext(false)

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: ReactNode } }).props.children)
  return ''
}

function langOf(children: ReactNode): string {
  const child = Array.isArray(children) ? children[0] : children
  const cls = (child as { props?: { className?: string } })?.props?.className || ''
  return /language-([\w-]+)/.exec(cls)?.[1] || ''
}

// ── Mermaid (loaded on first use; a partial/invalid diagram stays visible as code) ──
type MermaidApi = typeof import('mermaid').default
let mermaidReady: Promise<MermaidApi> | null = null
function getMermaid() {
  mermaidReady ||= import.meta.env.DEV
    ? import('mermaid').then(m => m.default)
    : runLazy<MermaidApi>('hm-mermaid', '__hmMermaid') // the built page carries Mermaid as inert text (lazy.ts)
  mermaidReady.catch(() => (mermaidReady = null))
  return mermaidReady
}

function Mermaid({ code }: { code: string }) {
  const id = `mmd-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      getMermaid()
        .then(m => {
          // Re-initialised per render so diagrams follow the current theme.
          m.initialize({ startOnLoad: false, theme: document.documentElement.dataset.theme === 'light' ? 'default' : 'dark', securityLevel: 'strict', fontFamily: 'system-ui' })
          return m.render(id, code)
        })
        .then(r => {
          if (alive) {
            setSvg(r.svg)
            setFailed(false)
          }
        })
        .catch(() => {
          document.getElementById(`d${id}`)?.remove() // mermaid leaves an error node behind
          if (alive) setFailed(true)
        })
    }, 250) // debounce while the diagram is still streaming in
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [code, id])
  const [full, setFull] = useState(false)
  if (svg && !failed)
    return (
      <>
        <div className="mermaid-box tappable" role="button" aria-label="Open diagram full screen" onClick={() => setFull(true)} dangerouslySetInnerHTML={{ __html: svg }} />
        {full && <DiagramViewer svg={svg} source={code} onClose={() => setFull(false)} />}
      </>
    )
  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span>mermaid{failed ? ' (not rendered)' : ''}</span>
      </div>
      <pre>{code}</pre>
    </div>
  )
}

/** Full-screen diagram: pinch or use +/− to zoom, drag to pan, copy the source. */
function DiagramViewer({ svg, source, onClose }: { svg: string; source: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1)
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const base = useRef<{ d: number; z: number } | null>(null)
  useBackHandler(onClose)
  const dist = () => {
    const [a, b] = [...pts.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  return (
    <div className="diagram-view" onClick={onClose}>
      <div className="diagram-bar" onClick={e => e.stopPropagation()}>
        <button onClick={() => setZoom(z => Math.max(0.5, z / 1.35))} aria-label="Zoom out">−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.min(6, z * 1.35))} aria-label="Zoom in">＋</button>
        <button onClick={() => setZoom(1)}>Fit</button>
        <button onClick={() => { void copyText(source); toast('Diagram source copied') }}>Copy</button>
        <button className="close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div
        className="diagram-scroll"
        onClick={e => e.stopPropagation()}
        onPointerDown={e => {
          pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (pts.current.size === 2) base.current = { d: dist(), z: zoom }
        }}
        onPointerMove={e => {
          if (!pts.current.has(e.pointerId)) return
          pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (pts.current.size === 2 && base.current) setZoom(Math.min(6, Math.max(0.5, (base.current.z * dist()) / base.current.d)))
        }}
        onPointerUp={e => {
          pts.current.delete(e.pointerId)
          base.current = null
        }}
        onPointerCancel={e => pts.current.delete(e.pointerId)}
      >
        <div className="diagram-inner" style={{ width: `${zoom * 100}%` }} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </div>
  )
}

/** Full-screen view of an html preview (same offline sandbox as the inline frame). Android Back closes it. */
function HtmlViewer({ html, onClose }: { html: string; onClose: () => void }) {
  useBackHandler(onClose, true)
  return (
    <div className="html-viewer" role="dialog" aria-modal="true" aria-label="HTML preview">
      <button className="close" onClick={onClose} aria-label="Close preview">✕</button>
      <HtmlFrame html={html} network={false} />
    </div>
  )
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const streaming = useContext(StreamingCtx)
  const [preview, setPreview] = useState(false)
  const [viewer, setViewer] = useState(false)
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const [wrap, setWrap] = useState(false)
  const lang = langOf(children)
  if (lang === 'mermaid') return <Mermaid code={textOf(children)} />
  if (lang === 'openui-lang' || lang === 'openui') {
    const src = textOf(children)
    return (
      <OpenUIBlock
        code={src}
        fallback={
          <div className="codeblock">
            <div className="codeblock-bar"><span>openui-lang (not shown)</span></div>
            <pre>{src}</pre>
          </div>
        }
      />
    )
  }
  const code = textOf(children)
  const isDiff = lang === 'diff' || lang === 'patch' || (!lang && looksLikeDiff(code))
  const lines = code.split('\n').length
  const long = lines > 26
  const previewable = (lang === 'html' || lang === 'svg') && lines >= 3
  const showing = previewable && preview
  return (
    <div className={`codeblock${long && !open ? ' collapsed' : ''}${wrap ? ' wrap' : ''}`}>
      <div className="codeblock-bar">
        <span>{lang || (isDiff ? 'diff' : 'code')}</span>
        {!isDiff && (
          <button className={wrap ? 'on' : ''} onClick={() => { haptic(); setWrap(w => !w) }}>
            Wrap
          </button>
        )}
        {previewable && (
          <button className={showing ? 'on' : ''} disabled={streaming} onClick={() => { haptic(); setPreview(p => !p) }}>
            {showing ? 'Code' : 'Preview'}
          </button>
        )}
        {!isDiff && lines >= 3 && (
          <button
            onClick={() => {
              haptic()
              const type = lang === 'html' ? 'html' : lang === 'svg' ? 'svg' : lang === 'markdown' || lang === 'md' ? 'markdown' : lang === 'json' ? 'json' : lang === 'csv' ? 'csv' : 'code'
              const title = type === 'code' ? `${lang || 'code'} snippet` : type === 'html' ? 'Web page' : `${type} snippet`
              void createDoc(title, code, type, type === 'code' ? lang : '').then(d => d && toast('Opened in the canvas'))
            }}
          >
            Canvas
          </button>
        )}
        <button
          onClick={() => {
            void copyText(code)
            haptic()
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {showing ? (
        lang === 'svg' ? (
          <img className="inline-frame inline-svg" alt="SVG preview" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(code)}`} />
        ) : (
          <>
            <HtmlFrame html={code} network={false} autoHeight={{ min: 160, max: Math.round(window.innerHeight * 0.6) }} className="inline-frame" />
            <button className="codeblock-more" onClick={() => { haptic(); setViewer(true) }} aria-label="Open preview full screen">Full screen</button>
            {viewer && <HtmlViewer html={code} onClose={() => setViewer(false)} />}
          </>
        )
      ) : isDiff ? <DiffView text={code} /> : <pre>{children}</pre>}
      {long && !showing && (
        <button className="codeblock-more" onClick={() => { haptic(); setOpen(o => !o) }}>
          {open ? 'Show less' : `Show all ${lines} lines`}
        </button>
      )}
    </div>
  )
}

// ── interactive pieces ──────────────────────────────────────

/** A task-list checkbox you can tap. Ticks are remembered on this phone. */
function TaskBox({ seed, idx, initial }: { seed: string; idx: number; initial: boolean }) {
  const on = useTask(seed, idx, initial)
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      className={`task-box${on ? ' on' : ''}`}
      onClick={e => {
        e.stopPropagation()
        haptic()
        setTask(seed, idx, !on)
      }}
    >
      {on && (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12.5 10 17.5 19 7" />
        </svg>
      )}
    </button>
  )
}

/** The top-level task list shows "done / total" with a bar. */
function TaskList({ className, children }: { className?: string; children?: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null)
  const [p, setP] = useState<{ done: number; total: number } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || el.parentElement?.closest('.task-list-item')) return // a list inside a task item is counted by that task's list
    const calc = () => setP({ total: el.querySelectorAll('.task-box').length, done: el.querySelectorAll('.task-box.on').length })
    calc()
    return subscribeTasks(() => setTimeout(calc, 0))
  }, [])
  return (
    <div className="task-wrap">
      {p && p.total > 0 && (
        <div className="task-progress">
          <div className="task-bar">
            <i style={{ width: `${(p.done / p.total) * 100}%` }} />
          </div>
          <span>
            {p.done}/{p.total} done
          </span>
        </div>
      )}
      <ul ref={ref} className={className}>
        {children}
      </ul>
    </div>
  )
}

const cellText = (row: ReactElement): string[] =>
  Children.toArray((row.props as { children?: ReactNode }).children)
    .filter(isValidElement)
    .map(c => textOf((c.props as { children?: ReactNode }).children).trim())

/** Tables: tap a column heading to sort (numbers sort as numbers), Copy exports tab-separated text. */
function MdTable({ children }: { children?: ReactNode }) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  const [copied, setCopied] = useState(false)
  const parts = Children.toArray(children).filter(isValidElement) as ReactElement[]
  const thead = parts.find(x => x.type === 'thead')
  const tbody = parts.find(x => x.type === 'tbody')
  const headRow = thead ? (Children.toArray((thead.props as { children?: ReactNode }).children).find(isValidElement) as ReactElement | undefined) : undefined
  const bodyRows = tbody ? (Children.toArray((tbody.props as { children?: ReactNode }).children).filter(isValidElement) as ReactElement[]) : []

  const sorted = useMemo(() => {
    if (!sort) return bodyRows
    const num = (t: string) => {
      const n = parseFloat(t.replace(/[,\s$€£%]/g, ''))
      return Number.isFinite(n) && /^[-+]?[\d.,\s$€£%]+$/.test(t.trim()) ? n : null
    }
    return [...bodyRows].sort((a, b) => {
      const x = cellText(a)[sort.col] ?? ''
      const y = cellText(b)[sort.col] ?? ''
      const nx = num(x)
      const ny = num(y)
      return (nx != null && ny != null ? nx - ny : x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' })) * sort.dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, children])

  if (!thead || !tbody || !headRow) return <div className="table-wrap"><table>{children}</table></div>

  const heads = Children.toArray((headRow.props as { children?: ReactNode }).children).filter(isValidElement) as ReactElement[]
  const newHead = cloneElement(
    thead,
    {},
    cloneElement(
      headRow,
      {},
      heads.map((th, i) =>
        cloneElement(th as ReactElement<{ className?: string; onClick?: () => void; children?: ReactNode }>, {
          className: 'sortable',
          onClick: () => {
            haptic()
            setSort(sort?.col === i ? (sort.dir === 1 ? { col: i, dir: -1 } : null) : { col: i, dir: 1 })
          },
          children: (
            <>
              {(th.props as { children?: ReactNode }).children}
              <span className="sort-ind">{sort?.col === i ? (sort.dir === 1 ? '▲' : '▼') : '⇅'}</span>
            </>
          )
        })
      )
    )
  )
  const copy = () => {
    const rows = [heads.map(h => textOf((h.props as { children?: ReactNode }).children).trim()), ...sorted.map(cellText)]
    const line = (r: string[]) => '| ' + r.map(c => c.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')).join(' | ') + ' |'
    const sep = '| ' + rows[0].map(() => '---').join(' | ') + ' |'
    void copyText([line(rows[0]), sep, ...rows.slice(1).map(line)].join('\n'))
    haptic()
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <div className="table-block">
      <button className="table-copy" onClick={copy}>
        {copied ? 'Copied' : 'Copy table'}
      </button>
      <div className="table-wrap">
        <table>
          {newHead}
          {cloneElement(tbody, {}, sorted)}
        </table>
      </div>
    </div>
  )
}

// Raw HTML from the model (<kbd>, <mark>, <details>, <span style>…) is rendered, but sanitized: the
// WebView exposes a native bridge, so scripts, event handlers and unknown tags must never get through.
// Inline SVG (diagrams, icons, banners) is drawn, with no way to run or load anything: no script, foreignObject,
// use, image, a, style or animation elements, and only presentation attributes.
const SVG_TAGS = ['svg', 'g', 'defs', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'linearGradient', 'radialGradient', 'stop', 'text', 'tspan', 'title', 'filter', 'feGaussianBlur', 'feMerge', 'feMergeNode', 'feOffset', 'feFlood', 'feColorMatrix', 'feComposite']
const SVG_ATTRS = ['viewBox', 'width', 'height', 'fill', 'fillOpacity', 'fillRule', 'stroke', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'strokeDasharray', 'strokeOpacity', 'opacity', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'offset', 'stopColor', 'stopOpacity', 'gradientUnits', 'gradientTransform', 'textAnchor', 'dominantBaseline', 'fontSize', 'fontFamily', 'fontWeight', 'letterSpacing', 'filter', 'stdDeviation', 'floodColor', 'floodOpacity', 'in', 'in2', 'result', 'values', 'type', 'dx', 'dy', 'preserveAspectRatio', 'id', 'className', 'xmlns']
const schema = {
  ...defaultSchema,
  protocols: { ...defaultSchema.protocols, href: [...(defaultSchema.protocols?.href || []), 'hermes-chat'] },
  tagNames: [...(defaultSchema.tagNames || []), ...SVG_TAGS, 'mark', 'u', 'small', 'big', 'abbr', 'cite', 'dfn', 'figure', 'figcaption', 'caption', 'center'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'style'],
    ...Object.fromEntries(SVG_TAGS.map(t => [t, SVG_ATTRS])),
    code: [['className', /^language-./, 'math-inline', 'math-display']]
  }
}

// Inline styles are limited to looks (colour, spacing, borders, type); nothing that can position,
// overlay, hide, resize to the screen, or load a URL.
const STYLE_OK = /^(color|background(-color)?|padding(-(top|right|bottom|left))?|margin(-(top|right|bottom|left))?|border(-(top|right|bottom|left))?(-(width|style|color|radius))?|border-radius|font-(weight|style|size|family|variant)|text-(decoration|align|transform|shadow)|letter-spacing|line-height|white-space|vertical-align|opacity|display)$/
function rehypeSafeStyle() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      const raw = node.properties?.style
      if (typeof raw !== 'string') return
      const kept = raw
        .split(';')
        .map(d => d.trim())
        .filter(d => {
          const [prop, ...rest] = d.split(':')
          const val = rest.join(':').toLowerCase()
          if (!prop || !val.trim() || !STYLE_OK.test(prop.trim().toLowerCase())) return false
          if (/url\(|expression|javascript:|@import/.test(val)) return false
          return prop.trim().toLowerCase() !== 'display' || /^\s*(inline|inline-block|block|none)\s*$/.test(val)
        })
      // A card with its own background but no text colour would inherit the theme's (white on a pastel card).
      const lum = backgroundLuminance(kept.join(';'))
      if (lum !== null && !kept.some(d => /^color\s*:/i.test(d))) kept.push(lum > 0.18 ? 'color: #1c1c21' : 'color: #f2f2f4')
      if (kept.length) node.properties.style = kept.join('; ')
      else delete node.properties.style
    })
  }
}

// KaTeX draws \colorbox{yellow}{…} with the theme's text colour: white on yellow in the dark theme.
function rehypeColorboxContrast() {
  // The coloured box is a sibling of the text, so the colour goes on the nearest enclosing .mord.
  const walk = (node: Element, mord: Element | null) => {
    const cls = node.properties?.className
    const own = Array.isArray(cls) && cls.includes('mord') ? node : mord
    const style = node.properties?.style
    if (Array.isArray(cls) && cls.includes('colorbox') && typeof style === 'string' && mord) {
      const lum = backgroundLuminance(style)
      const ms = typeof mord.properties.style === 'string' ? mord.properties.style : ''
      if (lum !== null && !/(^|;)\s*color\s*:/.test(ms)) mord.properties.style = `${ms}${ms ? ';' : ''}color:${lum > 0.18 ? '#1c1c21' : '#f2f2f4'}`
    }
    for (const c of node.children) if (c.type === 'element') walk(c, own)
  }
  return (tree: Root) => {
    for (const c of tree.children) if (c.type === 'element') walk(c, null)
  }
}

// Math inside a raw HTML block (e.g. a styled <div> or <td> holding $…$ / $$…$$): remark-math never sees it (the
// whole block is one html node), and rehype-katex only converts remark-math's own output, so it stayed literal.
// Before rehype-raw parses the fragment, turn the delimiters into the <code class="language-math …"> that
// remark-math would have made (the sanitizer already allows exactly that).
const MATH_IN_HTML = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?![\s$])([^$\n]*?[^\s$\\])\$(?![\d$])/g
const escHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export function mathInHtml(html: string): string {
  if (!/[$\\]/.test(html)) return html
  return html
    .split(/(<[^<>]*>)/)
    .map(part => {
      if (part.startsWith('<') && part.endsWith('>')) return part
      return part.replace(MATH_IN_HTML, (_m, dd, br, par, inl) => {
        const tex = dd ?? br
        if (tex !== undefined) return `<code class="language-math math-display">${escHtml(tex.trim())}</code>`
        return `<code class="language-math math-inline">${escHtml((par ?? inl).trim())}</code>`
      })
    })
    .join('')
}
function rehypeMathInHtml() {
  return (tree: Root) => {
    visit(tree, 'raw', (node: { value: string }) => {
      node.value = mathInHtml(node.value)
    })
  }
}

// Obsidian callouts: `> [!note] Title` (+ `-` / `+` for collapsible) become a titled box.
const CALLOUT = /^\[!([\w-]+)\]([+-])?[ \t]*/
function rehypeCallouts() {
  const text = (n: Element): string => {
    const f = n.children[0]
    return f && f.type === 'text' ? f.value : ''
  }
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'blockquote' || !parent || index === undefined) return
      const first = node.children.find((c): c is Element => c.type === 'element')
      if (!first || first.tagName !== 'p') return
      const m = CALLOUT.exec(text(first))
      if (!m) return
      const kind = m[1].toLowerCase()
      const head = first.children[0] as { value: string }
      let rest = head.value.slice(m[0].length)
      const nl = rest.indexOf('\n')
      const title = (nl < 0 ? rest : rest.slice(0, nl)).trim() || kind.charAt(0).toUpperCase() + kind.slice(1)
      rest = nl < 0 ? '' : rest.slice(nl + 1)
      head.value = rest
      const body = node.children.filter(c => !(c === first && !rest && first.children.length === 1))
      const fold = m[2]
      const titleEl: Element = { type: 'element', tagName: fold ? 'summary' : 'div', properties: { className: ['callout-title'] }, children: [{ type: 'text', value: title }] }
      const el: Element = {
        type: 'element',
        tagName: fold ? 'details' : 'div',
        properties: { className: ['callout', `callout-${kind}`], ...(m[2] === '+' ? { open: true } : {}) },
        children: [titleEl, { type: 'element', tagName: 'div', properties: { className: ['callout-body'] }, children: body }]
      }
      parent.children[index] = el
    })
  }
}

// The sanitizer prefixes ids (user-content-…) but not the url(#id) references to them (gradients, filters).
function rehypeSvgRefs() {
  const fix = (v: string) => v.replace(/url\(#(?!user-content-)([^)\s]+)\)/g, 'url(#user-content-$1)')
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (!SVG_TAGS.includes(node.tagName)) return
      for (const [k, v] of Object.entries(node.properties || {})) if (typeof v === 'string' && v.includes('url(#')) node.properties[k] = fix(v)
    })
  }
}

// Commands models use that KaTeX lacks (e.g. from the esint/cancel packages): closest look-alikes.
const KATEX_MACROS = {
  '\\ointctrclockwise': '\\oint',
  '\\ointclockwise': '\\oint',
  '\\varointclockwise': '\\oint',
  '\\intclockwise': '\\int'
}

const isLocal = (href: string) => /^(\/|~\/|file:)/.test(href)
// Links to another chat: [title](hermes-chat:<session id>). A bare session id in a reply becomes one too.
const CHAT_HREF = /^hermes-chat:([\w-]{1,80})$/

const REMARK = [remarkGfm, [remarkMath, { singleDollarTextMath: true }]] as const
// Guessing the language of an unlabelled code block is costly: while a reply streams it would run on every
// update, so it waits until the reply is complete.
const rehypeFor = (detect: boolean) =>
  [rehypeMathInHtml, rehypeRaw, [rehypeSanitize, schema], rehypeSafeStyle, rehypeSvgRefs, rehypeCallouts, [rehypeKatex, { throwOnError: false, strict: false, macros: KATEX_MACROS }], rehypeColorboxContrast, [rehypeHighlight, { detect, ignoreMissing: true }]] as const
const REHYPE_DONE = rehypeFor(true)
const REHYPE_LIVE = rehypeFor(false)

// Keep local paths (react-markdown would otherwise strip unknown schemes but leaves /paths alone).
const urlTransform = (url: string) => (isLocal(url) || CHAT_HREF.test(url) ? url : defaultUrlTransform(url))

// interactive: card buttons may send (chat replies only; canvas, files and /btw just show cards).
export const Markdown = memo(function Markdown({ text, streaming = false, interactive = false }: { text: string; streaming?: boolean; interactive?: boolean }) {
  const ui = useMemo(() => ({ streaming, interactive }), [streaming, interactive])
  const seed = useRef('')
  seed.current = useMemo(() => hashText(text), [text])
  const nextBox = useRef(0)
  nextBox.current = 0 // task boxes are numbered in document order, per render
  // Built once per message: new component functions on every render would make React rebuild every code
  // block, table and diagram on each streamed update (losing "Show all", Wrap, a drawn diagram…).
  const components = useMemo<Components>(() => mdComponents(seed, nextBox), [])
  return (
    <OpenUICtx.Provider value={ui}>
    <StreamingCtx.Provider value={streaming}>
    <div
      className="md"
      onClick={e => {
        // Tap inline code or a formula to copy it (a selection in progress is left alone).
        const t = e.target as HTMLElement
        if (t.closest('a, button, summary, .hm-openui') || window.getSelection()?.toString()) return
        const code = t.closest('code')
        if (code && !code.closest('pre')) {
          void copyText(code.textContent || '')
          haptic()
          toast('Copied')
          return
        }
        const math = t.closest('.katex')
        const tex = math?.querySelector('annotation[encoding="application/x-tex"]')?.textContent
        if (tex) {
          void copyText(tex)
          haptic()
          toast('LaTeX copied')
        }
      }}
    >
      <ReactMarkdown
        remarkPlugins={REMARK as unknown as Options['remarkPlugins']}
        rehypePlugins={(streaming ? REHYPE_LIVE : REHYPE_DONE) as unknown as Options['rehypePlugins']}
        // Sanitize adds the user-content- prefix to ids itself; don't let remark-rehype add it too.
        remarkRehypeOptions={REMARK_REHYPE}
        urlTransform={urlTransform}
        components={components}
      >
        {prepare(chatLinks(text))}
      </ReactMarkdown>
    </div>
    </StreamingCtx.Provider>
    </OpenUICtx.Provider>
  )
})

const REMARK_REHYPE = { clobberPrefix: '' }

function mdComponents(seed: { current: string }, nextBox: { current: number }): Components {
  return {
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    input: props =>
      props.type === 'checkbox' ? <TaskBox seed={seed.current} idx={nextBox.current++} initial={Boolean(props.checked)} /> : <input {...props} />,
    ul: ({ className, children }) => (className?.includes('contains-task-list') ? <TaskList className={className}>{children}</TaskList> : <ul className={className}>{children}</ul>),
    li: ({ className, children }) =>
      className?.includes('task-list-item') ? (
        <li
          className={className}
          onClick={e => {
            const t = e.target as HTMLElement
            // Links, code, formulas and anything nested inside the item (quotes, lists…) keep their own behaviour.
            if (t.closest('a, button, code, .katex')) return
            const nested = t.closest('blockquote, ul, ol, pre, table')
            if (nested && e.currentTarget.contains(nested) && nested !== e.currentTarget) return
            e.stopPropagation()
            ;(e.currentTarget.querySelector(':scope > .task-box, :scope > p > .task-box') as HTMLElement | null)?.click()
          }}
        >
          {children}
        </li>
      ) : (
        <li className={className}>{children}</li>
      ),
    code: ({ className, children }) => {
      // Inline code that is just a web address opens it (fenced blocks end in a newline and stay plain, for copying).
      const url = !className && typeof children === 'string' && /^https?:\/\/\S+$/.test(children) ? children : ''
      if (!url) return <code className={className}>{children}</code>
      return (
        <a
          href={url}
          className="code-link"
          onClick={e => {
            e.preventDefault()
            haptic()
            openExternal(url)
          }}
        >
          <code>{children}</code>
        </a>
      )
    },
    img: ({ src, alt }) => (typeof src === 'string' && src ? <Media src={src} alt={alt} /> : null),
    a: ({ href, children }) => {
      if (href?.startsWith('#')) {
        // Footnotes: jump within this message (ids get the sanitizer's user-content- prefix).
        const id = decodeURIComponent(href.slice(1))
        return (
          <a
            href={href}
            onClick={e => {
              e.preventDefault()
              const box = (e.currentTarget as HTMLElement).closest('.md')
              const el = box?.querySelector(`[id="user-content-${CSS.escape(id)}"], [id="${CSS.escape(id)}"]`)
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }}
          >
            {children}
          </a>
        )
      }
      const chat = href ? CHAT_HREF.exec(href) : null
      if (chat) {
        return (
          <a
            href={href}
            className="chat-link"
            onClick={e => {
              e.preventDefault()
              haptic()
              openSessionFromNotification(chat[1])
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
            </svg>
            {children}
          </a>
        )
      }
      if (href && isLocal(href)) {
        return mediaKind(href) === 'file' ? <FileChip src={href} label={textOf(children).replace(/^📎\s*/, '')} /> : <Media src={href} alt={textOf(children)} />
      }
      return (
        <a
          href={href}
          onClick={e => {
            e.preventDefault()
            if (href) openExternal(href)
          }}
        >
          {children}
        </a>
      )
    },
    table: ({ children }) => <MdTable>{children}</MdTable>
  }
}
