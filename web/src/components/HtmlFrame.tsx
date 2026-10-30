import { useEffect, useMemo, useRef, useState } from 'react'
import { openExternal } from '../bridge'
import { toast } from '../store'
import { confirmDialog } from '../dialog'
import { frameDoc, frameHeight } from '../htmlframe'

/**
 * HTML runs in a sandboxed frame: scripts yes, but no access to the app (no `allow-same-origin`), and no network
 * unless allowed. With `autoHeight` the frame grows to the page's own height (clamped to min..max px).
 */
export function HtmlFrame({ html, network, autoHeight, className }: { html: string; network: boolean; autoHeight?: { min: number; max: number }; className?: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [err, setErr] = useState('')
  const [h, setH] = useState<number | null>(null)
  const auto = !!autoHeight
  const min = autoHeight?.min ?? 0
  const max = autoHeight?.max ?? 0
  const srcDoc = useMemo(() => frameDoc(html, network, auto), [html, network, auto])
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
      } else if (auto && 'hmFrameHeight' in e.data) {
        const next = frameHeight(e.data.hmFrameHeight, min, max)
        if (next != null) setH(next)
      }
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [srcDoc, auto, min, max])
  return (
    <div className={`html-wrap${auto ? ' auto' : ''}`}>
      {err && <div className="html-err">⚠ {err}</div>}
      <iframe
        ref={frame}
        className={`html-frame${className ? ` ${className}` : ''}`}
        title="Preview"
        sandbox="allow-scripts allow-forms allow-modals"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        style={auto ? { height: h ?? min } : undefined}
      />
    </div>
  )
}
