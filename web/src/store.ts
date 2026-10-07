import { useSyncExternalStore } from 'react'
import type {
  ProfileRow,
  SessionListRow,
  SessionLiveInfo,
  TranscriptMessage,
  Usage
} from '@hermes/shared/gateway-contract.generated'
import type { ConnectionState } from '@hermes/shared/json-rpc-gateway'
import type { ServerRequest } from '@hermes/shared/json-rpc-channel'
import { cachedChat } from './chatcache'

export interface ActivityItem {
  session: string
  text: string
  short?: string
  profile?: string
  review?: boolean
  ts: number
}

export type ToolStatus = 'generating' | 'running' | 'done' | 'error'

export type ChatItem =
  | { kind: 'user'; id: string; text: string; images?: string[]; imageUrls?: string[]; imagePaths?: string[]; files?: string[]; rowId?: number; /** ms */ at?: number }
  | {
      kind: 'assistant'
      id: string
      text: string
      reasoning: string
      streaming: boolean
      error?: string
      warning?: string
      /** Turn stats shown beside the actions, e.g. "~41 tok/s · ctx 2%". */
      meta?: string
      /** ms */
      at?: number
    }
  | {
      kind: 'tool'
      id: string
      name: string
      context?: string
      args?: Record<string, unknown> | null
      status: ToolStatus
      duration?: number | null
      summary?: string | null
      resultText?: string | null
      inlineDiff?: string | null
      risk?: string
    }
  | { kind: 'notice'; id: string; text: string; level: 'info' | 'warn' | 'error' }
  | {
      kind: 'subagent'
      id: string
      goal: string
      status: string
      detail?: string
      summary?: string | null
      tools: number
    }

export interface Todo {
  id?: string
  content?: string
  status?: string
}

/** Something queued for the next message: a photo (held by Hermes until the turn is sent) or a file
 * staged in the chat's workspace (sent as its @file: reference in the message text). */
export interface Attachment {
  kind: 'image' | 'file'
  name: string
  /** Hermes's path for it: image.detach needs it to drop a queued photo. */
  path?: string
  /** file.attach's reference text (e.g. "@file:…"), put in front of the message. */
  ref?: string
  /** Local thumbnail (object URL) for photos. */
  preview?: string
}

export interface ActiveSession {
  runtimeId: string
  storedId: string
  profile: string
  title: string
  info: SessionLiveInfo
  items: ChatItem[]
  running: boolean
  status: string // live "thinking.delta" spinner text
  usage: Usage | null
  /** Context window fill, from provider usage or Hermes's local estimate (context_breakdown). */
  ctx: Ctx | null
  /** Live generation speed of the running turn (tokens/s), null before the stream starts. */
  tps: number | null
  todos: Todo[]
  openAssistantId: string | null
  attachments: Attachment[] // queued for the next prompt
}

export interface Ctx {
  used: number
  max: number
  percent: number
}

export type Sheet = null | 'model' | 'commands' | 'session-actions' | 'chat-menu' | 'draft-menu' | 'status' | 'rollback'

export type Screen = null | 'skills' | 'memory' | 'cron' | 'files' | 'projects' | 'settings' | 'bots' | 'setup' | 'hub'

export interface Toast {
  id: number
  text: string
  level: 'info' | 'warn' | 'error'
}

export interface AppState {
  conn: ConnectionState
  connDetail: string
  profile: string
  profiles: ProfileRow[]
  sessions: SessionListRow[]
  sessionsLoading: boolean
  active: ActiveSession | null
  /** Stored id of a chat being (re)opened: the UI shows a loading state instead of an empty new chat. */
  opening: string | null
  /** A chat's last-seen items, drawn while `opening` waits for Hermes (chatcache.ts). Read-only: no actions. */
  preview: { storedId: string; title: string; items: ChatItem[] } | null
  requests: ServerRequest[]
  drawer: boolean
  sheet: Sheet
  screen: Screen
  /** Profile a Settings screen opens scoped to (from a bot's page); null = the current one. */
  screenProfile: string | null
  /** Where Back from `screen` goes (the Hermes hub opened it); null = the chat. */
  screenBack: Screen
  toasts: Toast[]
  textScale: number
  health: import('./health').Health | null
  /** What Hermes is doing right now on the phone (plugin /activity), incl. background self-review. */
  activity: ActivityItem[]
  /** The profile's default model, shown in the header before a chat exists. */
  defaultModel: string
  /** …and its reasoning level (config agent.reasoning_effort, or the model's own override). */
  defaultEffort: string
  /** Chats with messages you haven't opened yet (unread.ts). */
  unread: string[]
  /** A message-search hit to scroll to once its chat is open (jump.ts). */
  jump: import('./jump').Jump | null
  /** In-chat search (header ⋮ → Search): the text typed and which match (0 = newest) is current; null = off. */
  find: { q: string; i: number } | null
  /** A message typed while Hermes was offline, sent on reconnect (gateway.ts outbox). chat null = a new chat. */
  queued: { chat: string | null; text: string } | null
}

const savedProfile = (() => {
  try {
    return localStorage.getItem('hm.profile') || 'default'
  } catch {
    return 'default'
  }
})()

const savedScale = (() => {
  try {
    return Number(localStorage.getItem('hm.textScale')) || 1
  } catch {
    return 1
  }
})()

const lastOpen = (() => {
  try {
    const v = JSON.parse(localStorage.getItem('hm.lastSession') || 'null') as { id: string; profile: string } | null
    return v && v.profile === savedProfile ? v.id : null
  } catch {
    return null
  }
})()

let state: AppState = {
  conn: 'idle',
  connDetail: '',
  profile: savedProfile,
  profiles: [],
  sessions: [],
  sessionsLoading: false,
  active: null,
  opening: lastOpen,
  preview: lastOpen ? cachedChat(savedProfile, lastOpen) : null,
  requests: [],
  unread: [],
  jump: null,
  find: null,
  queued: (() => {
    try {
      return JSON.parse(localStorage.getItem('hm.outbox.v1') || 'null')
    } catch {
      return null
    }
  })(),
  drawer: false,
  sheet: null,
  screen: null,
  screenProfile: null,
  screenBack: null,
  toasts: [],
  textScale: savedScale,
  health: null,
  activity: [],
  defaultModel: "",
  defaultEffort: ""
}

const listeners = new Set<() => void>()

/** Run `fn` on every state change (outside React). Returns an unsubscribe function. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getState(): AppState {
  return state
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...next }
  listeners.forEach(l => l())
}

export function updateActive(fn: (a: ActiveSession) => Partial<ActiveSession> | null): void {
  const a = state.active
  if (!a) return
  const patch = fn(a)
  if (patch) setState({ active: { ...a, ...patch } })
}

export function useStore<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => select(state)
  )
}

let toastSeq = 0
export function toast(text: string, level: Toast['level'] = 'info', ttl = 3500): void {
  if (state.toasts.some(t => t.text === text)) return // the same message is already on screen: don't stack copies
  const id = ++toastSeq
  setState(s => ({ toasts: [...s.toasts.slice(-2), { id, text, level }] }))
  setTimeout(() => setState(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), ttl)
}

let itemSeq = 0
export const newId = (p: string) => `${p}-${Date.now().toString(36)}-${++itemSeq}`

function storedInlineDiff(meta: unknown): string | undefined {
  let v = meta
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return undefined
    }
  }
  const trm = (v as { tool_result_metadata?: unknown } | null)?.tool_result_metadata
  const diff = (trm as { inline_diff?: unknown } | null)?.inline_diff
  return typeof diff === 'string' && diff.trim() ? diff : undefined
}

/** A stored user message carries its attachments as text: `@file:<path>` refs in front (and Hermes's
 *  "--- Attached Context ---" block after the message), `@image:<path>` lines (each with a "[screenshot]"
 *  marker). Split them off so a resumed chat shows chips, like a message sent in this session. */
export function splitAttachments(text: string): { text: string; images: string[]; files: string[] } {
  const base = (p: string) => p.trim().split('/').pop() || p.trim()
  let t = text
  const ctx = t.indexOf('\n--- Attached Context ---')
  if (ctx >= 0) t = t.slice(0, ctx)
  const files: string[] = []
  const lead = t.match(/^(?:@file:\S+\s*)+/)
  if (lead) {
    for (const m of lead[0].matchAll(/@file:(\S+)/g)) files.push(base(m[1]))
    t = t.slice(lead[0].length)
  }
  const images: string[] = []
  t = t.replace(/^@image:(.+)$(?:\n\[screenshot\])?/gm, (_, p: string) => {
    images.push(base(p))
    return ''
  })
  return { text: t.replace(/\n{3,}/g, '\n\n').trim(), images, files }
}

/** Stored transcript → chat items (user / assistant+reasoning / tool rows). */
export function hydrate(messages: TranscriptMessage[]): ChatItem[] {
  const out: ChatItem[] = []
  // Hermes' resume of a chat that is still answering appends the previous turn's tail again (same row ids and
  // tool call ids) after the live turn's rows. A stored row can't legitimately appear twice: skip repeats.
  const seen = new Set<string>()
  for (const m of messages) {
    if (m.display_kind === 'hidden') continue
    const key = m.role === 'tool' ? (typeof m.tool_call_id === 'string' && m.tool_call_id ? `t:${m.tool_call_id}` : '') : typeof m.row_id === 'number' ? `r:${m.row_id}` : ''
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    const text = typeof m.text === 'string' ? m.text : typeof m.content === 'string' ? m.content : ''
    // Seconds on the wire (ms tolerated).
    const at = typeof m.timestamp === 'number' && m.timestamp > 0 ? (m.timestamp > 1e12 ? m.timestamp : m.timestamp * 1000) : undefined
    if (m.role === 'user') {
      const u = splitAttachments(text)
      if (u.text || u.images.length || u.files.length)
        out.push({
          kind: 'user',
          id: newId('u'),
          text: u.text,
          images: u.images.length ? u.images : undefined,
          imagePaths: u.images.length ? [...text.matchAll(/^@image:(.+)$/gm)].map(m => m[1].trim()) : undefined,
          files: u.files.length ? u.files : undefined,
          rowId: typeof m.row_id === 'number' ? m.row_id : undefined,
          at
        })
    } else if (m.role === 'assistant') {
      const reasoning = (typeof m.reasoning === 'string' && m.reasoning) || ''
      if (text.trim() || reasoning.trim())
        out.push({ kind: 'assistant', id: newId('a'), text, reasoning, streaming: false, at })
    } else if (m.role === 'tool') {
      out.push({
        kind: 'tool',
        id: (m.tool_call_id as string) || newId('t'),
        name: m.name || 'tool',
        context: typeof m.context === 'string' ? m.context : undefined,
        args: m.args ?? null,
        status: 'done',
        // The gateway stores the edit preview with the result; resumed transcripts carry it here.
        inlineDiff: storedInlineDiff(m.display_metadata)
      })
    } else if (m.role === 'system' && text.trim()) {
      out.push({ kind: 'notice', id: newId('n'), text, level: 'info' })
    }
  }
  return out
}

/** A reloaded transcript (`fresh`) shows something the screen (`shown`) lacks: a tool call, a message or reply text.
 * Otherwise the screen is kept on a reconnect, with its local notices, tool timings and live reply. */
export function addsToScreen(fresh: ChatItem[], shown: ChatItem[]): boolean {
  const tools = new Set(shown.filter(i => i.kind === 'tool').map(i => i.id))
  if (fresh.some(i => i.kind === 'tool' && !tools.has(i.id))) return true
  const count = (items: ChatItem[], kind: ChatItem['kind']) => items.filter(i => i.kind === kind).length
  if (count(fresh, 'user') > count(shown, 'user')) return true
  const text = (items: ChatItem[]) => items.reduce((n, i) => n + (i.kind === 'assistant' ? i.text.trim().length : 0), 0)
  return text(fresh) > text(shown)
}

/** Close the open full screen: back to the hub when it opened it, else to the chat. */
export function closeScreen(): void {
  const s = getState()
  setState({ screen: s.screen !== s.screenBack ? s.screenBack : null, screenBack: null })
}
