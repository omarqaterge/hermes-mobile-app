// The app Hermes drives on a hidden display ("background app"). The shell tells the page about it
// (window.__hmBg on every change and on resume, bgState() at start) and serves the live frames
// (bgFrameAsync → window.__hmBgFrame). Port and token never reach the page.
import { useSyncExternalStore } from 'react'
import { bgFrameAsync, bgState } from './bridge'
import { getState, setState } from './store'

export interface BgState {
  session: string
  pkg: string
  label: string
  action: string
  since: number
}

export const FRAME_EVERY_MS = 500
const FRAME_TIMEOUT_MS = 8000

/** Validate whatever the shell sent: a state object, a JSON string of one, or nothing. */
export function parseBg(raw: unknown): BgState | null {
  let o: unknown = raw
  if (typeof raw === 'string') {
    if (!raw) return null
    try {
      o = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!o || typeof o !== 'object') return null
  const r = o as Record<string, unknown>
  if (typeof r.session !== 'string' || !r.session) return null
  const pkg = typeof r.pkg === 'string' ? r.pkg : ''
  return {
    session: r.session,
    pkg,
    label: typeof r.label === 'string' && r.label ? r.label : pkg || 'an app',
    action: typeof r.action === 'string' ? r.action : '',
    since: Number(r.since) || 0
  }
}

/** The state only counts for the chat that started it (stored session id). */
export function bgForChat(bg: BgState | null, chat: string | null | undefined): BgState | null {
  return bg && chat && bg.session === chat ? bg : null
}

/** Wait before the next frame request so requests start at most every `every` ms. */
export function frameDelay(elapsedMs: number, every = FRAME_EVERY_MS): number {
  return Math.max(0, every - Math.max(0, elapsedMs))
}

/** Store the new state; a different chat/app drops the old frame. Equal states keep the same object (no re-render). */
export function setBg(next: BgState | null): void {
  const cur = getState().bg
  if (cur && next && cur.session === next.session && cur.pkg === next.pkg && cur.label === next.label && cur.action === next.action && cur.since === next.since) return
  if (!next || !cur || cur.session !== next.session || cur.pkg !== next.pkg) setFrame('')
  setState({ bg: next })
  kickFrames()
}

export function refreshBg(): void {
  setBg(parseBg(bgState()))
}

declare global {
  interface Window {
    __hmBg?: (state: unknown) => void
    __hmBgFrame?: (id: number, dataUrl: string) => void
  }
}
window.__hmBg = state => setBg(parseBg(state))

// ── live frames: ONE loop for all consumers (card thumbnail, viewer), one request in flight ──
let frame = ''
const frameSubs = new Set<() => void>()
function setFrame(f: string) {
  if (f === frame) return
  frame = f
  frameSubs.forEach(l => l())
}

const consumers = new Map<symbol, number>() // consumer → the width it wants
let timer: ReturnType<typeof setTimeout> | null = null
let inflight = 0 // id of the request in flight, 0 = none
let seq = 0
let lastStart = 0

const wantWidth = () => Math.max(...consumers.values())
const canRun = () => consumers.size > 0 && document.visibilityState === 'visible' && getState().bg != null

function schedule(ms: number) {
  if (timer) clearTimeout(timer)
  timer = canRun() ? setTimeout(tick, ms) : null
}

function tick() {
  timer = null
  if (!canRun() || inflight) return
  const id = ++seq
  inflight = id
  lastStart = Date.now()
  const done = (data: string) => {
    if (inflight !== id) return // answered after the timeout
    inflight = 0
    if (canRun()) {
      if (data) setFrame(data)
      schedule(frameDelay(Date.now() - lastStart))
    }
  }
  pendingFrames.set(id, done)
  setTimeout(() => {
    if (pendingFrames.delete(id)) done('')
  }, FRAME_TIMEOUT_MS)
  if (!bgFrameAsync(id, wantWidth())) {
    pendingFrames.delete(id)
    done('')
  }
}

const pendingFrames = new Map<number, (data: string) => void>()
window.__hmBgFrame = (id, data) => {
  const f = pendingFrames.get(id)
  pendingFrames.delete(id)
  f?.(typeof data === 'string' && data.startsWith('data:image/') ? data : '')
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (canRun() && !inflight && !timer) schedule(0)
  } else if (timer) {
    clearTimeout(timer)
    timer = null
  }
})

/** Register a consumer that wants frames up to `maxW` wide; returns its release. Polling runs only while one exists. */
export function wantFrames(maxW: number): () => void {
  const key = Symbol('frames')
  consumers.set(key, maxW)
  if (canRun() && !inflight && !timer) schedule(0)
  return () => {
    consumers.delete(key)
    if (!consumers.size && timer) {
      clearTimeout(timer)
      timer = null
    }
  }
}

/** The bg state changed under a running loop (cleared: stop; set: start if someone waits). */
export function kickFrames(): void {
  if (!canRun()) {
    if (timer) clearTimeout(timer)
    timer = null
  } else if (!inflight && !timer) schedule(0)
}

export function useBgFrame(): string {
  return useSyncExternalStore(
    cb => {
      frameSubs.add(cb)
      return () => frameSubs.delete(cb)
    },
    () => frame
  )
}

refreshBg()
