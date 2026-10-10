// Mock Hermes dashboard + tui_gateway on 127.0.0.1:9119 for browser tests of the web UI (no phone needed).
// Logs every RPC / REST call to a JSONL file so test.cjs can assert what the app sent.
const http = require('http')
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
allSessions.unshift({ id: 's-stale', title: 'Stale edit chat', preview: 'x', message_count: 4, started_at: Math.floor(Date.now() / 1000) - 60, source: 'mobile' })
allSessions.unshift({ id: 's-run', title: 'Running chat', preview: 'x', message_count: 3, started_at: Math.floor(Date.now() / 1000), source: 'mobile' })

const canvasDocs = {} // session -> [doc]
// The chat whose start-up resume is slow already has a canvas (opening it while the chat loads must show it).
canvasDocs['s-slowstart'] = [{ id: 'dlife', title: 'Life', type: 'markdown', lang: '', rev: 1, updated: Date.now() / 1000, by: 'agent', chars: 12, path: '', created: Date.now() / 1000, content: '# Life\n\nGlider' }]
let activityItems = []
let refuseUntil = 0
let pluginEnabled = false
let providerConfigured = true // false = a fresh install (the welcome opens)
let phoneAccess = { files: true, termux_api: true, shizuku: 'ok' } // the plugin's /phone-access (Setup check)
let codexPolls = 0

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
      if (b.unconfigured) providerConfigured = false
      if (b.phone) phoneAccess = { ...phoneAccess, ...b.phone }
      if (b.bump) allSessions.find(x => x.id === b.bump).message_count += 2
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
      return send({ path: dir, parent: dir === '/' ? null : dir.replace(/\/[^/]+$/, '') || '/', entries })
    }
    if (p === '/api/cron/jobs' && req.method === 'GET') return send([{ id: 'j1', name: 'Morning brief', schedule: '0 9 * * *', prompt: 'Brief me', next_run_at: null }])
    if (p === '/api/cron/jobs/j1' && req.method === 'PUT') return send({ detail: 'Method Not Allowed' }, 405)
    if (p === '/api/cron/jobs/j1/runs') return send([{ title: 'ok', started_at: Date.now() / 1000 - 60, session_id: 's-6', preview: 'chat run' }, { title: 'saved output', output: '# Result\n\nAll good' }])
    if (p === '/api/sessions/search') return send({ results: [{ session_id: 's-long', title: 'Long chat', snippet: '…>>>question<<< 17', role: 'user' }] })
    if (p === '/api/plugins/hermes-mobile/activity') return send({ items: activityItems })
    if (p === '/api/plugins/hermes-mobile/prefs') return send({ order: null })
    if (p === '/api/plugins/hermes-mobile/phone-access') return send(phoneAccess)
    if (p === '/api/hermes/update/check') return send({ install_method: 'git', current_version: '0.21.5+4582.gb8a8be1', behind: 12, update_available: true, can_apply: true, message: null })
    if (p === '/api/plugins/hermes-mobile/refresh-logins') return send({ ok: true, anthropic: 0 })
    if (p === '/api/plugins/hermes-mobile/cleanup') return send({ ok: true, removed: [], freed_bytes: 0 })
    if (p === '/api/model/info') return send({ model: 'mock-model' })
    // Account sign-ins: ChatGPT is a device-code flow approved on the 2nd poll; Claude is terminal-only ("external").
    if (p === '/api/providers/oauth' && req.method === 'GET')
      return send({
        providers: [
          { id: 'openai-codex', name: 'ChatGPT or Codex Subscription', flow: 'device_code', cli_command: 'hermes auth add openai-codex', disconnectable: true, status: { logged_in: !!codexPolls && providerConfigured } },
          { id: 'anthropic', name: 'Anthropic Account', flow: 'external', cli_command: 'hermes auth add anthropic', disconnectable: true, status: { logged_in: false } },
          { id: 'claude-code', name: 'Anthropic OAuth', flow: 'external', cli_command: 'claude setup-token', disconnectable: false, status: { logged_in: false } }
        ]
      })
    if (p === '/api/providers/oauth/openai-codex/start') {
      codexPolls = 0
      return send({ session_id: 'dev1', flow: 'device_code', user_code: 'ABCD-1234', verification_url: 'https://auth.openai.com/codex/device', expires_in: 900, poll_interval: 1 })
    }
    if (p === '/api/providers/oauth/openai-codex/poll/dev1') {
      if (++codexPolls >= 2) providerConfigured = true
      return send({ session_id: 'dev1', status: codexPolls >= 2 ? 'approved' : 'pending' })
    }
    if (p.startsWith('/api/providers/oauth/sessions/')) return send({ ok: true })
    if (p === '/api/env' && req.method === 'PUT') {
      providerConfigured = true
      return send({ ok: true })
    }
    if (p === '/api/model/options') return send({ model: 'mock-model', provider: 'mock', providers: [{ slug: 'mock', name: 'Mock', authenticated: true, models: ['mock-model', 'mock-sonnet'] }] })
    if (p === '/api/model/set') return send({ ok: true })
    if (p === '/api/dashboard/plugins') return send([{ name: 'hermes-mobile' }, { name: 'kanban' }])
    if (p === '/api/config' && req.method === 'GET') return send({ plugins: { enabled: pluginEnabled ? ['other', 'hermes-mobile'] : ['other'] } })
    if (p === '/api/config' && req.method === 'PUT') {
      const b = JSON.parse(body || '{}')
      pluginEnabled = (b.config?.plugins?.enabled || []).includes('hermes-mobile')
      return send({ ok: true })
    }
    if (p === '/api/skills') return send([{ name: 'a', enabled: true }, { name: 'b', enabled: true }, { name: 'c', enabled: false }])
    if (p === '/api/plugins/hermes-mobile/memory')
      return send({ memory: { target: 'memory', entries: ['x', 'y'], used: 1100, limit: 2200 }, user: { target: 'user', entries: ['z'], used: 10, limit: 1375 } })
    if (p === '/api/status') return send({ version: '0.21.5', components: { dashboard: { status: 'ok' } } })
    if (p === '/api/plugins/hermes-mobile/checkpoints' && req.method === 'GET') {
      const d = new Date(Date.now() - 600_000).toISOString()
      return send({
        folders: [
          { workdir: '/root/projects/site', pruned: 1, snapshots: [{ id: 't1@' + d, hash: 'abc1234567', date: d, reason: 'before patch', files: ['app.py', 'notes.md'] }] },
          { workdir: '/root/.hermes/cache/scratch', pruned: 0, snapshots: [{ id: 't2@' + d, hash: 'def7654321', date: d, reason: 'before write_file', files: ['x.txt'] }] }
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
      return send(b.file ? { ok: true, restored_to: 'abc12345', restored_files: [b.file] } : { ok: true, restored_to: 'abc12345', restored_files: ['app.py', 'notes.md'], skipped_user_edits: [] })
    }
    if (p === '/api/plugins/hermes-mobile/checkpoints' && req.method === 'DELETE') return send({ ok: true })
    if (p === '/api/plugins/hermes-mobile/canvas') {
      const s = url.searchParams.get('session')
      const list = () => send({ docs: (canvasDocs[s] || []).map(({ content, ...m }) => m) })
      if (s === 's-slowstart') return void setTimeout(list, 700) // long enough to see the panel's loading state
      return list()
    }
    if (p === '/api/plugins/hermes-mobile/canvas/doc') {
      if (req.method === 'GET') {
        const d = (canvasDocs[url.searchParams.get('session')] || []).find(x => x.id === url.searchParams.get('id'))
        return d ? send({ ...d, versions: [] }) : send({ detail: 'not found' }, 404)
      }
      if (req.method === 'POST') {
        const b = JSON.parse(body)
        const d = { id: `d${Date.now()}`, title: b.title, type: b.type || 'markdown', lang: b.lang || '', rev: 1, updated: Date.now() / 1000, by: 'user', chars: (b.content || '').length, path: '', created: Date.now() / 1000, content: b.content || '' }
        ;(canvasDocs[b.session] ||= []).push(d)
        return send(d)
      }
      if (req.method === 'PUT') {
        const b = JSON.parse(body)
        const d = (canvasDocs[b.session] || []).find(x => x.id === b.id)
        if (!d) return send({ detail: 'not found' }, 404)
        d.content = b.content
        d.rev++
        const { content, ...meta } = d
        return send(meta)
      }
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
wss.on('connection', ws => {
  const event = (type, session_id, payload) => ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, session_id, payload } }))
  const later = (ms, fn) => setTimeout(fn, ms)

  ws.on('message', raw => {
    const msg = JSON.parse(String(raw))
    if (msg.method === undefined) return log({ answer: msg.id, result: msg.result, error: msg.error }) // response to a server request
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
        const n = params.model ? `-m${++created}` : ''
        const rt = `rt-new${n}`, model = params.model || 'mock-model'
        later(600, () => { log({ built: rt }); event('session.info', rt, { model, provider: params.provider || 'mock' }) })
        return reply({ session_id: rt, stored_session_id: `s-new${n}`, info: { model, provider: params.provider || 'mock' }, messages: [] })
      }
      case 'setup.status':
        return reply({ provider_configured: providerConfigured, ready: true })
      case 'model.options':
        return reply({ model: 'mock-model', provider: 'mock', providers: [{ slug: 'mock', name: 'Mock', authenticated: true, models: ['mock-model', 'mock-sonnet'] }] })
      case 'session.resume': {
        const sid = params.session_id
        if (sid === 's-run') {
          reply({
            session_id: 'rt-run',
            stored_session_id: 's-run',
            running: true,
            info: { title: 'Running chat', model: 'mock-model' },
            messages: [
              { role: 'user', text: 'First question', row_id: 1 },
              { role: 'assistant', text: 'First answer' }
            ],
            inflight: { user: 'Explain streams', assistant: 'Streams are a sequence of', streaming: true },
            todo_state: { todos: [{ id: '1', content: 'Read', status: 'completed' }, { id: '2', content: 'Write', status: 'in_progress' }], revision: 2 }
          })
          later(700, () => event('message.delta', 'rt-run', { text: ' values over time.' }))
          later(1200, () => event('message.complete', 'rt-run', { text: 'Streams are a sequence of values over time.' }))
          return
        }
        if (sid === 's-stale') {
          // Hermes no longer holds the first question live (row 999 answers 4018 to an edit).
          return reply({ session_id: 'rt-stale', stored_session_id: sid, info: { title: 'Stale edit chat', model: 'mock-model' }, messages: [
            { role: 'user', text: 'stale first question', row_id: 999 }, { role: 'assistant', text: 'stale first answer' },
            { role: 'user', text: 'stale second question', row_id: 1000 }, { role: 'assistant', text: 'stale second answer' }] })
        }
        if (sid === 's-slowstart') {
          // Slow start-up resume: the user starts a new chat while this is loading.
          return later(2500, () => reply({ session_id: 'rt-slowstart', stored_session_id: sid, info: { title: 'Slow chat', model: 'mock-model' }, messages: [{ role: 'user', text: 'old question', row_id: 1 }, { role: 'assistant', text: 'old answer' }] }))
        }
        if (sid === 's-long') {
          // 150 turns: the app should draw only the end and load earlier turns on scroll.
          const messages = []
          for (let i = 0; i < 150; i++) messages.push({ role: 'user', text: `question ${i}`, row_id: i * 2 + 1 }, { role: 'assistant', text: `**answer ${i}**\n\n- point a\n- point b` })
          return reply({ session_id: 'rt-s-long', stored_session_id: sid, info: { title: 'Long chat', model: 'mock-model' }, messages })
        }
        const res = { session_id: `rt-${sid}`, stored_session_id: sid, info: { title: sid, model: 'mock-model' }, messages: [{ role: 'user', text: `hello ${sid}`, row_id: 1, timestamp: 1790000000 }, { role: 'assistant', text: `answer ${sid}`, timestamp: 1790000060 }] }
        // A slow phone: the cached copy must be on screen long before this answer.
        if (sid === 's-slow') return later(1500, () => reply(res))
        return reply(res)
      }
      case 'image.attach_bytes':
        return reply({ attached: true, name: params.filename, path: `/root/.hermes/images/${params.filename}` })
      case 'image.detach':
        return reply({ detached: true, count: 0 })
      case 'file.attach':
        return reply({ attached: true, name: params.name, path: `/root/ws/${params.name}`, ref_path: `ws/${params.name}`, ref_text: `@file:ws/${params.name}`, uploaded: true })
      case 'prompt.submit': {
        if (params.truncate_before_row_id === 999)
          return ws.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code: 4018, message: 'target user message is no longer in session history' } }))
        reply({ user_row_id: 10 + seq++, ...(params.confirm_truncate ? { survivor_user_row_ids: [] } : {}) })
        const sid = params.session_id
        if (/^run the thing$/.test(params.text)) {
          later(100, () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'srv-approval-1', method: 'approval', params: { session_id: sid, command: 'rm -rf /tmp/x', description: 'delete the temp folder', allow_session: true } })))
          return
        }
        if (/^ask me$/.test(params.text)) {
          // Hermes asks a question (clarify, a server → client request) and waits.
          later(100, () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'srv-clarify-1', method: 'clarify', params: { session_id: sid, question: 'Which colour?', choices: ['Red', 'Blue'] } })))
          return
        }
        if (/^use tools$/.test(params.text)) {
          // Four tool calls (with reasoning between two of them), then the answer: the app folds them into one line.
          let t = 50
          for (const [i, name] of ['terminal', 'read_file', 'search_files', 'terminal'].entries()) {
            later((t += 40), () => event('tool.start', sid, { tool_id: `call_${i}`, name, context: `step ${i}`, args: { command: `echo ${i}` } }))
            later((t += 40), () => event('tool.complete', sid, { tool_id: `call_${i}`, name, duration_s: 1.5, result_text: `out ${i}` }))
            if (i === 1) later((t += 20), () => event('reasoning.delta', sid, { text: 'thinking between calls' }))
          }
          later((t += 60), () => event('message.start', sid, {}))
          later((t += 40), () => event('message.complete', sid, { text: 'All four done.' }))
          return
        }
        if (/^wait a while$/.test(params.text)) {
          // One long command (nothing streams for 7 s): what the app polls meanwhile is what costs battery.
          later(50, () => event('tool.start', sid, { tool_id: 'call_wait', name: 'terminal', context: 'sleep 7', args: { command: 'sleep 7' } }))
          later(7000, () => event('tool.complete', sid, { tool_id: 'call_wait', name: 'terminal', duration_s: 7, result_text: '' }))
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
            event('tool.complete', sid, { tool_id: 'call_cv', name: 'canvas', duration_s: 0.1, args: { action: 'create' }, result_text: JSON.stringify({ ok: true, id: 'dplan', shown: true }) })
          })
          later(3800, () => event('message.start', sid, {}))
          later(3900, () => event('message.complete', sid, { text: 'Wrote the plan.' }))
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
          later(300, () => event('message.complete', sid, { text: 'OK' }))
        }
        return
      }
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
