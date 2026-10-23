import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { BlockHandle, BlockProps, OpenUIApi } from '../openui-entry' // types only: erased, OpenUI stays lazy
import { runLazy } from '../lazy'
import { actionMessage, loadUiState, safeHttpUrl, saveUiState, type UiAction } from '../openui-msg'
import { haptic, openExternal } from '../bridge'
import { sendPrompt } from '../gateway'
import { getState, toast } from '../store'
import { hashText } from '../tasks'

/** Set by Markdown: is the message still streaming, and may its buttons send (chat replies only, not canvas/files). */
export const OpenUICtx = createContext({ streaming: false, interactive: false })

function getOpenUI(): Promise<OpenUIApi> {
  if (!import.meta.env.DEV) return runLazy<OpenUIApi>('hm-openui', '__hmOpenUI')
  // react-lang mounts OpenUI's devtools from a CDN in development builds; this flag says "already mounted".
  ;(globalThis as Record<symbol, unknown>)[Symbol.for('openui.devtools.autoMount')] = true
  return import('../openui-entry').then(() => (window as unknown as { __hmOpenUI: OpenUIApi }).__hmOpenUI)
}

/** Parser results that mean "nothing to draw": show the code instead. */
const FATAL = new Set(['parse-failed', 'parse-exception', 'no-root'])

const themeMode = (): 'light' | 'dark' => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
function useThemeMode() {
  const [mode, setMode] = useState(themeMode)
  useEffect(() => {
    const o = new MutationObserver(() => setMode(themeMode()))
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => o.disconnect()
  }, [])
  return mode
}

const chatId = () => {
  const s = getState()
  return s.active?.storedId || s.opening || ''
}

/** A ```openui-lang block: OpenUI draws it (lazy bundle, own shadow root); `fallback` shows if it can't. */
export function OpenUIBlock({ code, fallback }: { code: string; fallback: ReactNode }) {
  const { streaming, interactive } = useContext(OpenUICtx)
  const mode = useThemeMode()
  const host = useRef<HTMLDivElement>(null)
  const handle = useRef<BlockHandle | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [partial, setPartial] = useState(false)
  const live = useRef({ streaming, interactive })
  live.current = { streaming, interactive }
  const key = streaming ? '' : `${chatId()}:${hashText(code)}`
  const initial = useRef(key ? loadUiState(key) : undefined) // a reopened chat: what you typed before
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const onAction = (e: UiAction) => {
    if (e.type === 'open_url') {
      const url = safeHttpUrl(e.params?.url)
      if (url) openExternal(url)
      else toast('That link can’t be opened', 'error')
      return
    }
    if (e.type !== 'continue_conversation') return // the chat library has no custom actions
    if (!live.current.interactive) return toast('Open the chat to use this')
    if (getState().active?.running) return toast('Hermes is still answering. Try again when it’s done')
    const text = actionMessage(e)
    if (!text) return
    haptic()
    sendPrompt(text).catch(err => toast(err instanceof Error ? err.message : String(err), 'error'))
  }

  const props = (): BlockProps => ({
    code,
    streaming,
    mode,
    initialState: initial.current,
    onAction: e => onAction(e as UiAction),
    onState: s => {
      if (!key) return
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => saveUiState(key, s), 400) // one write per pause in typing
    },
    onErrors: errs => {
      if (live.current.streaming) return
      const hard = errs.filter(e => (e as { severity?: string }).severity !== 'warning')
      if (hard.some(e => FATAL.has(e.code))) setFailed(true)
      setPartial(hard.length > 0)
    }
  })
  // The bundle loads asynchronously (the first card parses ~4 MB): mount with the props of the render that is
  // current THEN, not the first one, or a reply that finished streaming meanwhile would stay half drawn.
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    let alive = true
    getOpenUI()
      .then(api => {
        if (!alive || !host.current) return
        handle.current = api.mount(host.current, latest.current())
        setReady(true)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
      clearTimeout(saveTimer.current)
      const h = handle.current
      handle.current = null
      if (h) setTimeout(() => h.unmount()) // not during the outer React's commit
    }
  }, [])
  useEffect(() => {
    handle.current?.update(props())
  }, [code, streaming, mode, interactive])

  return (
    <>
      {failed && fallback}
      {!ready && !failed && <div className="dim">Loading card…</div>}
      {/* Taps inside the card are the card's: no time toggle, no tap-to-copy, no swipe (swipe.ts SKIP). */}
      <div ref={host} className="hm-openui" hidden={failed} onClick={e => e.stopPropagation()} />
      {partial && !failed && <div className="warn-line">⚠ Part of this card couldn’t be shown</div>}
    </>
  )
}
