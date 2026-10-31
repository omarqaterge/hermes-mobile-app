// Contract check: sends the same requests the app sends to the mock Hermes (tools/web-e2e/mock.cjs) and to the real,
// pinned Hermes, and compares the reply SHAPES (keys and types, not values). The mock's replies are what the browser
// tests prove the app works with, so a key the mock sends that the real Hermes lacks, or a key of another type, fails;
// keys only the real Hermes sends are listed and allowed. The real Hermes runs the app's plugin and talks to a fake local
// model (fake-model.py), so the plugin's read-only routes and one whole model turn (prompt.submit and its events) are
// compared too.
// Usage: node contract.cjs [mock URL] [Hermes URL]   (defaults http://127.0.0.1:9119 and http://127.0.0.1:9229; run.sh
// starts both). The Hermes must be a throwaway one: chats are created, renamed, closed and deleted.
const MOCK = process.argv[2] || 'http://127.0.0.1:9119'
const REAL = process.argv[3] || 'http://127.0.0.1:9229'

// The Android shell reads the session token from the dashboard page with this pattern (MainActivity.TOKEN).
const TOKEN = /__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/

// Keys the mock sends that the real Hermes may leave out, with why. Paths as printed by the check.
const ALLOW_MISSING = {}

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
  let seq = 0
  ws.onmessage = e => {
    const msg = JSON.parse(String(e.data))
    if (msg.id !== undefined && waits.has(msg.id)) {
      waits.get(msg.id)(msg)
      waits.delete(msg.id)
    } else if (msg.method === 'event') events.push(msg.params)
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
      await new Promise(r => setTimeout(r, 100))
    }
  }
  // Every event of a type for a session after `from`, their payloads merged into one object (like groups() does for rows).
  const merged = (type, sid, from) => {
    const found = events.slice(from).filter(x => x.type === type && x.session_id === sid)
    if (!found.length) return { error: { code: 'none', message: `no ${type} event for this chat; events seen: ${[...new Set(events.slice(from).map(x => x.type))].join(', ') || 'none'}` } }
    return { result: groups(found.map(x => x.payload ?? {}))['[]'] }
  }
  return { page, rpc, http, events, event, merged, close: () => ws.close() }
}

// Arrays are compared element group by element group (rows with a `role` by role), each group merged into one
// object holding every key seen in it.
function groups(arr) {
  const out = {}
  for (const el of arr) {
    const g = kind(el) === 'object' && typeof el.role === 'string' ? `[role=${el.role}]` : '[]'
    if (kind(el) !== 'object') out[g] ??= el
    else {
      // A key keeps its first non-null value, so a field that is null in some rows is still typed by the others.
      const acc = (out[g] ??= {})
      for (const [k, v] of Object.entries(el)) if (acc[k] === undefined || acc[k] === null) acc[k] = v
    }
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
    const gm = groups(m), gr = groups(r)
    for (const g of Object.keys(gm)) {
      if (!(g in gr)) res.fails.push(`${path}${g}: the mock has such rows, Hermes doesn't`)
      else compare(gm[g], gr[g], path + g, res)
    }
  }
}


// The app's plugin (hermes-plugin/hermes-mobile, installed into the Hermes by start-hermes.sh): its read-only GET routes, with
// the paths and query strings the app uses. Canvas and library content is made first (SETUP, below) so those lists have rows.
// Not covered, and why: the routes that write (PUT /prefs, /bgapps, /openui, /auto; POST /memory, /approve, /stop,
// /cleanup, /refresh-logins, /openui/call, /checkpoints/restore; DELETE ...), the claude-login routes (they start a sign-in
// with Anthropic), /bots (always-on bots, Termux), /media (a file path on the phone) and /tool-result (a stored tool
// output). /phone-access is compared even though nothing on this machine can answer it (no /sdcard, no Termux:API, no
// rish): both sides answer "nothing reachable" in the same shape. /checkpoints answers with no folders here (a snapshot
// needs a write_file or patch turn), so its rows are not compared.
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
    get('/library/item', c => `${PLUGIN}/library/item?id=${c.libId}`)
  ]
}

// One model turn on the chat session.create made: prompt.submit, then the events the app reads in gateway.ts. The Hermes
// answers through the fake model (read_file on a note, then the answer); the mock has a scripted turn for the same prompt.
// Each event type is compared by the merged payloads of all events of that type, and the ORDER in which the types first
// appear must be the same.
const TURN_PROMPT = 'read the note'
const TURN_EVENTS = ['message.start', 'thinking.delta', 'reasoning.delta', 'tool.generating', 'tool.start', 'tool.complete', 'message.delta', 'session.usage', 'message.complete', 'session.info']
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
    if (c.exact && !m.error && !r.error) {
      if (JSON.stringify(m.result) !== JSON.stringify(r.result)) res.fails.push(`the mock sends ${JSON.stringify(m.result)}, Hermes ${JSON.stringify(r.result)}`)
    } else if (m.error && r.error) res.notes.push(`both answer an error (mock ${m.error.code}, Hermes ${r.error.code}: ${r.error.message})`)
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
