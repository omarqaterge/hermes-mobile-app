// In-app confirmation / text-entry dialogs, styled like the rest of the app (bottom sheets).
// They replace the browser's confirm()/prompt(), which show a foreign "The page at file:// says" box.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { haptic } from './bridge'
import { useBackHandler } from './backstack'
import { useSheetDrag } from './components/useSheetDrag'

interface Base {
  title: string
  message?: string
  /** Lines shown under the message, left-aligned (e.g. the files a restore changes). */
  list?: string[]
  /** Replaces the default icon (🗑 for danger). */
  icon?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}
interface ConfirmReq extends Base {
  kind: 'confirm'
  resolve: (ok: boolean) => void
}
interface PromptReq extends Base {
  kind: 'prompt'
  placeholder?: string
  value?: string
  /** When set, the confirm button stays disabled until the text equals this (type-the-name deletes). */
  match?: string
  resolve: (v: string | null) => void
}
type Req = ConfirmReq | PromptReq

let queue: Req[] = []
const subs = new Set<() => void>()
const emit = () => subs.forEach(f => f())
const push = (r: Req) => {
  queue = [...queue, r]
  emit()
}
const pop = () => {
  queue = queue.slice(1)
  emit()
}

export const confirmDialog = (o: Base): Promise<boolean> => new Promise(resolve => push({ kind: 'confirm', ...o, resolve }))
export const promptDialog = (o: Base & { placeholder?: string; value?: string; match?: string }): Promise<string | null> =>
  new Promise(resolve => push({ kind: 'prompt', ...o, resolve }))

function Dialog({ req }: { req: Req }) {
  const [text, setText] = useState(req.kind === 'prompt' ? req.value || '' : '')
  const input = useRef<HTMLInputElement>(null)
  const done = (v: boolean) => {
    haptic()
    if (req.kind === 'confirm') req.resolve(v)
    else req.resolve(v ? text.trim() : null)
    pop()
  }
  const drag = useSheetDrag(() => done(false))
  useBackHandler(() => done(false))
  useEffect(() => {
    if (req.kind === 'prompt') setTimeout(() => input.current?.focus(), 250)
  }, [req])
  const ready = req.kind !== 'prompt' || (req.match !== undefined ? text.trim() === req.match : true)
  return (
    <div className="sheet-backdrop dialog-backdrop" onClick={() => done(false)}>
      <div className="sheet dialog" role="alertdialog" ref={drag.ref} {...drag.bind} onClick={e => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className={`dialog-icon${req.danger ? ' danger' : ''}`} aria-hidden="true">
          {req.icon ?? (req.danger ? '🗑' : req.kind === 'prompt' ? '✎' : '?')}
        </div>
        <div className="dialog-title">{req.title}</div>
        {req.message && <div className="dialog-msg">{req.message}</div>}
        {req.list && req.list.length > 0 && (
          <ul className="dialog-list">
            {req.list.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
        {req.kind === 'prompt' && (
          <input
            ref={input}
            className="sheet-input"
            value={text}
            placeholder={req.placeholder}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && ready && done(true)}
          />
        )}
        <div className="dialog-actions">
          <button className="btn" onClick={() => done(false)}>
            {req.cancelLabel || 'Cancel'}
          </button>
          <button className={`btn ${req.danger ? 'danger-solid' : 'primary'}`} disabled={!ready} onClick={() => done(true)}>
            {req.confirmLabel || (req.danger ? 'Delete' : 'OK')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function DialogHost() {
  const req = useSyncExternalStore(
    cb => (subs.add(cb), () => subs.delete(cb)),
    () => queue[0] ?? null
  )
  return req ? <Dialog key={queue.length + req.title} req={req} /> : null
}
