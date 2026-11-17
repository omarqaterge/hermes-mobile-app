// The composer's tray (docs/decisions/chat-height-belongs-to-content.md): the live status line and the model row sit in
// a tray above the text box that can be closed, so a small screen keeps that height for the text.
//
// - Open on a new chat, so the model can be seen and changed before the first message; it closes by itself when that
//   first message is sent (`trayFirstSend`). A chat opened from the list starts closed. After that the person decides:
//   opened or closed by hand, it stays so for as long as that chat is on screen (`setTrayOpen`).
// - The first time ever that it closes by itself, a hint shows once beside the handle (`useTrayHint`), remembered in
//   localStorage `hm.trayHint.v1`.
// - Settings → Appearance → Model bar: "Tucked away" (the default) or "Always open" (localStorage `hm.modelBar`,
//   'tucked' | 'open'; absent = tucked): always open has no handle and is the layout from before the tray.
import { useSyncExternalStore } from 'react'
import { getState } from './store'

export type ModelBarMode = 'tucked' | 'open'

const MODE_KEY = 'hm.modelBar'
const HINT_KEY = 'hm.trayHint.v1'
/** How long the hint stays when nothing touches it (ms). One timer, started once, never repeated. */
export const HINT_MS = 4000

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, v: string): void {
  try {
    localStorage.setItem(key, v)
  } catch {
    /* private mode: lasts until the page reloads */
  }
}

export interface TrayState {
  /** The setting: tucked away (a handle opens and closes the tray) or always open. */
  mode: ModelBarMode
  /** Open now (always true when `mode` is 'open'). */
  open: boolean
  /** The hint "Model and context are here" is on screen. */
  hint: boolean
}

/** The app starts on the new-chat screen (open), or reopening the last chat (closed: it is a chat from the list). */
const startsNew = (): boolean => !getState().opening && !getState().active

let mode: ModelBarMode = read(MODE_KEY) === 'open' ? 'open' : 'tucked'
let open = startsNew()
/** Opened by itself for a new chat, and not touched since: the first message closes it. */
let auto = open
let hint = false
let hintTimer: ReturnType<typeof setTimeout> | undefined
/** The last change came with another chat: the tray takes its new state at once, without moving. */
let jump = false
let snap: TrayState = { mode, open: mode === 'open' || open, hint }

const subs = new Set<() => void>()
const subscribe = (f: () => void) => (subs.add(f), () => subs.delete(f))
function emit(): void {
  const next = { mode, open: mode === 'open' || open, hint: mode === 'tucked' && hint }
  if (next.mode === snap.mode && next.open === snap.open && next.hint === snap.hint) return
  snap = next
  subs.forEach(f => f())
}

export const trayState = (): TrayState => snap

/** The tray's state, re-rendering when it changes. */
export function useTray(): TrayState {
  return useSyncExternalStore(subscribe, trayState)
}

/** The Model bar setting. */
export const modelBarMode = (): ModelBarMode => mode

export function setModelBarMode(m: ModelBarMode): void {
  mode = m
  write(MODE_KEY, m)
  emit()
}

/** Opened or closed by hand (the handle): it stays so while this chat is on screen, a send does not change it. */
export function setTrayOpen(v: boolean): void {
  jump = false
  auto = false
  open = v
  dismissTrayHint()
  emit()
}

/** Another chat came on screen: a new chat starts open (closing on its first message), a chat from the list closed.
 *  `carry` keeps the state: the new-chat screen became a real chat (its first message, an attachment, a model pick). */
export function trayForChat(kind: 'new' | 'listed' | 'carry'): void {
  if (kind === 'carry') return
  jump = open !== (kind === 'new')
  open = kind === 'new'
  auto = kind === 'new'
  emit()
}

/** True once after a change that came with another chat on screen (Tray.tsx skips the movement). */
export function takeTrayJump(): boolean {
  const j = jump
  jump = false
  return j
}

/** The first message of a new chat was sent: a tray that opened by itself closes, and the first time ever that
 *  happens the hint shows once. */
export function trayFirstSend(): void {
  if (!auto) return
  auto = false
  if (!open) return
  open = false
  jump = false
  if (mode === 'tucked' && read(HINT_KEY) !== '1') {
    write(HINT_KEY, '1')
    hint = true
    clearTimeout(hintTimer)
    hintTimer = setTimeout(dismissTrayHint, HINT_MS)
  }
  emit()
}

/** The hint leaves (its time is up, or a touch). */
export function dismissTrayHint(): void {
  clearTimeout(hintTimer)
  hintTimer = undefined
  if (!hint) return
  hint = false
  emit()
}

/** Tests: back to a fresh start. */
export function resetTrayForTests(): void {
  mode = read(MODE_KEY) === 'open' ? 'open' : 'tucked'
  open = true
  auto = true
  hint = false
  jump = false
  clearTimeout(hintTimer)
  emit()
}
