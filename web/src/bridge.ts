// The native side of the app. Inside the Android shell `window.HermesAndroid` is a
// Java object (addJavascriptInterface); in a plain browser (development) the same
// capabilities come from URL parameters or are no-ops.
import { bootMark } from './boot'

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
  ttsControl?(cmd: 'play' | 'pause' | 'toggle' | 'rew' | 'ff' | 'stop'): void // read-aloud, shared with its notification
  startListening?(): void
  stopListening?(): void
  sharedItem?(index: number): string
  setLastChat?(id: string, title: string): void
  chatSeen?(id: string): void
  bgState?(): string // the background app Hermes drives (JSON without port/token) or ""
  bgFrameAsync?(id: number, maxW: number): void // answers window.__hmBgFrame(id, dataUrl | "")
  bgAction?(what: 'stop' | 'take_over'): string // "ok" or "error: …"
  setUnseen?(profile: string, json: string): void
  shareText?(title: string, text: string): void
  setupState?(): string
  setupFix?(what: string): void
  installHelperApp?(which: string): void // answers window.hermesSetupInstall(which, state, pct, msg)
  probeTermux?(): void // answers window.hermesTermuxProbe(json)
  setupCommand?(): boolean // copies the installer command with a fresh progress token
  setupProgress?(): string // {active, lines, done, fail}; new lines also come through window.hermesSetupLine(line)
  signInTermux?(provider: string, profile: string): boolean
  saveImage?(id: number, name: string, path: string, b64: string): void // into Pictures/Hermes; answers window.__hmImage(id, ok)
  shareImage?(id: number, name: string, path: string, b64: string): void // share sheet; answers window.__hmImage(id, ok)
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
  bootMark('token')
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
    bootMark('token-asked')
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

let imageSeq = 0
const imageWaits = new Map<number, (ok: boolean) => void>()

/** True when this app build can save / share images natively. */
export function canNativeImage(): boolean {
  return Boolean(native?.saveImage && native?.shareImage)
}

/** Save or share an image natively: a phone file (`path`) or the bytes (`b64`). Resolves with whether it worked. */
export function nativeImage(kind: 'save' | 'share', name: string, path: string, b64: string): Promise<boolean> {
  const fn = kind === 'save' ? native?.saveImage : native?.shareImage
  if (!native || !fn) return Promise.resolve(false)
  const w = window as unknown as { __hmImage?: (id: number, ok: boolean) => void }
  w.__hmImage ??= (id, ok) => {
    imageWaits.get(id)?.(ok)
    imageWaits.delete(id)
  }
  const id = ++imageSeq
  return new Promise(resolve => {
    imageWaits.set(id, resolve)
    fn.call(native, id, name, path, b64)
  })
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
  /** Older app builds don't report these two: undefined. */
  termuxApi?: boolean
  shizuku?: boolean
  /** Build.MANUFACTURER, lower case (older builds: undefined). */
  maker?: string
  startError: string
  /** App-first setup (older builds: undefined). canInstall = Android lets this app install apps. */
  termuxBoot?: boolean
  /** Termux:Boot was never opened: Android doesn't start it after a reboot until it is. */
  termuxBootStopped?: boolean
  /** Who signed Termux: 'fdroid', 'other' (GitHub/Play builds can't mix with F-Droid's add-ons) or '' (not installed). */
  termuxSigner?: string
  termuxVersion?: string
  canInstall?: boolean
  devOptions?: boolean
  wirelessDebugging?: boolean
  /** The shell can probe Termux (probeTermux) and run the installer's progress channel. */
  probe?: boolean
}

export function setupState(): NativeSetup | null {
  try {
    const raw = native?.setupState?.()
    return raw ? (JSON.parse(raw) as NativeSetup) : null
  } catch {
    return null
  }
}

export type SetupFix =
  | 'permissions' | 'start' | 'notifications' | 'battery-app' | 'battery-termux' | 'app-settings' | 'open-termux' | 'get-termux'
  | 'get-termux-api' | 'get-shizuku' | 'open-shizuku' | 'storage' | 'restart-hermes'
  | 'install-permission' | 'about-phone' | 'dev-options' | 'open-termux-boot'

/** Open the Android screen that fixes one setup item (fixed list on the Java side). */
export function setupFix(what: SetupFix): void {
  native?.setupFix?.(what)
}

/** The helper apps the shell can install (fixed sources and signers on the Java side). */
export type HelperApp = 'termux' | 'termux-api' | 'termux-boot' | 'shizuku'
export type InstallState = 'permission' | 'downloading' | 'installing' | 'done' | 'error'

type SetupListener =
  | { kind: 'install'; which: HelperApp; state: InstallState; pct: number; msg: string }
  | { kind: 'probe'; json: string }
  | { kind: 'line'; line: string }
  | { kind: 'changed' }
const setupListeners = new Set<(e: SetupListener) => void>()
/** Native setup events (install status, probe answers, installer lines) for whoever shows the setup. */
export function onSetupEvent(fn: (e: SetupListener) => void): () => void {
  setupListeners.add(fn)
  return () => setupListeners.delete(fn)
}
const emitSetup = (e: SetupListener) => setupListeners.forEach(fn => fn(e))
const sw = window as unknown as Record<string, unknown>
sw.hermesSetupInstall = (which: HelperApp, state: InstallState, pct: number, msg: string) => emitSetup({ kind: 'install', which, state, pct, msg })
sw.hermesTermuxProbe = (json: string) => emitSetup({ kind: 'probe', json })
sw.hermesSetupLine = (line: string) => emitSetup({ kind: 'line', line })
// The app came back to the front or a permission was answered (a dialog doesn't always change the page's visibility).
sw.hermesSetupChanged = () => emitSetup({ kind: 'changed' })

/** Download + install one helper app (Termux first). False = this shell can't. */
export function installHelperApp(which: HelperApp): boolean {
  try {
    if (!native?.installHelperApp) return false
    native.installHelperApp(which)
    return true
  } catch {
    return false
  }
}

/** Ask Termux (through the shell) whether Hermes is installed and running; the answer arrives as a 'probe' event. */
export function probeTermux(): boolean {
  try {
    if (!native?.probeTermux) return false
    native.probeTermux()
    return true
  } catch {
    return false
  }
}

/** Copy the installer command (built by the shell with a new one-time progress token). */
export function copySetupCommand(): boolean {
  try {
    return Boolean(native?.setupCommand?.())
  } catch {
    return false
  }
}

export function setupProgress(): { active: boolean; lines: string[]; done: boolean; fail: string } | null {
  try {
    const raw = native?.setupProgress?.()
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
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

/** This chat is on screen: the service drops its sticky Done chip, badge count and reply notification. */
export function chatSeen(id: string): void {
  try {
    window.HermesAndroid?.chatSeen?.(id)
  } catch {
    /* cosmetic */
  }
}

/** The chats the page shows as unread for a profile; the service mirrors them in the chip and the icon badge. */
export function setUnseen(profile: string, rows: { id: string; title: string }[]): void {
  try {
    window.HermesAndroid?.setUnseen?.(profile, JSON.stringify(rows.slice(0, 500)))
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

/** The background app's state as the shell holds it ("" = none). */
export function bgState(): string {
  try {
    return window.HermesAndroid?.bgState?.() || ''
  } catch {
    return ''
  }
}

/** Ask the shell for the hidden display's latest frame; it answers through window.__hmBgFrame(id, dataUrl | ""). */
export function bgFrameAsync(id: number, maxW: number): boolean {
  try {
    if (!window.HermesAndroid?.bgFrameAsync) return false
    window.HermesAndroid.bgFrameAsync(id, maxW)
    return true
  } catch {
    return false
  }
}

/** Stop the background app (closes its display) or take it over (moves it to the real screen). */
export function bgAction(what: 'stop' | 'take_over'): string {
  try {
    return String(window.HermesAndroid?.bgAction?.(what) ?? 'error: not available')
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : e}`
  }
}
