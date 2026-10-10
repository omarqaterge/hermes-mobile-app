// Canvas: documents Hermes and you share for one chat. State + sync with the phone (plugin /canvas API).
// The panel UI is components/Canvas.tsx; the agent writes through its `canvas` tool, and the tool events in
// gateway.ts call canvasToolDone() so the panel opens/refreshes the moment Hermes writes.
import { useSyncExternalStore } from 'react'
import { api } from './api'
import { getState, subscribe, toast } from './store'

export type DocType = 'markdown' | 'html' | 'code' | 'text' | 'json' | 'csv' | 'svg' | 'mermaid'

export interface DocMeta {
  id: string
  title: string
  type: DocType
  lang: string
  rev: number
  updated: number
  by: 'agent' | 'user' | ''
  chars: number
  path: string
  created: number
}
export interface Version {
  rev: number
  at: number
  by: 'agent' | 'user'
  note: string
}
export interface Doc extends DocMeta {
  content: string
  versions?: Version[]
}

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error'

interface CanvasState {
  session: string // stored chat id the docs belong to ('' = no chat yet)
  open: boolean
  size: 'half' | 'full' | 'max'
  docs: DocMeta[]
  active: string | null
  loaded: Record<string, Doc> // full documents we have fetched
  mode: Record<string, 'view' | 'edit'>
  save: SaveState
  remote: string | null // id of a document Hermes changed while you have unsaved edits
  /** Hermes is writing a canvas call right now (its arguments stream from the model, which takes a while for a big
   * page). Hermes sends no text until the call is complete, so the panel shows a "writing" state; `preview` is the
   * document text once the call starts (before the save lands). */
  writing: { since: number; title?: string; preview?: string; docId?: string; autoOpened?: boolean } | null
  /** This chat's document list hasn't arrived yet (chat still opening, or Hermes not reachable): the panel shows a
   * loading state, not "empty". */
  loading: boolean
}

const P = '/api/plugins/hermes-mobile/canvas'
let state: CanvasState = { session: '', open: false, size: 'half', docs: [], active: null, loaded: {}, mode: {}, save: 'idle', remote: null, writing: null, loading: false }
const subs = new Set<() => void>()
const set = (p: Partial<CanvasState>) => {
  state = { ...state, ...p }
  subs.forEach(f => f())
}
export const useCanvas = <T,>(sel: (s: CanvasState) => T): T => useSyncExternalStore(cb => (subs.add(cb), () => subs.delete(cb)), () => sel(state))
export const canvasState = (): CanvasState => state

const q = (o: Record<string, string | number>) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
const call = <T,>(method: string, path: string, body?: unknown) => api<T>(method, path, body, { profile: false })

// ── which chat's canvas ─────────────────────────────────────

let dirtyText: { id: string; text: string } | null = null // unsaved edit in the editor
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** The chat the canvas belongs to: the one on screen, or the one still opening (its documents are stored under its
 * stored id, so they can load before Hermes has resumed it, e.g. right after a cold start). */
function chatId(): string {
  const s = getState()
  return s.opening || s.active?.storedId || ''
}

/** Follow the open chat: each chat has its own canvas. */
function syncSession(): void {
  const id = chatId()
  if (id === state.session) {
    // Still waiting for the document list (offline at the time): try again once the panel is open and Hermes is back.
    if (state.loading && state.open && !listing && getState().conn === 'open') void refreshDocs()
    return
  }
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  // An edit typed just before switching chats is still waiting for its autosave: save it to the chat it
  // belongs to instead of dropping it.
  const d = dirtyText
  const have = d && state.loaded[d.id]
  if (d && have && state.session && d.text !== have.content) {
    call('PUT', `${P}/doc`, { session: state.session, id: d.id, content: d.text, base_rev: have.rev }).catch(e =>
      toast(`Canvas edit in “${have.title}” not saved: ${e instanceof Error ? e.message : String(e)}`, 'error', 6000)
    )
  }
  dirtyText = null
  // Opened on a chat that was still loading, the panel stays open once it is on screen: same id, so no reset.
  set({ session: id, open: false, docs: [], active: null, loaded: {}, mode: {}, save: 'idle', remote: null, writing: null, loading: Boolean(id) })
  if (id) void refreshDocs()
}

let listing = 0 // document-list requests in flight

export async function refreshDocs(): Promise<void> {
  const session = state.session
  if (!session) return
  listing++
  try {
    const r = await call<{ docs: DocMeta[] }>('GET', `${P}?${q({ session })}`)
    if (session !== state.session) return
    const prev = state.docs
    const active = state.active && r.docs.some(d => d.id === state.active) ? state.active : r.docs[0]?.id ?? null
    set({ docs: r.docs, active, loading: false })
    // A document changed under us: reload it, unless you have unsaved edits in it (then flag it).
    for (const d of r.docs) {
      const have = state.loaded[d.id]
      const changed = have ? have.rev !== d.rev : prev.some(p => p.id === d.id && p.rev !== d.rev)
      if (!changed) continue
      if (dirtyText?.id === d.id) set({ remote: d.id })
      else if (have || state.active === d.id) void loadDoc(d.id, true)
    }
  } catch {
    /* offline: keep what we have (and keep `loading`: the 6 s poll or the reconnect tries again) */
  } finally {
    listing--
  }
}

export async function loadDoc(id: string, force = false): Promise<Doc | null> {
  const session = state.session
  if (!session) return null
  if (!force && state.loaded[id]) return state.loaded[id]
  try {
    const d = await call<Doc>('GET', `${P}/doc?${q({ session, id })}`)
    if (session !== state.session) return null
    set({ loaded: { ...state.loaded, [id]: d }, docs: state.docs.map(m => (m.id === id ? { ...m, ...d } : m)) })
    return d
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error')
    return null
  }
}

// ── panel ────────────────────────────────────────────────────

export function openCanvas(id?: string, size?: 'half' | 'full' | 'max'): void {
  syncSession()
  if (!state.session) return
  set({ open: true, size: size ?? state.size, active: id ?? state.active ?? state.docs[0]?.id ?? null })
  if (state.active) void loadDoc(state.active)
}
export const closeCanvas = (): void => {
  void flushSave()
  set({ open: false })
}
export const setCanvasSize = (size: 'half' | 'full' | 'max'): void => set({ size })
export function selectDoc(id: string): void {
  void flushSave()
  set({ active: id, remote: null })
  void loadDoc(id)
}
export const setMode = (id: string, mode: 'view' | 'edit'): void => set({ mode: { ...state.mode, [id]: mode } })

// ── editing ──────────────────────────────────────────────────

/** Called by the editor on every change; saves ~0.8 s after you stop typing. */
export function editDoc(id: string, text: string): void {
  dirtyText = { id, text }
  set({ save: 'dirty' })
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flushSave(), 800)
}

export async function flushSave(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  const d = dirtyText
  if (!d) return
  const have = state.loaded[d.id]
  if (!have) return
  if (d.text === have.content) {
    dirtyText = null
    set({ save: 'idle' })
    return
  }
  set({ save: 'saving' })
  try {
    const r = await call<Doc>('PUT', `${P}/doc`, { session: state.session, id: d.id, content: d.text, base_rev: have.rev })
    if (dirtyText?.text === d.text) dirtyText = null
    set({ loaded: { ...state.loaded, [d.id]: { ...have, ...r, content: d.text } }, docs: state.docs.map(m => (m.id === d.id ? { ...m, ...r } : m)), save: dirtyText ? 'dirty' : 'saved', remote: null })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/conflict|changed/i.test(msg)) set({ save: 'conflict', remote: d.id })
    else {
      set({ save: 'error' })
      toast(msg, 'error')
    }
  }
}

/** The text being edited but not yet saved, for the panel to keep showing. */
export const unsavedFor = (id: string): string | null => (dirtyText?.id === id ? dirtyText.text : null)

/** Conflict: take Hermes's version (drops your unsaved edit) … */
export async function takeTheirs(id: string): Promise<void> {
  dirtyText = null
  set({ remote: null, save: 'idle' })
  await loadDoc(id, true)
}
/** … or keep yours and overwrite. */
export async function keepMine(id: string): Promise<void> {
  const d = dirtyText
  if (!d) return
  const latest = await loadDoc(id, true)
  if (latest) dirtyText = d
  set({ remote: null })
  await flushSave()
}

// ── documents ────────────────────────────────────────────────

export async function createDoc(title: string, content = '', type: DocType | '' = '', lang = ''): Promise<DocMeta | null> {
  syncSession()
  if (!state.session) {
    toast('Send a message first: the canvas belongs to a chat', 'warn')
    return null
  }
  try {
    const d = await call<Doc>('POST', `${P}/doc`, { session: state.session, title, content, type, lang })
    set({ loaded: { ...state.loaded, [d.id]: d }, docs: [...state.docs, d], active: d.id, open: true })
    return d
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error')
    return null
  }
}

export async function closeDoc(id: string): Promise<void> {
  try {
    await call('DELETE', `${P}/doc?${q({ session: state.session, id })}`)
    const docs = state.docs.filter(d => d.id !== id)
    const { [id]: _gone, ...loaded } = state.loaded
    set({ docs, loaded, active: state.active === id ? docs[0]?.id ?? null : state.active, open: docs.length ? state.open : false })
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error')
  }
}

export async function renameDoc(id: string, title: string): Promise<void> {
  try {
    const r = await call<Doc>('POST', `${P}/rename`, { session: state.session, id, title })
    set({ docs: state.docs.map(m => (m.id === id ? { ...m, ...r } : m)), loaded: state.loaded[id] ? { ...state.loaded, [id]: { ...state.loaded[id], title: r.title } } : state.loaded })
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error')
  }
}

export async function restoreVersion(id: string, rev: number): Promise<void> {
  dirtyText = null
  try {
    await call('POST', `${P}/restore`, { session: state.session, id, rev })
    set({ save: 'idle', remote: null, writing: null })
    await loadDoc(id, true)
    toast('Version restored')
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error')
  }
}

export const getVersion = (id: string, rev: number) => call<{ rev: number; at: number; by: string; note: string; content: string }>('GET', `${P}/version?${q({ session: state.session, id, rev })}`)

/** Open a text file from the phone in the canvas (linked to the file so it can be saved back). */
export async function openFileInCanvas(path: string): Promise<boolean> {
  syncSession()
  if (!state.session) {
    toast('Send a message first: the canvas belongs to a chat', 'warn')
    return false
  }
  try {
    const d = await call<Doc>('POST', `${P}/open-file`, { session: state.session, path })
    set({ loaded: { ...state.loaded, [d.id]: d }, docs: state.docs.some(m => m.id === d.id) ? state.docs.map(m => (m.id === d.id ? { ...m, ...d } : m)) : [...state.docs, d], active: d.id, open: true })
    return true
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error')
    return false
  }
}

export async function saveToFile(id: string): Promise<void> {
  await flushSave()
  try {
    const r = await call<{ path: string }>('POST', `${P}/save-file`, { session: state.session, id })
    toast(`Saved to ${r.path}`)
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error')
  }
}

// ── the agent's canvas tool ──────────────────────────────────

/** gateway.ts calls this when Hermes's `canvas` tool finished. Opens the panel for new documents. */
export function canvasToolDone(resultText: string | null | undefined, args: unknown): void {
  syncSession()
  canvasWritingDone()
  let shown = false
  let id = ''
  try {
    const r = JSON.parse(resultText || '{}')
    if (r.ok === false) return
    shown = Boolean(r.shown)
    id = r.id || ''
  } catch {
    /* not JSON: just refresh */
  }
  const action = (args as { action?: string } | null)?.action || ''
  void refreshDocs().then(() => {
    if (id && (shown || action === 'write' || action === 'patch')) {
      if (state.open || shown) {
        set({ active: id, open: true })
        void loadDoc(id, true)
      } else if (!state.open) toast(action === 'create' ? 'Hermes added a document to the canvas' : 'Hermes updated the canvas', 'info')
    }
  })
}

let writeTimer: ReturnType<typeof setTimeout> | null = null

/** gateway.ts: the model started writing what is (probably) a canvas call. After a moment, still writing = a real
 * document (reads and lists are short), so the panel opens on the writing state. */
export function canvasWritingStarted(): void {
  if (state.writing) return
  set({ writing: { since: Date.now() } })
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    if (state.writing && !state.open) set({ open: true, writing: { ...state.writing, autoOpened: true } })
  }, 1500)
}

/** gateway.ts: the call's real name and arguments arrived. Not a canvas call after all: undo the guess. */
export function canvasCallStarted(name: string, args: Record<string, unknown> | null | undefined): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = null
  const w = state.writing
  if (name !== 'canvas') {
    if (w) set({ writing: null, open: w.autoOpened ? false : state.open })
    return
  }
  const action = String(args?.action || '')
  if (action !== 'create' && action !== 'write') {
    if (w) set({ writing: null, open: w.autoOpened ? false : state.open })
    return
  }
  const content = typeof args?.content === 'string' ? args.content : undefined
  const docId = typeof args?.id === 'string' ? args.id : undefined
  set({ writing: { since: w?.since ?? Date.now(), title: typeof args?.title === 'string' ? args.title : undefined, preview: content, docId, autoOpened: w?.autoOpened } })
}

/** The turn ended (or the tool finished): no more writing state. */
export function canvasWritingDone(): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = null
  if (!state.writing) return
  const w = state.writing
  // Opened only for a call that wrote nothing that shows (failed, or the turn was stopped): close it again.
  set({ writing: null, open: w.autoOpened && !state.active ? false : state.open })
}

// ── background sync while it matters ─────────────────────────

let timer: ReturnType<typeof setInterval> | null = null
export function startCanvasSync(): void {
  if (timer) return
  subscribe(syncSession)
  syncSession()
  // Every 6 s while the panel is open (another device or a scheduled job could change a document). Hermes's own
  // edits need no polling: the canvas tool's completion refreshes at once (canvasToolDone). Nothing while closed.
  timer = setInterval(() => {
    if (document.visibilityState === 'visible' && state.session && state.open) void refreshDocs()
  }, 6000)
}

// ── line diff (version history) ──────────────────────────────

/** Unified-style diff of two texts, for DiffView. Falls back to a whole-block replace for huge inputs. */
export function lineDiff(a: string, b: string): string {
  const x = a.split('\n')
  const y = b.split('\n')
  if (x.length * y.length > 4_000_000) return ['@@ large change @@', ...x.map(l => `-${l}`), ...y.map(l => `+${l}`)].join('\n')
  const n = x.length
  const m = y.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (x[i] === y[j]) out.push(` ${x[i++]}`), j++
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(`-${x[i++]}`)
    else out.push(`+${y[j++]}`)
  }
  while (i < n) out.push(`-${x[i++]}`)
  while (j < m) out.push(`+${y[j++]}`)
  // keep 2 lines of context around changes
  const keep = new Set<number>()
  out.forEach((l, k) => {
    if (l[0] !== ' ') for (let c = Math.max(0, k - 2); c <= Math.min(out.length - 1, k + 2); c++) keep.add(c)
  })
  const res: string[] = []
  let gap = false
  out.forEach((l, k) => {
    if (keep.has(k)) {
      if (gap) res.push('@@ … @@')
      res.push(l)
      gap = false
    } else gap = true
  })
  return res.length ? res.join('\n') : ' (no changes)'
}
