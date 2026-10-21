// The app Hermes drives on a hidden display: a small card above the composer (name, action, live thumbnail)
// that opens a full-screen viewer with Take over / Stop. Frames come from the shell (bgapp.ts), only while
// this is on screen and the page is visible.
import { useEffect, useState } from 'react'
import { bgForChat, useBgFrame, wantFrames } from '../bgapp'
import { bgAction, haptic } from '../bridge'
import { useBackHandler } from '../backstack'
import { toast, useStore } from '../store'
import { useSheetDrag } from './useSheetDrag'

const THUMB_W = 200
const VIEW_W = 540

export function BgApp() {
  const chat = useStore(s => (s.active ? s.active.storedId : s.opening))
  const bg = useStore(s => bgForChat(s.bg, chat))
  const [open, setOpen] = useState(false)
  const shown = bg != null
  useEffect(() => {
    if (!shown) return
    return wantFrames(THUMB_W)
  }, [shown])
  useEffect(() => {
    if (!shown) setOpen(false)
  }, [shown])
  const frame = useBgFrame()
  if (!bg) return null
  return (
    <>
      <button className="bg-card" onClick={() => setOpen(true)} aria-label={`Using ${bg.label}. Open live view`}>
        <span className="bg-thumb">{frame ? <img src={frame} alt="" draggable={false} /> : <span className="bg-thumb-empty">📱</span>}</span>
        <span className="bg-card-text">
          <span className="bg-card-title">Using {bg.label}</span>
          <span className="bg-card-action">{bg.action || 'Working in the background…'}</span>
        </span>
        <span className="bg-card-chev">›</span>
      </button>
      {open && <BgViewer label={bg.label} action={bg.action} onClose={() => setOpen(false)} />}
    </>
  )
}

function BgViewer({ label, action, onClose }: { label: string; action: string; onClose: () => void }) {
  const drag = useSheetDrag(onClose)
  useBackHandler(onClose)
  useEffect(() => wantFrames(VIEW_W), [])
  const frame = useBgFrame()
  const run = (what: 'stop' | 'take_over') => {
    haptic()
    const r = bgAction(what)
    if (r === 'ok') {
      toast(what === 'stop' ? `Stopped ${label}` : `${label} is on your screen now`)
      onClose()
    } else toast(r.replace(/^error:\s*/, '') || 'Could not do that', 'error')
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet tall bg-viewer" role="dialog" aria-label={`Using ${label}`} ref={drag.ref} {...drag.bind} onClick={e => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-title">Using {label}</div>
        <div className="bg-view">{frame ? <img src={frame} alt={`Live view of ${label}`} draggable={false} /> : <span className="dim">Waiting for the first picture…</span>}</div>
        <div className="bg-caption">{action || 'Working in the background…'}</div>
        <div className="sheet-actions">
          <button className="btn primary" onClick={() => run('take_over')}>
            Take over
          </button>
          <button className="btn danger" onClick={() => run('stop')}>
            Stop
          </button>
        </div>
      </div>
    </div>
  )
}
