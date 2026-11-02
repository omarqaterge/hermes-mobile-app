// Opt-in usage stats (Settings → About → "Share anonymous usage stats"), sent to Aptabase's events API with a plain
// request. Off by default. Without an app key (__STATS_KEY__, set at build time from HERMES_STATS_KEY) nothing here
// does anything and the choice is never offered. Without a "yes" nothing is queued or sent.
// Sending is bounded: one short-lived timer at a time, no periodic loop, each event tried at most twice, a cap per
// launch. Failures are silent and nothing waits for a request. Nothing is kept on disk but the choice and the ID.
import { appVersion, isNative } from './bridge'
import { getState, subscribe, type Screen } from './store'

/** Everything that is ever sent, besides the install ID, the app version and the Android version on every event. */
export const STATS_EVENTS = {
  app_start: null,
  screen_open: { screen: ['skills', 'memory', 'cron', 'files', 'projects', 'settings', 'bots', 'setup', 'hub', 'welcome', 'gallery'] },
  heard_from: { source: ['GitHub', 'Reddit', 'X', 'YouTube', 'A friend', 'Search', 'Other'] }
} as const

export type StatsEvent = keyof typeof STATS_EVENTS
export const STATS_SOURCES = STATS_EVENTS.heard_from.source

const CHOICE = 'hm.statsChoice'
const INSTALL_ID = 'hm.statsId'
const SOURCE_ASKED = 'hm.statsSourceAsked'
const HOSTS: Record<string, string> = { EU: 'https://eu.aptabase.com', US: 'https://us.aptabase.com' }
const SDK_VERSION = 'hermes-mobile-stats@1'
const FLUSH_AFTER_MS = 30_000
const RETRY_AFTER_MS = 5 * 60_000
const TIMEOUT_MS = 10_000
const MAX_TRIES = 2
const MAX_BATCH = 25 // the API's limit per request
const MAX_PER_LAUNCH = 200

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string | null): void => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

/** The build's app key. A plain browser (development, the browser tests) may set hm.devStatsKey in sessionStorage. */
function appKey(): string {
  if (__STATS_KEY__) return __STATS_KEY__
  if (isNative) return ''
  try {
    return sessionStorage.getItem('hm.devStatsKey') || ''
  } catch {
    return ''
  }
}
/** Where a key sends events: its region picks the host (A-EU-… or A-US-…); anything else switches stats off. */
function eventsUrl(key: string): string {
  const parts = key.split('-')
  const host = parts.length === 3 ? HOSTS[parts[1]] : undefined
  return host ? `${host}/api/v0/events` : ''
}

/** With no usable key, the opt-in isn't offered and nothing can be sent. */
export const statsAvailable = (): boolean => Boolean(eventsUrl(appKey()))
export const statsOn = (): boolean => statsAvailable() && read(CHOICE) === 'yes'
/** The opt-in card has not been shown yet. */
export const statsUndecided = (): boolean => read(CHOICE) === null
/** The card is on screen: until they say yes it counts as no, so it never shows twice. */
export const markStatsAsked = (): void => {
  if (statsUndecided()) write(CHOICE, 'no')
}
export const statsSourceAsked = (): boolean => read(SOURCE_ASKED) === '1'

/** A random ID that says nothing about the device. Also Aptabase's session ID, so its "sessions" count installs. */
function installId(): string {
  let id = read(INSTALL_ID)
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    write(INSTALL_ID, id)
  }
  return id
}

interface Queued {
  body: unknown
  tries: number
}
let queue: Queued[] = []
let timer = 0
let inFlight: AbortController | null = null
let generation = 0 // a new choice makes a running request's events stale
let tracked = 0
let startSent = false

function schedule(ms: number): void {
  if (timer || inFlight || !queue.length || document.hidden) return // hidden: the next return to the app sends them
  timer = window.setTimeout(() => {
    timer = 0
    void flush()
  }, ms)
}

async function flush(keepalive = false): Promise<void> {
  clearTimeout(timer)
  timer = 0
  const url = eventsUrl(appKey())
  if (inFlight || !queue.length || !url) return
  const batch = queue.splice(0, MAX_BATCH)
  const started = generation
  const ctl = new AbortController()
  inFlight = ctl
  const stop = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  let retry = true
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'App-Key': appKey() },
      credentials: 'omit',
      keepalive,
      signal: ctl.signal,
      body: JSON.stringify(batch.map(e => e.body))
    })
    retry = r.status === 429 || r.status >= 500
  } catch {
    // offline or blocked: tried again below, once
  }
  clearTimeout(stop)
  inFlight = null
  if (started !== generation) return
  if (retry) {
    queue.unshift(...batch.filter(e => ++e.tries < MAX_TRIES))
    schedule(RETRY_AFTER_MS)
  } else schedule(FLUSH_AFTER_MS)
}

/** Queues one event from the list above. A name, a property or a value that isn't on the list is dropped. */
export function track(name: StatsEvent, props?: Record<string, string>): void {
  if (!statsOn() || tracked >= MAX_PER_LAUNCH) return
  const allowed: Record<string, readonly string[]> | null = STATS_EVENTS[name]
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(props || {})) {
    if (!allowed?.[k]?.includes(v)) return
    clean[k] = v
  }
  tracked++
  queue.push({
    tries: 0,
    body: {
      timestamp: new Date().toISOString(),
      sessionId: installId(),
      eventName: name,
      systemProps: {
        isDebug: !isNative,
        osName: 'Android',
        osVersion: /Android\s+([\d.]+)/.exec(navigator.userAgent)?.[1] || '',
        appVersion: appVersion(),
        sdkVersion: SDK_VERSION
      },
      props: clean
    }
  })
  schedule(FLUSH_AFTER_MS)
}

function sendStart(): void {
  if (startSent || !statsOn()) return
  startSent = true
  track('app_start')
}

/** The user's choice. Off also drops anything waiting and forgets the install ID: a later yes is a new install ID. */
export function setStatsChoice(on: boolean): void {
  write(CHOICE, on ? 'yes' : 'no')
  if (on) {
    sendStart()
    return
  }
  generation++
  queue = []
  clearTimeout(timer)
  timer = 0
  inFlight?.abort()
  startSent = false
  write(INSTALL_ID, null)
}

/** "How did you hear about us?": asked once; no answer sends nothing. */
export function answerStatsSource(source: string | null): void {
  write(SOURCE_ASKED, '1')
  if (source) track('heard_from', { source })
}

/** Called once at launch. With no key it does nothing at all, not even listen. */
export function startStats(): void {
  if (!statsAvailable()) return
  sendStart()
  let last: Screen = getState().screen
  subscribe(() => {
    const screen = getState().screen
    if (screen === last) return
    last = screen
    if (screen) track('screen_open', { screen })
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void flush(true)
    else schedule(FLUSH_AFTER_MS)
  })
}
