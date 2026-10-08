import { btwDone, openBtw } from './btw'
import { markSeen, noteSessions } from './unread'
import { rememberPrompt } from './recent'
import { api } from './api'
import { forgetCheckpoints } from './checkpoints'
import { cachedChat, forgetChat, rememberChat, saveChatToDisk } from './chatcache'
import { canvasCallStarted, canvasToolDone, canvasWritingDone, canvasWritingStarted } from './canvas'
import { applyDraftRead, autoReadFor, liveBridge, setDraftRead, speak } from './voice'
import { JsonRpcGatewayClient, type GatewayEvent } from '@hermes/shared/json-rpc-gateway'
import type { ServerRequest } from '@hermes/shared/json-rpc-channel'
import type {
  MessageCompletePayload,
  PromptSubmitResult,
  ProfilesListResult,
  SessionCompressResult,
  SessionCreateResult,
  SessionListResult,
  SessionListRow,
  SessionResumeResult,
  SubagentEventPayload,
  ToolCompletePayload,
  ToolStartPayload,
  TranscriptMessage,
  Usage
} from '@hermes/shared/gateway-contract.generated'
import { appInBackground, cancelNotification, notify, setLastChat, startHermes, wsUrl } from './bridge'
import {
  type ActiveSession,
  type Attachment,
  type ChatItem,
  type Ctx,
  addsToScreen,
  getState,
  hydrate,
  newId,
  setState,
  toast,
  type Todo,
  updateActive
} from './store'

// The client's own heartbeat is off (interval 0): see "liveness" below.
export const client = new JsonRpcGatewayClient({ requestTimeoutMs: 120_000, heartbeatIntervalMs: 0 })

const SERVER_REQUESTS = new Set(['approval', 'clarify', 'secret', 'sudo', 'otp', 'connection.request'])

// ── connection lifecycle ────────────────────────────────────

let attempt = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let started = false

client.onState(conn => {
  setState({ conn })
  if (conn === 'open') {
    aliveAt = Date.now()
    attempt = 0
    setState({ connDetail: '' })
  }
  if ((conn === 'closed' || conn === 'error') && started) scheduleReconnect()
})

function scheduleReconnect(): void {
  if (reconnectTimer) return
  const delay = Math.min(15_000, 600 * 2 ** Math.min(attempt, 5))
  attempt++
  setState({ connDetail: attempt > 2 ? 'Starting Hermes…' : 'Reconnecting…' })
  if (attempt === 2 || attempt % 6 === 0) startHermes()
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void connect()
  }, delay)
}

export async function connect(): Promise<void> {
  if (!started && getState().sessions.length === 0) {
    const cached = cachedSessions(getState().profile)
    if (cached.length) setState({ sessions: cached })
  }
  started = true
  const url = await wsUrl()
  if (!url) {
    setState({ conn: 'error', connDetail: 'Hermes is not running yet' })
    scheduleReconnect()
    return
  }
  warm.length = 0 // runtimes of the old socket: Hermes reaps those itself once it sees the socket gone
  try {
    await client.connect(url)
    await afterConnect()
  } catch (err) {
    setState({ connDetail: err instanceof Error ? err.message : String(err) })
    scheduleReconnect()
  }
}

export function reconnectNow(start = true): void {
  attempt = 0
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
  if (start) startHermes()
  void connect()
}

/** A notification answer woke the page from the background. The socket may be dead by now: timers are
 *  frozen while the app sleeps, and the client's heartbeat drops the socket on its first late tick, taking
 *  an in-flight send with it ("Send failed: WebSocket closed"). True when a ping gets through. */
export async function connectionAlive(): Promise<boolean> {
  if (getState().conn !== 'open') return false
  try {
    await rpc('gateway.ping', {}, 5000)
    return true
  } catch {
    return false
  }
}

// ── liveness ────────────────────────────────────────────────
// The client's built-in heartbeat dropped the socket after 45 s without an inbound frame, judged by a timer. While
// the app is hidden Chromium freezes the page (~1 min in), so on return the first late tick saw a minute of
// "silence" and closed a healthy socket: "offline", a reconnect, and a reload of the chat mid-turn. This one gives
// the socket a fresh window after a frozen gap, and pings as soon as the page is shown again.
const BEAT_MS = 15_000
const DEADLINE_MS = 45_000
let aliveAt = Date.now()
let lastBeat = Date.now()

client.onAny(() => {
  aliveAt = Date.now()
})

setInterval(() => {
  const now = Date.now()
  const slept = now - lastBeat > BEAT_MS * 2
  lastBeat = now
  if (getState().conn !== 'open') return
  if (slept) aliveAt = now
  else if (now - aliveAt >= DEADLINE_MS) {
    client.invalidate('WebSocket heartbeat timed out')
    return
  }
  rpc('gateway.ping', {}, DEADLINE_MS).then(
    () => (aliveAt = Date.now()),
    () => {}
  )
}, BEAT_MS)

/** Back in front: a socket that died while the page was frozen is replaced now, not after the deadline. */
async function checkSocket(): Promise<void> {
  if (getState().conn !== 'open') return
  try {
    await rpc('gateway.ping', {}, 10_000)
  } catch {
    if (getState().conn === 'open') client.invalidate('WebSocket closed')
  }
}

/** Keep a message for `chat` in the outbox and reconnect; afterConnect's flushOutbox sends it. */
export function queueAndReconnect(chat: string, text: string): void {
  saveOutbox({ chat, text })
  reconnectNow(false)
}

async function afterConnect(): Promise<void> {
  void loadProfiles()
  void loadSessions()
  void loadDefaultModel()
  setTimeout(() => void import('./hermes-update').then(m => m.checkHermes()), 5000) // is this Hermes the build the app was made for?
  const a = getState().active
  const last = a?.storedId || rememberedSession()
  const seq0 = openSeq
  if (last) {
    // Re-attach to the session we were showing (the backend may have restarted,
    // or Android killed the app while it was in the background).
    try {
      await resumeSession(last, { keepItemsIfSame: true, auto: true })
    } catch (err) {
      // Forget the chat only when Hermes says it is gone. A timeout right after start-up must not
      // drop you on an empty home screen: try once more shortly.
      if (!a && /not found|no such|unknown session|does not exist/i.test(errText(err))) rememberSession(null)
      setState({ opening: null })
      if (!/not found|no such|unknown session|does not exist/i.test(errText(err))) {
        setTimeout(() => {
          if (getState().conn === 'open' && !getState().active && openSeq === seq0) void resumeSession(last, { keepItemsIfSame: true, auto: true }).catch(() => {})
        }, 4000)
      }
    }
  } else setState({ opening: null })
  void flushOutbox()
}

// ── outbox: one message typed while Hermes was offline ──
function saveOutbox(q: AppStateQueued): void {
  setState({ queued: q })
  try {
    if (q) localStorage.setItem('hm.outbox.v1', JSON.stringify(q))
    else localStorage.removeItem('hm.outbox.v1')
  } catch {
    /* ignore */
  }
}
type AppStateQueued = { chat: string | null; text: string } | null

/** Offline: keep the message for the chat it was typed in and send it once connected. */
export function queueMessage(text: string): void {
  const s = getState()
  saveOutbox({ chat: s.active?.storedId || s.opening || null, text })
}

/** Take the queued message back (✕ on its chip): it returns to the composer. */
export function unqueueMessage(): string {
  const q = getState().queued
  saveOutbox(null)
  return q?.text || ''
}

async function flushOutbox(): Promise<void> {
  const q = getState().queued
  if (!q || getState().conn !== 'open') return
  saveOutbox(null)
  try {
    if (q.chat && getState().active?.storedId !== q.chat) await resumeSession(q.chat)
    if (!q.chat && getState().active) startDraft()
    await sendPrompt(q.text)
    toast('Sent the message you queued')
  } catch (err) {
    composerPrefill.set(q.text)
    toast(`Couldn't send the queued message: ${errText(err)}`, 'error', 6000)
  }
}

/** Tapped a Hermes notification: show that chat (now, or right after connecting). */
/** `draft`: an answer typed into a notification that couldn't be delivered goes into the composer. */
export function openSessionFromNotification(storedId: string, draft?: string): void {
  rememberSession(storedId)
  setState({ screen: null, sheet: null, drawer: false })
  const fill = () => draft && composerPrefill.set(draft)
  if (getState().conn === 'open') void resumeSession(storedId).then(fill, e => toast(errText(e), 'error'))
  else setTimeout(fill, 300)
}

function rememberedSession(): string | null {
  try {
    const raw = localStorage.getItem('hm.lastSession')
    const v = raw ? (JSON.parse(raw) as { id: string; profile: string }) : null
    return v && v.profile === getState().profile ? v.id : null
  } catch {
    return null
  }
}

function rememberSession(id: string | null): void {
  try {
    if (id) localStorage.setItem('hm.lastSession', JSON.stringify({ id, profile: getState().profile }))
    else localStorage.removeItem('hm.lastSession')
  } catch {
    /* ignore */
  }
}

// ── requests ────────────────────────────────────────────────

export function rpc<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
  const profile = getState().profile
  return client.request<T>(method, { profile, ...params }, timeoutMs)
}

export async function loadProfiles(): Promise<void> {
  try {
    const r = await rpc<ProfilesListResult>('profiles.list')
    setState({ profiles: r.profiles ?? [] })
  } catch {
    /* non-fatal */
  }
}

let sessionsTimer: ReturnType<typeof setTimeout> | null = null
/** How many chats the drawer asks for; "Show more" raises it (session.list has a limit but no paging). */
const SESSIONS_PAGE = 80
let sessionLimit = SESSIONS_PAGE
/** The last list filled the whole page, so older chats may exist. */
export const moreSessionsMayExist = (): boolean => getState().sessions.length >= sessionLimit
export function loadMoreSessions(): Promise<void> {
  sessionLimit += 100
  return loadSessions()
}
export function loadSessionsSoon(): void {
  if (sessionsTimer) return
  sessionsTimer = setTimeout(() => {
    sessionsTimer = null
    void loadSessions()
  }, 800)
}

const SESSIONS_CACHE = (p: string) => `hm.sessions.v1.${p}`

/** The last chat list we saw, so the drawer isn't empty while Hermes is (re)starting. */
export function cachedSessions(profile: string): SessionListRow[] {
  try {
    const v = JSON.parse(localStorage.getItem(SESSIONS_CACHE(profile)) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** What new chats start with (model + reasoning level), for the header before a chat exists. */
export async function loadDefaultModel(): Promise<void> {
  try {
    const [info, cfg] = await Promise.all([
      api<{ model?: string }>('GET', '/api/model/info'),
      api<{ agent?: { reasoning_effort?: string; reasoning_overrides?: Record<string, string> } }>('GET', '/api/config').catch(() => null)
    ])
    const model = info?.model || ''
    const ag = cfg?.agent
    // A per-model override (agent.reasoning_overrides) beats the general default.
    const effort = (model && ag?.reasoning_overrides?.[model]) || ag?.reasoning_effort || ''
    setState({ defaultModel: model || getState().defaultModel, defaultEffort: effort })
  } catch {
    /* keep the last one */
  }
}

export async function loadSessions(): Promise<void> {
  setState({ sessionsLoading: true })
  try {
    const r = await rpc<SessionListResult>('session.list', { limit: sessionLimit })
    setState({ sessions: r.sessions ?? [] })
    noteSessions(r.sessions ?? [])
    try {
      localStorage.setItem(SESSIONS_CACHE(getState().profile), JSON.stringify((r.sessions ?? []).slice(0, SESSIONS_PAGE)))
    } catch {
      /* ignore */
    }
  } catch {
    /* keep old list */
  } finally {
    setState({ sessionsLoading: false })
  }
}

export async function switchProfile(profile: string): Promise<void> {
  if (profile === getState().profile) return
  openSeq++
  keepPreview(getState().active)
  for (const w of warm.splice(0)) closeLater(w.runtimeId, 0)
  await closeActiveIfIdle()
  try {
    localStorage.setItem('hm.profile', profile)
  } catch {
    /* ignore */
  }
  sessionLimit = SESSIONS_PAGE
  setState({ profile, active: null, opening: null, sessions: cachedSessions(profile), drawer: false, defaultModel: '' })
  void loadSessions()
  void loadDefaultModel()
}

// Chats you just left stay live in Hermes for a while: switching back is then Hermes's instant "already live"
// path, and closing one is not on the way of opening the next. session.close runs on Hermes's WebSocket read
// loop (not its worker pool) and finalizes the chat there (memory commit, end hooks, up to 5 s waiting for
// a background review), so while it runs every later request waits. It used to be awaited BEFORE each
// session.resume, which made opening a chat right after a reply take seconds.
const WARM = 2
const warm: Array<{ storedId: string; runtimeId: string }> = []

function closeLater(runtimeId: string, ms = 3000): void {
  setTimeout(() => {
    // Reopened meanwhile (Hermes handed the same live session back): keep it.
    if (getState().active?.runtimeId === runtimeId || warm.some(w => w.runtimeId === runtimeId)) return
    void rpc('session.close', { session_id: runtimeId }).catch(() => {})
  }, ms)
}

/** `prev` is no longer on screen: keep it warm (an idle one) and close the oldest warm chats. */
function retire(prev: ActiveSession | null): void {
  if (!prev || prev.running) return // a working chat stays open, as before: it finishes and notifies
  if (getState().active?.runtimeId === prev.runtimeId) return
  const i = warm.findIndex(w => w.storedId === prev.storedId)
  if (i >= 0) warm.splice(i, 1)
  warm.unshift({ storedId: prev.storedId, runtimeId: prev.runtimeId })
  for (const w of warm.splice(WARM)) closeLater(w.runtimeId)
}

function unwarm(storedId: string): void {
  const i = warm.findIndex(w => w.storedId === storedId)
  if (i >= 0) warm.splice(i, 1)
}

function keepPreview(a: ActiveSession | null): void {
  if (a) rememberChat(a.profile, a.storedId, a.title, a.items)
}

async function closeActiveIfIdle(): Promise<void> {
  const a = getState().active
  if (a && !a.running) {
    try {
      await rpc('session.close', { session_id: a.runtimeId })
    } catch {
      /* ignore */
    }
  }
}

function baseActive(r: SessionCreateResult | SessionResumeResult, storedId: string): ActiveSession {
  const resumed = r as SessionResumeResult
  const running = Boolean(resumed.running ?? r.info?.running)
  const items = hydrate(r.messages ?? [])
  const openAssistantId = running ? addInflight(items, resumed.inflight) : null
  return {
    runtimeId: r.session_id,
    storedId: r.stored_session_id || storedId,
    profile: getState().profile,
    title: r.info?.title || '',
    info: r.info ?? {},
    items,
    running,
    status: '',
    usage: r.info?.usage ?? null,
    ctx: null,
    tps: null,
    todos: (resumed.todo_state?.todos as Todo[] | undefined) ?? [],
    openAssistantId,
    attachments: []
  }
}

/** Opening a chat while Hermes is still answering: the stored transcript lacks the live turn, so add
 * the question (if it isn't stored yet) and the reply so far from the resume's `inflight` snapshot.
 * Returns the reply's item id when its text is still streaming, so the next deltas continue it. */
function addInflight(items: ChatItem[], live: SessionResumeResult['inflight']): string | null {
  if (!live) return null
  const q = (live.user || '').trim()
  let lastUser = -1
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'user') { lastUser = i; break }
  const storedQ = lastUser >= 0 ? (items[lastUser] as { text: string }).text.trim() : ''
  if (q && storedQ !== q) {
    items.push({ kind: 'user', id: newId('u'), text: q })
    lastUser = items.length - 1
  }
  // Parts of this turn's reply that are already stored (text before a tool call) aren't shown twice.
  const shown = items
    .slice(lastUser + 1)
    .map(i => (i.kind === 'assistant' ? i.text : ''))
    .join('')
  let partial = live.assistant || ''
  if (shown && partial.startsWith(shown)) partial = partial.slice(shown.length)
  else if (shown.trim() && shown.includes(partial.trim())) partial = ''
  if (!partial.trim()) return null
  const id = newId('a')
  items.push({ kind: 'assistant', id, text: partial, reasoning: '', streaming: Boolean(live.streaming) })
  return live.streaming ? id : null
}

export async function newSession(opts: { cwd?: string } = {}): Promise<ActiveSession> {
  openSeq++ // a chat still loading must not replace this one
  const prev = getState().active
  const r = await rpc<SessionCreateResult>('session.create', {
    source: 'mobile',
    ...(opts.cwd ? { cwd: opts.cwd, cwd_explicit: true } : {})
  })
  const active = baseActive(r, r.stored_session_id)
  trackBuild(active.runtimeId)
  keepPreview(prev)
  setState({ active, opening: null, preview: null, drawer: false })
  retire(prev)
  rememberSession(active.storedId)
  applyDraftRead(active.storedId) // a read-aloud choice made on the empty screen
  return active
}

/** Bumped whenever the user navigates (new chat, open a chat, switch profile). A chat still loading checks it so it
 * can't replace the one the user went to meanwhile (the start-up resume just stops, the others go warm). */
let openSeq = 0

export function startDraft(): void {
  if (liveBridge.active) liveBridge.stop() // live mode belongs to the chat it started in
  setDraftRead(null)
  void loadDefaultModel()
  openSeq++
  const prev = getState().active
  keepPreview(prev)
  rememberSession(null)
  setState({ active: null, opening: null, preview: null, drawer: false })
  retire(prev)
}

export async function resumeSession(storedId: string, opts: { keepItemsIfSame?: boolean; auto?: boolean } = {}): Promise<void> {
  // The automatic start-up resume doesn't count as navigation: if the user goes elsewhere meanwhile, it loses.
  const seq = opts.auto ? openSeq : ++openSeq
  const prev = getState().active
  // Opening another chat ends live mode: it would keep listening and send to the new chat.
  if (liveBridge.active && prev?.storedId !== storedId) liveBridge.stop()
  keepPreview(prev)
  // Draw the chat as it was last seen right away; the resume below replaces it.
  const preview = prev?.storedId === storedId ? null : cachedChat(getState().profile, storedId)
  setState({ opening: storedId, preview, drawer: false })
  // After a reconnect the client replays the events this chat missed; let them land first, or they would be applied
  // a second time on top of the reloaded transcript (duplicate tool cards and text).
  const replay = prev?.storedId === storedId ? client.sessionReplayBarrier(prev.runtimeId) : undefined
  if (replay) await replay
  let r: SessionResumeResult
  try {
    r = await rpc<SessionResumeResult>('session.resume', { session_id: storedId }, 60_000)
  } catch (err) {
    if (seq === openSeq) setState({ opening: null, preview: null })
    throw err
  }
  unwarm(storedId)
  trackBuild(r.session_id) // a fresh resume builds its agent in the background too
  if (opts.auto && openSeq !== seq) return // the user went elsewhere while this was loading
  const next = baseActive(r, storedId)
  next.items = applySavedStats(next.items, next.storedId)
  if (opts.keepItemsIfSame && prev && prev.storedId === next.storedId && !addsToScreen(next.items, prev.items)) {
    next.items = prev.items
    // Keep streaming into the reply that was open before the reconnect.
    next.openAssistantId = next.running ? prev.openAssistantId : null
  }
  const title = next.title || getState().sessions.find(s => s.id === storedId)?.title || ''
  // Another chat was opened while this one loaded: that one wins, this one just goes warm.
  if (seq !== openSeq) {
    retire({ ...next, title })
    return
  }
  setState({ active: { ...next, title }, opening: null, preview: null, drawer: false })
  if (prev && prev.storedId !== next.storedId) retire(prev)
  rememberSession(next.storedId)
  markSeen(next.storedId)
  setLastChat(next.storedId, title)
  // Show the chat's context fill under its last reply.
  void refreshCtx(next.usage).then(ctx => {
    const id = lastAssistantId()
    if (ctx && id) patchItem(id, it => (it.kind === 'assistant' && !it.meta ? { ...it, meta: fmtCtx(ctx) } : it))
  })
}

export async function deleteSession(storedId: string): Promise<void> {
  const keep = (getState().active?.attachments ?? []).map(a => (a.path || a.ref || '').split('/').pop() || '').filter(Boolean)
  // Hermes refuses to delete a chat that still has a live session (error 4023): close ours first.
  const open = getState().active
  const live = [...(open && open.storedId === storedId ? [open.runtimeId] : []), ...warm.filter(w => w.storedId === storedId).map(w => w.runtimeId)]
  unwarm(storedId)
  forgetChat(getState().profile, storedId)
  for (const id of live) {
    try {
      await rpc('session.close', { session_id: id })
    } catch {
      /* already closed */
    }
  }
  await rpc('session.delete', { session_id: storedId })
  if (getState().active?.storedId === storedId) {
    setState({ active: null })
    rememberSession(null)
  }
  setState(s => ({ sessions: s.sessions.filter(x => x.id !== storedId) }))
  // Its photos, attached files and canvas would otherwise stay on the phone forever. Keep whatever is
  // attached in the composer of another open chat: it isn't in any message yet.
  void api('POST', '/api/plugins/hermes-mobile/cleanup', { keep }).catch(() => {})
  void forgetCheckpoints(storedId)
}

export async function renameSession(title: string): Promise<void> {
  const a = getState().active
  if (!a) return
  await rpc('session.title', { session_id: a.runtimeId, title })
  updateActive(() => ({ title }))
  loadSessionsSoon()
}

/** Rename any chat (not only the open one) through the dashboard: PATCH /api/sessions/{id}. */
export async function renameStored(storedId: string, title: string): Promise<void> {
  const r = await api<{ title?: string }>('PATCH', `/api/sessions/${encodeURIComponent(storedId)}`, { title, profile: getState().profile })
  const t = r?.title ?? title
  setState(st => ({ sessions: st.sessions.map(x => (x.id === storedId ? { ...x, title: t } : x)) }))
  if (getState().active?.storedId === storedId) updateActive(() => ({ title: t }))
  loadSessionsSoon()
}

export interface MessageHit {
  id: string
  title: string
  snippet: string
  role?: string
}

/** Full-text search inside chats (dashboard FTS). Snippets mark matches as >>>word<<<. */
export async function searchMessages(q: string): Promise<MessageHit[]> {
  const r = await api<{ results?: Array<{ session_id?: string; id?: string; title?: string; snippet?: string; role?: string }> }>(
    'GET',
    `/api/sessions/search?q=${encodeURIComponent(q)}&limit=25`
  )
  const seen = new Set<string>()
  const out: MessageHit[] = []
  for (const h of r.results ?? []) {
    const id = h.session_id || h.id || ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, title: h.title || '', snippet: h.snippet || '', role: h.role })
  }
  return out
}

export async function sendPrompt(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  if (getState().opening) throw new Error('Still opening your chat — wait a moment')
  rememberPrompt(trimmed)
  let a = getState().active
  if (!a) a = await newSession()

  const btw = /^\/btw(?:\s+([\s\S]*))?$/i.exec(trimmed)
  if (btw) {
    openBtw(btw[1] || '')
    return
  }
  if (trimmed.startsWith('/')) {
    await runSlash(a, trimmed)
    return
  }

  if (a.running) {
    // Mid-turn: steer the running turn instead of queueing a new prompt.
    await rpc('session.steer', { session_id: a.runtimeId, text: trimmed })
    pushItem({ kind: 'notice', id: newId('n'), text: `Steer: ${trimmed}`, level: 'info' })
    return
  }

  const uid = newId('u')
  const queued = a.attachments
  const images = queued.filter(x => x.kind === 'image').map(x => x.name)
  const files = queued.filter(x => x.kind === 'file')
  // Photos are already queued inside Hermes; files travel as their @file: references in the text.
  const refs = files.map(f => f.ref).filter(Boolean)
  const body = refs.length ? `${refs.join(' ')}\n\n${trimmed}` : trimmed
  pushItem({ kind: 'user', id: uid, text: trimmed, images: images.length ? images : undefined, imageUrls: queued.some(x => x.preview) ? queued.filter(x => x.kind === 'image').map(x => x.preview || '') : undefined, imagePaths: queued.some(x => x.path) ? queued.filter(x => x.kind === 'image').map(x => x.path || '') : undefined, files: files.length ? files.map(f => f.name) : undefined, at: Date.now() })
  updateActive(() => ({ running: true, status: '', attachments: [], openAssistantId: null }))
  try {
    await switching.get(a.runtimeId)?.catch(() => {}) // a model picked a moment ago must apply to this turn
    const r = await rpc<PromptSubmitResult>('prompt.submit', { session_id: a.runtimeId, text: body, surface: 'mobile' })
    setUserRowId(uid, r?.user_row_id)
  } catch (err) {
    // Not sent: the attachments are still queued, so show them again.
    updateActive(() => ({ running: false, attachments: queued }))
    pushItem({ kind: 'notice', id: newId('n'), text: `Send failed: ${errText(err)}`, level: 'error' })
  }
}

type Dispatch = {
  type?: string | null
  output?: string | null
  target?: string | null
  message?: string | null
  notice?: string | null
  display?: string | null
  warning?: string | null
}

/** Put text into the composer (dispatch type "prefill"); the Composer listens for this. */
export const composerPrefill = { set: (_text: string) => {} }

/** Same routing as Hermes Desktop: slash.exec first; skills and other routed commands go through
 * command.dispatch, whose result says what to do (exec / alias / send / skill / prefill). */
async function runSlash(a: ActiveSession, text: string, depth = 0): Promise<void> {
  const body = text.replace(/^\/+/, '').trim()
  const name = body.split(/\s+/)[0]
  const arg = body.slice(name.length).trim()
  if (depth === 0) pushItem({ kind: 'user', id: newId('u'), text: `/${body}` })

  let r: Dispatch | null = null
  try {
    r = await rpc<Dispatch>('slash.exec', { session_id: a.runtimeId, command: body })
  } catch {
    // "skill command: use command.dispatch" (4018) and other routed commands
    try {
      r = await rpc<Dispatch>('command.dispatch', { session_id: a.runtimeId, name, arg: arg || null })
    } catch (err) {
      pushItem({ kind: 'notice', id: newId('n'), text: `/${name}: ${errText(err)}`, level: 'error' })
      return
    }
  }

  const type = String(r?.type || 'exec')
  if (type === 'alias' && r?.target && depth < 3) {
    await runSlash(a, `/${bare(r.target)}${arg ? ` ${arg}` : ''}`, depth + 1)
    return
  }
  if ((type === 'send' || type === 'prefill' || type === 'skill') && r?.notice?.trim()) {
    pushItem({ kind: 'notice', id: newId('n'), text: r.notice.trim(), level: 'info' })
  }
  if (type === 'prefill') {
    if (r?.message) composerPrefill.set(r.message)
    return
  }
  if (type === 'send' || type === 'skill') {
    const message = r?.message?.trim()
    if (!message) {
      pushItem({ kind: 'notice', id: newId('n'), text: `/${name}: ${type === 'skill' ? 'skill payload missing message' : 'empty message'}`, level: 'error' })
      return
    }
    updateActive(() => ({ running: true, status: '', openAssistantId: null }))
    try {
      await rpc('prompt.submit', { session_id: a.runtimeId, text: message, display_kind: type === 'skill' ? 'skill' : null, title_preview: r?.display || `/${body}`, surface: 'mobile' })
    } catch (err) {
      updateActive(() => ({ running: false }))
      pushItem({ kind: 'notice', id: newId('n'), text: `Send failed: ${errText(err)}`, level: 'error' })
    }
    return
  }
  const out = r?.output || r?.notice || r?.message || r?.warning || `/${name}: done`
  pushItem({ kind: 'notice', id: newId('n'), text: out, level: r?.warning ? 'warn' : 'info' })
}

const bare = (s: string) => s.replace(/^\/+/, '').trim()

export async function interrupt(): Promise<void> {
  const a = getState().active
  if (!a) return
  try {
    await rpc('session.interrupt', { session_id: a.runtimeId })
  } catch (err) {
    toast(errText(err), 'error')
  }
}

export async function undoLast(): Promise<void> {
  const a = getState().active
  if (!a) return
  try {
    await rpc('session.undo', { session_id: a.runtimeId })
    await resumeSession(a.storedId)
    toast('Last turn undone')
  } catch (err) {
    toast(errText(err), 'error')
  }
}

const MAX_ATTACH_MB = 20

function readDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(file)
  })
}

/** Queue a photo or file for the next message. Photos go to Hermes's image queue (it sees them); any other
 * file (PDF, text, spreadsheet…) is copied into the chat's workspace and referenced as @file: in the message. */
export async function attachFile(file: File): Promise<void> {
  if (file.size > MAX_ATTACH_MB * 1024 * 1024) throw new Error(`${file.name}: too large (max ${MAX_ATTACH_MB} MB)`)
  let a = getState().active
  if (!a) a = await newSession()
  const dataUrl = await readDataUrl(file)
  let att: Attachment
  if (file.type.startsWith('image/')) {
    const r = await rpc<{ attached?: boolean; name?: string | null; path?: string | null; message?: string | null }>('image.attach_bytes', {
      session_id: a.runtimeId,
      content_base64: dataUrl.split(',')[1] || '',
      filename: file.name || 'photo.jpg'
    })
    if (r?.attached === false) throw new Error(r.message || 'Image not attached')
    att = { kind: 'image', name: r?.name || file.name || 'image', path: r?.path || undefined, preview: URL.createObjectURL(file) }
  } else {
    const r = await rpc<{ attached?: boolean; name?: string; path?: string; ref_text?: string }>('file.attach', {
      session_id: a.runtimeId,
      data_url: dataUrl,
      name: file.name || 'file'
    })
    if (!r?.attached || !r.ref_text) throw new Error(`${file.name}: not attached`)
    att = { kind: 'file', name: r.name || file.name, path: r.path, ref: r.ref_text }
  }
  const runtimeId = a.runtimeId
  updateActive(x => (x.runtimeId === runtimeId ? { attachments: [...x.attachments, att] } : null))
}

/** Take something back out of the next message. A photo must also leave Hermes's queue (image.detach),
 * or it would still be sent; a file just loses its reference. */
export async function detachAttachment(att: Attachment): Promise<void> {
  const a = getState().active
  if (!a) return
  if (att.kind === 'image') {
    if (!att.path) throw new Error(`Can't remove ${att.name}: Hermes didn't say where it is queued`)
    await rpc('image.detach', { session_id: a.runtimeId, path: att.path })
  }
  updateActive(x => (x.runtimeId === a.runtimeId ? { attachments: x.attachments.filter(y => y !== att) } : null))
}

export async function clearAttachments(): Promise<void> {
  for (const att of [...(getState().active?.attachments ?? [])]) await detachAttachment(att)
}

/** A new chat's agent is built in the background (~2 s); Hermes announces it with the first `session.info`.
 * A model switch sent before that is silently lost: the build finishes with the profile default and every turn
 * runs on it, although `config.set` answered OK and the chat row stores the pick (seen 2026-10-03: a "Sonnet"
 * chat ran entirely on Gemini). So a switch waits for the build, and a send waits for the switch. */
const builds = new Map<string, { done: Promise<void>; resolve: () => void }>()
// Runtimes whose agent was announced. A resume of a chat that is still live (warm) returns the same runtime id and
// sends no session.info, so it must not wait; this also covers a session.info that beat the create/resume answer.
const ready = new Set<string>()
const switching = new Map<string, Promise<void>>()

function trackBuild(runtimeId: string): void {
  if (!runtimeId || ready.has(runtimeId) || builds.has(runtimeId)) return
  let resolve!: () => void
  const done = new Promise<void>(r => (resolve = r))
  builds.set(runtimeId, { done, resolve })
  setTimeout(() => markBuilt(runtimeId), 20000) // never hang a pick on a missed event
}

function markBuilt(runtimeId: string): void {
  ready.add(runtimeId)
  if (ready.size > 200) ready.delete(ready.values().next().value!)
  const b = builds.get(runtimeId)
  if (!b) return
  builds.delete(runtimeId)
  b.resolve()
}

export async function setModel(provider: string, model: string, effort?: string): Promise<void> {
  const a = getState().active ?? (await newSession())
  // Show the pick at once; Hermes needs a few seconds to rebuild the agent. Undone below if it fails.
  const before = { model: a.info.model, provider: a.info.provider }
  updateActive(x => (x.runtimeId === a.runtimeId ? { info: { ...x.info, model, provider } } : {}))
  const run = (async () => {
    await builds.get(a.runtimeId)?.done
    await rpc('config.set', { session_id: a.runtimeId, key: 'model', value: `${model} --provider ${provider} --session` })
    if (effort) await rpc('config.set', { session_id: a.runtimeId, key: 'reasoning', value: effort })
  })()
  switching.set(a.runtimeId, run)
  try {
    await run
  } catch (e) {
    updateActive(x => (x.runtimeId === a.runtimeId ? { info: { ...x.info, ...before } } : {}))
    throw e
  } finally {
    if (switching.get(a.runtimeId) === run) switching.delete(a.runtimeId)
  }
  if (effort) updateActive(x => (x.runtimeId === a.runtimeId ? { info: { ...x.info, reasoning_effort: effort } } : {}))
  toast(`Model: ${model}`)
}

export async function setReasoning(effort: string): Promise<void> {
  const a = getState().active ?? (await newSession())
  await rpc('config.set', { session_id: a.runtimeId, key: 'reasoning', value: effort })
  updateActive(x => ({ info: { ...x.info, reasoning_effort: effort } }))
  toast(`Reasoning: ${effort}`)
}

export function errText(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)
}

// ── server → client requests (approval, clarify, secret, sudo, otp) ─────

client.onRequest((req: ServerRequest) => {
  if (!SERVER_REQUESTS.has(req.method)) return false
  setState(s => ({ requests: [...s.requests.filter(r => r.id !== req.id), req] }))
  if (req.method === 'approval' && liveBridge.active) liveBridge.onApproval(req)
  // Approvals and questions are notified by the hermes-mobile plugin on the phone (works while
  // the app is closed); only masked prompts (password / secret / code) are notified from here.
  if (appInBackground() && req.method !== 'approval' && req.method !== 'clarify') {
    notify('Hermes needs your input', 'Open Hermes to continue', `req-${req.id}`)
  }
  return true
})

export function answerRequest(req: ServerRequest, result: Record<string, unknown>): void {
  req.respond(result)
  cancelNotification(`req-${req.id}`)
  setState(s => ({ requests: s.requests.filter(r => r.id !== req.id) }))
}

export function rejectRequest(req: ServerRequest): void {
  req.fail(-32000, 'cancelled by user')
  cancelNotification(`req-${req.id}`)
  setState(s => ({ requests: s.requests.filter(r => r.id !== req.id) }))
}

// ── streaming events → chat items ───────────────────────────

function pushItem(item: ChatItem): void {
  updateActive(a => ({ items: [...a.items, item] }))
}

function patchItem(id: string, fn: (item: ChatItem) => ChatItem): void {
  updateActive(a => ({ items: a.items.map(it => (it.id === id ? fn(it) : it)) }))
}

/** The assistant segment that deltas append to; opened lazily, closed by tools. */
function openAssistant(): string {
  const a = getState().active!
  if (a.openAssistantId && a.items.some(i => i.id === a.openAssistantId)) return a.openAssistantId
  const id = newId('a')
  updateActive(x => ({
    items: [...x.items, { kind: 'assistant', id, text: '', reasoning: '', streaming: true, at: Date.now() }],
    openAssistantId: id
  }))
  return id
}

function closeAssistant(): void {
  const a = getState().active
  if (!a?.openAssistantId) return
  const id = a.openAssistantId
  updateActive(x => ({
    openAssistantId: null,
    items: x.items
      .map(it => (it.id === id && it.kind === 'assistant' ? { ...it, streaming: false } : it))
      .filter(it => !(it.id === id && it.kind === 'assistant' && !it.text.trim() && !it.reasoning.trim()))
  }))
}

let lastEventAt = Date.now()

// Streamed text is applied in small batches, not per token: each change re-renders the reply's markdown,
// which gets slow on long answers. Any other event flushes first, so the order of things never changes.
let pending = { id: '', text: '', reasoning: '' }
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flushDeltas(): void {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  const p = pending
  pending = { id: p.id, text: '', reasoning: '' }
  if (!p.id || (!p.text && !p.reasoning)) return
  patchItem(p.id, it => (it.kind === 'assistant' ? { ...it, text: it.text + p.text, reasoning: it.reasoning + p.reasoning } : it))
  if (stream.ms > 400) {
    const tps = estTps()
    if (tps !== getState().active?.tps) updateActive(() => ({ tps }))
  }
}

function queueDelta(kind: 'text' | 'reasoning', t: string): void {
  const id = openAssistant()
  if (pending.id !== id) {
    flushDeltas()
    pending = { id, text: '', reasoning: '' }
  }
  if (kind === 'text') pending.text += t
  else pending.reasoning += t
  countStream(t)
  if (!flushTimer) {
    const cur = getState().active?.items.find(i => i.id === id)
    const long = cur?.kind === 'assistant' && cur.text.length > 6000
    flushTimer = setTimeout(flushDeltas, long ? 150 : 60)
  }
}

/** Ask the backend whether the open chat is still running; a missed message.complete otherwise leaves "thinking" on. */
async function syncRunning(): Promise<void> {
  const a = getState().active
  if (!a || !a.running || getState().conn !== 'open') return
  try {
    const r = await rpc<SessionResumeResult>('session.resume', { session_id: a.storedId }, 20_000)
    const cur = getState().active
    if (!cur || cur.storedId !== a.storedId || !cur.running) return
    if (Boolean(r.running ?? r.info?.running)) return
    // Finished while we weren't listening: take the stored transcript and stop the spinner.
    const next = baseActive(r, a.storedId)
    next.items = applySavedStats(next.items, next.storedId)
    setState({ active: { ...next, title: next.title || cur.title } })
  } catch {
    /* keep waiting */
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void checkSocket()
    void syncRunning()
  } else {
    // Kept for the next cold start, so the chat is on screen before Hermes answers.
    const a = getState().active
    if (a) saveChatToDisk(a.profile, a.storedId, a.title, a.items)
  }
})
setInterval(() => {
  if (getState().active?.running && Date.now() - lastEventAt > 45_000) void syncRunning()
}, 15_000)

client.onEvent((ev: GatewayEvent) => {
  lastEventAt = Date.now()
  const a = getState().active
  const type = ev.type as string
  const payload = (ev.payload ?? {}) as Record<string, unknown>
  if (type !== 'message.delta' && type !== 'reasoning.delta') flushDeltas()

  if (type === 'sessions.changed') {
    loadSessionsSoon()
    return
  }
  if (type === 'request.cancel') {
    // Answered elsewhere (the notification buttons, another client) or timed out: close the sheet.
    const id = String(payload.id || '')
    setState(s => ({ requests: s.requests.filter(r => String(r.id) !== id) }))
    return
  }
  if (type === 'notification.show') {
    const lvl = String(payload.level || 'info')
    toast(String(payload.text || ''), lvl === 'error' ? 'error' : lvl.startsWith('warn') ? 'warn' : 'info')
    return
  }
  if (type === 'session.info' && ev.session_id) markBuilt(ev.session_id)
  if (!a || !ev.session_id || (ev.session_id !== a.runtimeId && ev.session_id !== a.storedId)) {
    // Another chat (one you left while it worked) renamed itself or finished: refresh the drawer's counts,
    // which is what marks it unread.
    if (type === 'session.title' || type === 'message.complete') loadSessionsSoon()
    return
  }

  switch (type) {
    case 'message.start':
      stream = { chars: 0, ms: 0, last: 0, total: 0, start: performance.now() }
      updateActive(() => ({ running: true, tps: null }))
      break
    case 'thinking.delta':
      updateActive(() => ({ status: String(payload.text || '') }))
      break
    case 'status.update':
      updateActive(() => ({ status: String(payload.text || '') }))
      break
    case 'reasoning.delta':
      queueDelta('reasoning', String(payload.text || ''))
      break
    case 'message.delta':
      queueDelta('text', String(payload.text || ''))
      break
    case 'tool.generating': {
      closeAssistant()
      const name = String(payload.name || 'tool')
      // Plugin tools (canvas) stream under the generic name until tool.start; a long one is a document being written.
      if (name === 'canvas' || name === 'tool_call' || name === 'mcp__tool_call') canvasWritingStarted()
      pushItem({ kind: 'tool', id: newId('tg'), name, status: 'generating' })
      break
    }
    case 'tool.start': {
      closeAssistant()
      const p = payload as unknown as ToolStartPayload
      const cur = getState().active!.items
      // Deferred/plugin tools stream as a generic "tool_call": the real name only arrives with tool.start.
      const gens = [...cur].reverse().filter(i => i.kind === 'tool' && i.status === 'generating')
      const gen = gens.find(i => i.kind === 'tool' && i.name === p.name) ?? gens[0]
      if (cur.some(i => i.id === p.tool_id)) {
        // Already shown (a reloaded transcript has it): a replayed start must not add a second card.
        if (gen) updateActive(x => ({ items: x.items.filter(i => i.id !== gen.id) }))
        break
      }
      const tool: ChatItem = {
        kind: 'tool',
        id: p.tool_id,
        name: p.name,
        context: p.context || p.preview || undefined,
        args: p.args ?? null,
        status: 'running'
      }
      if (gen) patchItem(gen.id, () => tool)
      else pushItem(tool)
      canvasCallStarted(p.name, p.args)
      break
    }
    case 'tool.complete': {
      const p = payload as unknown as ToolCompletePayload
      const exists = getState().active!.items.some(i => i.id === p.tool_id)
      const done = (it: ChatItem): ChatItem =>
        it.kind === 'tool'
          ? {
              ...it,
              status: 'done',
              args: p.args ?? it.args,
              duration: p.duration_s,
              summary: p.summary,
              resultText: p.result_text ?? (typeof p.result === 'string' ? p.result : p.result != null ? JSON.stringify(p.result, null, 2) : null),
              inlineDiff: p.inline_diff ?? (p as { tool_result_metadata?: { inline_diff?: string } }).tool_result_metadata?.inline_diff ?? it.inlineDiff
            }
          : it
      if (exists) patchItem(p.tool_id, done)
      else pushItem(done({ kind: 'tool', id: p.tool_id, name: p.name, status: 'done' }))
      if (p.name === 'canvas') canvasToolDone(p.result_text ?? (typeof p.result === 'string' ? p.result : p.result != null ? JSON.stringify(p.result) : null), p.args)
      break
    }
    case 'tool.output_risk': {
      const id = String(payload.tool_id || '')
      if (id) patchItem(id, it => (it.kind === 'tool' ? { ...it, risk: String(payload.reason || payload.summary || 'flagged') } : it))
      break
    }
    case 'subagent.start':
    case 'subagent.progress':
    case 'subagent.thinking':
    case 'subagent.tool':
    case 'subagent.complete': {
      const p = payload as unknown as SubagentEventPayload
      const id = `sub-${p.subagent_id || p.task_index}`
      const exists = getState().active!.items.some(i => i.id === id)
      const detail = p.tool_preview || p.text || p.tool_name || undefined
      const status = type === 'subagent.complete' ? String(p.status || 'done') : String(p.status || 'running')
      if (!exists) {
        closeAssistant()
        pushItem({ kind: 'subagent', id, goal: p.goal, status, detail, summary: p.summary, tools: p.tool_count || 0 })
      } else
        patchItem(id, it =>
          it.kind === 'subagent'
            ? { ...it, status, detail: detail ?? it.detail, summary: p.summary ?? it.summary, tools: p.tool_count ?? it.tools }
            : it
        )
      break
    }
    case 'todo.updated':
      updateActive(() => ({ todos: ((payload.todos as unknown[]) || []) as never }))
      break
    case 'session.usage':
      updateActive(() => ({ usage: (payload.usage as never) ?? null }))
      break
    case 'session.info':
      updateActive(x => ({ info: { ...x.info, ...(payload as object) } }))
      break
    case 'session.title':
      updateActive(() => ({ title: String(payload.title || '') }))
      loadSessionsSoon()
      break
    case 'message.complete': {
      const p = payload as MessageCompletePayload
      updateActive(a => ({ items: a.items.filter(i => !(i.kind === 'tool' && i.status === 'generating')) }))
      canvasWritingDone()
      const openId = getState().active?.openAssistantId
      if (p.error || p.failure_reason) {
        pushItem({ kind: 'notice', id: newId('n'), text: String(p.error || p.failure_reason), level: 'error' })
      } else if (openId) {
        const finalText = typeof p.text === 'string' ? p.text : ''
        patchItem(openId, it =>
          it.kind === 'assistant' ? { ...it, text: fullReply(openId, it.text, finalText), warning: p.warning || undefined } : it
        )
      } else if (typeof p.text === 'string' && p.text.trim()) {
        pushItem({ kind: 'assistant', id: newId('a'), text: p.text, reasoning: p.reasoning || '', streaming: false })
      }
      const lastId = lastAssistantId()
      closeAssistant()
      if (liveBridge.active) {
        // Live mode reads every reply itself, then goes back to listening.
        const it = getState().active?.items.find(x => x.id === lastId)
        liveBridge.onReply(p.error || p.failure_reason ? '' : it && it.kind === 'assistant' ? it.text : typeof p.text === 'string' ? p.text : '')
      }
      if (!liveBridge.active && !p.error && !p.failure_reason && autoReadFor(getState().active?.storedId) && !appInBackground()) {
        const it = getState().active?.items.find(x => x.id === lastId)
        if (it && it.kind === 'assistant' && it.text) speak(lastId ?? 'auto', it.text)
      }
      updateActive(() => ({ running: false, status: '', usage: p.usage ?? getState().active?.usage ?? null }))
      void finishTurnStats(lastId, p.usage)
      break
    }
    case 'review.summary':
      // Background self-improvement review (skills / memory learned from this chat), as Desktop shows it.
      pushItem({ kind: 'notice', id: newId('n'), text: String(payload.text || ''), level: 'info' })
      break
    case 'btw.complete':
      if (btwDone(String(payload.task_id || ''), String(payload.text || ''))) break
    // falls through: not ours, show it as a notice
    case 'background.complete':
      pushItem({ kind: 'notice', id: newId('n'), text: String(payload.text || payload.summary || 'Background task finished'), level: 'info' })
      break
    default:
      break
  }
})

// ── archive (Hermes "hidden" sessions, same flag Desktop uses) ──
export async function setArchived(storedId: string, archived: boolean): Promise<void> {
  await rpc('session.set_hidden', { session_id: storedId, hidden: archived })
  if (archived) {
    setState(s => ({ sessions: s.sessions.filter(x => x.id !== storedId) }))
    if (getState().active?.storedId === storedId) startDraft()
  }
  loadSessionsSoon()
}

/** Archived = listed with include_hidden but not in the normal list. */
export async function loadArchived(): Promise<SessionListResult['sessions']> {
  const [all, visible] = await Promise.all([
    rpc<SessionListResult>('session.list', { limit: 200, include_hidden: true }),
    rpc<SessionListResult>('session.list', { limit: 200 })
  ])
  const shown = new Set((visible.sessions || []).map(s => s.id))
  return (all.sessions || []).filter(s => !shown.has(s.id))
}

function setUserRowId(itemId: string, rowId: number | null | undefined): void {
  if (typeof rowId !== 'number') return
  updateActive(a => ({ items: a.items.map(i => (i.id === itemId && i.kind === 'user' ? { ...i, rowId } : i)) }))
}

/** Durable row id of the user item (the truncate target). Live items may lack one: read it from the
 * stored history, matching user turns by position (same filter as hydrate). */
async function userRowId(a: ActiveSession, itemId: string): Promise<number> {
  const users = a.items.filter(i => i.kind === 'user')
  const idx = users.findIndex(i => i.id === itemId)
  const own = users[idx]
  if (own?.kind === 'user' && typeof own.rowId === 'number') return own.rowId
  const h = await rpc<{ messages: TranscriptMessage[] }>('session.history', { session_id: a.runtimeId })
  const rows = (h.messages || []).filter(m => m.role === 'user' && m.display_kind !== 'hidden' && String(m.text ?? m.content ?? '').trim())
  // Stored history can hold older turns than the view (compression prefix): align from the end.
  const row = rows[rows.length - users.length + idx]
  if (typeof row?.row_id !== 'number') throw new Error('Could not find that message in the stored chat')
  return row.row_id
}

/** Edit / regenerate: drop the user turn `itemId` and everything after it, then send `text` in its place. */
export async function resendFrom(itemId: string, text: string): Promise<void> {
  const trimmed = text.trim()
  const a = getState().active
  if (!a || !trimmed) return
  if (a.running) throw new Error('Wait for the current reply to finish')
  const cut = a.items.findIndex(i => i.id === itemId)
  if (cut < 0) return
  const rowId = await userRowId(a, itemId)
  const uid = newId('u')
  updateActive(x => ({
    items: [...x.items.slice(0, cut), { kind: 'user', id: uid, text: trimmed, at: Date.now() }],
    running: true,
    status: '',
    openAssistantId: null
  }))
  try {
    let r: PromptSubmitResult
    try {
      r = await rpc<PromptSubmitResult>('prompt.submit', {
        session_id: a.runtimeId,
        text: trimmed,
        surface: 'mobile',
        truncate_before_row_id: rowId,
        confirm_truncate: true,
        // Editing the first message leaves nothing before it; that's intended here.
        confirm_empty_truncate: !a.items.slice(0, cut).some(i => i.kind === 'user')
      })
    } catch (err) {
      // A turn that failed (model error, interrupted) is stored but never entered Hermes's live history, so
      // Hermes can't truncate to it. Nothing live needs dropping then: send the edited text as a normal prompt.
      if (!/no longer in session history/i.test(errText(err))) throw err
      r = await rpc<PromptSubmitResult>('prompt.submit', { session_id: a.runtimeId, text: trimmed, surface: 'mobile' })
    }
    setUserRowId(uid, r?.user_row_id)
  } catch (err) {
    updateActive(() => ({ running: false }))
    // The server may have kept the old turns: reload the truth, then say why.
    await resumeSession(a.storedId).catch(() => {})
    toast(`Send failed: ${errText(err)}`, 'error', 6000)
  }
}

/** Regenerate the reply of the turn containing `itemId` (an assistant item). */
export async function retryTurn(itemId: string): Promise<void> {
  const a = getState().active
  if (!a) return
  const at = a.items.findIndex(i => i.id === itemId)
  for (let i = at; i >= 0; i--) {
    const it = a.items[i]
    if (it.kind === 'user') return resendFrom(it.id, it.text)
  }
  throw new Error('No message to retry')
}

/** Fork the chat into a new session holding everything up to the end of this turn, and open it. */
export async function branchAt(itemId: string): Promise<void> {
  const a = getState().active
  if (!a) return
  if (a.running) throw new Error('Wait for the current reply to finish')
  const at = a.items.findIndex(i => i.id === itemId)
  let end = at
  while (end + 1 < a.items.length && a.items[end + 1].kind !== 'user') end++
  // session.branch copies visible user/assistant rows with text; count those up to the end of this turn.
  const visible = (i: ChatItem) => (i.kind === 'user' || i.kind === 'assistant') && !!i.text.trim()
  const total = a.items.filter(visible).length
  const count = a.items.slice(0, end + 1).filter(visible).length
  const r = await rpc<{ stored_session_id: string; title: string }>('session.branch', {
    session_id: a.runtimeId,
    ...(count < total ? { count } : {})
  })
  // The branch keeps the original name, with a branch icon in front (stored as a leading "⎇").
  const base = (a.title || r.title || 'New chat').replace(/^⎇\s*/, '')
  let named = `⎇ ${base}`
  for (let n = 1; n <= 9; n++) {
    try {
      await renameStored(r.stored_session_id, named)
      break
    } catch {
      // Hermes wants unique titles: a second branch of the same chat becomes "⎇ name 2", and so on.
      named = `⎇ ${base} ${n + 1}`
    }
  }
  await resumeSession(r.stored_session_id)
  loadSessionsSoon()
  toast(`Branched: ${base}`)
}

// ── turn stats (tok/s, ctx) ──────────────────────────────────

/** Streamed text of the running turn. Only gaps under 2 s count as generating, so tool runs and
 * approvals don't drag the rate down. */
let stream = { chars: 0, ms: 0, last: 0, total: 0, start: 0 }

function countStream(t: string): void {
  const now = performance.now()
  stream.total += t.length
  if (stream.last && now - stream.last < 2000) {
    stream.ms += now - stream.last
    stream.chars += t.length
  }
  stream.last = now
}

/** The streamed text normally IS the final reply. If some of it was missed (the chat was opened mid-reply),
 * the final text is longer and ends with what we have: take it, unless it also repeats text shown earlier
 * in this turn (then it is the whole turn, not this reply). */
function fullReply(openId: string, streamed: string, finalText: string): string {
  if (!streamed.trim()) return finalText
  if (finalText.length <= streamed.length || !finalText.trimEnd().endsWith(streamed.trim())) return streamed
  const items = getState().active?.items ?? []
  const at = items.findIndex(i => i.id === openId)
  for (let i = at - 1; i >= 0 && items[i].kind !== 'user'; i--) {
    const it = items[i]
    if (it.kind === 'assistant' && it.text.trim() && finalText.includes(it.text.trim())) return streamed
  }
  return finalText
}

/** ~4 characters per token: a rough measure for providers that report no usage. */
const estTps = () => Math.round(stream.chars / 4 / (stream.ms / 1000))

/** When the reply arrived in one or two big chunks (no usable gaps), fall back to the whole turn's wall time. */
function wallTps(): number | null {
  const s = (performance.now() - stream.start) / 1000
  return stream.start && stream.total > 40 && s > 0.5 ? Math.max(1, Math.round(stream.total / 4 / s)) : null
}

function lastAssistantId(): string | null {
  const items = getState().active?.items || []
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'user') break
    if (it.kind === 'assistant' && it.text.trim()) return it.id
  }
  return null
}

/** Provider ctx if reported, else Hermes's own local estimate. */
export async function refreshCtx(usage?: Usage | null): Promise<Ctx | null> {
  const a = getState().active
  if (!a) return null
  let ctx: Ctx | null = null
  if (usage?.context_max && usage.context_used != null)
    ctx = { used: usage.context_used, max: usage.context_max, percent: usage.context_percent ?? (usage.context_used / usage.context_max) * 100 }
  else {
    try {
      const b = await rpc<{ context_used: number; context_max: number; context_percent: number }>('session.context_breakdown', { session_id: a.runtimeId })
      if (b.context_max) ctx = { used: b.context_used, max: b.context_max, percent: (b.context_used / b.context_max) * 100 }
    } catch {
      /* agent not built yet */
    }
  }
  if (ctx && getState().active?.runtimeId === a.runtimeId) updateActive(() => ({ ctx }))
  return ctx
}

/** Summarise older turns so the chat fits the model again (session.compress). The view keeps every turn;
 * a notice marks where Hermes's own copy was shortened. Returns what happened, for a toast. */
export async function compressChat(): Promise<string> {
  const a = getState().active
  if (!a) throw new Error('No chat open')
  if (a.running) throw new Error('Wait until Hermes has finished')
  const r = await rpc<SessionCompressResult>('session.compress', { session_id: a.runtimeId }, 300_000)
  if (r.compressed === false || r.summary?.noop || r.summary?.aborted || r.summary?.refused_would_grow) return r.message || r.summary?.headline || 'Nothing to compress'
  const b = r.before_messages, n = r.after_messages
  const text = b != null && n != null ? `Context compressed: ${b} → ${n} messages` : 'Context compressed'
  if (getState().active?.runtimeId === a.runtimeId) pushItem({ kind: 'notice', id: newId('n'), text, level: 'info' })
  await refreshCtx(r.usage)
  return text
}

export function fmtCtx(c: Ctx): string {
  const k = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
  return `ctx ${c.percent < 1 ? '<1' : Math.round(c.percent)}% · ${k(c.used)}/${k(c.max)}`
}

async function finishTurnStats(itemId: string | null, usage?: Usage | null): Promise<void> {
  const reported = usage?.avg_tps && usage.avg_tps > 0 ? Math.round(usage.avg_tps) : null
  const tps = reported ?? (stream.ms > 400 ? estTps() : wallTps())
  const ctx = await refreshCtx(usage)
  const parts = [tps ? `${reported ? '' : '~'}${tps} tok/s` : '', ctx ? fmtCtx(ctx) : ''].filter(Boolean)
  if (!itemId || !parts.length) return
  const meta = parts.join(' · ')
  patchItem(itemId, it => (it.kind === 'assistant' ? { ...it, meta } : it))
  // Persist under the turn's user message (durable row id) so reopening the chat shows it again.
  const a = getState().active
  if (!a) return
  const at = a.items.findIndex(i => i.id === itemId)
  let userId: string | null = null
  for (let i = at; i >= 0; i--) if (a.items[i].kind === 'user') { userId = a.items[i].id; break }
  if (!userId) return
  try {
    saveStat(a.storedId, await userRowId(a, userId), meta)
  } catch {
    /* no durable row: stats stay for this view only */
  }
}

const STATS_KEY = 'hm.stats.v1'

function loadStats(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STATS_KEY) || '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function saveStat(storedId: string, rowId: number, meta: string): void {
  const all = loadStats()
  delete all[`${storedId}:${rowId}`] // re-insert last so the cap drops the oldest
  all[`${storedId}:${rowId}`] = meta
  const keys = Object.keys(all)
  for (const k of keys.slice(0, Math.max(0, keys.length - 2000))) delete all[k]
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(all))
  } catch {
    /* storage full / unavailable */
  }
}

/** Put saved turn stats back on the last reply of each turn. */
function applySavedStats(items: ChatItem[], storedId: string): ChatItem[] {
  const all = loadStats()
  const out = items.slice()
  let meta: string | undefined
  let lastReply = -1
  const flush = () => {
    if (meta && lastReply >= 0) {
      const it = out[lastReply]
      if (it.kind === 'assistant') out[lastReply] = { ...it, meta }
    }
  }
  out.forEach((it, i) => {
    if (it.kind === 'user') {
      flush()
      meta = it.rowId != null ? all[`${storedId}:${it.rowId}`] : undefined
      lastReply = -1
    } else if (it.kind === 'assistant' && it.text.trim()) lastReply = i
  })
  flush()
  return out
}

