// A chat that has read phone data. Text the agent read (an SMS, a calendar note) can tell it to leak the rows: a remote
// image whose address carries them loads with no tap, and a link or a card's open_url sends them with one. So in such a
// chat, what the agent writes can't fetch anything from the network until the user taps, and can't open an address
// until the user has seen it in full. This holds in every access mode, Full access included. Other chats are unchanged.
//
// "Tainted" = the chat's items hold a phone_data tool call, whatever its outcome (allowed, denied, failed). It is derived
// from the items, so it survives a reload or a resume (the history brings the tool items back) and nothing is stored.
import { createContext } from 'react'
import { openExternal } from './bridge'
import { confirmDialog } from './dialog'
import { getState, useStore, type AppState, type ChatItem } from './store'

/** True inside an assistant message of a chat that has read phone data (set by Markdown). */
export const GuardCtx = createContext(false)

const TOOL = 'phone_data'

/** A tool item for phone_data, also when it was called through Hermes's Tool Search bridge (`tool_call`). */
export function isPhoneDataCall(it: ChatItem): boolean {
  if (it.kind !== 'tool') return false
  if (it.name === TOOL) return true
  if (it.name !== 'tool_call') return false
  const calls = (it.args as { calls?: unknown } | null | undefined)?.calls
  return Array.isArray(calls) && calls.some(c => (c as { name?: unknown } | null)?.name === TOOL)
}

const memo = new WeakMap<readonly ChatItem[], boolean>()

/** Do these items hold a phone_data call? Cached per array (the store replaces the array on every change), so a long chat
 *  is scanned once per change and a tainted one stops at the first hit. */
export function isTaintedItems(items: readonly ChatItem[] | null | undefined): boolean {
  if (!items || !items.length) return false
  let v = memo.get(items)
  if (v === undefined) {
    v = items.some(isPhoneDataCall)
    memo.set(items, v)
  }
  return v
}

/** The items on screen: a preview of the chat being opened, else the active chat's. */
const shownItems = (s: AppState): readonly ChatItem[] | null =>
  s.opening && s.preview?.storedId === s.opening ? s.preview.items : s.active?.items ?? null

export const useTainted = (): boolean => useStore(s => isTaintedItems(shownItems(s)))
export const isTaintedNow = (): boolean => isTaintedItems(shownItems(getState()))

/** Would this address be fetched by the page (an image, video, audio or frame source)? Local files and attachments are not. */
export const isRemoteUrl = (s: string): boolean => /^(https?:)?\/\//i.test(s.trim())

export interface Address {
  host: string
  full: string
  query: string
}

/** The parts of an address the user needs to judge it: the host, the whole text, and the query on its own. */
export function addressOf(raw: string): Address {
  const full = raw.trim()
  try {
    const u = new URL(full.startsWith('//') ? `https:${full}` : full)
    return { host: u.host || u.protocol, full, query: u.search }
  } catch {
    const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(full)
    const q = full.indexOf('?')
    return { host: m ? m[1] : full.slice(0, 40), full, query: q >= 0 ? full.slice(q).split('#')[0] : '' }
  }
}

const SHOWN = 1500
const cut = (s: string) => (s.length > SHOWN ? `${s.slice(0, SHOWN)}…` : s)

/** Open an address from the agent's text. In a chat that has read phone data it first shows the address in full and opens
 *  only on confirmation; elsewhere it opens at once, as before. Never uses the browser's confirm(). */
export async function openChecked(url: string, guarded: boolean): Promise<void> {
  if (!guarded) return openExternal(url)
  const a = addressOf(url)
  const list = [`Site: ${a.host}`, `Address: ${cut(a.full)}`]
  if (a.query) list.push(`Data in the address: ${cut(a.query)}`)
  const ok = await confirmDialog({
    title: 'Open this address?',
    message: 'This chat has read data from your phone. An address can carry that data out. Open it only if you expect this site.',
    list,
    icon: '🔗',
    confirmLabel: 'Open',
    cancelLabel: 'Cancel'
  })
  if (ok) openExternal(url)
}

/** Same, for an address the page itself would fetch when the user plays or loads it (a video frame). */
export async function confirmAddress(url: string, guarded: boolean, title = 'Load this address?'): Promise<boolean> {
  if (!guarded) return true
  const a = addressOf(url)
  const list = [`Site: ${a.host}`, `Address: ${cut(a.full)}`]
  if (a.query) list.push(`Data in the address: ${cut(a.query)}`)
  return confirmDialog({
    title,
    message: 'This chat has read data from your phone. An address can carry that data out.',
    list,
    icon: '🔗',
    confirmLabel: 'Load',
    cancelLabel: 'Cancel'
  })
}
