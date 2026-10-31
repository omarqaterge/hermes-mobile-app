import { useEffect, useRef, useState } from 'react'
import { drainQueue, errText, sendPrompt } from '../gateway'
import { haptic } from '../bridge'
import { editQueued, removeQueued, restoreFirst, setPaused, useQueue, type Queued } from '../queue'
import { toast, useStore } from '../store'

const ico = (d: string) => (
  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

/** The follow-ups waiting for the running reply to end: dashed bubbles at the end of the chat (not part of `items`). */
export function QueuedRows() {
  const chat = useStore(s => s.active?.storedId)
  const running = useStore(s => s.active?.running ?? false)
  const { items, paused } = useQueue(chat)
  if (!chat || !items.length) return null
  return (
    <div className="queued-rows">
      {paused && (
        <div className="queue-paused">
          <span>Queue paused</span>
          <button
            className="mini"
            onClick={() => {
              haptic()
              if (running) setPaused(chat, false) // sent when this reply ends
              else drainQueue(chat, true)
            }}
          >
            Resume
          </button>
        </div>
      )}
      {items.map((q, i) => (
        <QueuedRow key={q.id} chat={chat} q={q} index={i} total={items.length} />
      ))}
    </div>
  )
}

function QueuedRow({ chat, q, index, total }: { chat: string; q: Queued; index: number; total: number }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(q.text)
  const ta = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ta.current
    if (!editing || !el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [editing, draft])
  const head = `Queued · ${index + 1} of ${total}`
  if (editing)
    return (
      <div className="msg user queued-msg editing">
        <div className="queued-head">{head}</div>
        <textarea ref={ta} className="edit-box" value={draft} autoFocus onChange={e => setDraft(e.target.value)} />
        <div className="edit-bar">
          <button className="edit-cancel" onClick={() => { setEditing(false); setDraft(q.text) }}>
            Cancel
          </button>
          <button
            className="edit-send"
            disabled={!draft.trim()}
            onClick={() => {
              haptic()
              editQueued(chat, q.id, draft.trim())
              setEditing(false)
            }}
          >
            Save
          </button>
        </div>
      </div>
    )
  return (
    <div className="msg user queued-msg">
      <div className="queued-head">{head}</div>
      <div className="bubble">{q.text}</div>
      <div className="queued-actions">
        <button
          className="icon-btn"
          aria-label="Send queued message now"
          onClick={() => {
            haptic()
            removeQueued(chat, q.id)
            sendPrompt(q.text).catch(e => {
              restoreFirst(chat, q)
              toast(errText(e), 'error')
            })
          }}
        >
          {ico('M12 19V5M5 12l7-7 7 7')}
        </button>
        <button className="icon-btn" aria-label="Edit queued message" onClick={() => { haptic(); setDraft(q.text); setEditing(true) }}>
          {ico('M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4')}
        </button>
        <button className="icon-btn" aria-label="Remove queued message" onClick={() => { haptic(); removeQueued(chat, q.id) }}>
          {ico('M6 6l12 12M18 6L6 18')}
        </button>
      </div>
    </div>
  )
}
