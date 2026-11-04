import { useEffect, useRef, useState } from 'react'
import { askBtw, clearBtw, closeBtw, useBtw } from '../btw'
import { useBackHandler } from '../backstack'
import { haptic } from '../bridge'
import { confirmDialog } from '../dialog'
import { useSheetDrag } from './useSheetDrag'
import { Markdown } from './Markdown'
import { useTainted } from '../phone-data-taint'
import { Spinner } from './Spinner'

/** /btw: a small side chat about the open chat, as a bottom sheet over it. */
export function BtwSheet() {
  const { open, msgs } = useBtw()
  if (!open) return null
  return <Inner msgs={msgs} />
}

function Inner({ msgs }: { msgs: ReturnType<typeof useBtw>['msgs'] }) {
  const drag = useSheetDrag(closeBtw)
  useBackHandler(closeBtw)
  const [text, setText] = useState('')
  const tainted = useTainted()
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [msgs])
  const send = () => {
    if (!text.trim()) return
    haptic()
    void askBtw(text)
    setText('')
  }
  const clear = async () => {
    if (await confirmDialog({ title: 'Clear this side chat?', message: 'Its questions and answers go; the main chat stays as it is.', confirmLabel: 'Clear', danger: true })) clearBtw()
  }
  return (
    <div className="sheet-backdrop" onClick={closeBtw}>
      <div className="sheet btw" role="dialog" ref={drag.ref} {...drag.bind} onClick={e => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="btw-head">
          <div className="sheet-title">By the way</div>
          {/* Its own pointerdown, so the sheet's drag-to-close (top 64 px) doesn't capture the tap. */}
          <button className="btw-clear" onPointerDown={e => e.stopPropagation()} onClick={() => void clear()} disabled={!msgs.length}>
            Clear
          </button>
        </div>
        <div className="btw-hint dim small">Ask about this chat without interrupting it. Hermux sees the conversation so far.</div>
        <div className="sheet-scroll btw-list">
          {msgs.map(m => (
            <div key={m.id}>
              <div className="btw-q">{m.q}</div>
              <div className={`btw-a${m.error ? ' err' : ''}`}>{m.a === null ? <Spinner small /> : <Markdown text={m.a} guard={tainted} />}</div>
            </div>
          ))}
          <div ref={end} />
        </div>
        <div className="composer-wrap btw-input">
          <div className="composer">
            <textarea
              rows={1}
              autoFocus
              placeholder="Ask a quick question…"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <button className="send" aria-label="Send" onClick={send} disabled={!text.trim()}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21.85 12.5c.8-.35.8-1.5 0-1.84L3.4 2.6c-.66-.29-1.39.2-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
