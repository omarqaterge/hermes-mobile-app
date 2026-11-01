import { appVersion, isDevtoolsBuild } from './bridge'
import { remoteDebugStrip, useRemoteDebug } from './remotedebug'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { afterChatOpens, compressChat, connect, errText, fmtCtx, openSessionFromNotification, reconnectNow } from './gateway'
import { closeScreen, getState, setState, toast, useStore, type ChatItem, type Todo } from './store'
import { ItemView, ToolRunHead } from './components/ChatItems'
import { foldMap } from './fold'
import { turnChanges } from './changes'
import { TurnChangesCard } from './components/Changes'
import { Chevron, Collapse } from './components/ui'
import { Composer } from './components/Composer'
import { QueuedRows } from './components/Queued'
import { Scrubber } from './components/Scrubber'
import { SCRUB_MIN, currentMark, userMarks } from './scrub'
import { TtsPlayer } from './components/TtsPlayer'
import { Drawer } from './components/Drawer'
import { RequestSheet } from './components/RequestSheet'
import { ChatMenuSheet, CommandsSheet, DraftMenuSheet, GoalSheet, ModelSheet, ContextSheet, RollbackSheet, SessionActionsSheet, StatusSheet, useCompress } from './components/Sheets'
import { bannerItems, startActivityPolling } from './activity'
import { DialogHost } from './dialog'
import { BtwSheet } from './components/Btw'
import { CanvasPanel } from './components/Canvas'
import { startCanvasSync, useCanvas } from './canvas'
import { backTop } from './backstack'
import { installSwipeToDrawer, openChatCanvas } from './swipe'
import { installPullToBtw } from './pullbtw'
import { findHit, findMatches, firstRange, highlightWords } from './jump'
import { useBackHandler } from './backstack'
import { recentPrompts } from './recent'
import { BACK_GRACE_MS, firstUnseen, lastBack, lastVisit, newWhileAway, noteAway, noteBack, onBack } from './visit'
import { bare, useCommandCatalog, type CommandEntry } from './commands'
import { Title, plainTitle } from './components/Title'
import { fmtClock, useAutoRead, useDraftAutoRead } from './voice'
import { dotState, startHealthPolling, checkHealth } from './health'
import { SettingsScreen } from './components/Settings'
import { SetupFlow, SetupScreen, checkSetupFlow, watchFirstRun } from './components/Setup'
import { BotsScreen } from './components/Bots'
import { GalleryScreen } from './components/Gallery'
import { CronScreen, FilesScreen, HubScreen, MemoryScreen, ProjectsScreen, SkillsScreen } from './components/Screens'
import { Spinner } from './components/Spinner'
import { BgApp } from './components/BgApp'
import { AutoButton } from './components/AutoAccess'
import { refreshBg } from './bgapp'
import { bootMark } from './boot'
import { UninstallResume } from './components/Uninstall'
import { toggleSide, useSidePanel } from './sidepanel'

declare global {
  interface Window {
    hermesBack?: () => boolean
    hermesResume?: () => void
    hermesPause?: () => void
    hermesOpenSession?: (id: string, draft?: string) => void
  }
}

// Android back button: close the top-most overlay first.
window.hermesBack = () => {
  if (backTop()) return true // dialogs, pickers, sheets and settings sub-pages first
  const s = getState()
  if (s.sheet) {
    setState({ sheet: null })
    return true
  }
  if (s.drawer) {
    setState({ drawer: false })
    return true
  }
  if (s.screen) {
    closeScreen()
    return true
  }
  return false
}
window.hermesOpenSession = (id: string, draft?: string) => openSessionFromNotification(id, draft)
// Called by the shell when the app returns to the foreground.
window.hermesResume = () => {
  noteBack()
  if (getState().conn !== 'open') reconnectNow()
  refreshBg()
}
// Called by the shell when the app leaves the foreground (Home, another app, screen off): the open chat was seen until
// now (visit.ts). The page's own visibilitychange may come later or not at all in a WebView.
window.hermesPause = () => noteAway(getState().active?.storedId)

function Header() {
  const title = useStore(s => (s.opening && s.preview?.storedId === s.opening ? s.preview.title : s.active?.title))
  const profile = useStore(s => s.profile)
  const hasActive = useStore(s => Boolean(s.active))
  const dot = useStore(s => dotState(s.conn, s.health))
  const chatReading = useAutoRead(useStore(s => s.active?.storedId))
  const draftReading = useDraftAutoRead()
  const reading = hasActive ? chatReading : draftReading
  const canvasDocs = useCanvas(c => c.docs.length)
  const canvasWriting = useCanvas(c => Boolean(c.writing))
  const unread = useStore(s => s.unread.length > 0)
  const [wide, sideHidden] = useSidePanel()
  // Wide screens: ☰ hides or shows the docked chat list (sidepanel.ts); phones: it opens the drawer.
  const menuLabel = wide ? (sideHidden ? 'Show chat list' : 'Hide chat list') : unread ? 'Sessions (unread chats)' : 'Sessions'
  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" aria-label={menuLabel} onClick={() => (wide ? toggleSide() : setState({ drawer: true }))}>
        ☰{unread && <span className="unread-dot on-menu" />}
      </button>
      <button className="title-btn" onClick={() => hasActive && setState({ sheet: 'chat-menu' })}>
        <span className="title">
          <Title text={title} fallback={hasActive ? 'New chat' : 'Hermes'} />
        </span>
        <span className="subtitle">
          <span
            className={`conn-dot ${dot}`}
            role="button"
            aria-label="Backend status"
            onClick={e => {
              e.stopPropagation()
              setState({ sheet: 'status' })
            }}
          />
          {reading ? <span className="reading-badge" title="Reading replies aloud">🔊</span> : null}
          {profile !== 'default' ? profile : 'Hermes Agent'}
        </span>
      </button>
      <AutoButton />
      {(
        <button
          className={`icon-btn canvas-btn${canvasWriting ? ' writing' : ''}`}
          aria-label={canvasWriting ? 'Canvas (Hermes is writing)' : 'Canvas'}
          onClick={openChatCanvas}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="3" />
            <path d="M8 9h8M8 13h8M8 17h5" />
          </svg>
          {canvasDocs > 0 && <span className="canvas-dot" />}
        </button>
      )}
      <button
        className="icon-btn"
        aria-label="Chat options"
        onClick={() => setState({ sheet: hasActive ? 'chat-menu' : 'draft-menu' })}
      >
        ⋮
      </button>
    </header>
  )
}

function ConnBanner() {
  const conn = useStore(s => s.conn)
  const detail = useStore(s => s.connDetail)
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (conn === 'open') {
      setSecs(0)
      return
    }
    const t0 = Date.now()
    const id = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [conn])
  if (conn === 'open') return null
  const label = detail || (conn === 'connecting' ? 'Connecting to Hermes…' : 'Hermes is offline')
  return (
    <div className="conn-banner">
      <Spinner small />
      <span className="conn-label">
        {label}
        {secs >= 3 ? ` · ${secs}s` : ''}
        {secs >= 20 ? ' · taking long' : ''}
      </span>
      {secs >= 10 && (
        <button className="mini" onClick={() => setState({ screen: 'setup' })}>
          Check setup
        </button>
      )}
      <button className="mini" onClick={() => reconnectNow()}>
        {secs >= 20 ? 'Restart Hermes' : 'Retry'}
      </button>
    </div>
  )
}

const EMPTY_TODOS: Todo[] = []

/** What Hermes is doing that the chat stream doesn't show: background review, other chats, other bots. */
function ActivityBanner() {
  const items = useStore(s => s.activity)
  const activeId = useStore(s => s.active?.storedId)
  const running = useStore(s => s.active?.running ?? false)
  const sessions = useStore(s => s.sessions)
  // The open chat's own live turn already has the status line.
  const shown = bannerItems(items, activeId, running)
  if (shown.length === 0) return null
  const first = shown[0]
  const here = first.session === activeId
  const where = here ? '' : plainTitle(sessions.find(x => x.id === first.session)?.title) || first.profile || 'another chat'
  return (
    <button
      className="activity-banner"
      disabled={here}
      onClick={() => !here && void openSessionFromNotification(first.session)}
    >
      <Spinner small />
      <span className="activity-text">
        {where ? <b>{where}: </b> : null}
        {first.text}
        {shown.length > 1 ? <span className="dim"> (+{shown.length - 1} more)</span> : null}
      </span>
    </button>
  )
}

const COMPRESS_AT = 80
const compressDismissed = new Set<string>()

/** Near a full context: offer to summarise older turns (session.compress) before Hermes starts forgetting. */
function CompressHint() {
  const pct = useStore(s => s.active?.ctx?.percent ?? 0)
  const id = useStore(s => s.active?.storedId ?? '')
  const running = useStore(s => s.active?.running ?? false)
  const [, bump] = useState(0)
  const { busy, run } = useCompress(() => compressDismissed.add(id))
  if (!id || pct < COMPRESS_AT || (running && !busy) || compressDismissed.has(id)) return null
  return (
    <div className="compress-hint">
      <span>
        Context {Math.round(pct)}% full. {busy ? 'Compressing…' : 'Compress older turns so Hermes keeps up?'}
      </span>
      <button
        className="btn compress-go"
        disabled={busy}
        onClick={run}
      >
        {busy ? <Spinner small /> : 'Compress'}
      </button>
      {!busy && (
        <button
          className="icon-btn compress-x"
          aria-label="Not now"
          onClick={() => {
            compressDismissed.add(id)
            bump(n => n + 1)
          }}
        >
          ✕
        </button>
      )}
    </div>
  )
}

/** Milliseconds since `start`, redrawn once a second only while a turn runs and the page is visible (battery);
 * it stops by itself when the page is hidden and catches up on the next tick once it is visible again. */
function useElapsed(start: number | null, running: boolean): number {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!running || start == null) return
    let id: ReturnType<typeof setInterval> | undefined
    const stop = () => {
      if (id !== undefined) clearInterval(id)
      id = undefined
    }
    const go = () => {
      stop()
      if (document.visibilityState === 'visible') {
        tick(n => n + 1)
        id = setInterval(() => tick(n => n + 1), 1000)
      }
    }
    go()
    document.addEventListener('visibilitychange', go)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', go)
    }
  }, [start, running])
  return start == null ? 0 : Math.max(0, Date.now() - start)
}

const GOAL_HIDDEN = new Set(['cleared', 'done', 'complete', 'completed', 'achieved'])

function StatusBar() {
  const running = useStore(s => s.active?.running ?? false)
  const status = useStore(s => s.active?.status ?? '')
  const todos = useStore(s => s.active?.todos ?? EMPTY_TODOS)
  const tps = useStore(s => s.active?.tps ?? null)
  const ctx = useStore(s => s.active?.ctx ?? null)
  const turnStart = useStore(s => s.active?.turnStart ?? null)
  const goal = useStore(s => s.active?.goal ?? null)
  const [openTodos, setOpenTodos] = useState(false)
  const [openGoal, setOpenGoal] = useState(false)
  const elapsed = useElapsed(turnStart, running)
  const done = todos.filter(t => t.status === 'completed' || t.status === 'done').length
  const showGoal = goal != null && !GOAL_HIDDEN.has(goal.status)
  if (!running && todos.length === 0 && !showGoal) return null
  return (
    <div className="statusbar">
      {running && (
        <div className="status-line">
          <Spinner small /> <span className="status-text">{status || 'Working…'}</span>
          {elapsed >= 3000 ? <span className="dim small status-elapsed">{fmtClock(elapsed / 1000)}</span> : null}
          {tps ? <span className="dim small">~{tps} tok/s</span> : null}
          {ctx && <span className="dim small">{fmtCtx(ctx).split(' · ')[0]}</span>}
        </div>
      )}
      {showGoal && goal && (
        <button className="goal-line" onClick={() => setOpenGoal(true)}>
          🎯 {goal.title} · turn {goal.turns_used} of {goal.max_turns} · {goal.paused_reason ? `paused: ${goal.paused_reason}` : goal.status}
        </button>
      )}
      {openGoal && showGoal && goal && <GoalSheet goal={goal} onClose={() => setOpenGoal(false)} />}
      {todos.length > 0 && (
        <div className="todos">
          <button className="todos-head" onClick={() => setOpenTodos(v => !v)}>
            ☑ Tasks {done}/{todos.length} <span className="chev"><Chevron open={openTodos} /></span>
          </button>
          <Collapse open={openTodos}>
            <ul>
              {todos.map((t, i) => (
                <li key={t.id || i} className={`todo-${t.status}`}>
                  {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◐' : t.status === 'cancelled' ? '✕' : '○'} {t.content}
                </li>
              ))}
            </ul>
          </Collapse>
        </div>
      )}
    </div>
  )
}

const SUGGESTIONS = [
  "What's on my calendar today?",
  'Summarise my unread email',
  'Quiz me on Knowledge-based AI',
  'What files are in my Downloads?'
]

/** Up to four: what you asked lately, then a couple of your skills, then the defaults. */
function suggestions(skills: CommandEntry[] | null): { text: string; label: string }[] {
  const out: { text: string; label: string }[] = []
  const seen = new Set<string>()
  const add = (text: string, label = text) => {
    if (out.length < 4 && !seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase())
      out.push({ text, label })
    }
  }
  for (const p of recentPrompts().slice(0, 3)) add(p, p.length > 70 ? p.slice(0, 68) + '…' : p)
  for (const c of (skills ?? []).filter(c => c.kind === 'skill').slice(0, 2)) add(`/${bare(c.name)} `, `/${bare(c.name)} · ${c.desc || 'skill'}`.slice(0, 70))
  for (const s of SUGGESTIONS) add(s)
  return out
}

function Empty({ onPick }: { onPick: (t: string) => void }) {
  const profile = useStore(s => s.profile)
  const catalog = useCommandCatalog()
  const picks = useMemo(() => suggestions(catalog), [catalog, profile])
  return (
    <div className="empty">
      <div className="logo">☤</div>
      <div className="empty-title">Hermes</div>
      <div className="dim">{profile === 'default' ? 'Your agent, on your phone.' : `Profile: ${profile}`}</div>
      <div className="suggestions">
        {picks.map(s => (
          <button key={s.text} className="suggestion" onClick={() => onPick(s.text)}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const WINDOW = 40

/** The search bar under the header while searching inside the open chat. */
function FindBar() {
  const find = useStore(s => s.find)
  const items = useStore(s => s.active?.items)
  const key = useStore(s => s.active?.storedId)
  const [seen] = useState({ key })
  useEffect(() => {
    if (find && key !== seen.key) setState({ find: null })
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => setState({ find: null })
  useBackHandler(close, !!find)
  if (!find) return null
  const n = items && find.q.trim() ? findMatches(items, find.q).length : 0
  const i = Math.min(find.i, Math.max(0, n - 1))
  const go = (d: number) => n > 0 && setState({ find: { ...find, i: (i + d + n) % n } })
  return (
    <div className="findbar" role="search">
      <input
        autoFocus
        value={find.q}
        placeholder="Search in this chat"
        onChange={e => setState({ find: { q: e.target.value, i: 0 } })}
        onKeyDown={e => {
          if (e.key === 'Enter') go(e.shiftKey ? 1 : -1)
        }}
      />
      <span className="find-count dim">{find.q.trim() ? (n ? `${n - i} / ${n}` : 'none') : ''}</span>
      <button className="icon-btn" aria-label="Previous match" disabled={!n} onClick={() => go(1)}>
        ↑
      </button>
      <button className="icon-btn" aria-label="Next match" disabled={!n} onClick={() => go(-1)}>
        ↓
      </button>
      <button className="icon-btn" aria-label="Close search" onClick={close}>
        ✕
      </button>
    </div>
  )
}

function Chat({ onPick }: { onPick: (t: string) => void }) {
  // While a chat opens, its last-seen items (chatcache.ts) stand in: read-only, no message actions.
  const previewing = useStore(s => Boolean(s.opening && s.preview?.storedId === s.opening))
  const items = useStore(s => (s.opening && s.preview?.storedId === s.opening ? s.preview.items : s.active?.items ?? null))
  const running = useStore(s => s.active?.running ?? false)
  const sessionKey = useStore(s => (s.opening && s.preview?.storedId === s.opening ? s.opening : s.active?.storedId))
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [showJump, setShowJump] = useState(false)
  // "New since your last visit" (visit.ts): the last-seen time is read once when the chat opens (before leaving it
  // marks anything) and the first newer message is found once, from the chat itself (not its cached preview).
  const visitRef = useRef<{ key: string | undefined; since: number | null; idx: number | null; applied: boolean }>({ key: undefined, since: null, idx: null, applied: false })
  const awayRef = useRef<{ at: number; back: number } | null>(null)
  const [, bumpBack] = useState(0)
  useEffect(
    () =>
      onBack(() => {
        const b = lastBack()
        if (!b || !b.chat || b.chat !== visitRef.current.key) return
        awayRef.current = { at: b.at, back: b.back }
        bumpBack(n => n + 1)
      }),
    []
  )
  if (visitRef.current.key !== sessionKey) {
    visitRef.current = { key: sessionKey, since: sessionKey ? lastVisit(sessionKey) : null, idx: null, applied: false }
    awayRef.current = null
  }
  if (visitRef.current.idx === null && sessionKey && items && items.length > 0 && !previewing) visitRef.current.idx = firstUnseen(items, visitRef.current.since)
  // Back in the app with this chat still open: messages that arrived while away get the divider (and the scroll),
  // replacing an older one. The backlog can land a moment after the return, so look again as items arrive, briefly.
  const awayAt = awayRef.current
  if (awayAt && items && !previewing) {
    const i = newWhileAway(items, awayAt.at, awayAt.back)
    if (i > 0) {
      visitRef.current = { key: sessionKey, since: awayAt.at, idx: i, applied: false }
      awayRef.current = null
    } else if (Date.now() > awayAt.back + 2 * BACK_GRACE_MS) awayRef.current = null
  }
  const dividerIdx = visitRef.current.idx ?? -1
  // Long chats: only the last WINDOW items are drawn on open (each one parses markdown); scrolling near the top
  // draws the previous WINDOW, keeping what's on screen in place. The start index stays put while new items
  // arrive, so nothing shifts under the reader.
  const count = items?.length ?? 0
  const [win, setWin] = useState({ key: sessionKey, start: Math.max(0, count - WINDOW) })
  let start = win.start
  if (win.key !== sessionKey || win.start > count) {
    start = Math.max(0, count - WINDOW)
    setWin({ key: sessionKey, start })
  }
  // Runs of tool calls fold into one line; tapping it opens them (keyed by the run's first item id).
  const [openRuns, setOpenRuns] = useState<ReadonlySet<string>>(() => new Set())
  const folds = useMemo(() => foldMap(items ?? [], openRuns), [items, openRuns])
  const changes = useMemo(() => turnChanges(items ?? [], running), [items, running])
  const toggleRun = useCallback((id: string) => {
    setOpenRuns(o => {
      const n = new Set(o)
      if (!n.delete(id)) n.add(id)
      return n
    })
  }, [])
  /** A search hit inside a folded run: open the run first (its first item id), true if that was needed. */
  const unfold = (idx: number): boolean => {
    const f = folds.get(idx)
    if (!f || !f.hidden || !items) return false
    for (let k = idx; k >= 0; k--) {
      const h = folds.get(k)
      if (h && 'head' in h) {
        toggleRun(items[k].id)
        return true
      }
    }
    return false
  }
  const topSentinel = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ node: Element; top: number } | null>(null)
  useEffect(() => {
    const el = scroller.current
    const s = topSentinel.current
    if (!el || !s || start === 0) return
    const io = new IntersectionObserver(
      es => {
        const first = s.nextElementSibling
        if (!es.some(e => e.isIntersecting) || anchor.current || !first) return
        anchor.current = { node: first, top: first.getBoundingClientRect().top }
        setWin(w => ({ ...w, start: Math.max(0, w.start - WINDOW) }))
      },
      { root: el, rootMargin: '800px 0px 0px 0px' }
    )
    io.observe(s)
    return () => io.disconnect()
  }, [start, sessionKey])
  // Message search: scroll to the hit (drawing earlier turns first if it is above the window) and flash it.
  const jump = useStore(s => s.jump)
  useEffect(() => {
    const el = scroller.current
    if (!jump || !items || !el || jump.storedId !== sessionKey) return
    const idx = findHit(items, jump.terms, jump.snippet)
    if (idx < 0) {
      setState({ jump: null })
      toast('Opened the chat; the exact message wasn’t found', 'info')
      return
    }
    if (idx < start) {
      setWin({ key: sessionKey, start: Math.max(0, idx - 3) })
      return // runs again once it is drawn
    }
    if (unfold(idx)) return // runs again once it is drawn
    setState({ jump: null })
    const node = el.children[(start > 0 ? 1 : 0) + idx - start]
    if (!node) return
    stick.current = false
    node.scrollIntoView({ block: 'center' })
    node.classList.add('hit-flash')
    const unmark = highlightWords(node, jump.terms)
    setTimeout(() => node.classList.remove('hit-flash'), 2500)
    setTimeout(unmark, 6000)
  }, [jump, items, sessionKey, start, folds]) // eslint-disable-line react-hooks/exhaustive-deps

  // In-chat search: mark every hit in the drawn messages, centre the current message (drawing earlier turns first if
  // it is above the window) and bring its first hit into view. Scrolls only when the query or the chosen match changes.
  const find = useStore(s => s.find)
  const lastNav = useRef('')
  useEffect(() => {
    const el = scroller.current
    if (!find || !items || !el || !find.q.trim()) {
      lastNav.current = ''
      return
    }
    const hits = findMatches(items, find.q)
    const idx = hits[Math.min(find.i, hits.length - 1)]
    if (idx === undefined) return
    if (idx < start) {
      setWin({ key: sessionKey, start: Math.max(0, idx - 3) })
      return // runs again once it is drawn
    }
    if (unfold(idx)) return // runs again once it is drawn
    const node = el.children[(start > 0 ? 1 : 0) + idx - start]
    if (!node) return
    const term = find.q.trim().toLowerCase()
    const unmarkAll = highlightWords(el, [term], 'hm-find')
    const unmarkCur = highlightWords(node, [term], 'hm-hit')
    const key = `${sessionKey}|${term}|${find.i}`
    if (lastNav.current !== key) {
      lastNav.current = key
      stick.current = false
      const r = firstRange(node, term)
      const box = (r ? r.getBoundingClientRect() : node.getBoundingClientRect())
      const view = el.getBoundingClientRect()
      el.scrollTop += box.top - view.top - view.height / 2 + box.height / 2
    }
    return () => {
      unmarkAll()
      unmarkCur()
    }
  }, [find, items, sessionKey, start, folds]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = scroller.current
    const a = anchor.current
    anchor.current = null
    // Keep the message that was first where it was (the browser's own scroll anchoring may already have).
    if (el && a && a.node.isConnected) el.scrollTop += a.node.getBoundingClientRect().top - a.top
  }, [start])

  useLayoutEffect(() => {
    stick.current = true
  }, [sessionKey])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (stick.current) el.scrollTop = el.scrollHeight
    // Content can shrink under the button (edit/retry drop turns) without a scroll event.
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stick.current = near
    setShowJump(!near)
  }, [items])

  // Open with the divider near the top instead of at the end (when it is above the last screenful). A search jump or
  // an in-chat search that is waiting wins; so does the user's own scrolling (this runs once per opened chat).
  useLayoutEffect(() => {
    const el = scroller.current
    const v = visitRef.current
    if (!el || !items || v.applied || previewing || v.idx === null) return
    if (dividerIdx < 0 || getState().jump || getState().find?.q.trim()) {
      v.applied = true
      return
    }
    if (dividerIdx < start) {
      setWin({ key: sessionKey, start: Math.max(0, dividerIdx - 3) })
      return // runs again once it is drawn
    }
    const mark = el.querySelector('.visit-divider')
    if (!mark) return
    v.applied = true
    const top = mark.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
    if (top >= el.scrollHeight - el.clientHeight) return // already within the last screenful: stay at the end
    stick.current = false
    el.scrollTop = top - 8
    setShowJump(true)
  }, [items, dividerIdx, start, sessionKey, previewing]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scrubber (components/Scrubber.tsx): one tick per message you sent; `scrubTo` is the item to bring to the top.
  const marks = useMemo(() => userMarks(items ?? []), [items])
  const marksRef = useRef(marks)
  marksRef.current = marks
  const [curMark, setCurMark] = useState(0)
  const [tall, setTall] = useState(false)
  const [scrubTo, setScrubTo] = useState<number | null>(null)
  const findOpen = useStore(s => Boolean(s.find))
  const startRef = useRef(start)
  startRef.current = start
  const topRaf = useRef(0)
  /** Which of your messages is at (or above) the top of the list, and whether the chat is long enough for the rail. */
  const trackTop = () => {
    topRaf.current = 0
    const el = scroller.current
    if (!el) return
    setTall(el.scrollHeight > 3 * el.clientHeight)
    const ms = marksRef.current
    if (ms.length < SCRUB_MIN) return
    const first = startRef.current > 0 ? 1 : 0
    const drawn = Math.max(0, count - startRef.current) // children past these are queued bubbles, the pad, buttons
    const top = el.getBoundingClientRect().top + 1
    let idx = startRef.current
    for (let c = first; c < first + drawn && c < el.children.length; c++) {
      if (el.children[c].getBoundingClientRect().bottom > top) {
        idx = startRef.current + c - first
        break
      }
      idx = startRef.current + c - first
    }
    setCurMark(currentMark(ms, idx))
  }
  useLayoutEffect(trackTop, [items, start]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelAnimationFrame(topRaf.current), [])
  // Same steps as the search jump: draw earlier turns first if the message is above the window, then scroll and flash.
  useEffect(() => {
    const el = scroller.current
    if (scrubTo === null || !items || !el) return
    if (scrubTo >= items.length) return setScrubTo(null)
    if (scrubTo < start) {
      setWin({ key: sessionKey, start: Math.max(0, scrubTo - 3) })
      return // runs again once it is drawn
    }
    if (unfold(scrubTo)) return // runs again once it is drawn
    setScrubTo(null)
    const node = el.children[(start > 0 ? 1 : 0) + scrubTo - start]
    if (!node) return
    stick.current = false
    el.scrollTop += node.getBoundingClientRect().top - el.getBoundingClientRect().top - 8
    node.classList.add('hit-flash')
    setTimeout(() => node.classList.remove('hit-flash'), 2500)
  }, [scrubTo, items, sessionKey, start, folds]) // eslint-disable-line react-hooks/exhaustive-deps

  const opening = useStore(s => s.opening)
  const conn = useStore(s => s.conn)
  const openingActive = useStore(s => s.active?.storedId)
  const openingTitle = useStore(s => s.sessions.find(x => x.id === s.opening)?.title || '')
  // The pull-up gesture lives on the list element, which is a different element in the skeleton / empty / list states.
  const hasList = Boolean(items && items.length)
  useEffect(() => {
    const el = scroller.current
    return el ? installPullToBtw(el) : undefined
  }, [hasList, opening, openingActive])
  if (opening && !previewing && (!(items && items.length) || opening !== openingActive))
    return (
      <div className="chat chat-skeleton" role="status" aria-label="Opening your chat">
        <div className="skeleton-label dim">
          <Spinner small /> {conn === 'open' ? plainTitle(openingTitle) || 'Opening your chat…' : 'Connecting to Hermes…'}
        </div>
        {/* The rough shape of a conversation while it loads, instead of a lone spinner. */}
        {[['user', 46], ['assistant', 88, 72, 54], ['user', 30], ['assistant', 80, 64]].map(([who, ...ws], i) => (
          <div key={i} className={`skeleton-msg ${who}`} style={who === 'user' ? { width: `${(ws as number[])[0] + 20}%` } : undefined} aria-hidden="true">
            {(ws as number[]).map((w, j) => (
              <span key={j} style={{ width: `${w}%`, animationDelay: `${(i * 3 + j) * 0.08}s` }} />
            ))}
          </div>
        ))}
      </div>
    )
  if (!items || items.length === 0) return <Empty onPick={onPick} />

  return (
    <div className="chat-wrap">
    <div
      className="chat"
      ref={scroller}
      onScroll={e => {
        const el = e.currentTarget
        const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        stick.current = near
        setShowJump(!near)
        if (!topRaf.current) topRaf.current = requestAnimationFrame(trackTop)
      }}
    >
      {start > 0 && (
        <div ref={topSentinel} className="chat-earlier dim">
          <Spinner /> Earlier messages…
        </div>
      )}
      {items.slice(start).map((it, i) => {
        // One element per item, also when folded: search and jump find messages by child index.
        const f = folds.get(start + i)
        const card = changes.get(start + i)
        const view = <ItemView key={it.id} item={it} actions={!previewing && hasActions(items, start + i)} busy={running || previewing} />
        const mark = start + i === dividerIdx ? <div className="visit-divider" role="separator">New since your last visit</div> : null
        if (!f) {
          if (card) return <div key={it.id} className="turn-end">{mark}{view}<TurnChangesCard changes={card} /></div>
          return mark ? <div key={it.id} className="visit-wrap">{mark}{view}</div> : view
        }
        if (!('head' in f)) return <div key={it.id} className={card ? 'turn-end' : 'folded'}>{mark}{card && <TurnChangesCard changes={card} />}</div>
        return (
          <div key={it.id} className="tool-run-wrap">
            {mark}
            <ToolRunHead id={it.id} run={f.head} open={f.open} onToggle={toggleRun} />
            {!f.hidden && <ItemView item={it} actions={false} busy={running || previewing} />}
            {card && <TurnChangesCard changes={card} />}
          </div>
        )
      })}
      <QueuedRows />
      <div className="chat-pad" />
      {showJump && (
        <button
          className="jump"
          aria-label="Scroll to the newest message"
          onClick={() => {
            const el = scroller.current
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
          }}
        >
          ↓
        </button>
      )}
      <div className="pull-hint" aria-hidden="true">
        <span>Release for a side question</span>
      </div>
    </div>
    {marks.length >= SCRUB_MIN && tall && !findOpen && !previewing && (
      <Scrubber marks={marks} current={Math.min(curMark, marks.length - 1)} onPick={k => marks[k] && setScrubTo(marks[k].idx)} />
    )}
    </div>
  )
}

/** Test builds only (`HM_DEVTOOLS=1`): a thin strip that can't be dismissed, drawn above everything, full screens included. */
function DevtoolsStrip() {
  const live = remoteDebugStrip(useRemoteDebug()) // remote debugging switched on in Settings → About (plan 14)
  const testBuild = isDevtoolsBuild(appVersion())
  if (!testBuild && !live) return null
  return (
    <>
      <div className="devtools-strip" role="status">
        {testBuild ? 'Test build: remote debugging is on' : live}
      </div>
      <div className="devtools-spacer" aria-hidden="true" />
    </>
  )
}

export function App() {
  const sheet = useStore(s => s.sheet)
  const screen = useStore(s => s.screen)
  const screenKey = useStore(s => s.screenProfile) || '-'
  const request = useStore(s => s.requests[0])
  const toasts = useStore(s => s.toasts)
  const scale = useStore(s => s.textScale)
  const [injected, setInjected] = useState<string | null>(null)
  const clearInjected = useCallback(() => setInjected(null), [])

  useEffect(() => {
    bootMark('painted')
    void connect()
  }, [])
  useEffect(() => installSwipeToDrawer(), [])

  const conn = useStore(s => s.conn)
  useEffect(() => {
    // Leaving the screens for the chat (a skill used, a chat opened…) forgets the way back to the hub.
    if (!screen && getState().screenBack) setState({ screenBack: null })
  }, [screen])
  useEffect(() => watchFirstRun(conn, () => setState({ screen: 'welcome' })), [conn])
  useEffect(() => {
    // Health poll starts once connected; each reconnect re-checks so the dot is current. All of it waits until the
    // chat has opened (afterChatOpens): sent with session.resume, it made the chat open several times slower.
    if (conn !== 'open') return
    let current = true
    void afterChatOpens().then(() => {
      if (!current || getState().conn !== 'open') return
      void checkSetupFlow() // a first run with something missing (no model, no plugin…): the setup flow resumes at it
      // A reconnect (each return from the background) pings; the full status only when stale. The first start's
      // full check is startHealthPolling's own.
      if (!startHealthPolling()) void checkHealth(false)
      startActivityPolling()
      startCanvasSync()
    })
    return () => {
      current = false
    }
  }, [conn])

  useEffect(() => {
    document.documentElement.style.setProperty('--scale', String(scale))
  }, [scale])

  return (
    <div className="app">
      <DevtoolsStrip />
      <Header />
      <ConnBanner />
      <FindBar />
      <Chat onPick={t => setInjected(t)} />
      <ActivityBanner />
      <StatusBar />
      <CompressHint />
      <TtsPlayer />
      <BgApp />
      <Composer injected={injected} onInjected={clearInjected} />
      {screen === 'skills' && <SkillsScreen onUse={t => setInjected(t)} />}
      {screen === 'memory' && <MemoryScreen />}
      {screen === 'cron' && <CronScreen />}
      {screen === 'files' && <FilesScreen onUse={t => setInjected(t)} />}
      {screen === 'projects' && <ProjectsScreen />}
      {screen === 'gallery' && <GalleryScreen />}
      {screen === 'bots' && <BotsScreen />}
      {screen === 'settings' && <SettingsScreen key={screenKey} />}
      {screen === 'setup' && <SetupScreen />}
      {screen === 'welcome' && <SetupFlow />}
      {screen === 'hub' && <HubScreen />}
      <Drawer />
      {sheet === 'model' && <ModelSheet />}
      {sheet === 'commands' && (
        <CommandsSheet
          onPick={cmd => {
            setState({ sheet: null })
            setInjected(cmd)
          }}
        />
      )}
      {sheet === 'chat-menu' && <ChatMenuSheet />}
      {sheet === 'draft-menu' && <DraftMenuSheet />}
      {sheet === 'session-actions' && <SessionActionsSheet />}
      {sheet === 'status' && <StatusSheet />}
      {sheet === 'rollback' && <RollbackSheet />}
      {sheet === 'context' && <ContextSheet />}
      {request && <RequestSheet key={request.id} req={request} />}
      <UninstallResume />
      <CanvasPanel />
      <BtwSheet />
      <DialogHost />
      <div className="toasts">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.level}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Users get actions on every message; assistant replies only on the last text segment of each turn. */
function hasActions(items: ChatItem[], i: number): boolean {
  const it = items[i]
  if (it.kind === 'user') return true
  if (it.kind !== 'assistant' || !it.text.trim()) return false
  for (let j = i + 1; j < items.length; j++) {
    const n = items[j]
    if (n.kind === 'user') return true
    if (n.kind === 'assistant' && n.text.trim()) return false
  }
  return true
}
