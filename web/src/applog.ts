// The recent app log a problem report may include (components/Report.tsx). In memory only, never written to disk or
// sent by itself: the last MAX_LINES lines of page errors, unhandled promise failures, console errors and warnings,
// connection changes and error toasts. What leaves the phone is scrubLog's copy, shown to the user first (report.ts).
import { logEvent, stackFrames } from './diaglog'
import { removeChatText, wellFormed } from './report'
import { getState, subscribe } from './store'

const MAX_LINES = 150
const MAX_LINE = 400
const CHAT_ITEMS = 300 // of the open chat, checked against a log line and the log
const lines: string[] = []

const clock = (): string => new Date().toISOString().slice(11, 19) // UTC time of day, no date or time zone
const say = (v: unknown): string => {
  if (v instanceof Error) return `${v.name}: ${v.message}`
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

/** The title and latest messages of the open chat, to keep out of the log. */
export function openChatText(): string[] {
  const a = getState().active
  return [a?.title || '', ...(a?.items || []).slice(-CHAT_ITEMS).map(i => ('text' in i && typeof i.text === 'string' ? i.text : ''))]
}

/** Adds one line (kind, then the message on one line, cut to MAX_LINE). Chat text goes before the cut, and while its
 *  chat is still open: the log outlives both. */
export function logLine(kind: string, ...parts: unknown[]): void {
  const text = removeChatText(parts.map(say).join(' ').replace(/\s+/g, ' ').trim(), openChatText())
  lines.push(wellFormed(`${clock()} ${kind} ${text}`.slice(0, MAX_LINE)))
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES)
}

/** The log as it is now, oldest line first. */
export const appLog = (): string => lines.join('\n')

/** Settings → About → Delete the diagnostic log. */
export const clearAppLog = (): void => {
  lines.length = 0
}

/** The kept part of a page error: its type and where, never its words (those stay in this memory-only log). */
const keepError = (e: unknown): void => {
  if (e instanceof Error) logEvent('web', 'js_error', { type: e.name, at: stackFrames(e) })
  else logEvent('web', 'js_error', { type: 'not_an_error' })
}

let started = false
/** Starts collecting (main.tsx, once). */
export function startAppLog(): void {
  if (started) return
  started = true
  window.addEventListener('error', e => {
    logLine('error', e.message || 'script error')
    keepError(e.error)
  })
  window.addEventListener('unhandledrejection', e => {
    logLine('unhandled', e.reason)
    keepError(e.reason)
  })
  for (const level of ['error', 'warn'] as const) {
    const orig = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      logLine(level, ...args)
      orig(...args)
    }
  }
  let conn = getState().conn
  let toastSeen = 0
  subscribe(() => {
    const s = getState()
    if (s.conn !== conn) {
      conn = s.conn
      logLine('conn', conn, s.connDetail)
    }
    for (const t of s.toasts) {
      if (t.id <= toastSeen) continue
      toastSeen = t.id
      // What failed, not why: an error's words (after the colon) and a quoted name can be the user's own.
      if (t.level === 'error') logLine('toast', t.text.split(': ')[0].replace(/“[^”]*”|"[^"]*"/g, '“…”'))
    }
  })
}
