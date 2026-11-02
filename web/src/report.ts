// "Report a problem" (components/Report.tsx): sends a report to the relay the owner deploys (relay/report/), which
// turns it into a public GitHub issue. Without a relay URL in the build (__REPORT_URL__, set from HERMES_REPORT_URL,
// empty by default), when the relay fails, or when this phone has reached its limit, the app opens GitHub's new-issue
// page with the report filled in instead, and the user submits it there.
// Besides the user's own words a report holds only the app, Android and Hermes versions; the recent app log
// (applog.ts) only if the user ticks it, after scrubLog; a screenshot only if the user picks one (relay only).
import { appVersion, isNative } from './bridge'

export const REPORT_REPO = 'omarqaterge/hermes-mobile-app'
export const MAX_TITLE = 120 // the relay's limits (relay/report/worker.js)
export const MAX_TEXT = 6000
export const MAX_LOG = 20_000
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

/** Replaced in a log before anyone sees it. Order matters: secrets inside URLs go with the URL's query. */
const RULES: Array<[RegExp, string | ((...m: string[]) => string)]> = [
  [/\(Linux; Android[^)]*\)/g, '(Linux; Android)'], // a browser identification names the phone model
  [/\b(https?|wss?):\/\/[^\s"'<>]+/gi, url => cleanUrl(url)],
  [/\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/g, '[token]'], // JWT
  [/\bBearer\s+[^\s"',]+/gi, 'Bearer [token]'],
  [/\b(?:sk|pk|rk)-[\w-]{16,}/g, '[key]'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|xox[abprs]-[\w-]{10,}|AIza[\w-]{30,}|hf_[A-Za-z0-9]{20,})/g, '[key]'],
  [/\b((?:api[_-]?key|token|secret|password|passwd|pwd|auth|session|cookie|key)["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi, (_m, k) => `${k}[removed]`],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, ip => (/^(127\.|0\.0\.0\.0$)/.test(ip) ? ip : '[ip]')],
  [/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi, '[ip]'],
  [/(?<![\w:])[0-9a-f]{0,4}(?::[0-9a-f]{0,4})*::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?(?![\w:])/gi, m => (m === '::' || m === '::1' ? m : '[ip]')],
  [/\/data\/data\/com\.termux\/files\/home|\/data\/user\/\d+\/com\.termux\/files\/home|\/home\/[^\s/"':]+|\/Users\/[^\s/"':]+|\/root(?=\/|\b)/g, '~'],
  [/\/storage\/emulated\/\d+|\/sdcard/g, '[storage]'],
  [/\b[0-9a-f]{32,}\b/gi, '[id]'],
  [/[A-Za-z0-9+/_-]{40,}={0,2}/g, '[data]'],
  [/"[^"\n]{25,}"|“[^”\n]{25,}”|'[^'\n]{25,}'/g, '"[text]"'] // quoted text in an error can be a message
]
function cleanUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}${u.pathname}${u.search || u.hash ? '?[removed]' : ''}`
  } catch {
    return '[link]'
  }
}

/** The log with personal details taken out: tokens, keys, emails, IP addresses, URL queries, home and storage paths,
 *  long IDs, quoted text, and any line of the given chat text (`chat`: the open chat's messages). */
export function scrubLog(log: string, chat: string[] = []): string {
  let out = log
  // Chat text first, before the other rules change it: every line of 12 characters or more, longest first.
  const bits = [...new Set(chat.flatMap(t => t.split('\n').map(l => l.trim())).filter(l => l.length >= 12))].sort((a, b) => b.length - a.length)
  for (const b of bits) out = out.split(b).join('[chat text]')
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
  if (r.log) parts.push('', '<details><summary>Recent app log (personal details removed in the app)</summary>', '', '```text', r.log.replace(/^(\s*)(`{3,})/gm, '$1​$2'), '```', '', '</details>')
  return parts.join('\n')
}

const newIssue = (title: string, body: string) =>
  `https://github.com/${REPORT_REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
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
  | { kind: 'sent'; url: string; screenshot: boolean }
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
    const body = (await res.json().catch(() => null)) as { url?: unknown; screenshot?: unknown } | null
    if (!res.ok || typeof body?.url !== 'string' || !body.url.startsWith(`https://github.com/${REPORT_REPO}/issues/`)) return { kind: 'fallback', why: 'failed' }
    return { kind: 'sent', url: body.url, screenshot: body.screenshot === true }
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
