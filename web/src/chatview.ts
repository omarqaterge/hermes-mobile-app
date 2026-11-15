// Which chat the screen shows, as one explicit answer. The store keeps three fields for it (`opening`, `preview`,
// `active`), and while one chat opens over another they disagree: `active` is still the chat being left. Every
// component used to work the answer out for itself; they read it here instead.
//
//   kind      opening   preview            active                       the chat list area shows
//   home      null      –                  null                         the new-chat screen
//   open      null      –                  the chat                     the chat, live
//   open      the chat  not this chat      the same chat, with items    the chat, live, while a reconnect reloads it
//   preview   chat B    B's last-seen      null or the chat being left  B as last seen: read-only
//   loading   chat B    none for B         null or the chat being left  the skeleton
//
// In `preview` and `loading` the chat on screen is not `active`, so nothing that acts on `active` may run
// (`viewSettled`): it would hit the chat being left, or start a new chat on top of the one that is opening.
import type { AppState, ChatItem } from './store'

export type ChatViewKind = 'home' | 'loading' | 'preview' | 'open'

type View = Pick<AppState, 'opening' | 'preview' | 'active'>

const previewed = (s: View) => (s.opening && s.preview?.storedId === s.opening ? s.preview : null)

export function viewKind(s: View): ChatViewKind {
  if (!s.opening) return s.active ? 'open' : 'home'
  if (previewed(s)) return 'preview'
  return s.active?.storedId === s.opening && s.active.items.length > 0 ? 'open' : 'loading'
}

/** The chat on screen is the one `active` holds (or there is none): the header menu and the Auto button may act. */
export const viewSettled = (s: View): boolean => {
  const k = viewKind(s)
  return k === 'home' || k === 'open'
}

/** Stored id of the chat the screen belongs to, '' on the new-chat screen. A chat still opening counts: its canvas
 *  and its cards' saved answers are kept under its stored id, so they can load before Hermes has resumed it. */
export const screenChat = (s: View): string => s.opening || s.active?.storedId || ''

/** The messages in the list: the preview's while one stands in, else the live chat's (null without a chat). While
 *  the skeleton covers the list this is still the chat being left. */
export const shownItems = (s: View): ChatItem[] | null => previewed(s)?.items ?? s.active?.items ?? null

/** The id the list's scroll position and per-chat marks are kept under: the previewed chat, else the live one. */
export const shownKey = (s: View): string | undefined => (previewed(s) ? s.opening! : s.active?.storedId)

/** The title in the header: always the chat on screen's, never the one being left ('' when it has none yet). */
export function shownTitle(s: View & Pick<AppState, 'sessions'>): string {
  const k = viewKind(s)
  if (k === 'preview') return s.preview!.title
  if (k === 'loading') return s.sessions.find(x => x.id === s.opening)?.title || ''
  return s.active?.title || ''
}
