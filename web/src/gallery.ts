// Library: canvas documents you chose to keep, each under a category. Independent of chats (deleting a chat clears
// its canvas, not the library). State + calls to the plugin's /library API; the screen is components/Library.tsx.
import { useSyncExternalStore } from 'react'
import { api } from './api'
import { canvasState, createDoc, flushSave, type DocType } from './canvas'
import { toast } from './store'

export interface LibItem {
  id: string
  title: string
  type: DocType
  lang: string
  category: string
  saved: number
  chars: number
  source?: { session: string; doc: string }
}
export interface LibItemFull extends LibItem {
  content: string
}

interface LibraryState {
  items: LibItem[]
  categories: Record<string, number>
  /** The first list hasn't arrived yet: the screen shows "Loading…", never "Nothing saved yet". */
  loading: boolean
  error: string
  filter: string // category shown, '' = all
}

const P = '/api/plugins/hermes-mobile/library'
let state: LibraryState = { items: [], categories: {}, loading: true, error: '', filter: '' }
const subs = new Set<() => void>()
const set = (p: Partial<LibraryState>) => {
  state = { ...state, ...p }
  subs.forEach(f => f())
}
export const useLibrary = <T,>(sel: (s: LibraryState) => T): T => useSyncExternalStore(cb => (subs.add(cb), () => subs.delete(cb)), () => sel(state))
export const libraryState = (): LibraryState => state

const call = <T,>(method: string, path: string, body?: unknown) => api<T>(method, path, body, { profile: false })
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
let everLoaded = false

export async function loadLibrary(): Promise<void> {
  try {
    const r = await call<{ items: LibItem[]; categories: Record<string, number> }>('GET', P)
    everLoaded = true
    // A filter on a category that no longer exists falls back to All.
    set({ items: r.items, categories: r.categories, loading: false, error: '', filter: state.filter && r.categories[state.filter] ? state.filter : '' })
  } catch (e) {
    // Keep `loading` until a real answer: an unreachable Hermes is not an empty library.
    set({ error: errText(e) })
  }
}

export function setLibraryFilter(filter: string): void {
  set({ filter })
}

/** Save one of the open chat's canvas documents (its latest text, unsaved edits included). */
export async function saveToLibrary(docId: string, category: string): Promise<boolean> {
  const session = canvasState().session
  if (!session) return false
  try {
    await flushSave()
    const item = await call<LibItem>('POST', P, { session, id: docId, category })
    toast(`Saved to Library · ${item.category}`)
    void loadLibrary()
    return true
  } catch (e) {
    toast(errText(e), 'error')
    return false
  }
}

export async function updateItem(id: string, change: { title?: string; category?: string }): Promise<void> {
  try {
    await call<LibItem>('PUT', `${P}/item`, { id, title: change.title || '', category: change.category || '' })
  } catch (e) {
    toast(errText(e), 'error')
  }
  await loadLibrary()
}

export async function deleteItem(id: string): Promise<void> {
  try {
    await call('DELETE', `${P}/item?id=${encodeURIComponent(id)}`)
  } catch (e) {
    toast(errText(e), 'error')
  }
  await loadLibrary()
}

export async function getItem(id: string): Promise<LibItemFull> {
  return call<LibItemFull>('GET', `${P}/item?id=${encodeURIComponent(id)}`)
}

/** A copy of the item as a new document on the open chat's canvas (createDoc refuses when there's no chat). */
export async function openInCanvas(item: LibItem): Promise<boolean> {
  try {
    const full = await getItem(item.id)
    return (await createDoc(full.title, full.content, full.type, full.lang)) != null
  } catch (e) {
    toast(errText(e), 'error')
    return false
  }
}

/** Hermes saved a document with its canvas tool: refresh a list that was already loaded and say where it went. */
export function libraryToolDone(resultText: string | null | undefined): void {
  try {
    const r = JSON.parse(resultText || '{}')
    if (r.ok === false || !r.item) return
    toast(`Hermes saved “${r.item.title}” to Library · ${r.item.category}`, 'info')
  } catch {
    return
  }
  if (everLoaded) void loadLibrary()
}
