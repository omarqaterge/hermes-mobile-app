import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { type ChatItem, toast } from '../store'
import { branchAt, resendFrom, retryTurn } from '../gateway'
import { Markdown } from './Markdown'
import { copyRich, copyText, haptic } from '../bridge'
import { PickerSheet } from './ui'
import { toggleSpeak, useVoice } from '../voice'
import { api } from '../api'
import { Media } from './Media'
import { DiffView, looksLikeDiff } from './Diff'
import { formatOutput, memoryDiff, plainText } from '../text'
import { runLabel, type ToolRun } from '../fold'
import { Spinner } from './Spinner'

// Stored outputs fetched for cards restored from history (resumed transcripts omit them).
const outputCache = new Map<string, string>()
// Ids we made up (`newId`) for tool rows without a tool_call_id. Real ids vary by provider: `call_…`, `toolu_…`.
const LOCAL_ID = /^[a-z]-[0-9a-z]+-\d+$/

const DIFF_DUP_ARGS = new Set(['content', 'old_string', 'new_string', 'patch', 'diff', 'old_text', 'new_text', 'operations'])

const TOOL_ICONS: Record<string, string> = {
  terminal: '⌘',
  execute_code: '▶',
  read_file: '📄',
  write_file: '✎',
  patch: '✎',
  search_files: '🔍',
  web_search: '🌐',
  web_extract: '🌐',
  browser_navigate: '🧭',
  skill_view: '✦',
  skills_list: '✦',
  memory: '🧠',
  todo: '☑',
  delegate_task: '⇶',
  clarify: '?',
  vision_analyze: '👁',
  image_generate: '🎨',
  send_message: '✉'
}

function fmtDuration(s?: number | null): string {
  if (s == null) return ''
  return s < 1 ? `${Math.round(s * 1000)}ms` : s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

function argsPreview(args?: Record<string, unknown> | null): string {
  if (!args) return ''
  const first = args.command ?? args.path ?? args.query ?? args.url ?? args.name ?? args.goal
  return typeof first === 'string' ? first : ''
}

export const ToolCard = memo(function ToolCard({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false)
  const [stored, setStored] = useState<string | null>(() => outputCache.get(item.id) ?? null)
  const [loadingOut, setLoadingOut] = useState(false)
  useEffect(() => {
    if (!open || item.resultText || stored != null || item.status !== 'done' || LOCAL_ID.test(item.id)) return
    setLoadingOut(true)
    api<{ content: string; truncated?: boolean }>('GET', `/api/plugins/hermes-mobile/tool-result?id=${encodeURIComponent(item.id)}`)
      .then(r => {
        const v = (r.content || '') + (r.truncated ? '\n… (truncated)' : '')
        outputCache.set(item.id, v)
        setStored(v)
      })
      .catch(() => setStored(''))
      .finally(() => setLoadingOut(false))
  }, [open, item.id, item.resultText, item.status, stored])
  const rawOut = item.resultText || stored || ''
  const out = rawOut ? formatOutput(rawOut) : null
  // Media produced by a tool (image generation, screenshots, recordings…).
  const mediaSrc =
    /(https?:\/\/[^\s"')]+\.(?:png|jpe?g|webp|gif|mp4|webm|mp3|m4a|wav)|(?:\/|~\/)[^\s"')]+\.(?:png|jpe?g|webp|gif|mp4|webm|mp3|m4a|wav))/i.exec(rawOut)?.[1] || null
  const label = item.context || argsPreview(item.args) || ''
  const memDiff = item.name === 'memory' && item.status !== 'error' ? memoryDiff(item.args, rawOut) : undefined
  // With a diff on screen, the file body / replaced strings in the args are just a noisier copy.
  const hasDiff = Boolean(item.inlineDiff || out?.diff || memDiff)
  const args = item.args && hasDiff ? Object.fromEntries(Object.entries(item.args).filter(([k]) => !DIFF_DUP_ARGS.has(k))) : item.args
  const icon = TOOL_ICONS[item.name] || '🔧'
  return (
    <div className={`tool tool-${item.status}${item.risk ? ' tool-risk' : ''}`}>
      <button className="tool-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="tool-icon">{icon}</span>
        <span className="tool-name">{item.name}</span>
        <span className="tool-label">{label}</span>
        <span className="tool-state">
          {item.status === 'generating' || item.status === 'running' ? <Spinner /> : null}
          {item.status === 'done' ? fmtDuration(item.duration) || '✓' : null}
          {item.status === 'error' ? '✕' : null}
        </span>
      </button>
      {open && (
        <div className="tool-body">
          {item.risk && <div className="tool-risk-note">⚠ {item.risk}</div>}
          {args && Object.keys(args).length > 0 && (
            <>
              <div className="tool-section">Arguments</div>
              <pre className="tool-pre">{JSON.stringify(args, null, 2)}</pre>
            </>
          )}
          {item.summary && (
            <>
              <div className="tool-section">Summary</div>
              <div className="tool-text">{item.summary}</div>
            </>
          )}
          {item.inlineDiff && (
            <>
              <div className="tool-section">Diff</div>
              <DiffView text={item.inlineDiff} />
            </>
          )}
          {memDiff && !item.inlineDiff && (
            <>
              <div className="tool-section">Diff</div>
              <DiffView text={memDiff} />
            </>
          )}
          {mediaSrc && <Media src={mediaSrc} />}
          {out?.diff && !item.inlineDiff && (
            <>
              <div className="tool-section">Diff</div>
              <DiffView text={out.diff} />
            </>
          )}
          {out && (out.text || !out.diff) && (
            <>
              <div className="tool-section">
                Output{out.meta ? <span className="dim"> · {out.meta}</span> : null}
                <button className="mini" onClick={() => void copyText(out.text)}>
                  Copy
                </button>
              </div>
              {looksLikeDiff(out.text) ? (
                <DiffView text={out.text} />
              ) : (
                <pre className="tool-pre">{out.text.length > 20000 ? out.text.slice(0, 20000) + '\n…' : out.text}</pre>
              )}
            </>
          )}
          {!out && loadingOut && <div className="tool-text dim">Loading output…</div>}
          {!out && !loadingOut && !item.summary && item.status === 'done' && stored !== null && <div className="tool-text dim">No output recorded</div>}
        </div>
      )}
    </div>
  )
})

/** The line a folded run of tool calls shows: icons of the tools used, "Ran 7 tools · 42s", a chevron. */
export const ToolRunHead = memo(function ToolRunHead({ id, run, open, onToggle }: { id: string; run: ToolRun; open: boolean; onToggle: (id: string) => void }) {
  return (
    <button className={`tool-run${run.running ? ' running' : ''}`} aria-expanded={open} onClick={() => { haptic(); onToggle(id) }}>
      <span className="tool-run-icons" aria-hidden="true">
        {run.names.slice(0, 4).map(n => (
          <span key={n} className="tool-icon">{TOOL_ICONS[n] || '🔧'}</span>
        ))}
      </span>
      <span className="tool-run-label">
        {runLabel(run)}
        {run.errors ? <span className="tool-run-err"> · {run.errors} failed</span> : null}
        <span className="tool-run-names">{run.names.join(', ')}</span>
      </span>
      {run.running ? <Spinner small /> : null}
      <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
    </button>
  )
})

/** Line brain (Lucide "brain", ISC licence), in the accent colour. */
function BrainIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375M6.003 5.125A3 3 0 0 0 6.401 6.5M3.477 10.896a4 4 0 0 1 .585-.396M19.938 10.5a4 4 0 0 1 .585.396M6 18a4 4 0 0 1-1.967-.516M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  )
}

function Reasoning({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false)
  if (!text.trim()) return null
  return (
    <div className={`reasoning${open ? ' open' : ''}`}>
      <button className="reasoning-head" onClick={() => setOpen(o => !o)}>
        <span className="reasoning-dot">{live ? <Spinner small /> : <BrainIcon />}</span>
        {live ? 'Thinking…' : 'Thought process'}
        <span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open ? <div className="reasoning-body">{text}</div> : live ? <div className="reasoning-peek">{text.slice(-160)}</div> : null}
    </div>
  )
}

function run(fn: () => Promise<void>): void {
  haptic()
  fn().catch(e => toast(e instanceof Error ? e.message : String(e), 'error'))
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button className="icon-act" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  )
}

/** The rendered message as clean HTML (no buttons or widgets), for pasting into Docs, Gmail, Notes… */
function richHtml(root: Element | null | undefined): string {
  const src = root?.querySelector('.md')
  if (!src) return ''
  const c = src.cloneNode(true) as HTMLElement
  c.querySelectorAll('button, svg, .codeblock-bar, .caret, script, style, [aria-hidden="true"]').forEach(e => e.remove())
  c.querySelectorAll('[class]').forEach(e => e.removeAttribute('class'))
  c.querySelectorAll('[style]').forEach(e => e.removeAttribute('style'))
  return c.innerHTML
}

function CopyBtn({ text, choose }: { text: string; choose?: boolean }) {
  const [done, setDone] = useState(false)
  const [menu, setMenu] = useState(false)
  const btn = useRef<HTMLDivElement>(null)
  const flash = () => {
    haptic()
    setDone(true)
    setTimeout(() => setDone(false), 1200)
  }
  return (
    <div ref={btn} style={{ display: 'contents' }}>
      <IconBtn
        label="Copy"
        onClick={() => {
          if (choose) return setMenu(true)
          void copyText(text)
          flash()
        }}
      >
        {done ? (
          <path d="M5 12l5 5L20 7" />
        ) : (
          <>
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </>
        )}
      </IconBtn>
      {menu && (
        <PickerSheet
          title="Copy reply"
          value=""
          options={[
            { value: 'text', label: 'Text only', sub: 'Plain words, no formatting marks' },
            { value: 'rich', label: 'With formatting', sub: 'Headings, bold, lists and tables when pasted into Docs, Gmail, Notes…' }
          ]}
          onPick={v => {
            if (v === 'text') void copyText(plainText(text))
            else {
              const html = richHtml(btn.current?.closest('.msg'))
              void (html ? copyRich(text, html) : copyText(text))
            }
            flash()
          }}
          onClose={() => setMenu(false)}
        />
      )}
    </div>
  )
}

function UserMsg({ item, actions, busy }: { item: Extract<ChatItem, { kind: 'user' }>; actions: boolean; busy: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.text)
  const time = useTimeTap(item.at)
  const ta = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ta.current
    if (!editing || !el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [editing, draft])
  if (editing)
    return (
      <div className="msg user editing">
        <textarea
          ref={ta}
          className="edit-box"
          value={draft}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          // Keep Cancel/Send visible once the keyboard has resized the view.
          onFocus={e => {
            const el = e.currentTarget.parentElement
            setTimeout(() => el?.scrollIntoView({ block: 'end', behavior: 'smooth' }), 350)
          }}
        />
        <div className="edit-bar">
          <button className="edit-cancel" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button
            className="edit-send"
            disabled={busy || !draft.trim()}
            onClick={() => {
              setEditing(false)
              run(() => resendFrom(item.id, draft))
            }}
          >
            Send
          </button>
        </div>
      </div>
    )
  return (
    <div className="msg user" onClick={time.toggle}>
      <div className="bubble">
        {item.images?.length || item.files?.length ? (
          <div className="attach-row">
            {item.images?.map((n, i) =>
              item.imageUrls?.[i] ? (
                <img key={`i-${n}-${i}`} className="msg-thumb" src={item.imageUrls[i]} alt={n} />
              ) : item.imagePaths?.[i] ? (
                <div key={`i-${n}-${i}`} className="msg-thumb-wrap">
                  <Media src={item.imagePaths[i]} alt={n} />
                </div>
              ) : (
                <span key={`i-${n}-${i}`} className="chip">🖼 {n}</span>
              )
            )}
            {item.files?.map(n => <span key={`f-${n}`} className="chip">📎 {n}</span>)}
          </div>
        ) : null}
        {item.text}
      </div>
      {time.node}
      {actions && (
        <div className="msg-actions user-actions">
          <CopyBtn text={item.text} />
          <IconBtn
            label="Edit"
            disabled={busy}
            onClick={() => {
              setDraft(item.text)
              setEditing(true)
              haptic()
            }}
          >
            <path d="M4 20h4L19 9l-4-4L4 16v4z" />
            <path d="M13.5 6.5l4 4" />
          </IconBtn>
        </div>
      )}
    </div>
  )
}

function SpeakBtn({ id, text }: { id: string; text: string }) {
  const on = useVoice(v => v.speakingId === id)
  return (
    <IconBtn label={on ? 'Stop reading' : 'Read aloud'} onClick={() => { haptic(); toggleSpeak(id, text) }}>
      {on ? (
        <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
      ) : (
        <>
          <path d="M4 10v4h4l5 4V6L8 10H4z" />
          <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
        </>
      )}
    </IconBtn>
  )
}

export const ItemView = memo(function ItemView({ item, actions = false, busy = false }: { item: ChatItem; actions?: boolean; busy?: boolean }) {
  switch (item.kind) {
    case 'user':
      return <UserMsg item={item} actions={actions} busy={busy} />
    case 'assistant':
      return <AssistantMsg item={item} actions={actions} busy={busy} />
    case 'tool':
      return <ToolCard item={item} />
    case 'subagent':
      return <SubagentView item={item} />
    case 'notice':
      return (
        <div className={`notice notice-${item.level}`}>
          <Markdown text={item.text} />
        </div>
      )
  }
})

function AssistantMsg({ item, actions, busy }: { item: Extract<ChatItem, { kind: 'assistant' }>; actions: boolean; busy: boolean }) {
  const time = useTimeTap(item.streaming ? undefined : item.at)
  return (
        <div className="msg assistant" onClick={time.toggle}>
          <Reasoning text={item.reasoning} live={item.streaming && !item.text} />
          {item.text && <Markdown text={item.text} streaming={item.streaming} />}
          {item.streaming && item.text && <span className="caret" />}
          {item.warning && <div className="warn-line">⚠ {item.warning}</div>}
          {!item.streaming && item.text && actions && (
            <div className="msg-actions">
              <CopyBtn text={item.text} choose />
              <SpeakBtn id={item.id} text={item.text} />
              <IconBtn label="Retry" disabled={busy} onClick={() => run(() => retryTurn(item.id))}>
                <path d="M20 11a8 8 0 1 0-2.3 5.7" />
                <path d="M20 4v7h-7" />
              </IconBtn>
              <IconBtn label="Branch" disabled={busy} onClick={() => run(() => branchAt(item.id))}>
                <circle cx="6" cy="5" r="2" />
                <circle cx="6" cy="19" r="2" />
                <circle cx="18" cy="7" r="2" />
                <path d="M6 7v10M18 9c0 5-12 3-12 8" />
              </IconBtn>
              {item.meta && <span className="msg-meta">{item.meta}</span>}
            </div>
          )}
          {time.node}
        </div>
  )
}

function SubagentView({ item }: { item: Extract<ChatItem, { kind: 'subagent' }> }) {
  return (
        <div className={`subagent sub-${item.status}`}>
          <div className="sub-head">
            <span>⇶ Sub-agent</span>
            <span className="sub-status">{item.status}</span>
          </div>
          <div className="sub-goal">{item.goal}</div>
          {item.detail && item.status !== 'done' && item.status !== 'completed' && <div className="sub-detail">{item.detail}</div>}
          {item.summary && <div className="sub-summary">{item.summary}</div>}
        </div>
  )
}

/** Tap a message (not a link, button, code or selected text) to show when it was sent. */
function useTimeTap(at?: number): { toggle: (e: React.MouseEvent) => void; node: React.ReactNode } {
  const [show, setShow] = useState(false)
  const toggle = (e: React.MouseEvent) => {
    if (!at) return
    const t = e.target as Element
    if (t.closest('a, button, input, textarea, summary, pre, code, table, .katex, .media, svg, .msg-actions')) return
    if (String(window.getSelection?.() || '')) return
    setShow(v => !v)
  }
  const d = at ? new Date(at) : null
  const today = d && d.toDateString() === new Date().toDateString()
  const node =
    show && d ? (
      <div className="msg-time">
        {today ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
      </div>
    ) : null
  return { toggle, node }
}
