// "Report a problem" relay: a Cloudflare Worker that turns a report from the app into a GitHub issue.
// The app can't hold a GitHub token (the repository and the app are public), so this Worker holds one as a secret
// (GITHUB_TOKEN, a fine-grained token that may only create issues on one repository) and creates the issue for it.
//   POST /        a report (JSON, see readReport) → 201 {url, number, screenshot}; 429 when a limit is reached
//   GET  /s/<id>  a screenshot a report uploaded (stored in the KV namespace REPORTS, linked from the issue)
// Limits, all kept in REPORTS: MAX_PER_INSTALL reports a day for each random per-install ID the app makes (never a
// phone identifier), MAX_PER_IP a day for each sender address (stored only as a salted hash), MAX_PER_DAY in all, and
// size caps on every field. KV isn't atomic, so a burst of requests at the same moment can pass a little over a limit.
// Everything fits Cloudflare's free plan (Workers and KV). See README.md for setup.

export const LIMITS = {
  MAX_PER_INSTALL: 5, // reports per install ID per UTC day
  MAX_PER_IP: 20, // reports per sender address (an IPv6 address counts by its /64) per UTC day
  MAX_PER_DAY: 200, // reports from everyone per UTC day: what a flood of made-up install IDs can cost at most
  MAX_BODY: 4_500_000, // bytes of request JSON (the screenshot is in it, base64)
  MAX_TITLE: 120,
  MAX_TEXT: 6000,
  MAX_LOG: 20_000,
  MAX_SHOT: 3_000_000 // bytes of decoded screenshot
}
const SHOT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const DAY_SECONDS = 86_400
const CORS = {
  'access-control-allow-origin': '*', // the app's page is a file:// page: its origin is "null"
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400'
}

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS, ...extra } })

/** Checks the request body and returns the report, or a string saying what is wrong. */
export function readReport(body) {
  if (!body || typeof body !== 'object') return 'not a report'
  const { installId, title, text, details, log, screenshot } = body
  if (typeof installId !== 'string' || !/^[0-9a-f]{32}$/.test(installId)) return 'bad install id'
  if (typeof title !== 'string' || !title.trim() || title.length > LIMITS.MAX_TITLE) return 'bad title'
  if (typeof text !== 'string' || !text.trim() || text.length > LIMITS.MAX_TEXT) return 'bad text'
  if (log != null && (typeof log !== 'string' || log.length > LIMITS.MAX_LOG)) return 'bad log'
  const d = {}
  for (const k of ['app', 'android', 'hermes']) {
    const v = details?.[k]
    if (v == null || v === '') continue
    if (typeof v !== 'string' || v.length > 60 || !/^[\w.+\-() ]+$/.test(v)) return `bad ${k} version`
    d[k] = v
  }
  let shot = null
  if (screenshot != null) {
    const { type, data } = screenshot
    if (typeof type !== 'string' || !Object.hasOwn(SHOT_TYPES, type) || typeof data !== 'string' || data.length > Math.ceil((LIMITS.MAX_SHOT * 4) / 3) + 4) return 'bad screenshot'
    shot = { type, data }
  }
  return { installId, title: title.replace(/\s+/g, ' ').trim(), text: text.trim(), details: d, log: log?.trim() || '', shot }
}

/** No @mentions (they would notify people) and no way out of the log's code block. */
const quiet = s => s.replace(/@(?=[\w-])/g, '@​')
const fenced = s => s.replace(/^(\s*)(`{3,}|~{3,})/gm, '$1​$2')

/** The issue's Markdown. */
export function issueBody(r, shotUrl) {
  const lines = [fenced(quiet(r.text)), '', '---', '', '**Details**', '']
  lines.push(`- App: ${r.details.app || 'unknown'}`, `- Android: ${r.details.android || 'unknown'}`, `- Hermux agent: ${r.details.hermes || 'unknown'}`)
  if (shotUrl) lines.push('', `![Screenshot](${shotUrl})`)
  if (r.log) lines.push('', '<details><summary>Recent app log (personal details removed in the app)</summary>', '', '```text', fenced(quiet(r.log)), '```', '', '</details>')
  lines.push('', '_Sent from the app\'s "Report a problem"._')
  return lines.join('\n')
}

async function sha256(s) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('')
}

/** Counts this report against both daily limits; false = a limit is already reached (nothing is counted then). */
async function withinLimits(env, installId, ip, now) {
  const day = new Date(now).toISOString().slice(0, 10)
  const counters = [
    [`id:${day}:${installId}`, LIMITS.MAX_PER_INSTALL],
    [`ip:${day}:${await sha256(`${env.IP_SALT || 'report-relay'}|${addressKey(ip)}`)}`, LIMITS.MAX_PER_IP],
    [`all:${day}`, LIMITS.MAX_PER_DAY]
  ]
  const counts = await Promise.all(counters.map(([k]) => env.REPORTS.get(k)))
  if (counters.some(([, max], i) => Number(counts[i] || 0) >= max)) return false
  const opts = { expirationTtl: 2 * DAY_SECONDS }
  await Promise.all(counters.map(([k], i) => env.REPORTS.put(k, String(Number(counts[i] || 0) + 1), opts)))
  return true
}

/** One network hands out a whole /64 to one customer, so an IPv6 address counts by its first four groups. */
function addressKey(ip) {
  if (!ip) return 'none'
  if (!ip.includes(':')) return ip
  const [head, tail = ''] = ip.toLowerCase().split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const zeros = ip.includes('::') ? Array(Math.max(0, 8 - left.length - right.length)).fill('0') : []
  return [...left, ...zeros, ...right].slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':')
}

function decodeShot(shot) {
  let bytes
  try {
    const bin = atob(shot.data)
    bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  } catch {
    return null
  }
  if (!bytes.length || bytes.length > LIMITS.MAX_SHOT) return null
  // The bytes must be the image type they claim to be.
  const is = (...sig) => sig.every((b, i) => bytes[i] === b)
  const ok =
    shot.type === 'image/jpeg' ? is(0xff, 0xd8, 0xff) : shot.type === 'image/png' ? is(0x89, 0x50, 0x4e, 0x47) : is(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45
  return ok ? bytes : null
}

async function createIssue(env, r, shotUrl) {
  const repo = env.REPO || 'omarqaterge/hermes-mobile-app'
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      'user-agent': 'hermux-report-relay'
    },
    body: JSON.stringify({ title: r.title, body: issueBody(r, shotUrl), labels: [env.LABEL || 'from-app'] })
  })
  if (!res.ok) return null
  const issue = await res.json()
  return typeof issue?.html_url === 'string' ? { url: issue.html_url, number: issue.number } : null
}

async function report(request, env) {
  if (!env.GITHUB_TOKEN || !env.REPORTS) return json(503, { error: 'relay not set up' })
  const size = Number(request.headers.get('content-length') || 0)
  if (size > LIMITS.MAX_BODY) return json(413, { error: 'too large' })
  const raw = await request.text()
  if (raw.length > LIMITS.MAX_BODY) return json(413, { error: 'too large' })
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return json(400, { error: 'not JSON' })
  }
  const r = readReport(body)
  if (typeof r === 'string') return json(400, { error: r })
  const bytes = r.shot ? decodeShot(r.shot) : null
  if (r.shot && !bytes) return json(400, { error: 'bad screenshot' })
  if (!(await withinLimits(env, r.installId, request.headers.get('cf-connecting-ip'), Date.now()))) return json(429, { error: 'limit reached' }, { 'retry-after': String(DAY_SECONDS) })
  let shotUrl = ''
  let shotKey = ''
  if (r.shot && bytes) {
    const id = `${crypto.randomUUID().replace(/-/g, '')}.${SHOT_TYPES[r.shot.type]}`
    shotKey = `shot:${id}`
    await env.REPORTS.put(shotKey, bytes, { metadata: { type: r.shot.type } })
    shotUrl = `${new URL(request.url).origin}/s/${id}`
  }
  const issue = await createIssue(env, r, shotUrl)
  if (!issue) {
    if (shotKey) await env.REPORTS.delete(shotKey) // no issue links to it
    return json(502, { error: 'GitHub refused the issue' })
  }
  return json(201, { ...issue, screenshot: Boolean(shotUrl) })
}

async function screenshot(id, env) {
  if (!/^[0-9a-f]{32}\.(jpg|png|webp)$/.test(id) || !env.REPORTS) return new Response('Not found', { status: 404 })
  const { value, metadata } = await env.REPORTS.getWithMetadata(`shot:${id}`, { type: 'arrayBuffer' })
  if (!value) return new Response('Not found', { status: 404 })
  return new Response(value, {
    headers: { 'content-type': metadata?.type || 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' }
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (request.method === 'POST' && url.pathname === '/') return report(request, env)
    if (request.method === 'GET' && url.pathname.startsWith('/s/')) return screenshot(url.pathname.slice(3), env)
    return json(404, { error: 'not found' })
  }
}
