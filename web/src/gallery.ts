// Canvas gallery: every canvas document of every chat (all profiles) in one place, grouped by type (HTML, Markdown,
// Code…), searchable by title and text, each with the chat it was made in. Nothing is saved or copied: the plugin's
// /gallery reads the canvas store and searches it.
// Saved copies from the old Library (before the gallery) are listed too, with `saved: true`.
// The screen is components/Gallery.tsx.
import { useSyncExternalStore } from 'react'
import { api } from './api'
import { canvasState, openCanvas, refreshDocs, type DocType } from './canvas'
import { getState, toast } from './store'
import { openSessionFromNotification, switchProfile } from './gateway'

export interface GalleryChat {
  profile: string
  title: string
  last_active: number | null
  archived: boolean
}
export interface GalleryItem {
  key: string
  session: string
  doc: string
  lib?: string
  saved?: boolean
  title: string
  type: DocType
  lang: string
  /** Its type, as the gallery shows it: HTML, Markdown, Code… */
  category: string
  created: number
  updated: number
  by: string
  chars: number
  snippet: string
  chat: GalleryChat | null
}

interface GalleryState {
  items: GalleryItem[]
  categories: Record<string, number>
  /** The first list hasn't arrived yet: the screen shows a spinner, never "empty". */
  loading: boolean
  error: string
  filter: string // category shown, '' = all
  /** The search box; the list shown is the answer for `shownQuery`. */
  query: string
  shownQuery: string
}

const G = '/api/plugins/hermes-mobile/gallery'
const C = '/api/plugins/hermes-mobile/canvas'
const L = '/api/plugins/hermes-mobile/library'
let state: GalleryState = { items: [], categories: {}, loading: true, error: '', filter: '', query: '', shownQuery: '' }
const subs = new Set<() => void>()
const set = (p: Partial<GalleryState>) => {
  state = { ...state, ...p }
  subs.forEach(f => f())
}
export const useGallery = <T,>(sel: (s: GalleryState) => T): T => useSyncExternalStore(cb => (subs.add(cb), () => subs.delete(cb)), () => sel(state))
export const galleryState = (): GalleryState => state

const call = <T,>(method: string, path: string, body?: unknown) => api<T>(method, path, body, { profile: false })
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const q = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')

export async function loadGallery(): Promise<void> {
  const query = state.query.trim()
  try {
    const r = await call<{ items: GalleryItem[]; categories: Record<string, number> }>('GET', query ? `${G}?${q({ q: query })}` : G)
    if (query !== state.query.trim()) return // typed on meanwhile: the newer search answers
    // A filter on a category with nothing (left) in it falls back to All.
    set({ items: r.items, categories: r.categories, loading: false, error: '', shownQuery: query, filter: state.filter && r.categories[state.filter] ? state.filter : '' })
  } catch (e) {
    // Keep `loading` until a real answer: an unreachable Hermes is not an empty gallery.
    set({ error: errText(e) })
  }
}

export const setGalleryFilter = (filter: string): void => set({ filter })

/** The screen opens: a fresh list with an empty search box (the last search is not kept). */
export function openGallery(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = null
  // The list left over is the answer to the old search: don't show it as the whole gallery.
  set(state.shownQuery ? { query: '', shownQuery: '', items: [], categories: {}, loading: true } : { query: '' })
  void loadGallery()
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
/** Search titles and text (Hermes searches; asked 300 ms after the last keystroke). */
export function setGalleryQuery(query: string): void {
  set({ query })
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchTimer = null
    void loadGallery()
  }, 300)
}

/** The document's text (a canvas document, or an old saved copy). */
export async function itemContent(item: GalleryItem): Promise<string> {
  if (item.lib) return (await call<{ content: string }>('GET', `${L}/item?${q({ id: item.lib })}`)).content
  return (await call<{ content: string }>('GET', `${C}/doc?${q({ session: item.session, id: item.doc })}`)).content
}

export async function renameItem(item: GalleryItem, title: string): Promise<void> {
  try {
    if (item.lib) await call('PUT', `${L}/item`, { id: item.lib, title, category: '' })
    else await call('POST', `${C}/rename`, { session: item.session, id: item.doc, title })
  } catch (e) {
    toast(errText(e), 'error')
  }
  if (!item.lib && canvasState().session === item.session) void refreshDocs()
  await loadGallery()
}

/** Removes the document from its chat's canvas (or deletes an old saved copy). */
export async function deleteItem(item: GalleryItem): Promise<void> {
  try {
    if (item.lib) await call('DELETE', `${L}/item?${q({ id: item.lib })}`)
    else await call('DELETE', `${C}/doc?${q({ session: item.session, id: item.doc })}`)
  } catch (e) {
    toast(errText(e), 'error')
  }
  if (!item.lib && canvasState().session === item.session) void refreshDocs()
  await loadGallery()
}

/** Open the chat the document was made in (switching profile when it belongs to another), optionally with the
 * canvas on that document. Returns false when the chat is gone. */
export async function openItemChat(item: GalleryItem, withCanvas: boolean): Promise<boolean> {
  const chat = item.chat
  if (!chat || !item.session) {
    toast('The chat this was made in no longer exists', 'error')
    return false
  }
  if (chat.profile && chat.profile !== getState().profile) await switchProfile(chat.profile)
  openSessionFromNotification(item.session)
  // The resume has set `opening` to this chat: the canvas follows it and stays open once the chat is live.
  if (withCanvas && item.doc) openCanvas(item.doc, 'side')
  return true
}

/** Hermes made a canvas document: refresh a list that is already loaded. */
export function galleryToolDone(): void {
  if (!state.loading) void loadGallery()
}
