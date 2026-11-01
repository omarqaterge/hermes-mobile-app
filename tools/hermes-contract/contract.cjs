// Contract check: sends the same requests the app sends to the mock Hermes (tools/web-e2e/mock.cjs) and to the real,
// pinned Hermes, and compares the reply SHAPES (keys and types, not values). The mock's replies are what the browser
// tests prove the app works with, so a key the mock sends that the real Hermes lacks, or a key of another type, fails;
// keys only the real Hermes sends are listed and allowed. The real Hermes runs the app's plugin and talks to a fake local
// model (fake-model.py), so the plugin's routes (reading and writing) and whole model turns (prompt.submit and its events) are
// compared too.
// Usage: node contract.cjs [mock URL] [Hermes URL]   (defaults http://127.0.0.1:9119 and http://127.0.0.1:9229; run.sh
// starts both). The Hermes must be a throwaway one: chats are created, renamed, closed and deleted.
const MOCK = process.argv[2] || 'http://127.0.0.1:9119'
const REAL = process.argv[3] || 'http://127.0.0.1:9229'

// The Android shell reads the session token from the dashboard page with this pattern (MainActivity.TOKEN).
const TOKEN = /__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/

// Keys the mock sends that the real Hermes may leave out, with why. Paths as printed by the check.
const ALLOW_MISSING = {}

const sleep = ms => new Promise(ok => setTimeout(ok, ms))
// The note the fake model's read_file call reads (run.sh passes it): the plugin routes that read a file use it too.
const NOTE = process.env.HM_CONTRACT_NOTE || '/tmp/hermes-contract-note.txt'

const kind = v => (v === null || v === undefined ? 'null' : Array.isArray(v) ? 'array' : typeof v)

// One connection to a Hermes (or the mock): the page with the token, REST with the token header, /api/ws JSON-RPC.
async function connect(base) {
  const page = await fetch(base + '/').then(r => r.text())
  const m = TOKEN.exec(page)
  if (!m) throw new Error(`${base}/ has no session token the Android shell can read`)
  const token = m[1]
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/ws?token=${encodeURIComponent(token)}`)
  const waits = new Map()
  const events = []
  const requests = [] // server → client requests (approval, clarify): { id, method, params }
  let seq = 0
  ws.onmessage = e => {
    const msg = JSON.parse(String(e.data))
    if (msg.id !== undefined && waits.has(msg.id)) {
      waits.get(msg.id)(msg)
      waits.delete(msg.id)
    } else if (msg.method === 'event') events.push(msg.params)
    else if (msg.method && msg.id !== undefined) requests.push(msg)
  }
  await new Promise((ok, fail) => {
    ws.onopen = ok
    ws.onerror = () => fail(new Error(`${base}/api/ws did not open`))
  })
  const rpc = (method, params = {}, ms = 30_000) =>
    new Promise(resolve => {
      const id = `c${++seq}`
      const timer = setTimeout(() => (waits.delete(id), resolve({ error: { code: 'timeout', message: `no answer in ${ms / 1000} s` } })), ms)
      waits.set(id, msg => (clearTimeout(timer), resolve(msg)))
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  const http = async (method, path, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'X-Hermes-Session-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    })
    const text = await r.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      json = text
    }
    return r.ok ? { result: json } : { error: { code: r.status, message: text.slice(0, 200) } }
  }
  // The app's answer to a server request (JsonRpcGatewayClient: a JSON-RPC result with the request's id).
  const answer = (id, result) => ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }))
  // The first server request with this method after `from`, waiting up to `ms`.
  const request = async (method, from, ms) => {
    const end = Date.now() + ms
    for (;;) {
      const q = requests.slice(from).find(x => x.method === method)
      if (q) return { id: q.id, result: q.params ?? {} }
      if (Date.now() > end) return { error: { code: 'timeout', message: `no ${method} request in ${ms / 1000} s` } }
      await sleep(100)
    }
  }
  // A request whose reply is compared by its status and headers (the plugin's /media streams bytes).
  const raw = async (path, headers) => {
    const r = await fetch(base + path, { headers: { 'X-Hermes-Session-Token': token, ...headers } })
    await r.arrayBuffer()
    return { status: r.status, headers: Object.fromEntries(r.headers) }
  }
  // The first event of a type (optionally for a session) after `from`, waiting up to `ms`.
  const event = async (type, sid, from, ms) => {
    const end = Date.now() + ms
    for (;;) {
      const e = events.slice(from).find(x => x.type === type && (!sid || x.session_id === sid))
      if (e) return { result: e.payload ?? {} }
      if (Date.now() > end) {
        const seen = events.slice(from).map(x => `${x.type}${x.session_id === sid ? '' : ` (${x.session_id || 'no session'})`}`)
        return { error: { code: 'timeout', message: `no ${type} event in ${ms / 1000} s; events seen: ${seen.join(', ') || 'none'}` } }
      }
      await sleep(100)
    }
  }
  // Every event of a type for a session between `from` and `to` (optionally only those whose payload passes `keep`),
  // their payloads merged into one object (like groups() does for rows).
  const merged = (type, sid, from, to = events.length, keep = () => true) => {
    const found = events.slice(from, to).filter(x => x.type === type && x.session_id === sid && keep(x.payload ?? {}))
    if (!found.length) return { error: { code: 'none', message: `no ${type} event for this chat; events seen: ${[...new Set(events.slice(from).map(x => x.type))].join(', ') || 'none'}` } }
    return { result: groups(found.map(x => x.payload ?? {}))['[]'] }
  }
  return { page, rpc, http, raw, events, event, merged, requests, request, answer, close: () => ws.close() }
}

// Arrays are compared element group by element group (rows with a `role` by role): Hermes's rows of a group are merged into
// one object holding every key seen in them, and each of the mock's rows is compared with it.
const groupOf = el => (kind(el) === 'object' && typeof el.role === 'string' ? `[role=${el.role}]` : '[]')
function groups(arr) {
  const out = {}
  for (const el of arr) {
    const g = groupOf(el)
    if (kind(el) !== 'object') out[g] ??= el
    else {
      out[g] = mergeInto(out[g] ?? {}, el)
    }
  }
  return out
}
// Merges one row into the rows merged so far: a key keeps its first non-null value (so a field that is null in some rows is
// still typed by the others), nested objects are merged the same way and lists are joined (rows of one group can carry
// different keys deeper down, like each provider's `status`).
function mergeInto(acc, el) {
  const out = { ...acc }
  for (const [k, v] of Object.entries(el)) {
    const a = out[k]
    if (a === undefined || a === null) out[k] = v
    else if (kind(a) === 'object' && kind(v) === 'object') out[k] = mergeInto(a, v)
    else if (kind(a) === 'array' && kind(v) === 'array') out[k] = a.concat(v)
  }
  return out
}

function compare(m, r, path, res) {
  const km = kind(m), kr = kind(r)
  if (km === 'null' || kr === 'null') {
    if (km !== kr) res.notes.push(`${path || '.'}: mock ${km}, Hermes ${kr}`)
    return
  }
  if (km !== kr) return res.fails.push(`${path || '.'}: mock sends ${km}, Hermes ${kr}`)
  if (km === 'object') {
    for (const k of Object.keys(m)) {
      const p = path ? `${path}.${k}` : k
      if (!(k in r)) {
        if (ALLOW_MISSING[p]) res.notes.push(`${p}: missing in Hermes (allowed: ${ALLOW_MISSING[p]})`)
        else res.fails.push(`${p}: the mock sends it (${kind(m[k])}), Hermes doesn't`)
      } else compare(m[k], r[k], p, res)
    }
    for (const k of Object.keys(r)) if (!(k in m)) res.extra.push(`${path ? `${path}.${k}` : k}:${kind(r[k])}`)
  } else if (km === 'array') {
    if (!m.length || !r.length) {
      if (m.length !== r.length) res.notes.push(`${path || '.'}: ${m.length ? 'Hermes' : 'mock'} sends an empty list (not compared)`)
      return
    }
    // Each of the mock's rows against all of Hermes's rows of its group merged (so a wrong type in any mock row shows).
    const gm = groups(m), gr = groups(r)
    for (const g of Object.keys(gm)) {
      if (!(g in gr)) res.fails.push(`${path}${g}: the mock has such rows, Hermes doesn't`)
      else for (const el of m.filter(x => groupOf(x) === g)) compare(el, gr[g], path + g, res)
    }
    res.fails = [...new Set(res.fails)]
  }
}


// The app's plugin (hermes-plugin/hermes-mobile, installed into the Hermes by start-hermes.sh): its GET routes with the
// paths and query strings the app uses, then the routes that WRITE, with the methods and bodies the app sends (web/src
// canvas.ts, gallery.ts, checkpoints.ts, order.ts, gateway.ts, Screens.tsx, OpenUIBlock.tsx, SignIn.tsx, api.ts,
// Bots.tsx, Settings.tsx, MainActivity.media). Everything writes into the throwaway HOME only. Canvas and library content
// is made first (SETUP, below) so those lists have rows. Not covered, and why (docs/spec/07-03-browser-e2e.md lists them too):
// POST /claude-login/start and /finish (they start a real sign-in with Anthropic; /cancel is covered), PUT /bots/{name}
// (it would turn an always-on bot on), POST /approve and /stop (the notification buttons: the plugin answers them over
// the dashboard on 127.0.0.1:9119, the phone's port, which the real Hermes here must never use; the same
// approval.respond and session.interrupt are covered over the WebSocket below). /phone-access is compared even though
// nothing on this machine can answer it (no /sdcard, no Termux:API, no rish): both sides answer "nothing reachable" in
// the same shape. /checkpoints and its diff and restore are compared after the "edit files" turn (turnCases), which
// gives the real Hermes a snapshot.
const PLUGIN = '/api/plugins/hermes-mobile'
const DOC = { title: 'Contract note', type: 'markdown', content: '# Contract\n\nA canvas document for the contract check.' }
async function pluginSetup(c) {
  const doc = await c.http('POST', `${PLUGIN}/canvas/doc`, { session: c.stored, ...DOC })
  if (doc.error) throw new Error(`setup: creating a canvas document failed: ${doc.error.code} ${doc.error.message}`)
  c.docId = doc.result.id
  const lib = await c.http('POST', `${PLUGIN}/library`, { session: c.stored, id: c.docId })
  if (lib.error) throw new Error(`setup: saving a library item failed: ${lib.error.code} ${lib.error.message}`)
  c.libId = lib.result.id
}
function pluginCases() {
  const get = (name, path) => ({ name: `GET plugin ${name}`, run: c => c.http('GET', typeof path === 'function' ? path(c) : PLUGIN + path) })
  return [
    { name: 'setup: a canvas document and a library item', setup: pluginSetup },
    get('/prefs', '/prefs'),
    get('/auto', c => `${PLUGIN}/auto?session=${c.stored}`),
    get('/bgapps', '/bgapps'),
    get('/openui', '/openui'),
    get('/phone-access', '/phone-access'),
    get('/memory', '/memory'),
    get('/checkpoints', c => `${PLUGIN}/checkpoints?session=${c.stored}`),
    get('/canvas', c => `${PLUGIN}/canvas?session=${c.stored}`),
    get('/canvas/doc', c => `${PLUGIN}/canvas/doc?session=${c.stored}&id=${c.docId}`),
    get('/gallery', '/gallery'),
    get('/gallery?q=', '/gallery?q=contract'),
    get('/library', '/library'),
    get('/library/item', c => `${PLUGIN}/library/item?id=${c.libId}`),
    get('/bots', '/bots'),
    get('/bots/log', '/bots/log'),
    ...pluginWriteCases()
  ]
}

// The plugin routes that write, as the app calls them (see above).
function pluginWriteCases() {
  const call = (name, method, path, body, more = {}) => ({
    name: `${method} plugin ${name}`,
    ...more,
    run: c => c.http(method, typeof path === 'function' ? path(c) : PLUGIN + path, typeof body === 'function' ? body(c) : body)
  })
  const q = o => new URLSearchParams(o).toString()
  return [
    // Canvas (canvas.ts) and the gallery's rename / delete (gallery.ts: a chat's document goes through the same canvas routes).
    call('/canvas/doc (save)', 'PUT', '/canvas/doc', c => ({ session: c.stored, id: c.docId, content: '# Contract\n\nEdited.', base_rev: 1 })),
    call('/canvas/rename', 'POST', '/canvas/rename', c => ({ session: c.stored, id: c.docId, title: 'Contract note renamed' })),
    call('/canvas/version', 'GET', c => `${PLUGIN}/canvas/version?${q({ session: c.stored, id: c.docId, rev: 1 })}`),
    call('/canvas/restore', 'POST', '/canvas/restore', c => ({ session: c.stored, id: c.docId, rev: 1 })),
    {
      name: 'POST plugin /canvas/doc (a second document)',
      run: async c => {
        const r = await c.http('POST', `${PLUGIN}/canvas/doc`, { session: c.stored, title: 'Throwaway', content: 'gone soon', type: 'markdown', lang: '' })
        c.doc2 = r.result?.id
        return r
      }
    },
    call('/canvas/doc (delete)', 'DELETE', c => `${PLUGIN}/canvas/doc?${q({ session: c.stored, id: c.doc2 })}`),
    {
      name: 'POST plugin /canvas/open-file',
      run: async c => {
        const r = await c.http('POST', `${PLUGIN}/canvas/open-file`, { session: c.stored, path: NOTE })
        c.fileDoc = r.result?.id
        return r
      }
    },
    call('/canvas/save-file', 'POST', '/canvas/save-file', c => ({ session: c.stored, id: c.fileDoc })),
    // The gallery's rename / delete of a saved (library) copy.
    call('/library/item (rename)', 'PUT', '/library/item', c => ({ id: c.libId, title: 'Contract copy renamed', category: '' })),
    call('/library/item (delete)', 'DELETE', c => `${PLUGIN}/library/item?${q({ id: c.libId })}`),
    // The chat list's pinned and manual order (order.ts).
    call('/prefs', 'PUT', '/prefs', { pinned: ['contract-chat'], manual: null, at: Date.now() }),
    // Auto access on and off (gateway.ts setPluginAuto).
    call('/auto (set)', 'PUT', '/auto', c => ({ session: c.stored, mode: 'auto' })),
    call('/auto (clear)', 'PUT', '/auto', c => ({ session: c.stored, mode: '' })),
    // The Memory screen (Screens.tsx): add, edit, delete.
    call('/memory (add)', 'POST', '/memory', { action: 'add', target: 'memory', content: 'A contract entry.' }),
    call('/memory (edit)', 'POST', '/memory', { action: 'replace', target: 'memory', content: 'A contract entry, edited.', old_text: 'A contract entry.' }),
    call('/memory (delete)', 'POST', '/memory', { action: 'remove', target: 'memory', old_text: 'A contract entry, edited.' }),
    // Settings switches the app writes (Settings.tsx), set to what they already are.
    call('/bgapps', 'PUT', '/bgapps', { allow_sensitive: false }),
    call('/openui', 'PUT', '/openui', { enabled: true }),
    // A card's Query(): one allowed read, one refused tool (403 on both sides).
    call('/openui/call (allowed read)', 'POST', '/openui/call', { name: 'read_file', args: { path: NOTE } }),
    call('/openui/call (refused tool)', 'POST', '/openui/call', { name: 'terminal', args: { command: 'true' } }, { expectError: 403 }),
    call('/refresh-logins', 'POST', '/refresh-logins', {}),
    call('/claude-login/cancel', 'POST', '/claude-login/cancel', { session_id: 'contract-none' }),
    call('/profiles/link', 'POST', '/profiles/link', {}),
    // After a chat is deleted (gateway.ts): uploads and canvas folders no chat uses.
    call('/cleanup', 'POST', '/cleanup', { keep: [] }),
    {
      // The shell's media URL (MainActivity.media): a byte range of a file, as a player asks for it.
      name: 'GET plugin /media (a byte range)',
      exact: true,
      run: async c => {
        const r = await c.raw(`${PLUGIN}/media?path=${encodeURIComponent(NOTE)}`, { Range: 'bytes=0-3' })
        const h = r.headers
        return { result: { status: r.status, accept_ranges: h['accept-ranges'] ?? null, content_range: /^bytes 0-3\/\d+$/.test(h['content-range'] || ''), length: h['content-length'] ?? null, type: (h['content-type'] || '').split(';')[0] } }
      }
    }
  ]
}

// One model turn on the chat session.create made: prompt.submit, then the events the app reads in gateway.ts. The Hermes
// answers through the fake model (read_file on a note, then the answer); the mock has a scripted turn for the same prompt.
// Each event type is compared by the merged payloads of all events of that type, and the ORDER in which the types first
// appear must be the same.
const TURN_PROMPT = 'read the note'
const TURN_EVENTS = ['session.title', 'message.start', 'thinking.delta', 'reasoning.delta', 'tool.generating', 'tool.start', 'tool.complete', 'message.delta', 'session.usage', 'message.complete', 'session.info']
const ORDER = ['message.start', 'reasoning.delta', 'tool.generating', 'tool.start', 'tool.complete', 'message.delta', 'message.complete']
function turnCases() {
  return [
    {
      name: 'prompt.submit',
      run: async c => {
        c.mark = c.events.length
        if (c.isMock) await c.http('POST', '/__mock', { activity: [{ session: c.newRuntime, text: 'Thinking…', short: 'Thinking', profile: 'default', review: false, ts: Date.now() / 1000 }] })
        const r = await c.rpc('prompt.submit', { session_id: c.newRuntime, text: TURN_PROMPT })
        if (r.error) return r
        // The activity feed (the app's banner) while the turn runs: the plugin's hooks report it; the mock is told to show one item.
        const started = await c.event('message.start', c.newRuntime, c.mark, 60_000)
        if (started.error) return started
        c.activity = { items: [] }
        for (let i = 0; i < 25 && !c.activity.items.length && !c.events.slice(c.mark).some(e => e.type === 'message.complete'); i++) {
          c.activity = (await c.http('GET', `${PLUGIN}/activity`)).result ?? c.activity
          await new Promise(ok => setTimeout(ok, 200))
        }
        const done = await c.event('message.complete', c.newRuntime, c.mark, 90_000)
        if (done.error) return done
        await new Promise(ok => setTimeout(ok, 1500)) // the session.info that follows
        if (c.isMock) await c.http('POST', '/__mock', { activity: [] })
        return r
      }
    },
    { name: 'GET plugin /activity (during the turn)', run: c => ({ result: c.activity }) },
    ...TURN_EVENTS.map(type => ({ name: `event ${type} (model turn)`, run: c => c.merged(type, c.newRuntime, c.mark) })),
    {
      name: 'event order (model turn)',
      exact: true,
      run: c => {
        const evs = c.events.slice(c.mark).filter(e => e.session_id === c.newRuntime)
        const done = evs.findIndex(e => e.type === 'message.complete')
        const first = type => evs.findIndex(e => e.type === type)
        const info = evs.findIndex((e, i) => i > done && e.type === 'session.info')
        const seen = ORDER.map(t => [t, first(t)]).concat([['session.info (after message.complete)', info]])
        return { result: seen.filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([t]) => t) }
      }
    }
  ]
}

// More model turns on the same chat, one per script of fake-model.py (the mock has a scripted turn for each prompt):
// `answer` = the server request the turn waits on and the app's answer to it (RequestSheet.tsx: approval { choice },
// clarify { answer }), `interrupt` = the app's Stop (session.interrupt) once the reply streams, `completes` = how many
// message.complete events end it (a background sub-agent's result comes back as a second turn).
async function runTurn(c, key, prompt, { answer, interrupt, completes = 1 } = {}) {
  const t = (c.turns[key] = { from: c.events.length })
  const reqFrom = c.requests.length
  const r = await c.rpc('prompt.submit', { session_id: c.newRuntime, text: prompt })
  if (r.error) return r
  if (answer) {
    const q = await c.request(answer.method, reqFrom, 60_000)
    if (q.error) return q
    t.request = q.result
    await sleep(300)
    c.answer(q.id, answer.result)
  }
  if (interrupt) {
    const d = await c.event('message.delta', c.newRuntime, t.from, 60_000)
    if (d.error) return d
    t.interrupt = await c.rpc('session.interrupt', { session_id: c.newRuntime })
  }
  const end = Date.now() + 90_000
  const done = () => c.events.slice(t.from).filter(e => e.type === 'message.complete' && e.session_id === c.newRuntime).length
  while (done() < completes) {
    if (Date.now() > end) return { error: { code: 'timeout', message: `${done()} of ${completes} message.complete in 90 s` } }
    await sleep(100)
  }
  await sleep(1500)
  t.to = c.events.length
  return r
}
const TURNS = [
  { key: 'approve', prompt: 'run the thing', opts: { answer: { method: 'approval', result: { choice: 'once' } } }, request: 'approval', events: ['tool.start', 'tool.complete', 'message.complete'] },
  { key: 'deny', prompt: 'run the thing', opts: { answer: { method: 'approval', result: { choice: 'deny' } } }, request: 'approval', events: ['tool.complete', 'message.complete'] },
  { key: 'clarify', prompt: 'ask me', opts: { answer: { method: 'clarify', result: { answer: 'Red' } } }, request: 'clarify', events: ['tool.start', 'tool.complete', 'message.complete'] },
  { key: 'todo', prompt: 'plan it', events: ['tool.start', 'tool.complete', 'todo.updated', 'message.complete'] },
  { key: 'edits', prompt: 'edit files', events: [['tool.complete', 'write_file'], ['tool.complete', 'patch'], 'message.complete'] },
  { key: 'sub-agent', prompt: 'delegate it', opts: { completes: 2 }, events: ['subagent.start', 'subagent.thinking', 'subagent.complete', 'tool.complete', 'message.complete'] },
  { key: 'interrupted', prompt: 'slow reply', opts: { interrupt: true }, events: ['message.complete'] }
]
function moreTurnCases() {
  const out = []
  for (const { key, prompt, opts, request, events } of TURNS) {
    out.push({ name: `prompt.submit (${key}: "${prompt}")`, run: c => runTurn(c, key, prompt, opts) })
    if (request) out.push({ name: `server request ${request} (${key})`, run: c => ({ result: c.turns[key]?.request ?? {} }) })
    if (opts?.interrupt) out.push({ name: `session.interrupt (${key}, while the reply streams)`, run: c => c.turns[key]?.interrupt ?? { error: { code: 'none', message: 'not sent' } } })
    for (const e of events) {
      const [type, tool] = Array.isArray(e) ? e : [e]
      out.push({
        name: `event ${type}${tool ? ` ${tool}` : ''} (${key})`,
        run: c => (c.turns[key] ? c.merged(type, c.newRuntime, c.turns[key].from, c.turns[key].to, p => !tool || p.name === tool) : { error: { code: 'none', message: 'the turn did not run' } })
      })
    }
    if (key === 'edits') out.push(...checkpointCases())
  }
  return out
}
// The chat's file checkpoints after the "edit files" turn (checkpoints.ts): the list, a snapshot's diff, a restore of the
// whole snapshot, and forgetting the chat's list (what the app does after deleting a chat).
function checkpointCases() {
  const q = o => new URLSearchParams(o).toString()
  return [
    {
      name: 'GET plugin /checkpoints (after the edits)',
      run: async c => {
        const r = await c.http('GET', `${PLUGIN}/checkpoints?${q({ session: c.newStored })}`)
        const f = r.result?.folders?.[0]
        c.snap = f && f.snapshots?.[0] ? { workdir: f.workdir, snap: f.snapshots[0].id } : null
        return r.result && !c.snap ? { error: { code: 'empty', message: `no snapshot listed: ${JSON.stringify(r.result)}` } } : r
      }
    },
    { name: 'GET plugin /checkpoints/diff', run: c => (c.snap ? c.http('GET', `${PLUGIN}/checkpoints/diff?${q({ session: c.newStored, ...c.snap })}`) : { error: { code: 'none', message: 'no snapshot' } }) },
    { name: 'POST plugin /checkpoints/restore', run: c => (c.snap ? c.http('POST', `${PLUGIN}/checkpoints/restore`, { session: c.newStored, ...c.snap, file: '' }) : { error: { code: 'none', message: 'no snapshot' } }) },
    { name: 'DELETE plugin /checkpoints', run: c => c.http('DELETE', `${PLUGIN}/checkpoints?${q({ session: c.newStored })}`) }
  ]
}

// The requests, in order. `run(c)` gets the target's connection with its own ids: the mock's stored chat is s-0, the real Hermes's
// is the one seed.py wrote; runtime ids come from the replies (session.resume, session.create).
const CASES = [
  ...[
    '/api/status',
    '/api/config',
    '/api/model/info',
    '/api/model/options',
    '/api/skills',
    '/api/dashboard/plugins',
    '/api/cron/jobs',
    '/api/env',
    '/api/providers/oauth',
    '/api/providers/custom-endpoints',
    '/api/credentials/pool',
    '/api/sessions/search?q=question'
  ].map(p => ({ name: `GET ${p}`, run: c => c.http('GET', p) })),
  ...pluginCases(),
  // The app's client says it answers server → client requests (json-rpc-channel.ts advertiseCapabilities); without it the
  // real Hermes withdraws approvals and skips questions at once.
  { name: 'client.capabilities', run: c => c.rpc('client.capabilities', { server_requests: true }) },
  { name: 'gateway.ping', run: c => c.rpc('gateway.ping') },
  { name: 'profiles.list', run: c => c.rpc('profiles.list') },
  { name: 'setup.status', run: c => c.rpc('setup.status') },
  { name: 'setup.runtime_check', run: c => c.rpc('setup.runtime_check') },
  { name: 'model.options', run: c => c.rpc('model.options') },
  { name: 'commands.catalog', run: c => c.rpc('commands.catalog') },
  { name: 'projects.list', run: c => c.rpc('projects.list') },
  { name: 'session.list', run: c => c.rpc('session.list', { limit: 50 }) },
  { name: 'session.list (hidden too)', run: c => c.rpc('session.list', { limit: 200, include_hidden: true }) },
  {
    name: 'session.resume',
    run: async c => {
      const r = await c.rpc('session.resume', { session_id: c.stored }, 60_000)
      c.runtime = r.result?.session_id
      return r
    }
  },
  { name: 'session.control.read', run: c => c.rpc('session.control.read', { session_id: c.runtime }) },
  { name: 'session.context_breakdown', run: c => c.rpc('session.context_breakdown', { session_id: c.runtime }) },
  { name: 'session.history', run: c => c.rpc('session.history', { session_id: c.runtime }) },
  { name: 'session.title', run: c => c.rpc('session.title', { session_id: c.runtime, title: 'Contract chat renamed' }) },
  { name: 'session.set_hidden', run: c => c.rpc('session.set_hidden', { session_id: c.stored, hidden: false }) },
  {
    name: 'config.set yolo',
    run: c => ((c.mark = c.events.length), c.rpc('config.set', { session_id: c.runtime, key: 'yolo', value: '1' }))
  },
  // The app learns the chat's new Auto state from this event (gateway.ts, case 'session.info').
  { name: 'event session.info (after config.set yolo)', run: c => c.event('session.info', c.runtime, c.mark, 10_000) },
  { name: 'session.interrupt (idle chat)', run: c => c.rpc('session.interrupt', { session_id: c.runtime }) },
  { name: 'session.close', run: c => c.rpc('session.close', { session_id: c.runtime }) },
  {
    name: 'session.create',
    run: async c => {
      c.mark = c.events.length
      const r = await c.rpc('session.create', { source: 'mobile' })
      c.newRuntime = r.result?.session_id
      c.newStored = r.result?.stored_session_id
      return r
    }
  },
  // The app waits for session.info to learn the new chat's agent is built (gateway.ts trackBuild).
  { name: 'event session.info (after session.create)', run: c => c.event('session.info', c.newRuntime, c.mark, 15_000) },
  ...turnCases(),
  {
    // The stored output of the turn's tool call (ChatItems.tsx, when a reloaded transcript has no output).
    name: 'GET plugin /tool-result',
    run: c => {
      const done = c.events.slice(c.mark).find(e => e.type === 'tool.complete' && e.session_id === c.newRuntime)
      return done ? c.http('GET', `${PLUGIN}/tool-result?id=${encodeURIComponent(done.payload.tool_id)}`) : { error: { code: 'none', message: 'no tool.complete' } }
    }
  },
  ...moreTurnCases(),
  { name: 'session.close (new chat)', run: c => c.rpc('session.close', { session_id: c.newRuntime }) },
  { name: 'session.delete', run: c => c.rpc('session.delete', { session_id: c.stored }) }
]

async function main() {
  for (const [name, url] of [['mock', MOCK], ['Hermes', REAL]]) {
    const port = new URL(url).port
    if (name === 'Hermes' && port === '9119') throw new Error('the real Hermes must not be on 9119 (that is the phone when adb forwards it)')
    const home = await fetch(url + '/').then(r => r.text(), () => null)
    if (home === null) throw new Error(`${name} is not answering on ${url}`)
    if ((name === 'mock') !== home.includes('MOCK-HERMES')) throw new Error(`${url} is ${name === 'mock' ? 'not the mock' : 'the mock, not a real Hermes'}`)
  }
  const mock = await connect(MOCK)
  const real = await connect(REAL)
  mock.stored = 's-0'
  real.stored = 'contract-chat'
  mock.turns = {}
  real.turns = {}
  let failed = 0
  const total = CASES.filter(c => !c.setup).length
  mock.isMock = true
  for (const c of CASES) {
    if (c.setup) {
      await c.setup(mock)
      await c.setup(real)
      continue
    }
    const [m, r] = [await c.run(mock), await c.run(real)]
    const res = { fails: [], notes: [], extra: [] }
    if (c.expectError) {
      if (m.error?.code !== c.expectError || r.error?.code !== c.expectError) res.fails.push(`expected ${c.expectError} from both: mock ${m.error?.code ?? 'ok'}, Hermes ${r.error?.code ?? 'ok'}`)
    } else if (c.exact && !m.error && !r.error) {
      if (JSON.stringify(m.result) !== JSON.stringify(r.result)) res.fails.push(`the mock sends ${JSON.stringify(m.result)}, Hermes ${JSON.stringify(r.result)}`)
    } else if (m.error && r.error) {
      // An error on both sides compares nothing (a wrong route, or an id an earlier case failed to make): only a case that
      // expects one (expectError) may answer an error.
      res.fails.push(`both answer an error, and the case expects none (mock ${m.error.code}, Hermes ${r.error.code}: ${r.error.message})`)
    }
    else if (m.error) res.fails.push(`the mock answers an error (${m.error.code} ${m.error.message}), Hermes doesn't`)
    else if (r.error) res.fails.push(`Hermes answers an error: ${r.error.code} ${r.error.message}`)
    else compare(m.result, r.result, '', res)
    if (res.fails.length) failed++
    console.log(`${res.fails.length ? 'FAIL' : 'PASS'}  ${c.name}`)
    for (const f of res.fails) console.log(`        drift: ${f}`)
    if (res.fails.length && r.result !== undefined) console.log(`        Hermes answered: ${JSON.stringify(r.result).slice(0, 800)}`)
    for (const n of res.notes) console.log(`        note: ${n}`)
    const more = res.extra.length > 40 ? ` and ${res.extra.length - 40} more` : ''
    if (res.extra.length) console.log(`        only in Hermes: ${res.extra.slice(0, 40).join(', ')}${more}`)
  }
  mock.close()
  real.close()
  console.log(failed ? `\n${failed} of ${total} replies differ from the mock` : `\nall ${total} replies match the mock's shapes`)
  process.exit(failed ? 1 : 0)
}

main().catch(e => {
  console.error('contract:', e.message)
  process.exit(2)
})
