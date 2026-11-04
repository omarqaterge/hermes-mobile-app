// The page's side of the diagnostic log: what happened, never what was said. An event is an area, a name and short
// fields; each part is checked here and again in DiagLog.java, so free text (a message, a path, an error's words) can't
// get in. In the app events are kept on the phone by DiagLog.java, so they outlive a crash; in a plain browser (the
// browser tests, development) they stay in memory. Nothing here sends anything: see diagnostics.ts.
import { diagBridge, isNative } from './bridge'

const NAME = /^[a-z][a-z0-9_]{0,23}$/
const VALUE = /^[A-Za-z0-9_.:+-]{1,32}$/
const STACK = /^[A-Za-z0-9_.:$<>,-]{1,400}$/ // only for `at`: file:line:column,file:line:column
const OFF = 'hm.diagOff'
const MAX_MEMORY = 300
const SLOW_RPC_MS = 10_000
const memory: string[] = []

export type Fields = Record<string, string | number | boolean | null | undefined>

function offInBrowser(): boolean {
  try {
    return localStorage.getItem(OFF) === '1'
  } catch {
    return false
  }
}

/** Fields as ["name", "value", …], each checked; the wrong shape becomes "?". */
export function checkedFields(fields: Fields): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || out.length >= 16) continue
    const text = String(v)
    out.push(NAME.test(k) ? k : 'unknown', (k === 'at' ? STACK : VALUE).test(text) ? text : '?')
  }
  return out
}

/** Adds one event. Never throws. */
export function logEvent(area: string, event: string, fields: Fields = {}): void {
  try {
    const flat = checkedFields(fields)
    const a = NAME.test(area) ? area : 'unknown'
    const e = NAME.test(event) ? event : 'unknown'
    if (isNative) {
      diagBridge.event(a, e, flat)
      return
    }
    if (offInBrowser()) return
    const parts = flat.reduce<string[]>((all, p, i) => (i % 2 ? [...all.slice(0, -1), `${all[all.length - 1]}=${p}`] : [...all, p]), [])
    const at = new Date().toISOString()
    memory.push(`${at.slice(5, 10)} ${at.slice(11, 19)} ${[a, e, ...parts].join(' ')}`)
    if (memory.length > MAX_MEMORY) memory.splice(0, memory.length - MAX_MEMORY)
  } catch {
    /* logging must never get in the way */
  }
}

/** A plain browser's events. */
export const memoryEvents = (): string[] => [...memory]
export const clearMemoryEvents = (): void => {
  memory.length = 0
}

/** Where an error happened (in the app that's index.html: the whole page is one file): script file names and places, up to 6, only from the stack's "at" lines: the first lines
 *  hold the error's words, which can look like a place too. */
export function stackFrames(e: Error): string {
  const out: string[] = []
  const frames = (e.stack || '').split('\n').filter(l => /^\s+at\s/.test(l))
  for (const line of frames) {
    const m = /([\w.-]+\.(?:js|mjs|ts|tsx|html)):(\d+):(\d+)\)?\s*$/.exec(line)
    if (!m) continue
    const f = `${m[1]}:${m[2]}:${m[3]}`
    if (!out.includes(f)) out.push(f)
    if (out.length === 6) break
  }
  return out.join(',') || 'none'
}

let downSince = 0
let attempts = 0
/** A change of the connection, once per outage: how long it was down, and how many tries that took. */
export function noteConn(conn: string): void {
  if (conn === 'open') {
    if (downSince) logEvent('conn', 'open', { down_s: Math.round((Date.now() - downSince) / 1000), tries: attempts })
    else logEvent('conn', 'open', { first: true })
    downSince = 0
    attempts = 0
  } else if (conn === 'closed' || conn === 'error') {
    attempts++
    if (!downSince) {
      downSince = Date.now()
      logEvent('conn', 'lost', { state: conn })
    }
  }
}

/** A failed or slow gateway call: the method's name, how long it took and the error's code; never its parameters or words. */
export function noteRpc(method: string, ms: number, err?: unknown): void {
  if (err !== undefined) {
    const e = err as { code?: unknown; name?: unknown }
    logEvent('rpc', 'fail', { method, ms, code: typeof e?.code === 'number' || typeof e?.code === 'string' ? e.code : typeof e?.name === 'string' ? e.name : 'other' })
  } else if (ms >= SLOW_RPC_MS) logEvent('rpc', 'slow', { method, ms })
}

/** A dashboard path's first part after the base (`canvas`, `skills`): later parts and the query can hold names. */
export function routeName(path: string): string {
  const parts = path.split(/[?#]/)[0].split('/').filter(Boolean)
  const first = parts[0] === 'api' ? (parts[1] === 'plugins' ? parts[3] : parts[1]) : parts[0]
  return first && /^[a-z][a-z0-9_-]{0,23}$/.test(first) ? first : 'other'
}
