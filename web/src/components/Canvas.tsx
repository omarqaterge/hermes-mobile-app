// The canvas panel: documents beside the chat that Hermes writes and you read, edit, run and keep.
import { useEffect, useMemo, useRef, useState } from 'react'
import { copyText, haptic, openExternal, shareText as nativeShare } from '../bridge'
import { parseCsv } from '../text'
import { sendPrompt, errText } from '../gateway'
import { toast } from '../store'
import { confirmDialog, promptDialog } from '../dialog'
import { useBackHandler } from '../backstack'
import { api } from '../api'
import {
  closeCanvas,
  closeDoc,
  createDoc,
  editDoc,
  flushSave,
  getVersion,
  keepMine,
  lineDiff,
  loadDoc,
  renameDoc,
  restoreVersion,
  saveToFile,
  selectDoc,
  setCanvasSize,
  setMode,
  takeTheirs,
  unsavedFor,
  useCanvas,
  type Doc,
  type DocMeta,
  type DocType
} from '../canvas'
import { Markdown } from './Markdown'
import { DiffView } from './Diff'
import { Row, Section } from './ui'
import { setState } from '../store'
import { useSheetDrag } from './useSheetDrag'
import { Spinner } from './Spinner'

const TYPE_ICON: Record<DocType, string> = { markdown: '📝', html: '🌐', code: '💻', text: '📄', json: '{ }', csv: '▦', svg: '🖼', mermaid: '⛓' }
const EXT: Record<DocType, string> = { markdown: 'md', html: 'html', code: 'txt', text: 'txt', json: 'json', csv: 'csv', svg: 'svg', mermaid: 'mmd' }
const CODE_EXT: Record<string, string> = { python: 'py', javascript: 'js', typescript: 'ts', bash: 'sh', rust: 'rs', go: 'go', java: 'java', kotlin: 'kt', c: 'c', cpp: 'cpp', css: 'css', sql: 'sql', yaml: 'yml' }

const ago = (t: number) => {
  const s = Math.max(0, Math.round(Date.now() / 1000 - t))
  return s < 10 ? 'just now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`
}

// ── content renderers ────────────────────────────────────────

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

/** HTML runs in a sandboxed frame: scripts yes, but no access to the app, and no network unless allowed. */
function HtmlFrame({ html, network }: { html: string; network: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [err, setErr] = useState('')
  const srcDoc = useMemo(() => {
    // First thing in the document, before any script of the page's own: remove the phone bridge, report errors,
    // and show alert() in the app's own look (Android's box says "The page at … says").
    const guard =
      `<script>try{delete window.HermesAndroid}catch(e){}try{window.HermesAndroid=undefined}catch(e){}` +
      `window.addEventListener('error',function(e){parent.postMessage({hmCanvasError:String(e.message)},'*')});` +
      `window.alert=function(m){parent.postMessage({hmCanvasAlert:String(m===undefined?'':m)},'*')};` +
      // Links would load the site inside the frame (sub-frame navigations never reach the Android shell): hand them to the app.
      `document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');` +
      `if(!a||/^#/.test(a.getAttribute('href')))return;e.preventDefault();parent.postMessage({hmCanvasLink:a.href},'*')},true);</script>`
    // Offline means offline: default-src doesn't cover form submissions, so they are blocked separately.
    const csp = network
      ? ''
      : `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'">`
    const top = `<meta name="viewport" content="width=device-width,initial-scale=1">${csp}${guard}`
    // The guard must be the very first thing that can run, so it goes right after the doctype (or at the start).
    const dt = /^\s*<!doctype[^>]*>/i.exec(html)
    if (dt) return html.slice(0, dt[0].length) + top + html.slice(dt[0].length)
    return `<!doctype html>${top}${html}`
  }, [html, network])
  useEffect(() => {
    setErr('')
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data) return
      if (typeof e.data.hmCanvasError === 'string') setErr(e.data.hmCanvasError)
      else if (typeof e.data.hmCanvasAlert === 'string' && e.data.hmCanvasAlert.trim()) toast(e.data.hmCanvasAlert.slice(0, 300), 'info', 5000)
      else if (typeof e.data.hmCanvasLink === 'string' && /^https?:\/\//i.test(e.data.hmCanvasLink)) {
        const url = e.data.hmCanvasLink.slice(0, 2000)
        // The page could post this without a tap, so the user confirms.
        confirmDialog({ title: 'Open link?', message: url, confirmLabel: 'Open' }).then(ok => ok && openExternal(url))
      }
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [srcDoc])
  return (
    <div className="html-wrap">
      {err && <div className="html-err">⚠ {err}</div>}
      <iframe ref={frame} className="html-frame" title="Preview" sandbox="allow-scripts allow-forms allow-modals" referrerPolicy="no-referrer" srcDoc={srcDoc} />
    </div>
  )
}

function DocView({ doc, text, network }: { doc: Doc; text: string; network: boolean }) {
  switch (doc.type) {
    case 'markdown':
      return (
        <div className="canvas-md">
          <Markdown text={text} />
        </div>
      )
    case 'html':
      return <HtmlFrame html={text} network={network} />
    case 'code':
      return <Markdown text={fenced(text, doc.lang || '')} />
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
      return <img className="canvas-svg" alt={doc.title} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`} />
    default:
      return <pre className="canvas-text">{text}</pre>
  }
}

// ── editor ───────────────────────────────────────────────────

type Wrap = { pre: string; post?: string; block?: boolean; ph?: string }
const SHORTCUTS: Array<{ label: string; title: string; w: Wrap }> = [
  { label: 'B', title: 'Bold', w: { pre: '**', post: '**', ph: 'bold' } },
  { label: 'I', title: 'Italic', w: { pre: '_', post: '_', ph: 'italic' } },
  { label: 'H', title: 'Heading', w: { pre: '## ', block: true, ph: 'Heading' } },
  { label: '•', title: 'Bullet list', w: { pre: '- ', block: true, ph: 'item' } },
  { label: '☑', title: 'Checklist', w: { pre: '- [ ] ', block: true, ph: 'task' } },
  { label: '“', title: 'Quote', w: { pre: '> ', block: true, ph: 'quote' } },
  { label: '</>', title: 'Code', w: { pre: '`', post: '`', ph: 'code' } },
  { label: '🔗', title: 'Link', w: { pre: '[', post: '](https://)', ph: 'text' } }
]

function Editor({ doc, onChange, onSelect }: { doc: Doc; onChange: (t: string) => void; onSelect: (s: string) => void }) {
  const ta = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState(() => unsavedFor(doc.id) ?? doc.content)
  const hist = useRef<{ stack: string[]; i: number }>({ stack: [text], i: 0 })
  const last = useRef(0)
  // Hermes (or a restore) replaced the text while you weren't typing: follow it.
  useEffect(() => {
    if (unsavedFor(doc.id) == null && doc.content !== text) {
      setText(doc.content)
      hist.current = { stack: [doc.content], i: 0 }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.rev])

  const push = (t: string) => {
    setText(t)
    onChange(t)
    const h = hist.current
    const now = Date.now()
    if (now - last.current < 700 && h.i === h.stack.length - 1 && h.stack.length > 1) h.stack[h.i] = t // group fast typing
    else {
      h.stack = [...h.stack.slice(0, h.i + 1), t].slice(-100)
      h.i = h.stack.length - 1
    }
    last.current = now
  }
  const step = (d: number) => {
    const h = hist.current
    const i = h.i + d
    if (i < 0 || i >= h.stack.length) return
    h.i = i
    setText(h.stack[i])
    onChange(h.stack[i])
  }
  const wrap = (w: Wrap) => {
    const el = ta.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b } = el
    const sel = text.slice(a, b) || w.ph || ''
    let out: string
    let caret: number
    if (w.block) {
      const start = text.lastIndexOf('\n', a - 1) + 1
      const lines = (text.slice(a, b) || w.ph || '').split('\n').map(l => w.pre + l).join('\n')
      out = text.slice(0, start) + lines + text.slice(Math.max(b, start))
      caret = start + lines.length
    } else {
      out = text.slice(0, a) + w.pre + sel + (w.post || '') + text.slice(b)
      caret = a + w.pre.length + sel.length
    }
    push(out)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }
  const md = doc.type === 'markdown'
  return (
    <div className="editor">
      <div className="editor-bar">
        <button onClick={() => step(-1)} aria-label="Undo" disabled={hist.current.i === 0}>
          ↶
        </button>
        <button onClick={() => step(1)} aria-label="Redo" disabled={hist.current.i >= hist.current.stack.length - 1}>
          ↷
        </button>
        {md && <span className="editor-sep" />}
        {md && SHORTCUTS.map(s => (
          <button key={s.title} title={s.title} aria-label={s.title} className="fmt" onClick={() => wrap(s.w)}>
            {s.label}
          </button>
        ))}
      </div>
      <textarea
        ref={ta}
        className={`editor-text${md ? '' : ' mono'}`}
        value={text}
        spellCheck={md}
        autoCapitalize={md ? 'sentences' : 'none'}
        autoCorrect={md ? 'on' : 'off'}
        onChange={e => push(e.target.value)}
        onSelect={e => {
          const t = e.currentTarget
          onSelect(t.selectionStart !== t.selectionEnd ? t.value.slice(t.selectionStart, t.selectionEnd) : '')
        }}
      />
    </div>
  )
}

// ── history ──────────────────────────────────────────────────

function HistorySheet({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const drag = useSheetDrag(onClose)
  useBackHandler(onClose)
  const [open, setOpen] = useState<number | null>(null)
  const [diff, setDiff] = useState('')
  const versions = [...(doc.versions ?? [])].reverse()
  const show = async (rev: number) => {
    if (open === rev) return setOpen(null)
    setOpen(rev)
    setDiff('…')
    try {
      const v = await getVersion(doc.id, rev)
      setDiff(lineDiff(v.content, doc.content))
    } catch (e) {
      setDiff(errText(e))
    }
  }
  return (
    <div className="sheet-backdrop picker-backdrop" onClick={onClose}>
      <div className="sheet picker" role="dialog" ref={drag.ref} {...drag.bind} onClick={e => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-title">Version history</div>
        <div className="picker-list">
          {versions.map(v => (
            <div key={v.rev} className="ver">
              <button className="ver-head" onClick={() => void show(v.rev)}>
                <span className={`by by-${v.by}`}>{v.by === 'agent' ? 'Hermes' : 'You'}</span>
                <span className="set-text">
                  <span className="set-title">
                    Version {v.rev}
                    {v.rev === doc.rev ? ' · current' : ''}
                  </span>
                  <span className="set-sub">
                    {ago(v.at)}
                    {v.note ? ` · ${v.note}` : ''}
                  </span>
                </span>
                <span className="set-chev">{open === v.rev ? '⌄' : '›'}</span>
              </button>
              {open === v.rev && (
                <div className="ver-body">
                  <div className="dim small">Changes from this version to the current one</div>
                  <DiffView text={diff} />
                  {v.rev !== doc.rev && (
                    <button
                      className="btn primary block"
                      onClick={() =>
                        void confirmDialog({ title: `Restore version ${v.rev}?`, message: 'The current text is kept in the history, so you can come back.', confirmLabel: 'Restore' }).then(ok => {
                          if (!ok) return
                          void restoreVersion(doc.id, v.rev)
                          onClose()
                        })
                      }
                    >
                      Restore this version
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── menus ────────────────────────────────────────────────────

const NEW_TYPES: Array<{ type: DocType; label: string; sub: string; lang?: string }> = [
  { type: 'markdown', label: 'Notes / document', sub: 'Markdown with a live preview' },
  { type: 'html', label: 'Web page', sub: 'HTML you can run right here' },
  { type: 'code', label: 'Code', sub: 'A source file', lang: 'python' },
  { type: 'text', label: 'Plain text', sub: 'Just text' }
]

function Sheetish({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const drag = useSheetDrag(onClose)
  useBackHandler(onClose)
  return (
    <div className="sheet-backdrop picker-backdrop" onClick={onClose}>
      <div className="sheet picker" role="dialog" ref={drag.ref} {...drag.bind} onClick={e => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-title">{title}</div>
        <div className="picker-list">{children}</div>
      </div>
    </div>
  )
}

function ext(doc: Doc): string {
  return doc.type === 'code' ? CODE_EXT[doc.lang] || 'txt' : EXT[doc.type]
}

/** Write a copy into the phone's Downloads folder. */
async function exportCopy(doc: Doc, text: string): Promise<void> {
  const name = `${doc.title.replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '_') || 'canvas'}.${ext(doc)}`
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  bytes.forEach(b => (bin += String.fromCharCode(b)))
  try {
    await api('POST', '/api/files/upload', { path: `/sdcard/Download/${name}`, data_url: `data:text/plain;base64,${btoa(bin)}`, overwrite: true }, { profile: false })
    toast(`Saved to Downloads/${name}`)
  } catch (e) {
    toast(errText(e), 'error')
  }
}

function shareText(title: string, text: string): void {
  if (!nativeShare(title, text)) toast('Copied (sharing works in the phone app)')
}

function DocMenu({ doc, text, onClose, onHistory }: { doc: Doc; text: string; onClose: () => void; onHistory: () => void }) {
  const run = (fn: () => void) => () => {
    haptic()
    onClose()
    fn()
  }
  return (
    <Sheetish title={doc.title} onClose={onClose}>
      <Section>
        <Row icon="✏️" tone="gold" title="Rename" onClick={run(() => void promptDialog({ title: 'Rename document', value: doc.title, placeholder: 'Title', confirmLabel: 'Rename' }).then(t => t && void renameDoc(doc.id, t)))} />
        <Row icon="🕘" tone="blue" title="Version history" sub={`${doc.rev} version${doc.rev === 1 ? '' : 's'}`} chevron onClick={run(onHistory)} />
      </Section>
      <Section title="Share and save">
        <Row icon="⧉" tone="teal" title="Copy" onClick={run(() => void copyText(text).then(() => toast('Copied')))} />
        <Row icon="↗" tone="green" title="Share…" onClick={run(() => shareText(doc.title, text))} />
        <Row icon="⬇" tone="purple" title={`Save a copy to Downloads`} sub={`${doc.title}.${ext(doc)}`} onClick={run(() => void exportCopy(doc, text))} />
        {doc.path && <Row icon="💾" tone="gold" title="Save to the original file" sub={doc.path} onClick={run(() => void saveToFile(doc.id))} />}
      </Section>
      <Section>
        <Row icon="📂" tone="blue" title="Open a file from the phone…" sub="Pick a text file in Files, then “Open in canvas”" chevron onClick={run(() => { closeCanvas(); setState({ screen: 'files' }) })} />
        <Row icon="🗑" danger title="Close this document" onClick={run(() => void confirmDialog({ title: `Close “${doc.title}”?`, message: 'It is removed from the canvas, with its history. A saved file on the phone is not touched.', confirmLabel: 'Close', danger: true }).then(ok => ok && void closeDoc(doc.id)))} />
      </Section>
    </Sheetish>
  )
}

function NewDocMenu({ onClose }: { onClose: () => void }) {
  return (
    <Sheetish title="New document" onClose={onClose}>
      <Section>
        {NEW_TYPES.map(t => (
          <Row
            key={t.type}
            icon={TYPE_ICON[t.type]}
            tone="gold"
            title={t.label}
            sub={t.sub}
            chevron
            onClick={() => {
              onClose()
              void promptDialog({ title: `New ${t.label.toLowerCase()}`, placeholder: 'Title', confirmLabel: 'Create' }).then(title => {
                if (title) void createDoc(title, '', t.type, t.lang || '').then(d => d && setMode(d.id, 'edit'))
              })
            }}
          />
        ))}
      </Section>
    </Sheetish>
  )
}

// ── the panel ────────────────────────────────────────────────

const ACTIONS: Array<[string, string]> = [
  ['Rewrite', 'Rewrite this so it is clearer.'],
  ['Shorter', 'Make this shorter.'],
  ['Longer', 'Expand this with more detail.'],
  ['Fix', 'Fix any mistakes in this (spelling, grammar or bugs).'],
  ['Explain', 'Explain this to me in the chat (do not change the document).']
]

let safeTop = -1
/** Resting heights (px) of the half and full panel; full leaves the status bar area free. */
function snapHeights() {
  if (safeTop < 0) {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;top:0;visibility:hidden;padding-top:env(safe-area-inset-top)'
    document.body.appendChild(probe)
    safeTop = probe.offsetHeight
    probe.remove()
  }
  const vh = window.innerHeight
  return { half: vh * 0.58, full: vh - safeTop }
}

const WIDE = window.matchMedia('(min-width: 840px)')

function useElapsed(since: number): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return Math.max(0, Math.round((now - since) / 1000))
}

function WritingBanner({ since }: { since: number }) {
  const secs = useElapsed(since)
  return (
    <div className="canvas-writing-bar" role="status">
      <Spinner small /> Hermes is rewriting this document… {secs}s
    </div>
  )
}

/** While Hermes writes a new document: its title and text once the call starts, skeleton lines until then. */
function CanvasWriting({ since, title, preview }: { since: number; title?: string; preview?: string }) {
  const secs = useElapsed(since)
  return (
    <div className="canvas-writing" role="status" aria-live="polite">
      <div className="canvas-writing-bar">
        <Spinner small />
        <span>
          {preview != null ? 'Saving' : 'Hermes is writing'} {title ? <b>“{title}”</b> : 'a document'}… {secs}s
        </span>
      </div>
      {preview != null ? (
        <pre className="canvas-writing-preview">{preview.length > 40000 ? preview.slice(0, 40000) + '\n…' : preview}</pre>
      ) : (
        <div className="canvas-skeleton" aria-hidden="true">
          {[92, 78, 85, 40, 88, 70, 95, 55].map((w, i) => (
            <span key={i} style={{ width: `${w}%`, animationDelay: `${i * 0.12}s` }} />
          ))}
        </div>
      )}
    </div>
  )
}

export function CanvasPanel() {
  const open = useCanvas(s => s.open)
  const size = useCanvas(s => s.size)
  const docs = useCanvas(s => s.docs)
  const activeId = useCanvas(s => s.active)
  const loaded = useCanvas(s => s.loaded)
  const modes = useCanvas(s => s.mode)
  const save = useCanvas(s => s.save)
  const remote = useCanvas(s => s.remote)
  const writing = useCanvas(s => s.writing)
  const listLoading = useCanvas(s => s.loading)
  const [menu, setMenu] = useState<null | 'doc' | 'new' | 'history'>(null)
  const [sel, setSel] = useState('')
  const [ask, setAsk] = useState('')
  const [net, setNet] = useState<Record<string, boolean>>({})
  const body = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; h: number; lastY: number; lastT: number; v: number; cap: boolean } | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const sizeBeforeEdit = useRef<'half' | 'full' | 'max' | null>(null)

  const meta: DocMeta | undefined = docs.find(d => d.id === activeId)
  const doc = activeId ? loaded[activeId] : undefined
  const mode = (activeId && modes[activeId]) || 'view'

  // Wide screens put the open canvas in a column beside the chat (styles.css, html[data-canvas]).
  useEffect(() => {
    document.documentElement.dataset.canvas = open ? size : ''
  }, [open, size])
  useBackHandler(() => (size === 'max' ? setCanvasSize('full') : size === 'full' ? setCanvasSize('half') : closeCanvas()), open && menu === null)
  useEffect(() => {
    if (open && activeId && !loaded[activeId]) void loadDoc(activeId)
  }, [open, activeId, loaded])

  // text selected in the preview → quick "ask Hermes" actions
  useEffect(() => {
    if (!open) return
    const on = () => {
      if (mode === 'edit') return
      const s = window.getSelection()
      const t = s && !s.isCollapsed && body.current && body.current.contains(s.anchorNode) ? s.toString().trim() : ''
      setSel(t.length > 2 ? t : '')
    }
    document.addEventListener('selectionchange', on)
    return () => document.removeEventListener('selectionchange', on)
  }, [open, mode])
  useEffect(() => setSel(''), [activeId, mode])

  if (!open) return null
  const text = doc ? unsavedFor(doc.id) ?? doc.content : ''

  const send = (instruction: string, selection?: string) => {
    if (!doc) return
    const lead = `About the canvas document “${doc.title}” (id ${doc.id}).`
    const msg = selection
      ? `${lead} ${instruction}\n\nSelected text:\n"""\n${selection}\n"""\n\nUse the canvas tool: read the document, then patch or write the change.`
      : `${lead} ${instruction}`
    haptic()
    void sendPrompt(msg).catch(e => toast(errText(e), 'error'))
    setSel('')
    window.getSelection()?.removeAllRanges()
  }

  const resetPanel = () => {
    if (panel.current) {
      panel.current.style.transition = ''
      panel.current.style.height = ''
    }
  }
  /** Drag from the handle or the tab row: the panel follows the finger, then snaps to the nearest rest position. */
  const dragProps = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (!panel.current || (e.target as HTMLElement).closest('.canvas-x')) return
      const now = performance.now()
      drag.current = { y: e.clientY, h: panel.current.offsetHeight, lastY: e.clientY, lastT: now, v: 0, cap: false }
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current
      if (!d || !panel.current || WIDE.matches) return // a side column on wide screens: no height to drag
      if (!d.cap) {
        if (Math.abs(e.clientY - d.y) < 8) return
        d.cap = true
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      const now = performance.now()
      if (now > d.lastT) d.v = (e.clientY - d.lastY) / (now - d.lastT)
      d.lastY = e.clientY
      d.lastT = now
      const h = Math.min(snapHeights().full, Math.max(40, d.h - (e.clientY - d.y)))
      panel.current.style.transition = 'none'
      panel.current.style.height = `${h}px`
    },
    onPointerCancel: () => {
      drag.current = null
      resetPanel()
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current
      drag.current = null
      const el = panel.current
      if (!d || !el) return
      el.style.transition = ''
      if (!d.cap) {
        el.style.height = ''
        if (e.currentTarget.classList.contains('canvas-grip')) setCanvasSize(size === 'full' ? 'half' : 'full')
        return
      }
      // Magnetic snap: project a little ahead with the finger's speed, then go to the nearest rest position.
      const { half, full } = snapHeights()
      const projected = el.offsetHeight - d.v * 160
      if (projected < half * 0.55 && (size === 'half' || el.offsetHeight < half * 0.75)) {
        el.style.height = '0px'
        window.setTimeout(() => closeCanvas(), 200)
        return
      }
      setCanvasSize(projected > (half + full) / 2 - full * 0.04 ? 'full' : 'half')
      el.style.height = ''
    }
  }

  return (
    <>
      <div ref={panel} className={`canvas-panel size-${size}`} role="dialog" aria-label="Canvas">
        <div className="canvas-grip" {...dragProps}>
          <span />
        </div>
        <div className="canvas-head" {...dragProps}>
          <div className="canvas-tabs">
            {docs.map(d => (
              <button key={d.id} className={`canvas-tab${d.id === activeId ? ' on' : ''}`} onClick={() => selectDoc(d.id)}>
                <span aria-hidden="true">{TYPE_ICON[d.type]}</span>
                <span className="canvas-tab-title">{d.title}</span>
              </button>
            ))}
            <button className="canvas-tab add" aria-label="New document" onClick={() => setMenu('new')}>
              ＋
            </button>
          </div>
          <button className="canvas-x" aria-label="Close canvas" onClick={() => closeCanvas()}>
            ✕
          </button>
        </div>

        {writing && (!meta || !writing.docId || writing.docId !== meta.id) ? (
          <CanvasWriting since={writing.since} title={writing.title} preview={writing.preview} />
        ) : !meta && listLoading ? (
          <div className="canvas-empty" aria-busy="true">
            <Spinner small />
            <div className="dim">Loading the canvas…</div>
          </div>
        ) : !meta ? (
          <div className="canvas-empty">
            <div className="canvas-empty-icon">🗒</div>
            <div className="canvas-empty-title">Your canvas is empty</div>
            <div className="dim">Ask Hermes to write something here, or start your own.</div>
            <button className="btn primary" onClick={() => setMenu('new')}>
              New document
            </button>
          </div>
        ) : (
          <>
            <div className="canvas-toolbar">
              <div className="seg small">
                <button
                  className={mode === 'view' ? 'on' : ''}
                  onClick={() => {
                    void flushSave()
                    setMode(meta.id, 'view')
                    // Editing takes the whole screen (the keyboard needs the room); go back to how it was.
                    if (sizeBeforeEdit.current) setCanvasSize(sizeBeforeEdit.current)
                    sizeBeforeEdit.current = null
                  }}
                >
                  {meta.type === 'html' ? 'Run' : 'View'}
                </button>
                <button
                  className={mode === 'edit' ? 'on' : ''}
                  onClick={() => {
                    setMode(meta.id, 'edit')
                    if (size !== 'full') {
                      sizeBeforeEdit.current = size
                      setCanvasSize('full')
                    }
                  }}
                >
                  Edit
                </button>
              </div>
              <span className={`save-state s-${save}`}>{save === 'saving' ? 'Saving…' : save === 'dirty' ? 'Unsaved' : save === 'saved' ? 'Saved ✓' : save === 'conflict' ? 'Conflict' : save === 'error' ? 'Not saved' : doc ? `${ago(doc.updated)}${doc.by === 'agent' ? ' · Hermes' : ''}` : ''}</span>
              {meta.type === 'html' && mode === 'view' && (
                <button className={`canvas-tool${net[meta.id] ? ' on' : ''}`} title="Allow the page to use the network" onClick={() => setNet(n => ({ ...n, [meta.id]: !n[meta.id] }))}>
                  {net[meta.id] ? '🌐 Online' : '🚫 Offline'}
                </button>
              )}
              <button className="canvas-tool" aria-label="Fill the whole screen" onClick={() => setCanvasSize('max')}>
                ⛶
              </button>
              <button className="canvas-tool" aria-label="More" onClick={() => setMenu('doc')}>
                ⋮
              </button>
            </div>

            {writing && writing.docId === meta.id && <WritingBanner since={writing.since} />}
            {remote === meta.id && (
              <div className="canvas-banner">
                <span>Hermes changed this document while you were editing.</span>
                <button onClick={() => void takeTheirs(meta.id)}>Use Hermes’s</button>
                <button onClick={() => void keepMine(meta.id)}>Keep mine</button>
              </div>
            )}

            <div className="canvas-body" ref={body}>
              {!doc ? (
                <div className="dim pad">Loading…</div>
              ) : mode === 'edit' ? (
                <Editor key={doc.id} doc={doc} onChange={t => editDoc(doc.id, t)} onSelect={setSel} />
              ) : (
                <DocView doc={doc} text={text} network={Boolean(net[doc.id])} />
              )}
            </div>

            {sel && (
              <div className="canvas-sel">
                <span className="canvas-sel-label">Ask Hermes about the selection</span>
                <div className="canvas-chips">
                  {ACTIONS.map(([label, instr]) => (
                    <button key={label} onClick={() => send(instr, sel)}>
                      {label}
                    </button>
                  ))}
                  <button
                    onClick={() =>
                      void promptDialog({ title: 'What should Hermes do with it?', placeholder: 'e.g. make it more formal', confirmLabel: 'Send' }).then(t => t && send(t, sel))
                    }
                  >
                    Other…
                  </button>
                </div>
              </div>
            )}

            {mode !== 'edit' && (
            <form
              className="canvas-ask"
              onSubmit={e => {
                e.preventDefault()
                if (!ask.trim()) return
                send(ask.trim())
                setAsk('')
              }}
            >
              <input value={ask} onChange={e => setAsk(e.target.value)} placeholder={`Ask Hermes to change “${meta.title}”…`} enterKeyHint="send" />
              <button type="submit" className="canvas-send" aria-label="Send" disabled={!ask.trim()}>
                ➤
              </button>
            </form>
            )}
          </>
        )}
      </div>
      {size === 'max' && (
        <button className="canvas-exit" aria-label="Exit full screen" onClick={() => setCanvasSize('full')}>
          ⤓
        </button>
      )}
      {menu === 'doc' && doc && <DocMenu doc={doc} text={text} onClose={() => setMenu(null)} onHistory={() => setMenu('history')} />}
      {menu === 'history' && doc && <HistorySheet doc={doc} onClose={() => setMenu(null)} />}
      {menu === 'new' && <NewDocMenu onClose={() => setMenu(null)} />}
    </>
  )
}

