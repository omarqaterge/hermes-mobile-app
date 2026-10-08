// The native side of the app. Inside the Android shell `window.HermesAndroid` is a
// Java object (addJavascriptInterface); in a plain browser (development) the same
// capabilities come from URL parameters or are no-ops.

interface AndroidBridge {
  getToken(): string // dashboard session token, fetched natively (no CORS from file://); blocks the page
  getTokenAsync?(id: number): void // same, answered through window.__hmToken(id, token)
  getBaseUrl(): string // e.g. "http://127.0.0.1:9119"
  startHermes(): void // Termux RUN_COMMAND ~/bin/hermes-services
  notify(title: string, body: string, tag: string): void
  cancelNotification(tag: string): void
  openExternal(url: string): void
  copyText(text: string): void
  copyRich(text: string, html: string): void
  haptic(): void
  isInForeground(): boolean
  appVersion(): string
  installUpdate?(url: string): void
  openFile?(path: string): void
  setBackground?(hex: string): void
  speak?(text: string, cfg: string): void
  listVoices?(cfg: string): void
  openTtsEngineApp?(pkg: string): void
  isAssistant?(): boolean // Hermes holds the phone's assistant role
  openAssistantSettings?(): void // system page to pick the digital assistant app
  stopSpeaking?(): void
  startListening?(): void
  stopListening?(): void
  sharedItem?(index: number): string
  setLastChat?(id: string, title: string): void
  shareText?(title: string, text: string): void
  setupState?(): string
  setupFix?(what: string): void
  signInTermux?(provider: string, profile: string): boolean
}

declare global {
  interface Window {
    HermesAndroid?: AndroidBridge
  }
}

const params = new URLSearchParams(window.location.search)
const native = window.HermesAndroid

export const isNative = Boolean(native)

function devValue(key: string): string {
  // Development only (plain browser): values set in sessionStorage, never in the URL.
  try {
    return sessionStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

export function baseUrl(): string {
  return (native?.getBaseUrl() || devValue('hm.devBase') || params.get('base') || 'http://127.0.0.1:9119').replace(/\/+$/, '')
}

export function fetchToken(): string {
  if (native) return native.getToken() || ''
  return devValue('hm.devToken')
}

// The token is scraped from the dashboard page on a native thread; while Hermes boots that can take seconds,
// so it is answered asynchronously (window.__hmToken) instead of freezing the page on a blocking bridge call.
let tokenSeq = 0
const tokenWaits = new Map<number, (t: string) => void>()
;(window as unknown as { __hmToken?: (id: number, t: string) => void }).__hmToken = (id, t) => {
  tokenWaits.get(id)?.(t || '')
  tokenWaits.delete(id)
}

function nativeToken(): Promise<string> {
  if (!native?.getTokenAsync) return Promise.resolve(fetchToken())
  const id = ++tokenSeq
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      tokenWaits.delete(id)
      resolve('')
    }, 15_000)
    tokenWaits.set(id, t => {
      clearTimeout(timer)
      resolve(t)
    })
    native.getTokenAsync!(id)
  })
}

/** Fresh WebSocket URL for every connect: the dashboard mints a new session token
 * whenever Hermes restarts, so a cached token would lock us out after a restart. */
export async function wsUrl(): Promise<string | null> {
  let token = native ? await nativeToken() : fetchToken()
  if (!native) {
    try {
      const r = await fetch('/__token', { cache: 'no-store' })
      if (r.ok) token = ((await r.json()) as { token?: string }).token || token
    } catch {
      /* static hosting: keep sessionStorage value */
    }
  }
  if (!token) return null
  return `${baseUrl().replace(/^http/, 'ws')}/api/ws?token=${encodeURIComponent(token)}`
}

export function startHermes(): void {
  native?.startHermes()
}

export function notify(title: string, body: string, tag = 'hermes'): void {
  if (native) {
    native.notify(title, body, tag)
    return
  }
  if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, tag })
}

export function cancelNotification(tag: string): void {
  native?.cancelNotification(tag)
}

export function appInBackground(): boolean {
  return native ? !native.isInForeground() : document.hidden
}

export function openExternal(url: string): void {
  if (native) native.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}

export async function copyText(text: string): Promise<void> {
  if (native) {
    native.copyText(text)
    return
  }
  await navigator.clipboard?.writeText(text)
}

/** Copy with formatting: `html` for apps that paste rich text, `text` (markdown) as the plain fallback. */
export async function copyRich(text: string, html: string): Promise<void> {
  if (native) {
    native.copyRich(text, html)
    return
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
  } catch {
    await navigator.clipboard?.writeText(text)
  }
}

export function haptic(): void {
  try {
    native?.haptic()
  } catch {
    /* optional */
  }
}

/** Android-only facts for the setup check (null in a browser). */
export interface NativeSetup {
  termux: boolean
  runCommand: boolean
  notifications: boolean
  batteryApp: boolean
  batteryTermux: boolean
  startError: string
}

export function setupState(): NativeSetup | null {
  try {
    const raw = native?.setupState?.()
    return raw ? (JSON.parse(raw) as NativeSetup) : null
  } catch {
    return null
  }
}

/** Open the Android screen that fixes one setup item (fixed list on the Java side). */
export function setupFix(what: 'permissions' | 'start' | 'notifications' | 'battery-app' | 'battery-termux' | 'app-settings' | 'open-termux' | 'get-termux'): void {
  native?.setupFix?.(what)
}

/** Opens Termux on `hermes auth add <provider>` (logins Hermes only does in a terminal). False = not possible here. */
export function signInTermux(provider: string, profile: string): boolean {
  try {
    return Boolean(native?.signInTermux?.(provider, profile))
  } catch {
    return false
  }
}

/** Download + install a release APK (the shell only accepts this project's GitHub release URLs). */
export function installUpdate(url: string): boolean {
  try {
    if (!native?.installUpdate) return false
    native.installUpdate(url)
    return true
  } catch {
    return false
  }
}

export function appVersion(): string {
  return native?.appVersion() || 'web-dev'
}

/** Open a file with another Android app (via termux-open). Returns false outside the app. */
export function openFile(path: string): boolean {
  if (native?.openFile) {
    native.openFile(path)
    return true
  }
  return false
}

/** A file another app shared to Hermes (Android share sheet): {name, mime, b64} or {error}. */
export function sharedItem(index: number): { name?: string; mime?: string; b64?: string; error?: string } {
  try {
    return JSON.parse(window.HermesAndroid?.sharedItem?.(index) || '{"error":"not available"}')
  } catch {
    return { error: 'unreadable' }
  }
}

/** The launcher's "last chat" shortcut (long-press the app icon). */
export function setLastChat(id: string, title: string): void {
  try {
    native?.setLastChat?.(id, title)
  } catch {
    /* cosmetic */
  }
}

/** Android share sheet (≤ 400,000 chars); in a browser it copies instead. Returns whether it shared. */
export function shareText(title: string, text: string): boolean {
  if (native?.shareText) {
    native.shareText(title, text.length > 400_000 ? text.slice(0, 399_000) + '\n\n…(cut)' : text)
    return true
  }
  void copyText(text)
  return false
}
