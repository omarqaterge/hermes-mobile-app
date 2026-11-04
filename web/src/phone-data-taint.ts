// A chat that has read phone data. Text the agent read (an SMS, a calendar note) can tell it to leak the rows: a remote
// image whose address carries them loads with no tap, and a link or a card's open_url sends them with one. So in such a
// chat, what the agent writes can't fetch anything from the network until the user taps, and can't open an address
// until the user has seen it in full. This holds in every access mode, Full access included. Other chats are unchanged.
//
// "Tainted" = the chat's items hold a phone_data tool call, whatever its outcome (allowed, denied, failed). It is derived
// from the items, so it survives a reload or a resume (the history brings the tool items back) and nothing is stored.
import { createContext, useContext } from 'react'
import { openExternal } from './bridge'
import { confirmDialog } from './dialog'
import { getState, subscribe, useStore, type AppState, type ChatItem } from './store'

/** True inside an assistant message of a chat that has read phone data (set by Markdown). */
export const GuardCtx = createContext(false)

const TOOL = 'phone_data'

/** A tool item for phone_data, also when it was called through Hermes's Tool Search bridge (`tool_call`). */
export function isPhoneDataCall(it: ChatItem): boolean {
  // A subagent counts only when its own events named the tool (gateway.ts sets `phoneData`); one that never did is left alone.
  if (it.kind === 'subagent') return it.phoneData === true
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

/** The chat ids of what is on screen: the preview's stored id, or the active chat's stored and live ids. */
const shownIds = (s: AppState): string[] =>
  s.opening && s.preview?.storedId === s.opening ? [s.opening] : s.active ? [s.active.storedId, s.active.runtimeId] : s.opening ? [s.opening] : []

// The app's own record (PhoneDataChats.java): the items can't tell when the phone_data call is older than the 60 cached items
// of a preview, outside the tip segment Hermes resumes, or in a subagent whose parent this is. The shell answers at once.
// A yes is kept for good (a chat never becomes unread); a no is asked again after a second, because a read can arrive later.
const known = new Set<string>()
const unknown = new Map<string, number>()
const RECHECK_MS = 1000

/** Did a phone_data read request for this chat id ever reach the app? False without a shell or with an older one. */
export function nativeTainted(id: string | null | undefined): boolean {
  if (!id) return false
  if (known.has(id)) return true
  const t = Date.now()
  const last = unknown.get(id)
  if (last !== undefined && t - last < RECHECK_MS) return false
  let yes = false
  try {
    yes = remoteBridge()?.phoneDataTainted?.(id) === true
  } catch {
    yes = false
  }
  if (yes) {
    known.add(id)
    unknown.delete(id)
  } else {
    if (unknown.size > 200) unknown.clear()
    unknown.set(id, t)
  }
  return yes
}

const taintedState = (s: AppState): boolean => isTaintedItems(shownItems(s)) || shownIds(s).some(nativeTainted)

export const useTainted = (): boolean => useStore(taintedState)
export const isTaintedNow = (): boolean => taintedState(getState())

/** Would this address be fetched by the page (an image, video, audio or frame source)? Local files and attachments are not. */
export const isRemoteUrl = (s: string): boolean => /^(?:https?:|[\\/]{2})/i.test(plainUrl(s))

/** An address as a browser reads it: whitespace and control characters are dropped (`ht\ttps:evil` is `https:evil`). */
// eslint-disable-next-line no-control-regex
const plainUrl = (s: string): string => s.replace(/[\s\u0000-\u001f\u007f]/g, '')

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

/** A string literal's text as the card reads it: \\t \\n \\r are whitespace, \\uXXXX and \\xXX their character, any other \\c is c. */
const unescapeLiteral = (s: string): string =>
  s.replace(/\\(?:u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(.))/g, (_a, u?: string, x?: string, c?: string) =>
    u || x ? String.fromCharCode(parseInt((u || x) as string, 16)) : 'tnr'.includes(c as string) ? ' ' : (c as string)
  )

/** A card's source (openui-lang) with every remote address in a string emptied, so the chat library's image components
 *  (Image, ImageBlock, ImageGallery, ImageText and any other that draws `<img src>` from a prop) have nothing to fetch. The
 *  address of a button's `@OpenUrl(...)` stays: it opens only through the address dialog. Returns the same text when nothing
 *  was removed. */
export function dropRemoteStrings(code: string): string {
  return code.replace(/(@OpenUrl\(\s*)?("(?:\\.|[^"\\\n])*")/g, (all, open: string | undefined, str: string) =>
    open || !/^(?:(?:https?|ftp):|[\\/]{2})/i.test(plainUrl(unescapeLiteral(str.slice(1, -1)))) ? all : `${open ?? ''}""`
  )
}

/** True inside a chat that has read phone data: the Markdown context when there is one (the chat's text, /btw), else the
 *  chat on screen itself (tool cards, notices, the canvas, reasoning and other places with no Markdown around). */
export function useGuard(): boolean {
  const ctx = useContext(GuardCtx)
  const tainted = useTainted()
  return ctx || tainted
}

// ── the shell's side: the one place that really refuses (RemoteGuard.java) ──
// While the chat on screen is tainted the shell answers every request the page makes to the internet with an empty 403 (all
// kinds: images, media, scripts, styles, frames, fonts, fetch), whatever the page renders. The guards above are what the
// user sees; this is what holds when one of them is missed. The shell starts each page load BLOCKED until this reports.

type RemoteBridge = { phoneDataTainted?: (id: string) => boolean; remoteBlock?: (on: boolean) => void; remoteAllowOnce?: (url: string) => void }
const remoteBridge = () => window.HermesAndroid as unknown as RemoteBridge | undefined

let lastReport = ''

/** Tell the shell whether the chat on screen has read phone data. On every change of chat or of the answer, and once at
 *  start (a reload): a new page load starts blocked in the shell and is only opened by this. */
function reportRemoteBlock(): void {
  const s = getState()
  const tainted = isTaintedNow()
  const key = `${s.opening || s.active?.runtimeId || ''}|${tainted}`
  if (key === lastReport) return
  lastReport = key
  try {
    remoteBridge()?.remoteBlock?.(tainted)
  } catch {
    // no shell, or an older one: the page's own guards still hold
  }
}

/** Start reporting (main.tsx). It subscribes to the store, so the moment the first phone_data item appears the shell is
 *  told, before the reply that follows it is drawn. */
export function startRemoteBlock(): void {
  reportRemoteBlock()
  subscribe(reportRemoteBlock)
}

/** The user tapped "Tap to load" for exactly this address: the shell lets that one request through, once, for 60 s. */
export function allowRemoteOnce(url: string): void {
  try {
    const t = url.trim()
    remoteBridge()?.remoteAllowOnce?.(new URL(t.startsWith('//') ? `https:${t}` : t).href)
  } catch {
    // not an address: nothing to allow
  }
}
