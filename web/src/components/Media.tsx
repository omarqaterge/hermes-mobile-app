import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { useBackHandler } from '../backstack'
import { canNativeImage, haptic, nativeImage, openExternal, openFile } from '../bridge'
import { toast } from '../store'

export { mediaKind, type MediaKind } from '../text'
import { mediaKind } from '../text'

const isRemote = (s: string) => /^(https?:|data:|blob:)/i.test(s)

/** Turn a path Hermes wrote (/root/…, ~/…, /sdcard/…, file://…) into an absolute path on the phone. */
export function localPath(src: string): string {
  let p = decodeURI(src.replace(/^file:\/\//, ''))
  if (p.startsWith('~/')) p = `/root/${p.slice(2)}`
  return p
}

const MAX_INLINE = 25 * 1024 * 1024
const cache = new Map<string, Promise<string>>()

/** data: URL for a file on the phone, read through the Hermes dashboard's files API. */
function loadLocal(path: string): Promise<string> {
  let p = cache.get(path)
  if (!p) {
    p = api<{ data_url: string; size?: number }>('GET', `/api/files/read?path=${encodeURIComponent(path)}`, undefined, { profile: false }).then(r => {
      if ((r.size ?? 0) > MAX_INLINE) throw new Error('too large to show inline')
      return r.data_url
    })
    p.catch(() => cache.delete(path))
    cache.set(path, p)
  }
  return p
}

// In the phone app, media streams from the plugin's /media through the shell (byte ranges: video seeks, nothing
// is base64'd through the bridge). The prefix carries a per-page key; see MainActivity.media.
let streamBase: string | null | undefined
function streamUrl(src: string): string | null {
  if (streamBase === undefined) {
    const n = window.HermesAndroid as unknown as { mediaBase?: () => string } | undefined
    streamBase = (n?.mediaBase && n.mediaBase()) || null
  }
  return streamBase ? streamBase + encodeURIComponent(localPath(src)) : null
}

function useSrc(src: string): { url: string | null; error: string } {
  const [url, setUrl] = useState<string | null>(isRemote(src) ? src : streamUrl(src))
  const [error, setError] = useState('')
  useEffect(() => {
    if (isRemote(src)) {
      setUrl(src)
      return
    }
    const streamed = streamUrl(src)
    if (streamed) {
      setError('')
      setUrl(streamed)
      return
    }
    let alive = true
    setUrl(null)
    loadLocal(localPath(src))
      .then(u => alive && setUrl(u))
      .catch(e => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [src])
  return { url, error }
}

function openWith(src: string) {
  if (isRemote(src) && !src.startsWith('data:')) openExternal(src)
  else if (!openFile(localPath(src))) toast('Open works in the phone app', 'warn')
}

function toBase64(url: string): Promise<string> {
  return fetch(url)
    .then(r => r.blob())
    .then(
      b =>
        new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
          r.onerror = () => reject(r.error)
          r.readAsDataURL(b)
        })
    )
}

/** Save (Pictures/Hermes) or share an image. `src` is what Hermes gave (a path or a URL), `shown` the URL on screen. */
async function imageAction(kind: 'save' | 'share', src: string, shown: string, name: string): Promise<void> {
  haptic()
  if (!canNativeImage()) {
    if (kind === 'share') return toast('Sharing works in the phone app', 'warn')
    const a = document.createElement('a')
    a.href = shown
    a.download = name
    a.click()
    return
  }
  let ok = false
  try {
    // Phone files go by path (the shell reads them like media()); blob:/data:/web images go as their bytes.
    ok = isRemote(src) ? await nativeImage(kind, name, '', await toBase64(src)) : await nativeImage(kind, name, localPath(src), '')
  } catch {
    ok = false
  }
  if (kind === 'save') toast(ok ? 'Saved to Pictures/Hermes' : "Couldn't save the image", ok ? 'info' : 'error')
  else if (!ok) toast("Couldn't share the image", 'error')
}

type View = { z: number; x: number; y: number }
const ONE: View = { z: 1, x: 0, y: 0 }

/** Full-screen image: pinch to zoom, drag to pan, double-tap for 1× / 2.5×, Save / Share / Open with…; Back closes. */
export function Lightbox({ src, url, alt, onClose }: { src: string; url: string; alt?: string; onClose: () => void }) {
  const [view, setView] = useState<View>(ONE)
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; z: number } | null>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)
  const lastTap = useRef(0)
  useBackHandler(onClose)
  const name = alt || localPath(src).split('/').pop() || 'image'
  const local = !isRemote(src)
  const dist = () => {
    const [a, b] = [...pts.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-label={name}
      onClick={e => {
        e.stopPropagation()
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="lightbox-stage"
        onClick={e => {
          if (e.target === e.currentTarget && view.z === 1) onClose()
        }}
        onPointerDown={e => {
          pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (pts.current.size === 2) {
            pinch.current = { d: dist(), z: view.z }
            drag.current = null
          } else drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }
        }}
        onPointerMove={e => {
          if (!pts.current.has(e.pointerId)) return
          pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (pts.current.size === 2 && pinch.current) {
            const p = pinch.current
            const z = Math.min(6, Math.max(1, (p.z * dist()) / p.d))
            setView(v => (z === 1 ? ONE : { ...v, z }))
          } else if (drag.current) {
            const d = drag.current
            const dx = e.clientX - d.x, dy = e.clientY - d.y
            if (Math.abs(dx) + Math.abs(dy) > 8) d.moved = true
            if (d.moved) setView(v => (v.z > 1 ? { ...v, x: d.vx + dx, y: d.vy + dy } : v))
          }
        }}
        onPointerUp={e => {
          pts.current.delete(e.pointerId)
          const wasPinch = pinch.current != null
          if (pts.current.size < 2) pinch.current = null
          const tap = drag.current && !drag.current.moved && !wasPinch
          drag.current = null
          if (!tap || (e.target as Element).tagName !== 'IMG') return
          const now = Date.now()
          if (now - lastTap.current < 300) {
            lastTap.current = 0
            haptic()
            setView(v => (v.z > 1 ? ONE : { z: 2.5, x: 0, y: 0 }))
          } else lastTap.current = now
        }}
        onPointerCancel={e => {
          pts.current.delete(e.pointerId)
          pinch.current = null
          drag.current = null
        }}
      >
        <img
          src={url}
          alt={alt || ''}
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
        />
      </div>
      <button className="lightbox-close" aria-label="Close" onClick={onClose}>
        ✕
      </button>
      <div className="lightbox-bar">
        <button onClick={() => void imageAction('save', src, url, name)}>Save</button>
        <button onClick={() => void imageAction('share', src, url, name)}>Share</button>
        {local || /^https?:/i.test(src) ? <button onClick={() => openWith(src)}>Open with…</button> : null}
      </div>
    </div>,
    document.body
  )
}

export function FileChip({ src, label }: { src: string; label?: string }) {
  const name = label || localPath(src).split('/').pop() || src
  return (
    <button className="file-chip" onClick={() => openWith(src)}>
      📎 <span>{name}</span>
    </button>
  )
}

const clock = (t: number) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '0:00')

/** Audio in the app's own look (play/pause, seek, speed) instead of the Android default controls. */
function AudioPlayer({ url, name, onError }: { url: string; name: string; onError: () => void }) {
  const el = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [rate, setRate] = useState(1)
  return (
    <div className="audio-player">
      <button
        className="audio-play"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={() => {
          haptic()
          const a = el.current
          if (!a) return
          if (a.paused) void a.play()
          else a.pause()
        }}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1.2" />
            <rect x="14" y="5" width="4" height="14" rx="1.2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
          </svg>
        )}
      </button>
      <div className="audio-mid">
        <div className="audio-name">{name}</div>
        <input
          className="slider"
          type="range"
          min={0}
          max={dur || 1}
          step={0.1}
          value={Math.min(t, dur || 1)}
          style={{ ['--pct' as string]: `${dur ? (t / dur) * 100 : 0}%` }}
          aria-label="Seek"
          onChange={e => {
            const v = Number(e.target.value)
            setT(v)
            if (el.current) el.current.currentTime = v
          }}
        />
        <div className="audio-times">
          <span>{clock(t)}</span>
          <span>{clock(dur)}</span>
        </div>
      </div>
      <button
        className="audio-rate"
        aria-label="Playback speed"
        onClick={() => {
          haptic()
          const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1
          setRate(next)
          if (el.current) el.current.playbackRate = next
        }}
      >
        {rate}×
      </button>
      <audio
        ref={el}
        src={url}
        preload="metadata"
        onLoadedMetadata={e => setDur(e.currentTarget.duration)}
        onTimeUpdate={e => setT(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={onError}
      />
    </div>
  )
}

export function Media({ src, alt }: { src: string; alt?: string }) {
  const kind = mediaKind(src)
  const { url, error } = useSrc(kind === 'file' ? '' : src)
  const [zoom, setZoom] = useState(false)
  const [failed, setFailed] = useState('')
  const fail = () => setFailed("couldn't load")
  if (kind === 'file') return <FileChip src={src} label={alt} />
  if (error || failed) return <FileChip src={src} label={`${alt || localPath(src).split('/').pop()} (${error || failed})`} />
  if (!url) return <div className="media-loading">Loading {kind}…</div>
  if (kind === 'video') return <video className="media" src={url} controls playsInline preload="metadata" onError={fail} />
  if (kind === 'audio') return <AudioPlayer url={url} name={alt || localPath(src).split('/').pop() || 'Audio'} onError={fail} />
  return (
    <>
      <img className="media" src={url} alt={alt || ''} loading="lazy" onClick={() => setZoom(true)} onError={fail} />
      {zoom && <Lightbox src={src} url={url} alt={alt} onClose={() => setZoom(false)} />}
    </>
  )
}
