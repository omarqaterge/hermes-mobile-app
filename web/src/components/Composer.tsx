import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fmtPause, getLivePause, liveAvailable, setLiveMute, startLive, stopLive } from '../live'
import { startListening, stopListening, useVoice, voiceErrorText, voiceInputAvailable } from '../voice'
import { afterChatOpens, attachFile, clearAttachments, composerPrefill, detachAttachment, errText, interrupt, queueMessage, sendPrompt, setYolo, unqueueMessage } from '../gateway'
import { getState, setState, toast, useStore, type Attachment } from '../store'
import { haptic } from '../bridge'
import { matchCommands, refreshCommands, useCommandCatalog, type CommandEntry } from '../commands'
import { PickerSheet, type Option } from './ui'
import { getDraft, setDraft } from '../drafts'
import { Spinner } from './Spinner'
import { QuoteBar } from './QuoteBar'
import { ctxLevel, ringDash } from '../ctxring'
import { effortLevel } from '../effort'
import { clearStashes, pushStash, stashes, takeStash } from '../stash'
import { confirmDialog } from '../dialog'
import { plainTitle } from './Title'
import { ago } from '../unread'
import { QUEUE_MAX, enqueue, useQueue } from '../queue'
import { clearQuotes, removeQuote, setQuotes, useQuotes, withQuotes } from '../quote'

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

/** The reasoning level as 1-5 rising bars (a hollow bar for off); the level's text when it is one we don't know. */
function EffortBars({ effort }: { effort: string }) {
  const n = effortLevel(effort)
  if (n === null) return <span className="model-chip-effort">{effort}</span>
  if (n === 0) return <span className="model-chip-effort effort-bars" aria-hidden="true"><span className="effort-bar off" style={{ height: 10 }} /></span>
  return (
    <span className="model-chip-effort effort-bars" aria-hidden="true">
      {[0, 1, 2, 3, 4].map(i => (
        <span key={i} className={`effort-bar${i < n ? ' on' : ''}`} style={{ height: 4 + i * 2 }} />
      ))}
    </span>
  )
}


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
  const [stashMenu, setStashMenu] = useState(false)
  const [attaching, setAttaching] = useState(0)
  const running = useStore(s => s.active?.running ?? false)
  const model = useStore(s => s.active?.info.model ?? s.defaultModel)
  const effort = useStore(s => s.active?.info.reasoning_effort || s.defaultEffort)
  const yolo = useStore(s => s.active?.info.yolo === true && !s.active.autoAccess)
  const attachments = useStore(s => s.active?.attachments ?? EMPTY)
  const conn = useStore(s => s.conn)
  const opening = useStore(s => s.opening)
  const profile = useStore(s => s.profile)
  const catalog = useCommandCatalog()
  const quotes = useQuotes()
  const chatId = useStore(s => s.active?.storedId)
  const queue = useQueue(chatId)
  // Quotes belong to the chat they were taken from.
  useEffect(() => clearQuotes(), [chatId])

  // Slash autocomplete: open while the text is "/<letters>" (no space yet) and something matches.
  // The token can sit anywhere: a "/word" right before the caret, at the start or after whitespace.
  const [caret, setCaret] = useState(text.length)
  const tok = /(^|\s)(\/[^\s]*)$/.exec(text.slice(0, caret))
  const slashQuery = tok ? tok[2] : null
  const slashStart = tok ? caret - tok[2].length : 0
  const matches = slashQuery != null && catalog ? matchCommands(catalog, slashQuery) : []
  const showMenu = slashQuery != null && (catalog == null || matches.length > 0)

  // Warm the catalog in the background once Hermes is reachable and the chat has opened (commands.catalog and the
  // skills scan are heavy for Hermes on a phone), and per profile.
  useEffect(() => {
    if (conn !== 'open') return
    let current = true
    void afterChatOpens().then(() => current && getState().conn === 'open' && refreshCommands())
    return () => {
      current = false
    }
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

  // Stash: only the typed text is put aside; quotes and attachments stay where they are.
  const stashList = attachMenu || stashMenu ? stashes() : []
  const putText = (t: string) => {
    setText(t)
    setCaret(t.length)
    ta.current?.focus()
  }
  const stashDraft = () => {
    if (!text.trim()) return
    pushStash(text, chatId || null)
    putText('')
    toast('Draft stashed')
  }
  const unstash = async (id: string) => {
    if (id === 'clear') {
      if (await confirmDialog({ title: 'Clear all stashed drafts?', message: 'The drafts you put aside will be deleted.', confirmLabel: 'Clear', danger: true })) clearStashes()
      return
    }
    const st = takeStash(id)
    if (!st) return
    if (text.trim()) {
      pushStash(text, chatId || null)
      toast('Swapped with your stash')
    }
    putText(st.text)
  }

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

  /** Send `typed` (with the quotes in front of it, unless it is a slash command); the text box is cleared only when `fromBox`. */
  const send = async (over?: { quotes: string[]; typed: string }, mode: 'send' | 'queue' = 'send') => {
    const fromBox = !over
    const t = over ? over.typed : text
    const slash = fromBox && t.trimStart().startsWith('/')
    const qs = slash ? [] : over ? over.quotes : quotes
    if ((!t.trim() && !qs.length) || busy) return
    haptic()
    const full = withQuotes(qs, t)
    if (mode === 'queue') {
      // Waits for the end of the running reply (queue.ts); the quotes go with it, as in a normal send.
      if (!chatId || slash || attachments.length) return
      if (!enqueue(chatId, full.trim())) return void toast(`The queue is full (${QUEUE_MAX} messages)`, 'error')
      setText('')
      if (qs.length) clearQuotes()
      return
    }
    if (conn !== 'open') {
      // Offline: keep it and send it on reconnect (one message; a second one joins it).
      const prev = getState().queued?.text
      queueMessage(prev ? `${prev}\n\n${full.trim()}` : full.trim())
      if (fromBox) setText('')
      if (qs.length && fromBox) clearQuotes()
      return
    }
    setBusy(true)
    if (fromBox) setText('')
    if (fromBox && qs.length) clearQuotes()
    try {
      await sendPrompt(full)
    } catch (err) {
      if (fromBox) {
        setText(t)
        if (qs.length) setQuotes(qs)
      }
      toast(errText(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const offline = conn !== 'open' || !!opening
  const placeholder = opening ? 'Opening your chat…' : quotes.length && !text ? 'Ask about the quote…' : offline ? 'Offline: type now, it sends when Hermes is back' : running ? 'Queue or steer a follow-up…' : 'Message Hermes'

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
          <span className="queued-text">⏳ Sends when Hermes is back: {queued.text.length > 80 ? queued.text.slice(0, 78) + '…' : queued.text}{queued.atts?.length ? ` (📎 ${queued.atts.length} attached)` : ''}</span>
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
      <QuoteBar onExplain={sel => void send({ quotes: [sel], typed: 'Explain this.' })} />
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
      {quotes.length > 0 && (
        <div className="attach-row quote-row">
          {quotes.map((q, i) => (
            <span key={`${i}-${q.slice(0, 20)}`} className="chip quote-chip">
              <span className="quote-chip-text">❝ {q.replace(/\s+/g, ' ').slice(0, 60)}{q.length > 60 ? '…' : ''}</span>
              <button className="attach-x" aria-label="Remove quote" onClick={() => { haptic(); removeQuote(i) }}>
                ✕
              </button>
            </span>
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
          <button className="model-chip" aria-label={`Model: ${model || 'none'}${effort && model ? `, reasoning ${effort === 'none' ? 'off' : effort}` : ''}. Change model`} onClick={() => { haptic(); setState({ sheet: 'model' }) }} disabled={offline}>
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z" />
            </svg>
            <span className="model-chip-name">{model ? model.replace(/^.*\//, '') : 'Choose a model'}</span>
            {effort && model ? <EffortBars effort={effort} /> : null}
          </button>
          {yolo && (
            // Full access (/yolo): commands run without asking. Tap to turn it off (Auto access shows only in the header).
            <button
              className="yolo-chip"
              aria-label="Full access is on: Hermes runs commands without asking. Tap to turn it off"
              onClick={() => {
                haptic()
                const a = getState().active
                if (a) void setYolo(a, false).then(() => toast('Full access off: Hermes asks before risky commands again'), e => toast(errText(e), 'error'))
              }}
              disabled={offline}
            >
              ⚡ Full access
            </button>
          )}
          <ContextRing />
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
        {stashMenu && (
          <PickerSheet
            title="Stashed drafts"
            options={[
              ...stashList.map(st => ({
                value: st.id,
                label: (st.text.trim().split('\n')[0] || '').slice(0, 60),
                sub: `${ago(st.at)} · ${(st.chat && plainTitle(getState().sessions.find(x => x.id === st.chat)?.title)) || 'New chat'}`,
                tone: 'gray' as const
              })),
              { value: 'clear', label: 'Clear all stashed drafts', tone: 'red' as const, icon: line('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3') }
            ]}
            value=""
            onPick={unstash}
            onClose={() => setStashMenu(false)}
          />
        )}
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
              ...ATTACH_OPTIONS,
              ...(text.trim() ? [{ value: 'stash', label: 'Stash draft', sub: 'Put this text aside and clear the box', tone: 'gray' as const, icon: line('M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM3 4h18v4H3zM12 11v5M9.5 13.5L12 16l2.5-2.5') }] : []),
              ...(stashList.length ? [{ value: 'stashes', label: `Stashed drafts (${stashList.length})`, sub: stashList[0].text.trim().slice(0, 50), tone: 'gray' as const, icon: line('M12 3l9 4.5-9 4.5-9-4.5zM3 12l9 4.5 9-4.5M3 16.5L12 21l9-4.5') }] : [])
            ]}
            value=""
            onPick={v => (v === 'model' ? setState({ sheet: 'model' }) : v === 'stash' ? stashDraft() : v === 'stashes' ? setStashMenu(true) : (v === 'camera' ? cameraInput : v === 'photo' ? photoInput : fileInput).current?.click())}
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
              void send(undefined, running ? 'queue' : 'send')
            }
          }}
        />
        {!text.trim() && !quotes.length && !running && !listening && liveAvailable() && (
          <button key="live"
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
        {!text.trim() && !quotes.length && !running && !listening && voiceInputAvailable() ? (
          <button key="mic"
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
          <button key="mic-on" className="send mic on" aria-label="Stop dictation" onClick={() => { haptic(); stopListening() }}>
            <span className="stop-square" />
          </button>
        ) : running && !text.trim() && !quotes.length ? (
          <button key="stop" className="send stop" aria-label="Stop" onClick={() => { haptic(); void interrupt() }}>
            <span className="stop-square" />
          </button>
        ) : running ? (
          <Fragment key="run">
            <button className="send steer" aria-label="Steer" title="Send into the running task now" onClick={() => void send()} disabled={busy || !!opening}>
              Steer
            </button>
            <button
              className="send queue"
              aria-label={queue.items.length >= QUEUE_MAX ? 'Queue (full)' : attachments.length ? 'Queue (remove attachments first)' : 'Queue'}
              title="Send after the running reply ends"
              onClick={() => void send(undefined, 'queue')}
              disabled={busy || !!opening || !chatId || text.trimStart().startsWith('/') || attachments.length > 0 || queue.items.length >= QUEUE_MAX}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21.85 12.5c.8-.35.8-1.5 0-1.84L3.4 2.6c-.66-.29-1.39.2-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"/></svg>
              <svg className="queue-badge" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><circle cx="12" cy="12" r="9" fill="var(--accent)" /><path d="M12 7v5l3 2" /></svg>
            </button>
          </Fragment>
        ) : (
          <button key="send" className="send" aria-label={conn !== 'open' ? 'Send when back online' : 'Send'} onClick={() => void send()} disabled={(!text.trim() && !quotes.length) || busy || !!opening}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21.85 12.5c.8-.35.8-1.5 0-1.84L3.4 2.6c-.66-.29-1.39.2-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"/></svg>
          </button>
        )}
      </div>
    </div>
  )
}

/** Small ring at the right end of the model row: how full the chat's context window is. Tap for the details sheet. */
function ContextRing() {
  const ctx = useStore(s => s.active?.ctx)
  if (!ctx) return null
  const pct = Math.min(100, Math.max(0, ctx.percent))
  const { dasharray, dashoffset } = ringDash(pct, 7)
  const label = pct > 0 && pct < 1 ? '<1' : String(Math.round(pct))
  return (
    <button className={`ctx-ring ${ctxLevel(pct)}`} aria-label={`Context ${label}% used. Show details`} onClick={() => { haptic(); setState({ sheet: 'context' }) }}>
      <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" fill="none" strokeWidth="2.5">
        <circle className="ctx-ring-track" cx="9" cy="9" r="7" />
        <circle className="ctx-ring-fill" cx="9" cy="9" r="7" strokeLinecap="round" strokeDasharray={dasharray} strokeDashoffset={dashoffset} transform="rotate(-90 9 9)" />
      </svg>
    </button>
  )
}
