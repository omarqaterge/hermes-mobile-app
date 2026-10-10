import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fmtPause, getLivePause, liveAvailable, setLiveMute, startLive, stopLive } from '../live'
import { startListening, stopListening, useVoice, voiceErrorText, voiceInputAvailable } from '../voice'
import { attachFile, clearAttachments, composerPrefill, detachAttachment, errText, interrupt, queueMessage, sendPrompt, unqueueMessage } from '../gateway'
import { getState, setState, toast, useStore, type Attachment } from '../store'
import { haptic } from '../bridge'
import { matchCommands, refreshCommands, useCommandCatalog, type CommandEntry } from '../commands'
import { PickerSheet, type Option } from './ui'
import { getDraft, setDraft } from '../drafts'
import { Spinner } from './Spinner'

const EMPTY: Attachment[] = []

const line = (d: string) => (
  <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)
const ATTACH_OPTIONS: Option[] = [
  {
    value: 'camera', label: 'Camera', sub: 'Take a picture now', tone: 'gold',
    icon: line('M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z')
  },
  {
    value: 'photo', label: 'Photo', sub: 'From your gallery', tone: 'blue',
    icon: line('M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01')
  },
  {
    value: 'file', label: 'File', sub: 'PDF, document, spreadsheet, text, code… (up to 20 MB)', tone: 'purple',
    icon: line('M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7zM14 3v4h4M9 13h6M9 17h4')
  }
]

const EFFORT_SHORT: Record<string, string> = { medium: 'med', minimal: 'min', none: 'off' }

export function Composer({ injected, onInjected }: { injected: string | null; onInjected: () => void }) {
  // Each chat keeps its own unsent text; the new-chat screen has one per profile.
  const draftKey = useStore(s => s.active?.storedId || `new:${s.profile}`)
  const fresh = useStore(s => (s.active?.items.length ?? 0) === 0)
  const keyRef = useRef(draftKey)
  const freshRef = useRef(fresh)
  const [text, setText] = useState(() => getDraft(draftKey))
  useLayoutEffect(() => {
    const prev = keyRef.current
    const wasFresh = freshRef.current
    freshRef.current = fresh
    if (prev === draftKey) return
    keyRef.current = draftKey
    // The new-chat screen just became a real chat (first attachment, share…), or an empty chat was replaced by
    // one with the picked model: the text stays with it.
    if ((prev.startsWith('new:') || wasFresh) && fresh) {
      setDraft(prev, '')
      setDraft(draftKey, text)
      return
    }
    setText(getDraft(draftKey))
  }, [draftKey, fresh]) // eslint-disable-line react-hooks/exhaustive-deps
  const listening = useVoice(v => v.listening)
  const live = useVoice(v => v.live)
  const liveMuted = useVoice(v => v.liveMuted)
  const livePartial = useVoice(v => v.partial)
  // Dictation inserts at the cursor: `pre`/`post` are the text before/after it, `live` the phrase still being
  // recognised (shown between them), `caret` where the cursor should be. Edits and cursor moves made while
  // dictating re-anchor it, so what you typed is never overwritten.
  const dict = useRef<{ pre: string; post: string; live: string; caret: number } | null>(null)
  const pendingCaret = useRef<number | null>(null)
  const [busy, setBusy] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [attachMenu, setAttachMenu] = useState(false)
  const [attaching, setAttaching] = useState(0)
  const running = useStore(s => s.active?.running ?? false)
  const model = useStore(s => s.active?.info.model ?? s.defaultModel)
  const effort = useStore(s => s.active?.info.reasoning_effort || s.defaultEffort)
  const attachments = useStore(s => s.active?.attachments ?? EMPTY)
  const conn = useStore(s => s.conn)
  const opening = useStore(s => s.opening)
  const profile = useStore(s => s.profile)
  const catalog = useCommandCatalog()

  // Slash autocomplete: open while the text is "/<letters>" (no space yet) and something matches.
  // The token can sit anywhere: a "/word" right before the caret, at the start or after whitespace.
  const [caret, setCaret] = useState(text.length)
  const tok = /(^|\s)(\/[^\s]*)$/.exec(text.slice(0, caret))
  const slashQuery = tok ? tok[2] : null
  const slashStart = tok ? caret - tok[2].length : 0
  const matches = slashQuery != null && catalog ? matchCommands(catalog, slashQuery) : []
  const showMenu = slashQuery != null && (catalog == null || matches.length > 0)

  // Warm the catalog in the background as soon as Hermes is reachable (and per profile).
  useEffect(() => {
    if (conn === 'open') refreshCommands()
  }, [conn, profile])
  useEffect(() => {
    if (slashQuery != null) refreshCommands()
  }, [slashQuery != null]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    composerPrefill.set = (t: string) => {
      setText(t)
      setCaret(t.length)
      ta.current?.focus()
    }
  }, [])

  const pick = (c: CommandEntry) => {
    haptic()
    const ins = `/${c.name} `
    const rest = text.slice(caret).replace(/^ /, '')
    setText(text.slice(0, slashStart) + ins + rest)
    const pos = slashStart + ins.length
    setCaret(pos)
    requestAnimationFrame(() => {
      ta.current?.focus()
      ta.current?.setSelectionRange(pos, pos)
    })
  }

  useEffect(() => {
    if (injected != null) {
      const v = injected + (injected.endsWith(' ') ? '' : ' ')
      setText(v)
      setCaret(v.length)
      onInjected()
      ta.current?.focus()
    }
  }, [injected, onInjected])

  useEffect(() => {
    setDraft(keyRef.current, text)
  }, [text])
  useLayoutEffect(() => {
    const c = pendingCaret.current
    if (c == null) return
    pendingCaret.current = null
    ta.current?.setSelectionRange(c, c) // never focuses, so the keyboard stays as it is
    setCaret(c)
  }, [text])

  /** Show `live` (a phrase being recognised, or a finished one when `done`) at the dictation cursor. */
  const dictate = (live: string, done: boolean) => {
    const d = dict.current
    if (!d) return
    const head = d.pre + (d.pre && live && !/\s$/.test(d.pre) ? ' ' : '') + live
    const tail = d.post && live && !/^\s/.test(d.post) ? ' ' + d.post : d.post
    d.caret = head.length
    if (done) {
      d.pre = head
      d.live = ''
    } else d.live = live
    pendingCaret.current = head.length
    setText(head + tail)
  }
  /** The user typed or moved the cursor while dictating: carry on from there. */
  const reanchor = (value: string, at: number) => {
    const d = dict.current
    if (!d) return
    d.pre = value.slice(0, at)
    d.post = value.slice(at)
    d.live = ''
    d.caret = at
  }

  const send = async () => {
    const t = text
    if (!t.trim() || busy) return
    haptic()
    if (conn !== 'open') {
      // Offline: keep it and send it on reconnect (one message; a second one joins it).
      const prev = getState().queued?.text
      queueMessage(prev ? `${prev}\n\n${t.trim()}` : t.trim())
      setText('')
      return
    }
    setBusy(true)
    setText('')
    try {
      await sendPrompt(t)
    } catch (err) {
      setText(t)
      toast(errText(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const offline = conn !== 'open' || !!opening
  const placeholder = opening ? 'Opening your chat…' : offline ? 'Offline: type now, it sends when Hermes is back' : running ? 'Steer the running task…' : 'Message Hermes'

  // Fit the box to its text (or placeholder). Measure again when the placeholder changes and when Live mode
  // gives the box back: a chat switched while it was hidden was measured at the wrong width and stayed 2 rows.
  useEffect(() => {
    const el = ta.current
    if (!el || live !== 'off') return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [text, placeholder, live])

  const queued = useStore(s => s.queued)

  const addFiles = async (files: File[]) => {
    setAttaching(n => n + files.length)
    for (const f of files) {
      try {
        await attachFile(f)
      } catch (err) {
        toast(errText(err), 'error')
      } finally {
        setAttaching(n => n - 1)
      }
    }
  }
  const detach = (a: Attachment) => {
    haptic()
    detachAttachment(a).catch(err => toast(errText(err), 'error'))
  }

  return (
    <div className="composer-wrap">
      {queued && (
        <div className="queued-chip">
          <span className="queued-text">⏳ Sends when Hermes is back: {queued.text.length > 80 ? queued.text.slice(0, 78) + '…' : queued.text}</span>
          <button
            className="icon-btn"
            aria-label="Don't send"
            onClick={() => {
              const t = unqueueMessage()
              setText(text ? `${t}\n\n${text}` : t)
            }}
          >
            ✕
          </button>
        </div>
      )}
      {showMenu && (
        <div className="slash-menu" role="listbox">
          {catalog == null && <div className="dim small pad">Loading commands…</div>}
          {matches.map(c => (
            <button key={`${c.kind}:${c.name}`} className="slash-item" onMouseDown={e => e.preventDefault()} onClick={() => pick(c)}>
              <span className="slash-name">
                /{c.name}
                {c.kind === 'skill' && <span className="tag">skill</span>}
              </span>
              <span className="slash-desc">{c.desc}</span>
            </button>
          ))}
        </div>
      )}
      {(attachments.length > 0 || attaching > 0) && (
        <div className="attach-row">
          {attachments.map((a, i) => (
            a.preview ? (
              <span key={`${a.path || a.name}-${i}`} className="attach-thumb">
                <img src={a.preview} alt={a.name} />
                <button className="attach-x" aria-label={`Remove ${a.name}`} onClick={() => detach(a)}>✕</button>
              </span>
            ) : (
            <span key={`${a.path || a.name}-${i}`} className="chip attach-chip">
              {a.kind === 'image' ? '🖼' : '📎'} <span className="attach-name">{a.name}</span>
              <button className="attach-x" aria-label={`Remove ${a.name}`} onClick={() => detach(a)}>
                ✕
              </button>
            </span>
            )
          ))}
          {attaching > 0 && (
            <span className="chip">
              <Spinner small /> Attaching…
            </span>
          )}
          {attachments.length > 1 && (
            <button
              className="mini"
              onClick={() => {
                haptic()
                clearAttachments().catch(err => toast(errText(err), 'error'))
              }}
            >
              clear
            </button>
          )}
        </div>
      )}
      {live !== 'off' && (
        <div className={`live-bar live-${live}`}>
          <span className="live-dot" />
          <div className="live-text">
            <div className="live-phase">
              Live · {liveMuted ? 'Mic muted' : live === 'listening' ? 'Listening…' : live === 'thinking' ? 'Hermes is thinking…' : 'Hermes is speaking…'}
            </div>
            {liveMuted ? (
              <div className="live-hint">Replies are still read aloud</div>
            ) : live === 'listening' && livePartial ? (
              <div className="live-partial">{livePartial}</div>
            ) : (
              <div className="live-hint">Pause for {fmtPause(getLivePause())} to send</div>
            )}
          </div>
          <button
            className={`live-mute${liveMuted ? ' on' : ''}`}
            aria-label={liveMuted ? 'Unmute microphone' : 'Mute microphone'}
            aria-pressed={liveMuted}
            onClick={() => {
              haptic()
              setLiveMute(!liveMuted)
            }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
              <path d="M17 12a5 5 0 0 1-10 0M12 17v4" />
              {liveMuted && <path d="M4 4l16 16" strokeWidth="2.4" />}
            </svg>
          </button>
          <button className="btn danger" onClick={() => { haptic(); stopLive() }}>
            End
          </button>
        </div>
      )}
      {live === 'off' && !showMenu && (
        // The model Hermes reports for this chat (session.info), or the profile default before a chat exists.
        <div className="model-row">
          <button className="model-chip" aria-label={`Model: ${model || 'none'}. Change model`} onClick={() => { haptic(); setState({ sheet: 'model' }) }} disabled={offline}>
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z" />
            </svg>
            <span className="model-chip-name">{model ? model.replace(/^.*\//, '') : 'Choose a model'}</span>
            {effort && model ? <span className="model-chip-effort">{EFFORT_SHORT[effort] ?? effort}</span> : null}
          </button>
        </div>
      )}
      <div className={`composer${live !== 'off' ? ' composer-hidden' : ''}`}>
        <button className="icon-btn" aria-label="Add" onClick={() => { haptic(); setAttachMenu(true) }} disabled={offline}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={e => {
            const files = Array.from(e.target.files || [])
            e.target.value = ''
            void addFiles(files)
          }}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={e => {
            const files = Array.from(e.target.files || [])
            e.target.value = ''
            void addFiles(files)
          }}
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={e => {
            const files = Array.from(e.target.files || [])
            e.target.value = ''
            void addFiles(files)
          }}
        />
        {attachMenu && (
          <PickerSheet
            title="Add"
            options={[
              {
                value: 'model',
                label: model ? model.replace(/^.*\//, '') : 'Choose a model',
                sub: `Model${effort ? ` · ${({ medium: 'medium', minimal: 'minimal' } as Record<string, string>)[effort] ?? effort} reasoning` : ''}: tap to change`,
                tone: 'teal',
                icon: line('M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z')
              },
              ...ATTACH_OPTIONS
            ]}
            value=""
            onPick={v => (v === 'model' ? setState({ sheet: 'model' }) : (v === 'camera' ? cameraInput : v === 'photo' ? photoInput : fileInput).current?.click())}
            onClose={() => setAttachMenu(false)}
          />
        )}
        <button
          className="icon-btn"
          aria-label="Commands"
          onMouseDown={e => e.preventDefault()}
          onClick={() => {
            const el = ta.current
            const at = el ? el.selectionStart : text.length
            if (!(slashQuery != null)) {
              const ins = at > 0 && !/\s/.test(text[at - 1]) ? ' /' : '/'
              setText(text.slice(0, at) + ins + text.slice(at))
              setCaret(at + ins.length)
              requestAnimationFrame(() => el?.setSelectionRange(at + ins.length, at + ins.length))
            }
            el?.focus()
          }}
          disabled={offline}
        >
          /
        </button>
        <textarea
          ref={ta}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={e => {
            setText(e.target.value)
            setCaret(e.target.selectionStart)
            reanchor(e.target.value, e.target.selectionStart)
          }}
          onSelect={e => {
            const el = e.currentTarget
            setCaret(el.selectionStart)
            const d = dict.current
            if (!d || el.selectionStart !== el.selectionEnd || el.selectionStart === d.caret) return
            // Cursor moved by hand: drop the half-recognised phrase (it comes back whole, at the new spot).
            let v = el.value
            let at = el.selectionStart
            if (d.live) {
              const s0 = d.pre.length + (d.pre && !/\s$/.test(d.pre) ? 1 : 0)
              const s1 = s0 + d.live.length
              v = v.slice(0, s0) + v.slice(s1)
              at = at >= s1 ? at - d.live.length : Math.min(at, s0)
              pendingCaret.current = at
              setText(v)
            }
            reanchor(v, at)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void send()
            }
          }}
        />
        {!text.trim() && !running && !listening && liveAvailable() && (
          <button
            className="send live-btn"
            aria-label="Live conversation"
            title={`Live: talk, pause ${fmtPause(getLivePause())} to send, Hermes answers out loud`}
            disabled={busy || offline}
            onClick={() => {
              haptic()
              startLive()
            }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
            </svg>
          </button>
        )}
        {!text.trim() && !running && !listening && voiceInputAvailable() ? (
          <button
            className="send mic"
            aria-label="Dictate"
            disabled={busy || offline}
            onClick={() => {
              haptic()
              const el = ta.current
              const at = el && document.activeElement === el ? el.selectionStart : text.length
              dict.current = { pre: text.slice(0, at), post: text.slice(at), live: '', caret: at }
              startListening((kind, t) => {
                // Keeps listening until you stop it: each finished phrase is inserted at the cursor, the live one shown there.
                if (kind === 'final') dictate(t, true)
                else if (kind === 'partial') dictate(t, false)
                else if (kind === 'error') toast(voiceErrorText(t), 'error', 8000)
                else if (kind === 'end') dict.current = null // no focus() here: it popped the keyboard up over the Send button
              })
            }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2z"/></svg>
          </button>
        ) : listening ? (
          <button className="send mic on" aria-label="Stop dictation" onClick={() => { haptic(); stopListening() }}>
            <span className="stop-square" />
          </button>
        ) : running && !text.trim() ? (
          <button className="send stop" aria-label="Stop" onClick={() => { haptic(); void interrupt() }}>
            <span className="stop-square" />
          </button>
        ) : (
          <button className="send" aria-label={running ? 'Steer' : conn !== 'open' ? 'Send when back online' : 'Send'} onClick={() => void send()} disabled={!text.trim() || busy || !!opening}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21.85 12.5c.8-.35.8-1.5 0-1.84L3.4 2.6c-.66-.29-1.39.2-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"/></svg>
          </button>
        )}
      </div>
    </div>
  )
}
