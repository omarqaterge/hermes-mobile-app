// Mock Hermes dashboard + tui_gateway on 127.0.0.1:9119 for browser tests of the web UI (no phone needed).
// Logs every RPC / REST call to a JSONL file so test.cjs can assert what the app sent.
const http = require('http')

// Reply for the inline HTML preview scenarios (`show html`, `show html streaming`).
const HTML_REPLY = 'Page:\n\n```html\n<!doctype html>\n<h1 id="t">Hello frame</h1>\n<script>document.getElementById("t").textContent += " ok"</script>\n<div style="height:600px"></div>\n```'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { WebSocketServer } = require('ws')

const LOG = process.env.HM_E2E_LOG || path.join(os.tmpdir(), 'hm-web-e2e-calls.jsonl')
fs.writeFileSync(LOG, '')
const log = o => fs.appendFileSync(LOG, JSON.stringify({ ...o, t: Date.now() }) + '\n')

const N_SESSIONS = 150
const allSessions = Array.from({ length: N_SESSIONS }, (_, i) => ({
  id: `s-${i}`,
  title: `Chat ${i}`,
  preview: `preview ${i}`,
  message_count: 2,
  started_at: Math.floor(Date.now() / 1000) - i * 3600,
  source: 'mobile'
}))
// The slow-resume chat, past the first page and just before the oldest (a test deletes the last row): its title comes
// from session.list, as with Hermes.
allSessions.splice(N_SESSIONS - 1, 0, { id: 's-slow', title: 's-slow', preview: 'x', message_count: 2, started_at: Math.floor(Date.now() / 1000) - (N_SESSIONS - 1.5) * 3600, source: 'mobile' })
allSessions.unshift({ id: 's-stale', title: 'Stale edit chat', preview: 'x', message_count: 4, started_at: Math.floor(Date.now() / 1000) - 60, source: 'mobile' })
allSessions.unshift({ id: 's-card', title: 'Card chat', preview: 'x', message_count: 2, started_at: Math.floor(Date.now() / 1000) - 30, source: 'mobile' })
allSessions.unshift({ id: 's-run', title: 'Running chat', preview: 'x', message_count: 3, started_at: Math.floor(Date.now() / 1000), source: 'mobile' })

const canvasDocs = {} // session -> [doc]
const libraryItems = [] // the Library (plugin library.py), newest first
// An old Library copy saved without a chat (no source): the gallery lists it as a saved copy.
libraryItems.push({ id: 'lib-old', title: 'Old notes', type: 'markdown', lang: '', category: 'Unsorted', saved: Math.floor(Date.now() / 1000) - 86400, chars: 16, content: 'Kept from before', source: null })
// The chat whose start-up resume is slow already has a canvas (opening it while the chat loads must show it).
canvasDocs['s-slowstart'] = [{ id: 'dlife', title: 'Life', type: 'markdown', lang: '', rev: 1, updated: Date.now() / 1000, by: 'agent', chars: 12, path: '', created: Date.now() / 1000, content: '# Life\n\nGlider' }]
// A chat with a canvas and things that scroll sideways (code, table, card): the swipe-left-to-canvas checks.
canvasDocs['s-panel'] = [{ id: 'dside', title: 'Side', type: 'markdown', lang: '', rev: 1, updated: Date.now() / 1000, by: 'agent', chars: 12, path: '', created: Date.now() / 1000, content: '# Side\n\nPanel text' }]
let activityItems = []
// The plugin's /tool-result: the stored output of a finished tool call, by tool_id (filled by every tool.complete the mock sends).
const toolResults = new Map()
// The plugin's /memory (MEMORY.md / USER.md) and /bots, kept so POST /memory and PUT /bots/<name> change what the next GET says.
const memory = { memory: { target: 'memory', entries: ['x', 'y'], used: 1100, limit: 2200 }, user: { target: 'user', entries: ['z'], used: 10, limit: 1375 } }
let botKeep = []
let prefsOrder = null // PUT /prefs (the chat list's pinned / manual order)
// Canvas versions (the plugin keeps one per save): `${session}/${doc}` -> [{ rev, at, by, note, content }], started when first asked.
const canvasHist = new Map()
const histOf = (s, d) => {
  const k = `${s}/${d.id}`
  if (!canvasHist.has(k)) canvasHist.set(k, [{ rev: d.rev, at: d.updated, by: d.by, note: 'created', content: d.content }])
  return canvasHist.get(k)
}
const botStatus = () => ({ keep: botKeep, host_running: false, running: { default: false }, parked: { default: false }, platforms: {}, keeper_alive: false })
const MEDIA_TYPES = { txt: 'text/plain; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', mp3: 'audio/mpeg', mp4: 'video/mp4', pdf: 'application/pdf' }
let refuseUntil = 0
let runtimeGen = 0
// forgetDrafts: Hermes restarted and the empty chats made so far are gone (a chat has no row until its first
// message); chats created afterwards get a -d<gen> suffix so a recreated chat can be told apart.
let draftGen = 0
const goneDraft = id => draftGen > 0 && /^s-new/.test(id) && !id.endsWith(`-d${draftGen}`)
let fastMode = 'normal'
let pluginEnabled = false
let providerConfigured = true // false = a fresh install (the welcome opens)
// true = like the pinned Hermes on a fresh install: setup.status scoped to a profile says a provider is configured although
// none is (its loose probe); setup.runtime_check still says ok: false.
let looseStatus = false
let bgapps = { allow_sensitive: false, available: true } // the plugin's /bgapps (Settings → Background apps)
let openui = { enabled: true } // the plugin's /openui (Settings → Replies)
let phoneAccess = { files: true, termux_api: true, shizuku: 'ok' } // the plugin's /phone-access (Setup check)
let codexPolls = 0
// Claude sign-in, like the pinned Hermes: `hermes auth add anthropic` (Termux) and the plugin's in-app login only add an
// entry to the profile's credential pool; /api/providers/oauth keeps saying logged_in: false for the Anthropic card
// (its status reads ~/.hermes/.anthropic_oauth.json and env vars only), /api/credentials/pool lists the entry.
let claudePool = []
let claudeLoginMissing = false // true = an older plugin without /claude-login (404)
const claudeEntry = () => ({ index: claudePool.length + 1, id: 'c0ffee', label: 'anthropic-oauth-1', auth_type: 'oauth', source: 'manual:hermes_pkce', priority: 0, last_status: null, request_count: 0, token_preview: 'sk-a...abcd', has_refresh: true })
// Provider catalog: the pinned Hermes's REAL answers (tools/hermes-provider-fixture.py), plus what the test saved.
const providerFixture = require('./fixtures/hermes-providers.json')
let envSet = {} // KEY -> value written by PUT /api/env (the profile's .env)
let endpoints = [] // POST /api/providers/custom-endpoints
// Like Hermes's redacted_credential_preview: first 4 + last 4 of a long value.
const redact = v => (v.length >= 12 ? `«redacted:${v.slice(0, 4)}...${v.slice(-4)}»` : '«redacted:***»')

const FILE_TEXT = { 'table.csv': 'a,b\n1,2', 'page.html': '<h1>Hi</h1>', 'code.py': 'print("x")' }
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', c => (body += c))
  req.on('end', () => {
    const url = new URL(req.url, 'http://x')
    log({ http: req.method, path: url.pathname, query: url.search, body: body ? safeJson(body) : null })
    const send = (o, status = 200) => {
      const b = JSON.stringify(o)
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) })
      res.end(b)
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      // MOCK-HERMES: test.cjs refuses to run unless it sees this (9119 may be forwarded to the real phone).
      return res.end('<!-- MOCK-HERMES --><script>window.__HERMES_SESSION_TOKEN__ = "tok"</script>')
    }
    const p = url.pathname
    if (p === '/m') {
      // Stand-in for the shell's streamed media URL (MainActivity.media → plugin /media).
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Accept-Ranges': 'bytes' })
      return res.end(png)
    }
    if (p === '/__mock') {
      // Test hooks: set the activity feed, bump a chat's message count (a reply landed there).
      const b = JSON.parse(body || '{}')
      if (b.activity) activityItems = b.activity
      if (b.unconfigured) {
        providerConfigured = false
        envSet = {}
        endpoints = []
        codexPolls = 0 // nobody signed in to ChatGPT any more either
      }
      if (b.configured) providerConfigured = true
      if (b.pluginEnabled !== undefined) pluginEnabled = b.pluginEnabled
      if (b.looseStatus !== undefined) looseStatus = b.looseStatus
      if (b.claudeSignedIn !== undefined) claudePool = b.claudeSignedIn ? [claudeEntry()] : []
      if (b.claudeLoginMissing !== undefined) claudeLoginMissing = b.claudeLoginMissing
      if (b.bgapps) bgapps = { ...bgapps, ...b.bgapps }
      if (b.openui) openui = { ...openui, ...b.openui }
      if (b.phone) phoneAccess = { ...phoneAccess, ...b.phone }
      if (b.bump) {
        // Like Hermes: session.list is sorted by last activity, so a chat that got a message moves to the front of the list.
        const i = allSessions.findIndex(x => x.id === b.bump)
        allSessions[i].message_count += 2
        allSessions.unshift(...allSessions.splice(i, 1))
      }
      // A brand-new chat made elsewhere (started now; session.list only has started_at, no separate last-active field).
      if (b.newChat) allSessions.unshift({ id: b.newChat, title: 'Brand new chat', preview: 'x', message_count: 0, started_at: Math.floor(Date.now() / 1000) + 5, source: 'mobile' })
      // newRuntime: the next resumes mint a new runtime id (Hermes reaped the parked one); gen 0 = the usual rt-<id>.
      if (b.newRuntime) runtimeGen++
      if (b.gen !== undefined) runtimeGen = b.gen
      if (b.forgetDrafts) draftGen++
      if (b.draftGen !== undefined) draftGen = b.draftGen
      if (b.up) refuseUntil = 0 // Hermes is back now (ends a drop early)
      if (b.drop) {
        // Hermes goes away: close every socket and refuse new ones for a while.
        refuseUntil = Date.now() + (b.drop || 3000)
        for (const c of wss.clients) c.terminate()
      }
      return send({ ok: true })
    }
    if (p === '/api/files' && req.method === 'GET') {
      // Every folder holds folders "a" and "b" (three levels deep) and a note.
      const dir = url.searchParams.get('path') || '/'
      const depth = dir.split('/').filter(Boolean).length
      const join = n => (dir === '/' ? '' : dir) + '/' + n
      const entries = depth < 4 ? ['a', 'b'].map(n => ({ name: n, path: join(n), is_directory: true })) : []
      entries.push({ name: 'note.txt', path: join('note.txt'), is_directory: false, size: 5 })
      for (const [n, text] of Object.entries(FILE_TEXT)) entries.push({ name: n, path: join(n), is_directory: false, size: text.length })
      for (const n of ['song.mp3', 'doc.pdf']) entries.push({ name: n, path: join(n), is_directory: false, size: 1000 })
      return send({ path: dir, parent: dir === '/' ? null : dir.replace(/\/[^/]+$/, '') || '/', entries })
    }
    if (p === '/api/files/read' && req.method === 'GET') {
      // Text files of the Files screen's previews (the call is logged, so a test can see what was read).
      const name = (url.searchParams.get('path') || '').split('/').pop()
      return send({ data_url: 'data:text/plain;base64,' + Buffer.from(FILE_TEXT[name] ?? 'hello').toString('base64'), size: (FILE_TEXT[name] ?? 'hello').length })
    }
    if (p === '/api/cron/jobs' && req.method === 'GET') return send([{ id: 'j1', name: 'Morning brief', schedule: '0 9 * * *', prompt: 'Brief me', next_run_at: null }])
    if (p === '/api/cron/jobs/j1' && req.method === 'PUT') return send({ detail: 'Method Not Allowed' }, 405)
    if (p === '/api/cron/jobs/j1/runs') return send([{ title: 'ok', started_at: Date.now() / 1000 - 60, session_id: 's-6', preview: 'chat run' }, { title: 'saved output', output: '# Result\n\nAll good' }])
    if (p === '/api/sessions/search') return send({ results: [{ session_id: 's-long', title: 'Long chat', snippet: '…>>>question<<< 17', role: 'user' }] })
    if (p === '/api/plugins/hermes-mobile/activity') return send({ items: activityItems })
    if (p === '/api/plugins/hermes-mobile/prefs') {
      // The chat list's order (plugin /prefs): PUT keeps what the app sent, the next GET returns it.
      if (req.method === 'PUT') {
        const b = JSON.parse(body || '{}')
        prefsOrder = { pinned: b.pinned || [], manual: b.manual ?? null, at: b.at ?? Date.now() }
      }
      return send({ order: prefsOrder })
    }
    if (p === '/api/plugins/hermes-mobile/media') {
      // The shell's media URL (plugin /media): a file with byte ranges (parse_range, 206 + Content-Range). The mock has no phone files,
      // so the bytes are made up: a 1x1 PNG for .png, 17 bytes of text for everything else.
      const name = url.searchParams.get('path') || ''
      if (!name) return send({ detail: 'not found' }, 404)
      const ext = (name.split('.').pop() || '').toLowerCase()
      const bytes = ext === 'png' ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') : Buffer.from('mock media bytes\n')
      const size = bytes.length
      const m = /^\s*bytes=(\d*)-(\d*)\s*$/.exec(req.headers.range || '')
      let start = 0, end = size - 1, ranged = false
      if (m && (m[1] || m[2])) {
        ranged = true
        if (m[1]) {
          start = +m[1]
          end = m[2] ? Math.min(+m[2], size - 1) : size - 1
        } else {
          const n = +m[2]
          start = Math.max(0, size - n)
        }
        if (start >= size || start > end || (!m[1] && +m[2] === 0)) {
          res.writeHead(416, { 'Content-Range': `bytes */${size}` })
          return res.end()
        }
      }
      const part = bytes.subarray(start, end + 1)
      const h = { 'Content-Type': MEDIA_TYPES[ext] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Length': part.length, 'Cache-Control': 'no-store' }
      if (ranged) h['Content-Range'] = `bytes ${start}-${end}/${size}`
      res.writeHead(ranged ? 206 : 200, h)
      return res.end(part)
    }
    if (p === '/api/plugins/hermes-mobile/tool-result') {
      // The stored output of one tool call (plugin /tool-result): what tool.complete carried, as the JSON text Hermes stores.
      const r = toolResults.get(url.searchParams.get('id') || '')
      return r ? send({ tool_name: r.tool_name, content: r.content, truncated: false }) : send({ detail: 'output not stored' }, 404)
    }
    if (p === '/api/plugins/hermes-mobile/bots' && req.method === 'GET') return send(botStatus())
    if (p.startsWith('/api/plugins/hermes-mobile/bots/') && p !== '/api/plugins/hermes-mobile/bots/log' && req.method === 'PUT') {
      // Always-on bots (plugin bots.py): keep a profile's gateway running. Only the default profile exists here.
      const name = decodeURIComponent(p.split('/').pop())
      if (name !== 'default') return send({ detail: 'profile not found' }, 404)
      const b = JSON.parse(body || '{}')
      botKeep = b.keep ? [name] : []
      return send(botStatus())
    }
    if (p === '/api/plugins/hermes-mobile/bots/log') return send({ log: '' })
    if (p === '/api/plugins/hermes-mobile/auto') {
      // Auto access: the plugin's list of chats whose dangerous commands are blocked under /yolo.
      const b = JSON.parse(body || '{}')
      if (req.method === 'PUT') return send({ session: b.session, mode: b.mode === 'auto' ? 'auto' : '' })
      return send({ session: url.searchParams.get('session') || '', mode: '' })
    }
    if (p === '/api/plugins/hermes-mobile/bgapps') {
      if (req.method === 'PUT') bgapps.allow_sensitive = !!JSON.parse(body || '{}').allow_sensitive
      return send(bgapps)
    }
    if (p === '/api/plugins/hermes-mobile/openui/call') {
      // A card's Query() (plugin openui_query.py): read-only tools only.
      const b = JSON.parse(body || '{}')
      if (b.name === 'read_file') return send({ content: '1|mock file', total_lines: 1, file_size: 10, truncated: false, is_binary: false, is_image: false, not_found: false })
      if (b.name !== 'web_search') return send({ detail: `${b.name} is not available to cards` }, 403)
      return send({ success: true, data: { web: [{ title: 'Mock result one', url: 'https://example.com/1', description: 'd' }] } })
    }
    if (p === '/api/plugins/hermes-mobile/openui') {
      if (req.method === 'PUT') openui.enabled = JSON.parse(body || '{}').enabled !== false
      return send(openui)
    }
    if (p === '/api/plugins/hermes-mobile/phone-access') return send(phoneAccess)
    if (p === '/api/hermes/update/check') return send({ install_method: 'git', current_version: '0.21.5+4582.gb8a8be1', behind: 12, update_available: true, can_apply: true, message: null })
    if (p === '/api/plugins/hermes-mobile/refresh-logins') return send({ ok: true, anthropic: 0 })
    if (p === '/api/plugins/hermes-mobile/cleanup') return send({ ok: true, dry_run: false, removed: [], freed_bytes: 0 })
    if (p === '/api/plugins/hermes-mobile/profiles/link') return send({ linked: [] }) // profiles that now share the default's plugin
    if (p === '/api/model/info') return send({ model: 'mock-model' })
    // Account sign-ins: the pinned Hermes's list; ChatGPT is a device-code flow approved on the 2nd poll.
    if (p === '/api/providers/oauth' && req.method === 'GET')
      return send({
        providers: providerFixture.oauth.providers.map(x => (x.id === 'openai-codex' ? { ...x, status: { ...x.status, logged_in: codexPolls >= 2 } } : x))
      })
    if (p === '/api/env' && req.method === 'GET') {
      const out = {}
      for (const [k, v] of Object.entries(providerFixture.env)) out[k] = envSet[k] ? { ...v, is_set: true, redacted_value: redact(envSet[k]) } : v
      return send(out)
    }
    if (p === '/api/env' && req.method === 'DELETE') {
      const k = JSON.parse(body || '{}').key
      if (!envSet[k]) return send({ detail: `${k} not found in .env` }, 404)
      delete envSet[k]
      return send({ ok: true, key: k, removed: true })
    }
    if (p === '/api/providers/custom-endpoints/validate') {
      // Hermes asks <base_url>/models; here every https URL "answers" with two models.
      const b = JSON.parse(body || '{}')
      if (!/^https:/.test(b.base_url || '')) return send({ ok: false, reachable: false, message: `Could not reach ${b.base_url}/models.`, models: [] })
      return send({ ok: true, reachable: true, message: '', models: ['mistral-large-latest', 'mistral-small-latest'], model_details: [], transport_checked: 'chat_completions', resolved_base_url: b.base_url })
    }
    if (p === '/api/providers/custom-endpoints' && req.method === 'POST') {
      // Same shape as the pinned Hermes (config_env.py _endpoint_row / _custom_endpoint_response).
      const b = JSON.parse(body || '{}')
      if (!b.name || !b.base_url || !b.model) return send({ detail: 'model required' }, 400)
      const id = b.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
      endpoints = endpoints.filter(e => e.id !== id)
      endpoints.push({ id, name: b.name, base_url: b.base_url, model: b.model, models: b.models || [b.model], api_mode: '', context_length: null, discover_models: true, has_api_key: !!b.api_key, api_key_preview: b.api_key ? `\${HERMES_CUSTOM_${id.toUpperCase()}_API_KEY}` : null, is_current: false, source: 'providers' })
      providerConfigured = true
      return send({ endpoints, current: { provider: '', model: '', base_url: '' }, ok: true, id })
    }
    if (p.startsWith('/api/providers/custom-endpoints/') && req.method === 'DELETE') {
      const id = decodeURIComponent(p.split('/').pop())
      endpoints = endpoints.filter(e => e.id !== id)
      return send({ endpoints, current: { provider: '', model: '', base_url: '' }, ok: true })
    }
    if (p === '/api/providers/custom-endpoints' && req.method === 'GET') return send({ endpoints, current: { provider: '', model: '', base_url: '' } })
    if (p === '/api/providers/oauth/openai-codex/start') {
      codexPolls = 0
      return send({ session_id: 'dev1', flow: 'device_code', user_code: 'ABCD-1234', verification_url: 'https://auth.openai.com/codex/device', expires_in: 900, poll_interval: 1 })
    }
    if (p === '/api/providers/oauth/openai-codex/poll/dev1') {
      if (++codexPolls >= 2) providerConfigured = true
      return send({ session_id: 'dev1', status: codexPolls >= 2 ? 'approved' : 'pending' })
    }
    if (p.startsWith('/api/providers/oauth/sessions/')) return send({ ok: true })
    // Hermes's DELETE clears the PKCE file and the whole credential_pool.anthropic (clear_provider_auth).
    if (p === '/api/providers/oauth/anthropic' && req.method === 'DELETE') {
      if (!claudePool.length) return send({ detail: 'No stored credentials were removed for Anthropic Account.' }, 409)
      claudePool = []
      return send({ ok: true, provider: 'anthropic' })
    }
    if (p === '/api/credentials/pool') return send({ providers: claudePool.length ? [{ provider: 'anthropic', entries: claudePool }] : [] })
    // The plugin's in-app Claude login (claude_login.py): start gives the claude.ai link, finish takes the pasted code#state.
    if (p.startsWith('/api/plugins/hermes-mobile/claude-login/')) {
      if (claudeLoginMissing) return send({ detail: 'Not Found' }, 404)
      const b = JSON.parse(body || '{}')
      if (p.endsWith('/cancel')) return send({ ok: b.session_id === 'cl1' }) // false for a sign-in that is not open
      if (p.endsWith('/start')) return send({ session_id: 'cl1', url: 'https://claude.ai/oauth/authorize?code=true&client_id=x&state=st-cl1', expires_in: 600 })
      if (p.endsWith('/finish')) {
        if (b.session_id !== 'cl1') return send({ detail: 'This sign-in expired. Start again.' }, 400)
        if (!String(b.code || '').endsWith('#st-cl1')) return send({ detail: 'That isn’t the code from this sign-in. Copy the whole code Claude shows (it has a # in the middle).' }, 400)
        claudePool = [claudeEntry()]
        providerConfigured = true
        return send({ ok: true, label: 'anthropic-oauth-1' })
      }
    }
    if (p === '/api/env' && req.method === 'PUT') {
      const b = JSON.parse(body || '{}')
      envSet[b.key] = b.value
      providerConfigured = true
      return send({ ok: true, key: b.key, config_updates: [] })
    }
    if (p === '/api/model/options') {
      const providers = [{ slug: 'mock', name: 'Mock', authenticated: true, models: ['mock-model', 'mock-sonnet'] }]
      if (envSet.DEEPSEEK_API_KEY) providers.push({ slug: 'deepseek', name: 'DeepSeek', authenticated: true, models: ['deepseek-chat', 'deepseek-reasoner'] })
      for (const e of endpoints) providers.push({ slug: e.id, name: e.name, authenticated: true, models: e.models })
      return send({ model: 'mock-model', provider: 'mock', providers })
    }
    if (p === '/api/model/set') return send({ ok: true })
    if (p === '/api/dashboard/plugins') return send([{ name: 'hermes-mobile' }, { name: 'kanban' }])
    if (p === '/api/config' && req.method === 'GET') return send({ agent: { reasoning_effort: 'high' }, plugins: { enabled: pluginEnabled ? ['other', 'hermes-mobile'] : ['other'] } })
    if (p === '/api/config' && req.method === 'PUT') {
      const b = JSON.parse(body || '{}')
      if (b.config?.plugins?.enabled) pluginEnabled = b.config.plugins.enabled.includes('hermes-mobile') // other config writes (the model) leave it alone
      return send({ ok: true })
    }
    if (p === '/api/skills') return send([{ name: 'a', enabled: true }, { name: 'b', enabled: true }, { name: 'c', enabled: false }])
    if (p === '/api/plugins/hermes-mobile/memory' && req.method === 'POST') {
      // Like the plugin: Hermes's memory store does the change, the answer holds its result and the fresh snapshot of THAT target only.
      const b = JSON.parse(body || '{}')
      const snap = memory[b.target]
      if (!snap) return send({ detail: 'target must be memory or user' }, 400)
      const out = { success: true, done: true, target: b.target }
      const at = snap.entries.indexOf(b.old_text)
      if (b.action === 'add') {
        snap.entries.push(b.content || '')
        snap.used += (b.content || '').length
        out.message = 'Entry added.'
      } else if (b.action === 'replace' || b.action === 'remove') {
        if (at < 0) return send({ result: { success: false, error: `No entry matched '${b.old_text}'.` }, [b.target]: snap })
        snap.used += (b.action === 'replace' ? (b.content || '').length : 0) - b.old_text.length
        if (b.action === 'replace') (snap.entries[at] = b.content || ''), (out.message = 'Entry replaced.'), (out.replaced_entry = b.old_text)
        else snap.entries.splice(at, 1), (out.message = 'Entry removed.'), (out.removed_entry = b.old_text)
      } else return send({ detail: 'action must be add, replace or remove' }, 400)
      return send({
        result: { ...out, usage: `${Math.round((snap.used / snap.limit) * 100)}% — ${snap.used}/${snap.limit} chars`, entry_count: snap.entries.length, note: 'Write saved. This update is complete — do not repeat it.' },
        [b.target]: snap
      })
    }
    if (p === '/api/plugins/hermes-mobile/memory') return send(memory)
    if (p === '/api/status') return send({ version: '0.21.5', components: { dashboard: { status: 'ok' } } })
    if (p === '/api/plugins/hermes-mobile/checkpoints' && req.method === 'GET') {
      const d = new Date(Date.now() - 600_000).toISOString()
      return send({
        folders: [
          { workdir: '/root/projects/site', pruned: 1, last: Date.now() / 1000 - 600, snapshots: [{ id: 't1@' + d, hash: 'abc1234567', date: d, reason: 'before patch', files: ['app.py', 'notes.md'] }] },
          { workdir: '/root/.hermes/cache/scratch', pruned: 0, last: Date.now() / 1000 - 600, snapshots: [{ id: 't2@' + d, hash: 'def7654321', date: d, reason: 'before write_file', files: ['x.txt'] }] }
        ]
      })
    }
    if (p === '/api/plugins/hermes-mobile/checkpoints/diff')
      return send({
        files: [
          { file: 'app.py', status: 'modified', added: 1, removed: 1, diff: 'diff --git a/app.py b/app.py\n--- a/app.py\n+++ b/app.py\n@@ -1 +1 @@\n-old line\n+new line\n' },
          { file: 'notes.md', status: 'added', added: 2, removed: 0, diff: 'diff --git a/notes.md b/notes.md\nnew file mode 100644\n--- /dev/null\n+++ b/notes.md\n@@ -0,0 +1,2 @@\n+a\n+b\n' }
        ]
      })
    if (p === '/api/plugins/hermes-mobile/checkpoints/restore') {
      const b = JSON.parse(body || '{}')
      return send(b.file ? { ok: true, restored_to: 'abc12345', restored_files: [b.file], skipped_user_edits: [], skipped_oversize: [] } : { ok: true, restored_to: 'abc12345', restored_files: ['app.py', 'notes.md'], skipped_user_edits: [], skipped_oversize: [] })
    }
    if (p === '/api/plugins/hermes-mobile/checkpoints' && req.method === 'DELETE') return send({ ok: true })
    if (p === '/api/plugins/hermes-mobile/library') {
      const meta = ({ content, ...m }) => m
      if (req.method === 'POST') {
        const b = JSON.parse(body)
        const d = (canvasDocs[b.session] || []).find(x => x.id === b.id)
        if (!d) return send({ detail: 'no such document' }, 400)
        const item = { id: `lib-${Date.now()}`, title: d.title, type: d.type, lang: d.lang, category: (b.category || '').trim() || 'Unsorted', saved: Date.now() / 1000, chars: d.content.length, content: d.content, source: { session: b.session, doc: d.id } }
        libraryItems.unshift(item)
        return send(meta(item))
      }
      const categories = {}
      for (const i of libraryItems) categories[i.category] = (categories[i.category] || 0) + 1
      return send({ items: libraryItems.map(meta), categories })
    }
    if (p === '/api/plugins/hermes-mobile/library/item') {
      const id = req.method === 'PUT' ? JSON.parse(body).id : url.searchParams.get('id')
      const i = libraryItems.findIndex(x => x.id === id)
      if (req.method === 'DELETE') {
        if (i >= 0) libraryItems.splice(i, 1)
        return send({ ok: true })
      }
      if (i < 0) return send({ detail: 'no such item' }, 400)
      if (req.method === 'PUT') {
        const b = JSON.parse(body)
        if ((b.title || '').trim()) libraryItems[i].title = b.title.trim()
        if ((b.category || '').trim()) libraryItems[i].category = b.category.trim()
        const { content, ...m } = libraryItems[i]
        return send(m)
      }
      return send(libraryItems[i])
    }
    // Canvas gallery (plugin gallery.py): every chat's canvas documents, by type, searchable, with the chat.
    if (p === '/api/plugins/hermes-mobile/gallery') {
      const KIND = { html: 'HTML', markdown: 'Markdown', code: 'Code', text: 'Text', json: 'JSON', csv: 'CSV', svg: 'SVG', mermaid: 'Mermaid' }
      const words = (url.searchParams.get('q') || '').toLowerCase().split(/\s+/).filter(Boolean)
      const plain = d => (d.type === 'html' ? d.content.replace(/<[^>]+>/g, ' ') : d.content.replace(/[#*_`>-]+/g, ' ')).replace(/\s+/g, ' ').trim()
      const chat = sid => {
        const s = allSessions.find(x => x.id === sid)
        return s ? { profile: 'default', title: s.title, last_active: s.started_at, archived: false } : null
      }
      const items = []
      for (const [sid, docs] of Object.entries(canvasDocs))
        for (const d of docs) {
          if (words.length && !words.every(w => `${d.title} ${plain(d)}`.toLowerCase().includes(w))) continue
          items.push({ key: `${sid}/${d.id}`, session: sid, doc: d.id, title: d.title, type: d.type, lang: d.lang, category: KIND[d.type] || 'Text', created: d.created, updated: d.updated, by: d.by, chars: d.content.length, snippet: plain(d).slice(0, 140), chat: chat(sid) })
        }
      for (const m of libraryItems) {
        const d = { type: m.type, content: m.content }
        if (words.length && !words.every(w => `${m.title} ${plain(d)}`.toLowerCase().includes(w))) continue
        const sid = (m.source && m.source.session) || ''
        items.push({ key: `lib:${m.id}`, session: sid, doc: '', lib: m.id, saved: true, title: m.title, type: m.type, lang: m.lang, category: KIND[m.type] || 'Text', created: m.saved, updated: m.saved, by: '', chars: m.chars, snippet: plain(d).slice(0, 140), chat: sid ? chat(sid) : null })
      }
      items.sort((a, b) => b.updated - a.updated)
      const categories = {}
      for (const k of Object.values(KIND)) for (const i of items) if (i.category === k) categories[k] = (categories[k] || 0) + 1
      return send({ items, categories })
    }
    if (p === '/api/plugins/hermes-mobile/canvas') {
      const s = url.searchParams.get('session')
      const list = () => send({ docs: (canvasDocs[s] || []).map(({ content, ...m }) => m) })
      if (s === 's-slowstart') return void setTimeout(list, 700) // long enough to see the panel's loading state
      return list()
    }
    if (p === '/api/plugins/hermes-mobile/canvas/doc') {
      if (req.method === 'GET') {
        const d = (canvasDocs[url.searchParams.get('session')] || []).find(x => x.id === url.searchParams.get('id'))
        const s = url.searchParams.get('session')
        return d ? send({ ...d, versions: histOf(s, d).map(({ content, ...v }) => v) }) : send({ detail: `no document '${url.searchParams.get('id')}' on this canvas` }, 400)
      }
      if (req.method === 'POST') {
        const b = JSON.parse(body)
        const d = { id: `d${Date.now()}`, title: b.title, type: b.type || 'markdown', lang: b.lang || '', rev: 1, updated: Date.now() / 1000, by: 'user', chars: (b.content || '').length, path: '', created: Date.now() / 1000, content: b.content || '' }
        ;(canvasDocs[b.session] ||= []).push(d)
        histOf(b.session, d)
        return send(d)
      }
      if (req.method === 'DELETE') {
        const s = url.searchParams.get('session')
        canvasDocs[s] = (canvasDocs[s] || []).filter(x => x.id !== url.searchParams.get('id'))
        return send({ ok: true })
      }
      if (req.method === 'PUT') {
        const b = JSON.parse(body)
        const d = (canvasDocs[b.session] || []).find(x => x.id === b.id)
        if (!d) return send({ detail: 'not found' }, 404)
        histOf(b.session, d)
        d.content = b.content
        d.chars = d.content.length
        d.rev++
        d.updated = Date.now() / 1000
        d.by = 'user'
        canvasHist.get(`${b.session}/${d.id}`).push({ rev: d.rev, at: d.updated, by: 'user', note: b.note || '', content: d.content })
        return send(d) // like the plugin: the whole document, content included
      }
    }
    if (p.startsWith('/api/plugins/hermes-mobile/canvas/') && p !== '/api/plugins/hermes-mobile/canvas/doc') {
      // version / restore / rename / open-file / save-file (plugin canvas.py): errors are 400 with a detail.
      const b = req.method === 'POST' ? JSON.parse(body || '{}') : {}
      const s = b.session ?? url.searchParams.get('session')
      const id = b.id ?? url.searchParams.get('id')
      const d = (canvasDocs[s] || []).find(x => x.id === id)
      const sub = p.split('/').pop()
      if (sub === 'open-file') {
        // The phone's file (the mock has none): text made up from its name, linked to the path.
        const name = String(b.path || '').split('/').pop() || 'file'
        const ext = (name.split('.').pop() || '').toLowerCase()
        const text = `Contents of ${name}\n`
        const nd = { id: `d${Date.now()}`, title: name, type: { md: 'markdown', html: 'html', json: 'json', csv: 'csv', svg: 'svg' }[ext] || 'text', lang: '', rev: 1, updated: Date.now() / 1000, by: 'user', chars: text.length, path: b.path, created: Date.now() / 1000, content: text }
        ;(canvasDocs[s] ||= []).push(nd)
        histOf(s, nd)
        return send(nd)
      }
      if (!d) return send({ detail: `no document '${id}' on this canvas` }, 400)
      if (sub === 'version') {
        const v = histOf(s, d).find(x => x.rev === +url.searchParams.get('rev'))
        return v ? send(v) : send({ detail: `revision ${url.searchParams.get('rev')} is no longer kept` }, 400)
      }
      if (sub === 'rename') {
        d.title = String(b.title || '').trim().slice(0, 120) || d.title
        d.updated = Date.now() / 1000
        return send(d)
      }
      if (sub === 'restore') {
        const v = histOf(s, d).find(x => x.rev === +b.rev)
        if (!v) return send({ detail: `revision ${b.rev} is no longer kept` }, 400)
        d.content = v.content
        d.chars = d.content.length
        d.rev++
        d.updated = Date.now() / 1000
        d.by = 'user'
        canvasHist.get(`${s}/${d.id}`).push({ rev: d.rev, at: d.updated, by: 'user', note: `restored revision ${b.rev}`, content: d.content })
        return send(d)
      }
      if (sub === 'save-file') return d.path ? send({ path: d.path, chars: d.content.length }) : send({ detail: "this document isn't linked to a file" }, 400)
    }
    return send({})
  })
})

function safeJson(t) {
  try {
    return JSON.parse(t)
  } catch {
    return t
  }
}

const wss = new WebSocketServer({ server, path: '/api/ws', verifyClient: () => Date.now() > refuseUntil })
let seq = 0
let created = 0
// The one chat with a goal ('rt-goal'): session.control changes it, session.control.read and .update report it.
const goalState = { rt: 'rt-goal', g: null }
const goalFor = rt => (rt === goalState.rt ? goalState.g : null)
const slowTurns = new Map() // runtime id → { timers, row, text } of a running 'slow reply'
// What the pinned Hermes puts in a subagent event (tools/hermes-contract compares it).
const TOOLSETS = ['browser', 'canvas', 'code_execution', 'computer_use', 'connections', 'file', 'image_gen', 'project', 'session_search', 'skills', 'terminal', 'todo', 'tts', 'vision', 'web']
// The usage object of Hermes's message.complete / session.usage after `n` model calls.
const usageN = n => ({ model: 'mock-model', input: 120 * n, output: 20 * n, reasoning: 0, prompt: 120 * n, completion: 20 * n, total: 140 * n, calls: n, context_used: 120, context_max: 256000, context_percent: 0, context_source: 'provider_usage', context_estimated: false, compressions: 0, avg_latency_s: 1, avg_tps: 20, active_subagents: 0 })
const CHAT_INFO = { model: 'mock-model', provider: 'mock' }
wss.on('connection', ws => {
  const event = (type, session_id, payload) => {
    // The plugin's /tool-result reads the output the tool call stored.
    if (type === 'tool.complete' && payload && payload.tool_id) toolResults.set(payload.tool_id, { tool_name: payload.name, content: typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result ?? null) })
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, session_id, payload } }))
  }
  const later = (ms, fn) => setTimeout(fn, ms)
  const live = fn => () => ws.readyState === 1 && fn()
  // Plays [type, payload] events 40 ms apart from `t` ms on; returns the time of the last one.
  const play = (sid, steps, t = 50, gap = 40) => {
    for (const [type, payload] of steps) later((t += gap), live(() => event(type, sid, payload)))
    return t
  }
  // The end of a model turn as the pinned Hermes sends it: reasoning, the answer in two chunks, reasoning.available,
  // message.complete (usage, status, persisted_turn: the rows stored for the turn) and the session.info after it.
  const ending = (text, calls, row, { status = 'complete', rows = 4 } = {}) => {
    const cut = Math.max(1, Math.floor(text.length / 2))
    return [
      ['thinking.delta', { text: '(-_-) computing...' }],
      ['reasoning.delta', { text: 'I have the result, ' }],
      ['reasoning.delta', { text: 'now I can answer.' }],
      ['message.delta', { text: '\n\n' + text.slice(0, cut) }],
      ['message.delta', { text: text.slice(cut) }],
      ['reasoning.available', { text }],
      ['message.complete', { text, usage: usageN(calls), status, persisted_turn: { row_ids: Array.from({ length: rows }, (_, i) => row + i), complete: true, user_row_id: row, final_assistant_row_id: row + rows - 1 }, reasoning: 'I have the result, now I can answer.' }],
      ['session.info', CHAT_INFO]
    ]
  }
  // The start of a model turn that calls a tool: message.start, a little reasoning, tool.generating, tool.start.
  const beginning = (name, tool_id, context, args, generating = name) => [
    ['message.start', undefined],
    ['thinking.delta', { text: '(o_o) processing...' }],
    ['reasoning.delta', { text: 'Let me do ' }],
    ['reasoning.delta', { text: 'this first.' }],
    ['tool.generating', { name: generating }],
    ['tool.start', { tool_id, name, context, args }]
  ]
  // Server → client requests (approval, clarify) the turn waits on: request id → what to play once the app answers.
  const waiting = new Map()

  let threeSid = ''
  ws.on('message', raw => {
    const msg = JSON.parse(String(raw))
    if (msg.method === undefined) {
      log({ answer: msg.id, result: msg.result, error: msg.error }) // response to a server request
      // A turn that waits on the answer goes on from here (approval, clarify): see runApproval / runClarify.
      const next = waiting.get(msg.id)
      if (next) {
        waiting.delete(msg.id)
        later(100, live(() => next(msg.result ?? {})))
      }
      // The three-question turn ends once its questions are answered.
      if (msg.id === 'srv-clarify-3') later(100, () => event('message.complete', threeSid, { text: 'Thanks.' }))
      return
    }
    const { id, method, params = {} } = msg
    log({ rpc: method, params })
    const reply = result => ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }))
    switch (method) {
      case 'session.list':
        return reply({ sessions: allSessions.slice(0, params.limit || 50) })
      case 'profiles.list':
        return reply({ profiles: [{ name: 'default', model: 'mock-model' }] })
      case 'session.create': {
        // Like Hermes: the agent is built in the background and announced by session.info. A model in the
        // params is the chat's own model from the start (a per-session override).
        const n = (params.model ? `-m${++created}` : '') + (draftGen ? `-d${draftGen}` : '')
        const rt = `rt-new${n}`, model = params.model || 'mock-model'
        later(600, () => { log({ built: rt }); event('session.info', rt, { model, provider: params.provider || 'mock' }) })
        // info names a provider only when the params did (a per-session override), like Hermes.
        return reply({ session_id: rt, stored_session_id: `s-new${n}`, info: { model, ...(params.provider ? { provider: params.provider } : {}) }, messages: [] })
      }
      case 'setup.status':
        return reply({ provider_configured: providerConfigured || (looseStatus && !!params.profile), ready: true })
      case 'setup.runtime_check':
        return reply(providerConfigured ? { ok: true } : { ok: false, error: 'Hermes is not connected to any AI provider yet.' })
      case 'model.options':
        return reply({ model: 'mock-model', provider: 'mock', providers: [{ slug: 'mock', name: 'Mock', authenticated: true, models: ['mock-model', 'mock-sonnet'] }] })
      case 'session.resume': {
        // Like Hermes's resume reply: the stored id comes back as resumed / session_key (no stored_session_id) and
        // info has no title (the app takes it from session.list). tools/hermes-contract checks this against Hermes.
        const sid = params.session_id
        if (goneDraft(sid)) return ws.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code: 4007, message: 'session not found' } }))
        if (sid === 's-run') {
          reply({
            session_id: 'rt-run',
            resumed: 's-run',
            session_key: 's-run',
            running: true,
            info: { model: 'mock-model' },
            messages: [
              { role: 'user', text: 'First question', row_id: 1 },
              { role: 'assistant', text: 'First answer' }
            ],
            turn_started_at: Date.now() / 1000 - 75,
            inflight: { user: 'Explain streams', assistant: 'Streams are a sequence of', streaming: true },
            todo_state: { todos: [{ id: '1', content: 'Read', status: 'completed' }, { id: '2', content: 'Write', status: 'in_progress' }], revision: 2 }
          })
          later(700, () => event('message.delta', 'rt-run', { text: ' values over time.' }))
          later(1200, () => event('message.complete', 'rt-run', { text: 'Streams are a sequence of values over time.' }))
          return
        }
        if (sid === 's-goal') {
          // A chat with a goal set: the goal line shows under the chat (session.control.read answers it).
          goalState.g = { title: 'Ship it', status: 'active', turns_used: 3, max_turns: 20, contract: { outcome: 'Login works' }, subgoals: ['tests'], gates: [] }
          return reply({ session_id: 'rt-goal', resumed: sid, session_key: sid, info: { model: 'mock-model' }, messages: [
            { role: 'user', text: 'work on it', row_id: 1 }, { role: 'assistant', text: 'answer s-goal' }] })
        }
        if (sid === 's-card') {
          // A saved chat holding a Query() card (same code as LIVE below).
          const code = ['root = Card([head, table])', 'head = CardHeader("Search results")', 'results = Query("web_search", {query: "openui"}, {data: {web: []}})', 'table = Table([Col("Title", results.data.web.title), Col("Link", results.data.web.url)])'].join('\n')
          return reply({ session_id: 'rt-card', resumed: sid, session_key: sid, info: { model: 'mock-model' }, messages: [
            { role: 'user', text: 'show live ui', row_id: 1 }, { role: 'assistant', text: 'Live:\n\n```openui-lang\n' + code + '\n```' }] })
        }
        if (sid === 's-stale') {
          // Hermes no longer holds the first question live (row 999 answers 4018 to an edit).
          return reply({ session_id: 'rt-stale', resumed: sid, session_key: sid, info: { model: 'mock-model' }, messages: [
            { role: 'user', text: 'stale first question', row_id: 999 }, { role: 'assistant', text: 'stale first answer' },
            { role: 'user', text: 'stale second question', row_id: 1000 }, { role: 'assistant', text: 'stale second answer' }] })
        }
        if (sid === 's-panel') {
          const card = ['root = Card([head, intro])', 'head = CardHeader("Swipe card")', 'intro = TextContent("Inside a card.")'].join('\n')
          return reply({ session_id: 'rt-panel', resumed: sid, session_key: sid, info: { model: 'mock-model' }, messages: [
            { role: 'user', text: 'show me things', row_id: 1 },
            { role: 'assistant', text: 'Plain words to swipe on.\n\n```js\nconst a = 1\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```openui-lang\n' + card + '\n```\n\nMore plain words.' }] })
        }
        if (sid === 's-wide') {
          // Text a real chat has: a long unbroken path / URL in plain text and in inline code.
          const url = 'https://example.com/' + 'segment-'.repeat(30) + 'end'
          return reply({ session_id: 'rt-wide', resumed: sid, session_key: sid, info: { model: 'mock-model' }, messages: [
            { role: 'user', text: 'where is it', row_id: 1 },
            { role: 'assistant', text: 'Plain words to swipe on.\n\nThe file is ' + url + ' and also `' + '/very/long/path/'.repeat(12) + 'file.txt` here.\n\nMore plain words.' }] })
        }
        if (sid === 's-slowstart') {
          // Slow start-up resume: the user starts a new chat while this is loading.
          return later(2500, () => reply({ session_id: 'rt-slowstart', resumed: sid, session_key: sid, info: { model: 'mock-model' }, messages: [{ role: 'user', text: 'old question', row_id: 1 }, { role: 'assistant', text: 'old answer' }] }))
        }
        if (sid === 's-scrub') {
          // 30 questions with tall answers: the chat scrubber (rail with one tick per question) shows.
          const messages = []
          for (let i = 1; i <= 30; i++) messages.push({ role: 'user', text: `question ${i}`, row_id: i }, { role: 'assistant', text: `answer ${i}\n\n` + 'line\n\n'.repeat(15) })
          return reply({ session_id: 'rt-s-scrub', resumed: sid, session_key: sid, info: { model: 'mock-model' }, messages })
        }
        if (sid === 's-visit') {
          // Two tall answers; the second question was sent at ...120 s (after a test sets the last visit to ...100 s).
          const tall = 'line\n\n'.repeat(60)
          return reply({ session_id: 'rt-s-visit', resumed: sid, session_key: sid, info: { model: 'mock-model' }, messages: [
            { role: 'user', text: 'visit question 1', row_id: 1, timestamp: 1790000000 }, { role: 'assistant', text: 'visit answer 1\n\n' + tall, timestamp: 1790000060 },
            { role: 'user', text: 'visit question 2', row_id: 3, timestamp: 1790000120 }, { role: 'assistant', text: 'visit answer 2\n\n' + tall, timestamp: 1790000180 }] })
        }
        if (sid === 's-long') {
          // 150 turns: the app should draw only the end and load earlier turns on scroll.
          const messages = []
          for (let i = 0; i < 150; i++) messages.push({ role: 'user', text: `question ${i}`, row_id: i * 2 + 1 }, { role: 'assistant', text: `**answer ${i}**\n\n- point a\n- point b` })
          return reply({ session_id: 'rt-s-long', resumed: sid, session_key: sid, info: { model: 'mock-model' }, messages })
        }
        const res = { session_id: runtimeGen ? `rt${runtimeGen}-${sid}` : `rt-${sid}`, resumed: sid, session_key: sid, info: { model: 'mock-model' }, messages: [{ role: 'user', text: `hello ${sid}`, row_id: 1, timestamp: 1790000000 }, { role: 'assistant', text: `answer ${sid}`, timestamp: 1790000060 }] }
        // A slow phone: the cached copy must be on screen long before this answer.
        if (sid === 's-slow') return later(1500, () => reply(res))
        return reply(res)
      }
      case 'image.attach_bytes':
        return reply({ attached: true, name: params.filename, path: `/root/.hermes/images/${params.filename}` })
      case 'image.attach':
        return reply({ attached: true, name: params.path.split('/').pop(), path: params.path })
      case 'image.detach':
        return reply({ detached: true, count: 0 })
      case 'config.set':
        if (params.key === 'yolo') {
          // Like Hermes's _set_yolo: flips this session's flag in-process and announces it with session.info.
          const on = params.value === '1'
          later(50, () => event('session.info', params.session_id, { yolo: on }))
          return reply({ key: 'yolo', value: on ? '1' : '0', scope: 'session' })
        }
        if (params.key === 'fast') {
          // Like Hermes's _set_fast: "toggle"/"on"/"off" → the new mode, "fast" or "normal".
          fastMode = params.value === 'toggle' ? (fastMode === 'fast' ? 'normal' : 'fast') : ['on', 'fast'].includes(params.value) ? 'fast' : 'normal'
          return reply({ key: 'fast', value: fastMode })
        }
        return reply({ key: params.key, value: params.value })
      case 'file.attach':
        return reply({ attached: true, name: params.name, path: `/root/ws/${params.name}`, ref_path: `ws/${params.name}`, ref_text: `@file:ws/${params.name}`, uploaded: true })
      case 'prompt.submit': {
        if (params.truncate_before_row_id === 999)
          return ws.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code: 4018, message: 'target user message is no longer in session history' } }))
        const row = 10 + seq++
        reply({ status: 'streaming', user_row_id: row, ...(params.confirm_truncate ? { survivor_user_row_ids: [] } : {}) })
        const sid = params.session_id
        if (/^run the thing$/.test(params.text)) {
          // Hermes runs a command it must ask about: tool.start, the approval request (a server → client request) and nothing until
          // the app answers; then tool.complete (approved: the output; denied: "BLOCKED"), the reply and message.complete.
          const tid = `call_run${row}`, args = { command: 'rm -rf /tmp/x' }
          const t = play(sid, beginning('terminal', tid, args.command, args))
          later(t + 40, live(() => {
            const started = Date.now()
            waiting.set('srv-approval-1', res => {
              const result = res.choice === 'deny' || res.choice === undefined
                ? { output: '', exit_code: -1, error: 'BLOCKED: Command denied by user. The user has NOT consented to this action. Do NOT retry this command, do NOT rephrase it, and do NOT attempt the same outcome via a different command. Stop the current workflow and wait for the user to respond before taking any further destructive or irreversible action.', status: 'blocked', user_summary: 'You denied this command — it did not run.' }
                : { output: '', exit_code: 0, error: null, approval: 'Command required approval (recursive delete) and was approved by the user.' }
              play(sid, [['tool.complete', { tool_id: tid, name: 'terminal', args, duration_s: (Date.now() - started) / 1000, result }], ...ending('Ran the thing.', 2, row)], 0)
            })
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'srv-approval-1', method: 'approval', params: { session_id: sid, command: args.command, pattern_key: 'recursive delete', pattern_keys: ['recursive delete'], description: 'delete the temp folder', allow_permanent: true, allow_session: true, request_id: `req-${row}`, choices: ['once', 'session', 'always', 'deny'] } }))
          }))
          return
        }
        if (/^run the long thing$/.test(params.text)) {
          // Hermes's security scan can repeat one finding many times; the answer buttons must stay on screen.
          const f = '[HIGH] Nested executable body could not be resolved: the shell will execute a grouped value, but the scanner cannot prove the complete body.'
          const description = 'Security scan — ' + Array(20).fill(f).join('; ') + '; ' + 'a very long warning that no dedupe can shorten. '.repeat(40)
          later(100, () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'srv-approval-long', method: 'approval', params: { session_id: sid, command: 'echo ' + 'x'.repeat(3000), description, allow_session: true } })))
          return
        }
        if (/^ask me$/.test(params.text)) {
          // Hermes asks a question (the clarify tool: tool.start, then a server → client request) and waits; the answer becomes
          // the tool's result and the turn goes on.
          const tid = `call_ask${row}`, args = { question: 'Which colour?', choices: ['Red', 'Blue'] }
          const t = play(sid, beginning('clarify', tid, args.question, args))
          later(t + 40, live(() => {
            const started = Date.now()
            waiting.set('srv-clarify-1', res => {
              const result = { question: args.question, choices_offered: args.choices, user_response: res.answer ?? '' }
              play(sid, [['tool.complete', { tool_id: tid, name: 'clarify', args, duration_s: (Date.now() - started) / 1000, result }], ...ending('You picked a colour.', 2, row)], 0)
            })
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'srv-clarify-1', method: 'clarify', params: { session_id: sid, question: args.question, choices: args.choices } }))
          }))
          return
        }
        if (/^plan it$/.test(params.text)) {
          // The task list: the tool streams as the generic "tool_call" (a deferred tool), tool.complete carries the list and
          // its revision, then todo.updated.
          const tid = `call_plan${row}`
          const todos = [{ id: '1', content: 'Read', status: 'completed' }, { id: '2', content: 'Write', status: 'in_progress' }]
          const args = { todos }
          play(sid, [
            ...beginning('todo_list', tid, 'planning 2 task(s)', args, 'tool_call'),
            ['tool.complete', { tool_id: tid, name: 'todo_list', args, duration_s: 0.01, result: { todos, revision: 1, summary: { total: 2, pending: 0, in_progress: 1, completed: 1, cancelled: 0 } }, todos, revision: 1 }],
            ['todo.updated', { todos, revision: 1 }],
            ...ending('Planned.', 2, row)
          ])
          return
        }
        if (/^delegate it$/.test(params.text)) {
          // A background sub-agent: delegate_task returns "dispatched" at once, the sub-agent works (subagent.*), and its result
          // comes back as a second turn (another message.start … message.complete) after the first one ends.
          const tid = `call_deleg${row}`, goal = 'Count to three', args = { goal, context: 'Answer with the three words only.' }
          const sub = { goal, task_count: 1, task_index: 0, subagent_id: 'sa-0-mock', child_session_id: 'mock-child', delegation_id: 'deleg_mock', depth: 0, model: 'mock-model', tool_count: 0, toolsets: TOOLSETS }
          const dispatched = { status: 'dispatched', mode: 'background', count: 1, delegation_id: 'deleg_mock', goals: [goal], note: 'Subagent is running in the background; its full result re-enters the conversation as a new message when it finishes. Results are delivered only after you END YOUR TURN: do anything that does not depend on it, then stop with a one-line status. Do not poll its transcript or artifacts to wait for it.', subagent_ids: ['sa-0-mock'], control_hint: "While a child runs you can orchestrate it live with this same tool: delegate_task(action='list') to see live children, action='steer' with subagent_id + message to redirect one, action='stop' with subagent_id to end one early.", live_transcripts: ['/root/.hermes/cache/delegation/live/deleg_mock/task-0.log'], live_transcripts_hint: 'Each subagent streams a human-readable transcript of its operations to the file listed above (append-only, one per task). Read or `tail -f` these paths at any time to watch a child work while it runs.' }
          const t = play(sid, [
            ...beginning('delegate_task', tid, goal, args),
            ['subagent.start', { ...sub, text: goal }],
            ['tool.complete', { tool_id: tid, name: 'delegate_task', args, duration_s: 0.3, result: dispatched }],
            ['subagent.thinking', { ...sub, text: '(｡•́︿•̀｡) reasoning...' }],
            ['subagent.thinking', { ...sub, text: 'One, two, three.' }],
            ['subagent.complete', { ...sub, input_tokens: 120, output_tokens: 20, reasoning_tokens: 0, api_calls: 1, text: 'One, two, three.', status: 'completed', summary: 'One, two, three.', duration_seconds: 0.3 }],
            ['status.update', { kind: 'process', text: `Subagent Task Completed: ${goal}` }],
            ...ending('The helper counted.', 2, row)
          ])
          // The sub-agent's result re-enters the chat as a message of its own, which the model answers.
          play(sid, [
            ['message.start', undefined],
            ['reasoning.available', { text: 'One, two, three.' }],
            ['message.complete', { text: 'One, two, three.', usage: usageN(3), status: 'complete', persisted_turn: { row_ids: [row + 5, row + 6], complete: true, user_row_id: row + 5, final_assistant_row_id: row + 6 } }],
            ['session.info', CHAT_INFO]
          ], t + 200)
          return
        }
        if (/^ask me three$/.test(params.text)) {
          // Three questions at once: the sheet shows them one at a time.
          threeSid = sid
          const questions = [{ qid: 'a', question: 'Colour?', choices: ['Red', 'Blue'] }, { qid: 'b', question: 'Size?', choices: ['S', 'M'] }, { qid: 'c', question: 'Notes?', choices: null }]
          later(100, () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'srv-clarify-3', method: 'clarify', params: { session_id: sid, questions } })))
          return
        }
        if (/^slow reply$/.test(params.text)) {
          // A reply that takes 1.5 s, so a follow-up can be queued meanwhile; Stop (session.interrupt) ends it early.
          const turn = { row, text: '', timers: [] }
          turn.timers = [
            later(100, live(() => event('message.start', sid, {}))),
            later(300, live(() => ((turn.text = 'Slow done.'), event('message.delta', sid, { text: 'Slow done.' })))),
            later(1500, live(() => (slowTurns.delete(sid), event('message.complete', sid, { text: 'Slow done.' }))))
          ]
          slowTurns.set(sid, turn)
          return
        }
        if (/^(next one|c|d|e)$/.test(params.text)) {
          // The follow-ups the queue tests send: answered at once.
          later(100, () => ws.readyState === 1 && event('message.complete', sid, { text: `Queued ${params.text} done.` }))
          return
        }
        if (/^read the note$/.test(params.text)) {
          // One whole turn with the event types and payload shapes of the pinned Hermes (tools/hermes-contract sends this
          // prompt to the real Hermes with a fake model: reasoning, one read_file call, reasoning, the answer in chunks).
          // A tool result is the parsed JSON in `result` (the real Hermes adds `result_text` only with display.tool_progress verbose, which
          // the app never sets, so no flow here sends it).
          const stored = sid.startsWith('rt-new') ? sid.replace(/^rt-/, 's-') : sid.replace(/^rt-/, '') // the chat's stored id
          const args = { path: '/root/note.txt' }
          const usage = n => ({ model: 'mock-model', input: 120 * n, output: 20 * n, reasoning: 0, prompt: 120 * n, completion: 20 * n, total: 140 * n, calls: n, context_used: 120, context_max: 256000, context_percent: 0, context_source: 'provider_usage', context_estimated: false, compressions: 0, avg_latency_s: 1, avg_tps: 20, active_subagents: 0 })
          const steps = [
            ['message.start', undefined],
            // Hermes names the chat after its first message, then again once the title model has answered.
            ['session.title', { session_id: stored, title: 'read the note' }],
            ['thinking.delta', { text: '(o_o) processing...' }],
            ['reasoning.delta', { text: 'Let me read ' }],
            ['reasoning.delta', { text: 'the note first.' }],
            ['tool.generating', { name: 'read_file' }],
            ['tool.start', { tool_id: 'call_note', name: 'read_file', context: 'note.txt', args }],
            ['tool.complete', { tool_id: 'call_note', name: 'read_file', args, duration_s: 0.04, result: { content: '1|contract note', total_lines: 1, file_size: 14, truncated: false, is_binary: false, is_image: false, not_found: false } }],
            ['thinking.delta', { text: '(-_-) computing...' }],
            ['reasoning.delta', { text: 'I have the note, ' }],
            ['reasoning.delta', { text: 'now I can answer.' }],
            ['message.delta', { text: '\n\nThe note says: ' }],
            ['message.delta', { text: 'contract note. ' }],
            ['session.usage', { usage: usage(1) }],
            ['message.delta', { text: 'Nothing else ' }],
            ['message.delta', { text: 'to report.' }],
            ['reasoning.available', { text: 'The note says: contract note. Nothing else to report.' }],
            ['session.title', { session_id: stored, title: 'Contract title' }],
            ['message.complete', { text: 'The note says: contract note. Nothing else to report.', usage: usage(2), status: 'complete', persisted_turn: { row_ids: [3, 4, 5, 6], complete: true, user_row_id: 3, final_assistant_row_id: 6 }, reasoning: 'I have the note, now I can answer.' }],
            ['session.info', { model: 'mock-model', provider: 'mock' }]
          ]
          let t = 50
          for (const [type, payload] of steps) later((t += 40), live(() => (payload === undefined ? ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, session_id: sid } })) : event(type, sid, payload))))
          return
        }
        if (/^use tools$/.test(params.text)) {
          // Four tool calls (with reasoning between two of them), then the answer: the app folds them into one line.
          let t = 50
          // Each result is the parsed JSON of the tool's output in `result` (shapes of the real tools), never `result_text`.
          const calls = [
            ['terminal', { command: 'echo 0' }, { output: 'out 0', exit_code: 0, error: null }],
            ['read_file', { path: '/root/note.txt' }, { content: '1|out 1', total_lines: 1, file_size: 7, truncated: false, is_binary: false, is_image: false, not_found: false }],
            ['search_files', { pattern: 'out', path: '/root' }, { total_count: 1, matches: [{ path: '/root/note.txt', line: 1, content: 'out 2' }] }],
            ['terminal', { command: 'echo 3' }, { output: 'out 3', exit_code: 0, error: null }]
          ]
          for (const [i, [name, args, result]] of calls.entries()) {
            later((t += 40), () => event('tool.start', sid, { tool_id: `call_${i}`, name, context: `step ${i}`, args }))
            later((t += 40), () => event('tool.complete', sid, { tool_id: `call_${i}`, name, args, duration_s: 1.5, result }))
            if (i === 1) later((t += 20), () => event('reasoning.delta', sid, { text: 'thinking between calls' }))
          }
          later((t += 60), () => event('message.start', sid, {}))
          later((t += 40), () => event('message.complete', sid, { text: 'All four done.' }))
          return
        }
        if (/^edit files$/.test(params.text)) {
          // Two file edits (a write and a patch) with their inline diffs, then the answer: the turn ends with a changes card.
          const edits = [
            ['write_file', { path: '/root/projects/site/a.txt', content: 'x\ny' }, '--- a/a.txt\n+++ b/a.txt\n@@ -0,0 +1,2 @@\n+x\n+y',
              { bytes_written: 3, dirs_created: true, verified: true, lint: { status: 'skipped', message: 'No linter for .txt files' }, resolved_path: '/root/projects/site/a.txt', files_modified: ['/root/projects/site/a.txt'] }],
            ['patch', { path: '/root/projects/site/b.txt', old_string: 'old', new_string: 'new' }, '--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-old\n+new',
              { success: true, diff: '--- a//root/projects/site/b.txt\n+++ b//root/projects/site/b.txt\n@@ -1 +1 @@\n-old\n+new', files_modified: ['/root/projects/site/b.txt'], lint: { status: 'skipped', message: 'No linter for .txt files' }, resolved_path: '/root/projects/site/b.txt' }]
          ]
          const steps = [['message.start', undefined]]
          for (const [i, [name, args, diff, result]] of edits.entries())
            steps.push(['tool.generating', { name }], ['tool.start', { tool_id: `call_ed${i}`, name, context: args.path, args }], ['tool.complete', { tool_id: `call_ed${i}`, name, args, duration_s: 0.2, result, inline_diff: diff }])
          play(sid, [...steps, ...ending('Edited.', 3, row, { rows: 6 })])
          return
        }
        if (/^wait a while$/.test(params.text)) {
          // One long command (nothing streams for 7 s): what the app polls meanwhile is what costs battery.
          later(50, () => event('tool.start', sid, { tool_id: 'call_wait', name: 'terminal', context: 'sleep 7', args: { command: 'sleep 7' } }))
          later(7000, () => event('tool.complete', sid, { tool_id: 'call_wait', name: 'terminal', duration_s: 7, args: { command: 'sleep 7' }, result: { output: '', exit_code: 0, error: null } }))
          later(7050, () => event('message.start', sid, {}))
          later(7100, () => event('message.complete', sid, { text: 'Waited.' }))
          return
        }
        if (/^write canvas$/.test(params.text)) {
          // A plugin tool streams under the generic name for a while (the model writing a big document), then runs.
          later(50, () => event('tool.generating', sid, { name: 'tool_call' }))
          later(2600, () => event('tool.start', sid, { tool_id: 'call_cv', name: 'canvas', args: { action: 'create', title: 'Plan', content: '# Plan\n\nStep one' } }))
          later(3600, () => {
            const stored = sid.replace(/^rt-/, '')
            const d = { id: 'dplan', title: 'Plan', type: 'markdown', lang: '', rev: 1, updated: Date.now() / 1000, by: 'agent', chars: 18, path: '', created: Date.now() / 1000, content: '# Plan\n\nStep one' }
            ;(canvasDocs[stored] ||= []).push(d)
            event('tool.complete', sid, { tool_id: 'call_cv', name: 'canvas', duration_s: 0.1, args: { action: 'create', title: 'Plan', content: '# Plan\n\nStep one' }, result: { ok: true, id: 'dplan', shown: true } })
          })
          later(3800, () => event('message.start', sid, {}))
          later(3900, () => event('message.complete', sid, { text: 'Wrote the plan.' }))
          return
        }
        if (/^see https:\/\/example\.com\/b$/.test(params.text)) {
          // Web addresses in plain text: a tool's output and inline code in the reply.
          later(50, () => event('tool.start', sid, { tool_id: 'call_url', name: 'web_extract', context: 'example.com', args: { urls: ['https://example.com/a'] } }))
          later(100, () => event('tool.complete', sid, { tool_id: 'call_url', name: 'web_extract', duration_s: 0.2, args: { urls: ['https://example.com/a'] }, result: { results: [{ url: 'https://example.com/a', title: 'Example', content: 'fetched https://example.com/a.', error: null }] } }))
          later(150, () => event('message.start', sid, {}))
          later(200, () => event('message.complete', sid, { text: 'Read `https://example.com/c` and:\n\n```\nhttps://example.com/d\n```' }))
          return
        }
        // OpenUI cards (```openui-lang). Keep OUI identical to CODE in web/src/openui-entry.test.tsx.
        const OUI = [
          'root = Card([head, intro, plans, form, more])',
          'head = CardHeader("Pick a plan", "Two options")',
          'intro = TextContent("Both include **support**.")',
          'plans = Buttons([a, b], "row")',
          'a = Button("Option A", @ToAssistant("Pick A"), "primary")',
          'b = Button("Option B", @ToAssistant("Pick B"), "secondary")',
          'form = Form("contact", formBtns, [nameField])',
          'nameField = FormControl("Name", Input("name", "Your name", "text", {required: true}))',
          'formBtns = Buttons([send])',
          'send = Button("Send", @ToAssistant("Here are my details"), "primary")',
          'more = FollowUpBlock([f1])',
          'f1 = FollowUpItem("Compare both")'
        ].join('\n')
        if (/^show ui$/.test(params.text)) {
          later(100, () => event('message.start', sid, {}))
          later(200, () => event('message.complete', sid, { text: 'Here are the plans:\n\n```openui-lang\n' + OUI + '\n```\n\nPick one.' }))
          return
        }
        if (/^show form ui$/.test(params.text)) {
          // Keep identical to FORM in web/src/openui-form.test.tsx. A form whose picker is required.
          const FORM = [
            'root = Card([head, form])',
            'head = CardHeader("Book a table")',
            'form = Form("booking", formBtns, [nameField, sizeField, dayField])',
            'nameField = FormControl("Name", Input("name", "Your name", "text", {required: true}))',
            'sizeField = FormControl("Party size", Select("size", [SelectItem("2", "Two people"), SelectItem("4", "Four people")], "Choose size", {required: true}))',
            'dayField = FormControl("Day", DatePicker("day", "single", {required: true}))',
            'formBtns = Buttons([send])',
            'send = Button("Book", @ToAssistant("Book it"), "primary")'
          ].join('\n')
          later(100, () => event('message.start', sid, {}))
          later(200, () => event('message.complete', sid, { text: 'Book here:\n\n```openui-lang\n' + FORM + '\n```' }))
          return
        }
        if (/^show ui streaming$/.test(params.text)) {
          const full = 'Streaming plans:\n\n```openui-lang\n' + OUI + '\n```\n'
          const chunks = full.match(/[\s\S]{1,12}/g)
          let t = 100
          event('message.start', sid, {})
          for (const c of chunks) later((t += 20), () => event('message.delta', sid, { text: c }))
          later(t + 300, () => event('message.complete', sid, { text: full }))
          return
        }
        if (/^show live ui$/.test(params.text)) {
          // Keep identical to LIVE in web/src/openui-entry.test.tsx.
          const LIVE = [
            'root = Card([head, table])',
            'head = CardHeader("Search results")',
            'results = Query("web_search", {query: "openui"}, {data: {web: []}})',
            'table = Table([Col("Title", results.data.web.title), Col("Link", results.data.web.url)])'
          ].join('\n')
          later(100, () => event('message.start', sid, {}))
          later(200, () => event('message.complete', sid, { text: 'Live:\n\n```openui-lang\n' + LIVE + '\n```' }))
          return
        }
        if (/^show broken ui$/.test(params.text)) {
          later(100, () => event('message.start', sid, {}))
          later(200, () => event('message.complete', sid, { text: 'Oops:\n\n```openui-lang\nthis is not openui at all\n```' }))
          return
        }
        if (/^show html$/.test(params.text)) {
          later(100, () => event('message.start', sid, {}))
          later(200, () => event('message.complete', sid, { text: HTML_REPLY }))
          return
        }
        if (/^show html streaming$/.test(params.text)) {
          const chunks = HTML_REPLY.match(/[\s\S]{1,16}/g)
          let t = 100
          event('message.start', sid, {})
          for (const c of chunks) later((t += 40), () => event('message.delta', sid, { text: c }))
          later(t + 1500, () => event('message.complete', sid, { text: HTML_REPLY }))
          return
        }
        if (/^show diagram$/.test(params.text)) {
          later(100, () => event('message.start', sid, {}))
          later(200, () => event('message.complete', sid, { text: 'Flow:\n\n```mermaid\ngraph TD\n  A[Start] --> B[Done]\n```' }))
          return
        }
        if (/^link chats$/.test(params.text)) {
          later(100, () => event('message.start', sid, {}))
          later(200, () => event('message.complete', sid, { text: 'Earlier we talked in [Old chat](hermes-chat:s-6) and in 20260929_194711_8c8b2a, plus some more words to read out loud for the player.' }))
          return
        }
        if (/^show media$/.test(params.text)) {
          later(100, () => event('message.start', sid, {}))
          later(200, () => event('message.complete', sid, { text: 'Here it is:\n\nMEDIA:/root/pics/my pic.png' }))
          return
        }
        if (/long code/.test(params.text)) {
          // A long streamed reply with a code block, many small deltas.
          const code = Array.from({ length: 40 }, (_, i) => `line_${i} = compute(${i})`).join('\n')
          const full = `Here is the code:\n\n\`\`\`python\n${code}\n\`\`\`\n\nAnd some more explanation text after it. `.repeat(1) + 'Done.'
          const chunks = full.match(/[\s\S]{1,6}/g)
          let t = 200
          event('message.start', sid, {})
          for (const c of chunks) later((t += 25), () => event('message.delta', sid, { text: c }))
          later(t + 400, () => event('message.complete', sid, { text: full }))
        } else {
          later(100, () => event('message.start', sid, {}))
          later(200, () => event('message.delta', sid, { text: 'OK' }))
          later(300, () => event('message.complete', sid, { text: 'OK', usage: { input: 1200, output: 340, total: 1540, cost_usd: 0.0123, cache_hit_pct: 63 } }))
        }
        return
      }
      case 'session.control.read':
        return reply({ control: { goal: goalFor(params.session_id), loop: null, heartbeat: null, revision: 'x', updated_at: 0 } })
      case 'session.control':
        reply({})
        if (params.action === 'goal.pause' && goalState.rt === params.session_id) goalState.g = { ...goalState.g, status: 'paused', paused_reason: 'by user' }
        if (params.action === 'goal.resume' && goalState.rt === params.session_id) goalState.g = { ...goalState.g, status: 'active', paused_reason: null }
        if (params.action === 'goal.clear' && goalState.rt === params.session_id) goalState.g = null
        if (goalState.rt === params.session_id) later(30, () => event('session.control.update', params.session_id, { control: { goal: goalState.g, loop: null, heartbeat: null, revision: 'y', updated_at: 1 } }))
        return
      case 'session.interrupt': {
        // Hermes answers {status: 'interrupted'} (also for a chat that is not running); a running turn ends with message.complete
        // whose status is 'interrupted' and whose text is what had streamed so far.
        reply({ status: 'interrupted' })
        const t = slowTurns.get(params.session_id)
        if (t) {
          t.timers.forEach(clearTimeout)
          slowTurns.delete(params.session_id)
          later(50, live(() => event('message.complete', params.session_id, { text: t.text, usage: usageN(2), status: 'interrupted', persisted_turn: { row_ids: [t.row, t.row + 1], complete: false, user_row_id: t.row } })))
          later(100, live(() => event('session.info', params.session_id, CHAT_INFO)))
        }
        return
      }
      case 'client.capabilities':
        // The app says it answers server → client requests; Hermes lists the ones it will send.
        return reply({ server_requests: ['approval', 'clarify', 'display.install.sudo', 'preview.act', 'preview.read', 'secret', 'sudo', 'terminal.read', 'tour', 'vault.code', 'vault.save_login', 'vault.unlock_prompt', 'window.read'], declines_not_shown: true })
      case 'gateway.ping':
        return reply({ ok: true })
      case 'session.close':
        return reply({ closed: true })
      case 'session.delete':
        return reply({ deleted: params.session_id })
      case 'session.title':
        return reply({ pending: false, title: params.title })
      case 'session.set_hidden':
        return reply({ hidden: !!params.hidden, session_key: params.session_id })
      case 'commands.catalog':
        return reply({ categories: [], skills: {}, pairs: [] })
      case 'session.context_breakdown':
        if (params.session_id === 'rt-s-full') return reply({ context_used: 850, context_max: 1000, context_percent: 85 })
        return reply({ context_used: 100, context_max: 1000, context_percent: 10 })
      case 'projects.list':
        return reply({ projects: [{ id: 'p1', name: 'Thesis', primary_path: '/root/projects/thesis', folders: [{ path: '/root/projects/thesis' }] }] })
      case 'projects.project_sessions':
        return reply({ project: { previewSessions: [{ id: 's-3', title: 'Chat 3' }, { id: 's-4', title: 'Chat 4' }] } })
      case 'session.compress':
        return later(300, () => reply({ compressed: true, before_messages: 40, after_messages: 6, usage: { context_used: 200, context_max: 1000, context_percent: 20 } }))
      default:
        return reply({})
    }
  })
})

server.on('error', e => {
  console.error(`mock: can't listen on 127.0.0.1:9119 (${e.code}). Is an adb forward or a real Hermes using it?`)
  process.exit(1)
})
server.listen(9119, '127.0.0.1', () => console.log('mock on 9119'))
