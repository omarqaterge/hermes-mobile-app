// "Report a problem" (components/Report.tsx): sends a report to the relay the owner deploys (relay/report/), which
// turns it into a public GitHub issue. Without a relay URL in the build (__REPORT_URL__, set from HERMES_REPORT_URL,
// empty by default), when the relay fails, or when this phone has reached its limit, the app opens GitHub's new-issue
// page with the report filled in instead, and the user submits it there.
// Besides the user's own words a report holds only the app, Android and Hermes versions; the diagnostic log
// (diagnostics.ts) only if the user ticks it, after scrubLog; a screenshot only if the user picks one (relay only).
// Through the relay the log is kept privately and the public issue only names it. On GitHub's page it would be public,
// so it goes there only in a build without a relay, where the sheet said so before the user chose it.
import { appVersion, isNative } from './bridge'

export const REPORT_REPO = 'omarqaterge/hermes-mobile-app'
export const MAX_TITLE = 120 // the relay's limits (relay/report/worker.js)
export const MAX_TEXT = 6000
export const MAX_LOG = 60_000
const MAX_FALLBACK_URL = 7500 // GitHub answers 414 to much longer links
const SEND_TIMEOUT_MS = 30_000
const INSTALL_ID = 'hm.reportId'

/** The build's relay URL. A plain browser (development, the browser tests) may set hm.devReportUrl in sessionStorage. */
export function relayUrl(): string {
  if (__REPORT_URL__) return __REPORT_URL__
  if (isNative) return ''
  try {
    return sessionStorage.getItem('hm.devReportUrl') || ''
  } catch {
    return ''
  }
}

export interface ReportDetails {
  app: string
  android: string
  hermes: string
}
/** The versions every report carries: nothing else about the phone. */
export function reportDetails(hermes: string): ReportDetails {
  return {
    app: appVersion(),
    android: /Android\s+([\d.]+)/.exec(navigator.userAgent)?.[1] || '',
    hermes: hermes ? `v${hermes.replace(/^v/, '')}` : ''
  }
}

const digitCount = (s: string): number => s.replace(/\D/g, '').length
/** Two decimals joined by a comma or semicolon that are a place on Earth (two numbers split by a space only could be
 *  anything, so they stay). */
const isCoordinatePair = (m: string): boolean => {
  const [lat, lon] = m.split(/\s*[,;]\s*/).map(Number)
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180
}
/** 7 to 15 digits in groups split by spaces, dashes or dots, but not a date (2026-11-04, 04.11.2026) and not dots alone
 *  unless they are 3.3.4 (a version or a build number is dots alone). */
const isLocalNumber = (m: string): boolean => {
  const n = digitCount(m)
  if (n < 7 || n > 15) return false
  if (/^\d{4}[ .-]\d{1,2}[ .-]\d{1,2}(?:[ .-]\d{1,4})?$/.test(m) || /^\d{1,2}[ .-]\d{1,2}[ .-]\d{2,4}$/.test(m)) return false
  if (!/[ -]/.test(m)) return /^\d{3}(\.\d{3}\.\d{4})$/.test(m)
  return true
}
/** Replaced in a log before anyone sees it. Order matters: secrets inside URLs go with the URL's query. */
const RULES: Array<[RegExp, string | ((...m: string[]) => string)]> = [
  [/\(Linux;[^)]*Android[^)]*\)/g, '(Linux; Android)'], // a browser identification names the phone model
  [/\b(https?|wss?):\/\/[^\s"'<>]+/gi, url => cleanUrl(url)],
  [/\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/g, '[token]'], // JWT
  [/\b(Bearer|Basic)\s+[^\s"',]+/gi, (_m, k) => `${k} [token]`],
  [/\b(?:sk|pk|rk)[-_][\w-]{16,}/g, '[key]'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|xox[abprs]-[\w-]{10,}|AIza[\w-]{30,}|hf_[A-Za-z0-9]{20,}|gsk_\w{20,}|AKIA[0-9A-Z]{16})/g, '[key]'],
  [/(?<!\d)\d{6,}:[\w-]{30,}/g, '[key]'], // a Telegram bot token, also inside a word ("bot123…")
  [/([\w-]*(?:api[_-]?key|token|secret|password|passwd|pwd|auth\w*|session|cookie|key)["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi, (_m, k) => `${k}[removed]`],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, ip => (/^(127\.|0\.0\.0\.0$)/.test(ip) ? ip : '[ip]')],
  [/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi, '[ip]'],
  [/(?<![\w:])[0-9a-f]{0,4}(?::[0-9a-f]{0,4})*::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?(?![\w:])/gi, m => (m === '::' || m === '::1' ? m : '[ip]')],
  // Coordinates and phone numbers (a contact's number or a place can be in an error). Shapes a log needs stay: see below.
  [/(?<![\w.])-?\d{1,3}\.\d{3,}\s*[,;]\s*-?\d{1,3}\.\d{3,}(?![\w]|\.\d)/g, m => (isCoordinatePair(m) ? '[place]' : m)],
  [/\b(lat(?:itude)?|lon(?:g|gitude)?|lng)(["']?\s*[=:]\s*)-?\d{1,3}\.\d{3,}(?![\w]|\.\d)/gi, (_m, k, sep) => `${k}${sep}[place]`],
  [/(?<![\w.])\+\d[\d ().-]{5,18}\d(?![\w])/g, m => (digitCount(m) >= 7 && digitCount(m) <= 15 ? '[number]' : m)],
  [/(?<![\w.:/+-])\(\d{2,5}\)[ .-]?\d{2,4}(?:[ .-]\d{2,4}){0,3}(?![\w:/]|[.-]\d)/g, m => (digitCount(m) >= 7 && digitCount(m) <= 15 ? '[number]' : m)],
  [/(?<![\w.:/+-])\d{2,4}(?:[ .-]\d{2,4}){1,4}(?![\w:/]|[ .-]\d)/g, m => (isLocalNumber(m) ? '[number]' : m)],
  // A file's name can be as private as the folder's, so the whole path goes.
  [/(?:\/data\/data\/com\.termux\/files\/home|\/data\/user\/\d+\/com\.termux\/files\/home|\/home\/[^\s/"':]+|\/Users\/[^\s/"':]+|\/root(?=\/|\b))[^\s"':,)]*/g, '~'],
  [/(?:\/storage\/emulated\/\d+|\/sdcard)[^\s"':,)]*/g, '[storage]'],
  [/\b[0-9a-f]{32,}\b/gi, '[id]'],
  [/[A-Za-z0-9+_-]{40,}={0,2}/g, '[data]'],
  [/"[^"\n]{25,}"|“[^”\n]{25,}”|'[^'\n]{25,}'/g, '"[text]"'] // quoted text in an error can be a message
]
function cleanUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.split('/').map(p => (p.length >= 20 ? '[removed]' : p)).join('/') // a webhook's secret is in its path
    return `${u.protocol}//${u.host}${path}${u.search || u.hash ? '?[removed]' : ''}`
  } catch {
    return '[link]'
  }
}

/** `text` without any line of `chat` (12 characters or more), with spaces evened out on both sides and also in its JSON
 *  form. A long line is also found by its first 40 characters, and goes to the end of the line: a log line may be cut. */
export function removeChatText(text: string, chat: string[]): string {
  const lines = chat.flatMap(t => t.split('\n').map(l => l.replace(/\s+/g, ' ').trim())).filter(l => l.length >= 12)
  const bits = [...new Set(lines.flatMap(l => [l, JSON.stringify(l).slice(1, -1)]))].sort((a, b) => b.length - a.length)
  let out = text.replace(/[ \t]+/g, ' ')
  for (const b of bits) {
    out = out.split(b).join('[chat text]')
    const start = b.slice(0, 40)
    for (let at = b.length > 40 ? out.indexOf(start) : -1; at >= 0; at = out.indexOf(start, at)) {
      const end = out.indexOf('\n', at)
      out = `${out.slice(0, at)}[chat text]${end < 0 ? '' : out.slice(end)}`
    }
  }
  return out
}

/** Lone halves of an emoji, left when text is cut: encodeURIComponent throws on them. */
export const wellFormed = (s: string): string => s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')

/** The log with personal details taken out: tokens, keys, emails, IP addresses, URL queries, home and storage paths,
 *  long IDs, phone numbers (`[number]`) and coordinates (`[place]`), quoted text, and any line of the given chat text (`chat`: the open chat's messages). */
export function scrubLog(log: string, chat: string[] = []): string {
  let out = removeChatText(log, chat) // first, before the other rules change the text
  for (const [re, to] of RULES) out = out.replace(re, to as string)
  return out.length > MAX_LOG ? out.slice(out.length - MAX_LOG).replace(/^[^\n]*\n/, '') : out
}

export interface Report {
  title: string
  text: string
  details: ReportDetails
  log?: string
}

/** The issue text the GitHub page is filled with. */
export function issueText(r: Report, note = ''): string {
  const parts = [r.text.trim(), '', '---', '', '**Details**', '', `- App: ${r.details.app || 'unknown'}`, `- Android: ${r.details.android || 'unknown'}`, `- Hermux agent: ${r.details.hermes || 'unknown'}`]
  if (note) parts.push('', note)
  if (r.log) parts.push('', '<details><summary>Diagnostic log (personal details removed in the app)</summary>', '', '```text', r.log.replace(/^(\s*)(`{3,})/gm, '$1​$2'), '```', '', '</details>')
  return parts.join('\n')
}

const newIssue = (title: string, body: string) =>
  `https://github.com/${REPORT_REPO}/issues/new?title=${encodeURIComponent(wellFormed(title))}&body=${encodeURIComponent(wellFormed(body))}`
const CUT = '_(Cut: the rest didn’t fit in the link.)_'

/** GitHub's new-issue page filled with the report, under MAX_FALLBACK_URL: the log's oldest lines go first, then
 *  the end of the text. */
export function fallbackUrl(r: Report, note = ''): string {
  const title = r.title.slice(0, MAX_TITLE)
  let url = newIssue(title, issueText(r, note))
  if (url.length <= MAX_FALLBACK_URL) return url
  let log = (r.log || '').split('\n')
  while (log.length) {
    log = log.slice(Math.max(1, Math.ceil(log.length / 8)))
    url = newIssue(title, issueText({ ...r, log: log.length ? log.join('\n') : undefined }, note))
    if (url.length <= MAX_FALLBACK_URL) return url
  }
  let lo = 0
  let hi = r.text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (newIssue(title, issueText({ ...r, text: `${r.text.slice(0, mid)}…\n\n${CUT}`, log: undefined }, note)).length <= MAX_FALLBACK_URL) lo = mid
    else hi = mid - 1
  }
  return newIssue(title, issueText({ ...r, text: `${r.text.slice(0, lo)}…\n\n${CUT}`, log: undefined }, note))
}

/** A random ID that says nothing about the device, only so the relay can limit how often one install sends. */
function installId(): string {
  let id = ''
  try {
    id = localStorage.getItem(INSTALL_ID) || ''
  } catch {
    /* private mode */
  }
  if (!/^[0-9a-f]{32}$/.test(id)) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')
    try {
      localStorage.setItem(INSTALL_ID, id)
    } catch {
      /* private mode */
    }
  }
  return id
}

export interface Screenshot {
  type: string
  /** base64, no data: prefix */
  data: string
}

export type SendResult =
  | { kind: 'sent'; url: string; screenshot: boolean; log: boolean }
  | { kind: 'fallback'; why: 'no-relay' | 'limit' | 'failed' }

/** Sends through the relay. Anything but a created issue is a fallback, with why. */
export async function sendReport(r: Report, shot?: Screenshot | null): Promise<SendResult> {
  const url = relayUrl()
  if (!url) return { kind: 'fallback', why: 'no-relay' }
  const ctl = new AbortController()
  const stop = setTimeout(() => ctl.abort(), SEND_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installId: installId(), title: r.title.slice(0, MAX_TITLE), text: r.text.slice(0, MAX_TEXT), details: r.details, log: r.log || undefined, screenshot: shot || undefined }),
      signal: ctl.signal
    })
    if (res.status === 429) return { kind: 'fallback', why: 'limit' }
    const body = (await res.json().catch(() => null)) as { url?: unknown; screenshot?: unknown; log?: unknown } | null
    if (!res.ok || typeof body?.url !== 'string' || !body.url.startsWith(`https://github.com/${REPORT_REPO}/issues/`)) return { kind: 'fallback', why: 'failed' }
    return { kind: 'sent', url: body.url, screenshot: body.screenshot === true, log: body.log === true }
  } catch {
    return { kind: 'fallback', why: 'failed' }
  } finally {
    clearTimeout(stop)
  }
}

/** A picked image as a JPEG of at most 1600 px a side: smaller to send, and without the photo's metadata (place,
 *  time, camera) since only the pixels are drawn again. */
export async function prepareScreenshot(file: File): Promise<Screenshot & { preview: string }> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * scale))
  canvas.height = Math.max(1, Math.round(bmp.height * scale))
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  const preview = canvas.toDataURL('image/jpeg', 0.85)
  return { type: 'image/jpeg', data: preview.slice(preview.indexOf(',') + 1), preview }
}
