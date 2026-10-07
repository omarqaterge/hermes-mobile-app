import { useEffect, useRef, useState } from 'react'
import { askBtw, closeBtw, useBtw } from '../btw'
import { useBackHandler } from '../backstack'
import { haptic } from '../bridge'
import { useSheetDrag } from './useSheetDrag'
import { Markdown } from './Markdown'
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
  return (
    <div className="sheet-backdrop" onClick={closeBtw}>
      <div className="sheet btw" role="dialog" ref={drag.ref} {...drag.bind} onClick={e => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-title">By the way</div>
        <div className="btw-hint dim small">Ask about this chat without interrupting it. Hermes sees the conversation so far.</div>
        <div className="sheet-scroll btw-list">
          {msgs.map(m => (
            <div key={m.id}>
              <div className="btw-q">{m.q}</div>
              <div className={`btw-a${m.error ? ' err' : ''}`}>{m.a === null ? <Spinner small /> : <Markdown text={m.a} />}</div>
            </div>
          ))}
          <div ref={end} />
        </div>
        <div className="btw-input">
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
            ➤
          </button>
        </div>
      </div>
    </div>
  )
}
