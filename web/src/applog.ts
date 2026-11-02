// The recent app log a problem report may include (components/Report.tsx). In memory only, never written to disk or
// sent by itself: the last MAX_LINES lines of page errors, unhandled promise failures, console errors and warnings,
// connection changes and error toasts. What leaves the phone is scrubLog's copy, shown to the user first (report.ts).
import { getState, subscribe } from './store'

const MAX_LINES = 150
const MAX_LINE = 400
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

/** Adds one line (kind, then the message on one line, cut to MAX_LINE). */
export function logLine(kind: string, ...parts: unknown[]): void {
  const text = parts.map(say).join(' ').replace(/\s+/g, ' ').trim()
  lines.push(`${clock()} ${kind} ${text}`.slice(0, MAX_LINE))
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES)
}

/** The log as it is now, oldest line first. */
export const appLog = (): string => lines.join('\n')

let started = false
/** Starts collecting (main.tsx, once). */
export function startAppLog(): void {
  if (started) return
  started = true
  window.addEventListener('error', e => logLine('error', e.message || 'script error'))
  window.addEventListener('unhandledrejection', e => logLine('unhandled', e.reason))
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
      if (t.level === 'error') logLine('toast', t.text)
    }
  })
}
