// Which chats wait for the person ("Needs you", spec 3.13). Two sources, merged per chat:
//   - the requests this page holds (`requests`): chats attached to its socket, known at once;
//   - the plugin's `waiting` list (`GET /activity`, read by activity.ts): every other chat, whose request reaches the page
//     only when it is opened.
// This is only a list of who waits and for what kind of thing. Nothing here answers a request: a tap opens the chat, and
// the request sheet there asks, with the fingerprint and unlock rules (docs/decisions/approval-needs-fingerprint.md).
import { useSyncExternalStore } from 'react'
import type { ServerRequest } from '@hermes/shared/json-rpc-channel'
import { getState, setState, subscribe, type AppState, type WaitingItem } from './store'
import { chatListHeld, onChatListFree } from './chatsnapshot'
import { lockView, onLockView } from './lockview'
import { SUB_AGENT } from './waiting'

export interface Need {
  /** The stored id of the chat. */
  session: string
  kind: string
  /** Who in the chat asks, when it isn't the chat itself ("A sub-agent"). */
  who: string
}

const WORDS = new Map([
  ['approval', 'wants to run a command'],
  ['phone_data', 'wants to read phone data'],
  ['question', 'asked a question'],
  ['clarify', 'asked a question'],
  ['sudo', 'wants a password'],
  ['secret', 'wants a key'],
  ['otp', 'wants a code'],
  ['connection.request', 'wants to connect an account']
])

/** What the chat waits for, in a few words of this app's own: nothing from the feed is printed. A kind this build doesn't
 *  know gets neutral words, and the only "who" is the fixed one. */
export function needWords(n: Pick<Need, 'kind' | 'who'>): string {
  const what = WORDS.get(n.kind) ?? 'is waiting for you'
  return n.who === SUB_AGENT ? `${SUB_AGENT} ${what}` : what
}

/** Requests are named by the live session; `chatOf` gives their stored chat. One entry per chat, oldest wait first; the
 *  chats known only from this page's own requests follow. */
export function mergeNeeds(waiting: WaitingItem[], requests: ServerRequest[], chatOf: (r: ServerRequest) => string): Need[] {
  const out = new Map<string, Need>()
  for (const w of waiting) if (w.session && !out.has(w.session)) out.set(w.session, { session: w.session, kind: w.kind, who: w.who ?? '' })
  for (const r of requests) {
    const session = chatOf(r)
    if (session && !out.has(session)) out.set(session, { session, kind: r.method, who: '' })
  }
  return [...out.values()]
}

let chatOf: (r: ServerRequest) => string = () => ''
/** gateway.ts knows which chat a live session belongs to. */
export function setRequestChat(fn: (r: ServerRequest) => string): void {
  chatOf = fn
}

const NONE: Need[] = []
let memo: { waiting: WaitingItem[]; requests: ServerRequest[]; live: string | undefined; out: Need[] } | null = null

/** Every chat that waits, the same array until something about it changes (safe as a store selector). */
export function needsOf(s: Pick<AppState, 'waiting' | 'requests' | 'active'>): Need[] {
  if (!s.waiting.length && !s.requests.length) return NONE
  const live = s.active?.runtimeId
  if (memo && memo.waiting === s.waiting && memo.requests === s.requests && memo.live === live) return memo.out
  const next = mergeNeeds(s.waiting, s.requests, chatOf)
  const out = memo && sameNeeds(memo.out, next) ? memo.out : next
  memo = { waiting: s.waiting, requests: s.requests, live, out }
  return out
}

export function sameNeeds(a: Need[], b: Need[]): boolean {
  return a.length === b.length && a.every((n, i) => n.session === b[i].session && n.kind === b[i].kind && n.who === b[i].who)
}

let openMemo: { needs: Need[]; sessions: AppState['sessions']; open: string | undefined; out: Need[] } | null = null

/** The chats of this bot's list that wait, without the open one (its sheet is already there): what the header button
 *  counts and the activity banner names. A chat of another bot can't be opened from here; its notification still asks. */
export function openNeeds(s: AppState): Need[] {
  const needs = needsOf(s)
  if (!needs.length) return NONE
  const open = s.active?.storedId
  if (openMemo && openMemo.needs === needs && openMemo.sessions === s.sessions && openMemo.open === open) return openMemo.out
  const listed = new Set(s.sessions.map(x => x.id))
  const next = needs.filter(x => x.session !== open && listed.has(x.session))
  const out = openMemo && sameNeeds(openMemo.out, next) ? openMemo.out : next
  openMemo = { needs, sessions: s.sessions, open, out }
  return out
}

/** Call right after starting to open a chat from Needs you: its request is the next one the sheet takes up. */
export function aimAtNeed(chat: string): void {
  setState({ needTarget: chat })
}

let onSheet: ServerRequest['id'] | null = null

/** How long after taking over from another request a sheet ignores every answer but a refusal. */
export const SHEET_PAUSE_MS = 700
let followedAnother: ServerRequest['id'] | null = null // the request now on the sheet, if it replaced another there
let shownAt = 0

/** The request the sheet shows. One on the sheet stays until it is answered or withdrawn, so what a finger is about to
 *  tap never changes under it. Only when the sheet is free is the next one chosen: the chat opened from Needs you first,
 *  so the row and the sheet agree, else the oldest. */
export function currentRequest(s: Pick<AppState, 'requests' | 'needTarget'>): ServerRequest | undefined {
  const kept = onSheet === null ? undefined : s.requests.find(r => r.id === onSheet)
  if (kept) return kept
  const replaced = onSheet !== null
  const next = (s.needTarget ? s.requests.find(r => chatOf(r) === s.needTarget) : undefined) ?? s.requests[0]
  onSheet = next?.id ?? null
  followedAnother = next && replaced ? next.id : null
  if (next) shownAt = performance.now() // not on every store change while no request is open (streaming)
  return next
}

/** The sheet is on screen with this request: the pause counts from here. */
export function sheetShown(id: ServerRequest['id']): void {
  if (id === onSheet) shownAt = performance.now()
}

/** The app is back on screen: a request that replaced another while it was away hasn't been seen yet, so its pause
 *  starts again from now. */
export function sheetBackInView(): void {
  if (followedAnother !== null && followedAnother === onSheet) shownAt = performance.now()
}

/** Whether a tap made at `at` (an event's timeStamp) may answer this request. A tap meant for the request before it must
 *  not answer this one unseen, where the same button now stands. It compares times, so no timer is involved. */
export function sheetCanAnswer(id: ServerRequest['id'], at: number): boolean {
  return followedAnother !== id || at - shownAt >= SHEET_PAUSE_MS
}

// The aim lasts only while it has a real request to bring forward: it ends when the person goes elsewhere or the chat
// fails to open, when the chat is open with no request here (Hermes hands them over with the opening), and when its
// request reaches the sheet. The `waiting` feed plays no part, so an entry in it can't keep the aim alive.
function settleAim(): void {
  const s = getState()
  const t = s.needTarget
  if (!t) return
  if (s.opening) {
    if (s.opening !== t) setState({ needTarget: null })
    return
  }
  const shown = currentRequest(s)
  const over = s.active?.storedId !== t || !s.requests.some(r => chatOf(r) === t) || (shown && chatOf(shown) === t)
  if (over) setState({ needTarget: null })
}
subscribe(settleAim)

/** The header button's words: "one needs you", "2 need you". */
export const needsPhrase = (n: number): string => (n === 1 ? 'one needs you' : `${n} need you`)

// What the chat list draws. It follows `needsOf`, except that nothing moves under a finger or a lifted row: a change that
// comes meanwhile is applied when it lifts (the same rule as the list's order, chatsnapshot.ts).
let shown: Need[] = NONE
const listeners = new Set<() => void>()
function refresh(): void {
  // Over the lock screen a docked list says nothing of what a chat waits for, at once, even under a finger.
  const locked = lockView()
  if (!locked && chatListHeld()) return
  const next = locked ? NONE : needsOf(getState())
  if (next === shown || sameNeeds(next, shown)) return
  shown = next
  listeners.forEach(f => f())
}
subscribe(refresh)
onChatListFree(refresh)
onLockView(refresh)

/** Whether the app is showing over the lock screen, for what must say less there. */
export const useLockView = (): boolean => useSyncExternalStore(onLockView, lockView)

export function useListedNeeds(): Need[] {
  return useSyncExternalStore(
    f => {
      listeners.add(f)
      refresh()
      return () => {
        listeners.delete(f)
      }
    },
    () => shown
  )
}
