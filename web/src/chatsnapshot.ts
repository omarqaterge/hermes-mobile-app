// When the chat list's default order is read (spec 3.13, decision chats-ordered-by-last-activity.md). Rows are ordered
// by last activity, but from a snapshot of each chat's activity time, taken only:
//   - when the side panel starts to open (the menu button, anything else that opens it, or a swipe that starts pulling
//     it in), so the rows are in place before they can be seen;
//   - when the first list from Hermes arrives after start (the one before it came from the cache), and when the bot
//     changes;
//   - when a chat is created (a chat made since the last snapshot appears in the list), or deleted, archived or restored
//     from the list (`chatListChanged`, called by SessionList);
//   - while the list is docked on a wide screen: when another chat is opened and when the app returns (`onAppResume`).
// Never while a finger is down on the panel or a row is being dragged: a snapshot asked for then waits until the finger
// lifts. Nothing else re-sorts the rows: a reply that lands, or an old chat that a new message brings into the page of 80,
// leaves the rows where they are (chatorder.ts `mergeListed`). A snapshot that finds the same times as the last one
// changes nothing and re-renders nothing, so opening the panel costs no render when nothing moved. No timer.
import { useSyncExternalStore } from 'react'
import type { SessionListRow } from '@hermes/shared/gateway-contract.generated'
import { getState, subscribe as onStore } from './store'
import { lastActive } from './unread'
import { activityTimes, createdMs, mergeListed, sameTimes } from './chatorder'
import { sideHidden } from './sidepanel'

export interface ChatSnapshot {
  profile: string
  /** Each listed chat's last activity (ms) as of the snapshot. */
  times: Map<string, number>
  /** When it was taken (ms): the date headings are worked out from it. */
  at: number
}

/** A chat listed for the first time counts as created when it was made at most this long before the last snapshot (the
 *  list can arrive a moment after the chat was made). */
const CREATED_MARGIN_MS = 5 * 60_000

let snap: ChatSnapshot = { profile: '', times: new Map(), at: 0 }
const subs = new Set<() => void>()
let touching = false // a finger, mouse button or pen is down on the side panel
let dragging = false // a row is lifted (SessionList's drag)
let wanted = false // a snapshot was asked for while held
let openGesture = false // a swipe that pulls the panel in took the snapshot already
let restoring = false // a chat was restored: the list that brings it back takes a snapshot
let firstList = true // no list has come from Hermes yet in this run
const docked = () => window.matchMedia('(min-width: 840px)').matches && !sideHidden()
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()
const publish = (next: ChatSnapshot) => {
  snap = next
  subs.forEach(f => f())
}

/** Takes a snapshot now, or as soon as no finger is on the panel and no row is lifted. */
export function takeChatSnapshot(): void {
  if (touching || dragging) {
    wanted = true
    return
  }
  wanted = false
  const { sessions, profile } = getState()
  const now = Date.now()
  const times = activityTimes(sessions, lastActive)
  if (profile === snap.profile && sameDay(now, snap.at) && sameTimes(times, snap.times)) return
  publish({ profile, times, at: now })
}

/** A chat was deleted or archived from the list, or restored (`restored`: it comes back with the next list). */
export function chatListChanged(restored = false): void {
  if (restored) restoring = true
  takeChatSnapshot()
}

/** While a row is lifted (drag to reorder or pin), no snapshot is applied; one asked for meanwhile follows the drop. */
export function holdChatSnapshot(on: boolean): void {
  dragging = on
  if (!on && wanted && !touching) takeChatSnapshot()
  if (!on) freed()
}

/** A finger is on the panel or a row is lifted: the list's rows must not move now. */
export const chatListHeld = (): boolean => touching || dragging

const freeSubs = new Set<() => void>()
/** `fn` runs each time the list stops being held (needsyou.ts applies what waited). */
export function onChatListFree(fn: () => void): void {
  freeSubs.add(fn)
}
function freed(): void {
  if (!chatListHeld()) freeSubs.forEach(f => f())
}

/** A swipe has started pulling the closed panel in: the rows are put in order now, before they can be seen. */
export function panelOpenGestureStarted(): void {
  openGesture = true
  takeChatSnapshot()
}

/** The swipe has ended, open or closed. */
export function panelOpenGestureEnded(): void {
  openGesture = false
}

/** The app is back in the foreground (window.hermesResume). */
export function onAppResume(): void {
  if (docked()) takeChatSnapshot()
}

export function useChatSnapshot(): ChatSnapshot {
  return useSyncExternalStore(
    f => {
      subs.add(f)
      return () => {
        subs.delete(f)
      }
    },
    () => snap
  )
}

/** A new list: a chat made since the last snapshot takes a new one; any other change keeps the rows where they are. */
function listed(rows: SessionListRow[]): void {
  if (getState().profile !== snap.profile || !snap.times.size || restoring) {
    restoring = false
    return takeChatSnapshot()
  }
  const created = rows.some(r => !snap.times.has(r.id) && createdMs(r) > snap.at - CREATED_MARGIN_MS)
  const merged = mergeListed(snap.times, rows, lastActive)
  if (!sameTimes(merged, snap.times)) publish({ ...snap, times: merged })
  if (created) takeChatSnapshot()
}

const changedChats = (rows: SessionListRow[]) => rows.length !== snap.times.size || rows.some(r => !snap.times.has(r.id))

// The moments that come from the store: the panel opening, the bot, a new list, the open chat while docked.
let prev = getState()
onStore(() => {
  const s = getState()
  const p = prev
  prev = s
  // A swipe that pulls the panel in took the snapshot when it started.
  if (s.drawer && !p.drawer && !openGesture) takeChatSnapshot()
  if (firstList && p.sessionsLoading && !s.sessionsLoading) {
    firstList = false
    takeChatSnapshot()
  }
  if (s.profile !== p.profile) queueMicrotask(takeChatSnapshot)
  else if (s.sessions !== p.sessions && changedChats(s.sessions)) {
    // gateway.ts notes the new counts (unread.ts) right after putting the list in the store, in the same task: the
    // times are read after it, before anything is painted.
    const rows = s.sessions
    queueMicrotask(() => {
      if (getState().sessions === rows) listed(rows)
    })
  } else if (s.active?.storedId && s.active.storedId !== p.active?.storedId && docked()) takeChatSnapshot()
})

// A finger on the panel holds the snapshot until it lifts (capture, so a row's own handlers can't hide it). Touches are
// followed by touch events, which go on while the list scrolls (the pointer is cancelled when a scroll starts); a mouse or
// pen by pointer events.
const pointers = new Set<number>()
let touches = false
const inPanel = (e: Event) => Boolean((e.target as Element | null)?.closest?.('.drawer'))
const settle = () => {
  const now = touches || pointers.size > 0
  if (now === touching) return
  touching = now
  if (!touching && wanted && !dragging) takeChatSnapshot()
  if (!touching) freed()
}
const opts = { capture: true, passive: true }
window.addEventListener('touchstart', e => {
  if (inPanel(e)) touches = true
  settle()
}, opts)
const touchEnd = (e: TouchEvent) => {
  if (!e.touches.length) touches = false
  settle()
}
window.addEventListener('touchend', touchEnd, opts)
window.addEventListener('touchcancel', touchEnd, opts)
window.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch' && inPanel(e)) pointers.add(e.pointerId)
  settle()
}, opts)
const pointerEnd = (e: PointerEvent) => {
  pointers.delete(e.pointerId)
  settle()
}
window.addEventListener('pointerup', pointerEnd, opts)
window.addEventListener('pointercancel', pointerEnd, opts)
