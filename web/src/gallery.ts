// Canvas gallery: every canvas document of every chat (all profiles) in one place, grouped by category, each with the
// chat it was made in. Nothing is saved or copied: the plugin's /gallery reads the canvas store. A document's
// category is the one Hermes gave it when it made it (or the one you picked); without one it is grouped by type.
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
  category: string
  /** No category of its own: grouped by its type. */
  auto: boolean
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
}

const G = '/api/plugins/hermes-mobile/gallery'
const C = '/api/plugins/hermes-mobile/canvas'
const L = '/api/plugins/hermes-mobile/library'
let state: GalleryState = { items: [], categories: {}, loading: true, error: '', filter: '' }
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
  try {
    const r = await call<{ items: GalleryItem[]; categories: Record<string, number> }>('GET', G)
    // A filter on a category that no longer exists falls back to All.
    set({ items: r.items, categories: r.categories, loading: false, error: '', filter: state.filter && r.categories[state.filter] ? state.filter : '' })
  } catch (e) {
    // Keep `loading` until a real answer: an unreachable Hermes is not an empty gallery.
    set({ error: errText(e) })
  }
}

export const setGalleryFilter = (filter: string): void => set({ filter })

/** The document's text (a canvas document, or an old saved copy). */
export async function itemContent(item: GalleryItem): Promise<string> {
  if (item.lib) return (await call<{ content: string }>('GET', `${L}/item?${q({ id: item.lib })}`)).content
  return (await call<{ content: string }>('GET', `${C}/doc?${q({ session: item.session, id: item.doc })}`)).content
}

/** Put a canvas document under a category ('' = back to its type's group). Also used by the canvas's own menu. */
export async function setDocCategory(session: string, doc: string, category: string): Promise<boolean> {
  try {
    await call('POST', `${C}/category`, { session, id: doc, title: category })
  } catch (e) {
    toast(errText(e), 'error')
    return false
  }
  if (canvasState().session === session) void refreshDocs()
  if (!state.loading) void loadGallery()
  return true
}

export async function moveItem(item: GalleryItem, category: string): Promise<void> {
  if (!item.lib) {
    await setDocCategory(item.session, item.doc, category)
    return
  }
  try {
    await call('PUT', `${L}/item`, { id: item.lib, title: '', category })
  } catch (e) {
    toast(errText(e), 'error')
  }
  await loadGallery()
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
  if (withCanvas && item.doc) openCanvas(item.doc, 'full')
  return true
}

/** Hermes filed a document under a category with its canvas tool: refresh a list that is already loaded. */
export function galleryToolDone(): void {
  if (!state.loading) void loadGallery()
}
