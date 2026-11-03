// Tests for the report relay with a stand-in KV and a mocked GitHub API: `node --test` in relay/report.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import worker, { LIMITS, LOG_DAYS, issueBody, readReport } from './worker.js'

const ID = 'a'.repeat(32)
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64')

function kv() {
  const m = new Map()
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k).value : null },
    async put(k, value, opts) { m.set(k, { value, metadata: opts?.metadata, ttl: opts?.expirationTtl }) },
    async delete(k) { m.delete(k) },
    async getWithMetadata(k) { const e = m.get(k); return e ? { value: e.value, metadata: e.metadata } : { value: null, metadata: null } }
  }
}

let env, calls, answer
beforeEach(() => {
  env = { GITHUB_TOKEN: 'test-token', REPORTS: kv(), REPO: 'owner/repo', LABEL: 'from-app' }
  calls = []
  answer = () => new Response(JSON.stringify({ html_url: 'https://github.com/owner/repo/issues/7', number: 7 }), { status: 201 })
  globalThis.fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return answer() }
})

const post = (body, ip = '203.0.113.5') =>
  worker.fetch(new Request('https://relay.example/', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body) }), env)
const report = (extra = {}) => ({ installId: ID, title: 'Chat list is empty', text: 'After an update the list is empty.', details: { app: '1.4.0', android: '14', hermes: 'v0.21.5' }, ...extra })

test('creates the issue with the label and answers with its URL', async () => {
  const res = await post(report())
  assert.equal(res.status, 201)
  assert.deepEqual(await res.json(), { url: 'https://github.com/owner/repo/issues/7', number: 7, screenshot: false, log: false })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.github.com/repos/owner/repo/issues')
  assert.equal(calls[0].init.headers.authorization, 'Bearer test-token')
  assert.deepEqual(calls[0].body.labels, ['from-app'])
  assert.equal(calls[0].body.title, 'Chat list is empty')
  assert.match(calls[0].body.body, /- App: 1\.4\.0\n- Android: 14\n- Hermux agent: v0\.21\.5/)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
})

test('answers the CORS preflight', async () => {
  const res = await worker.fetch(new Request('https://relay.example/', { method: 'OPTIONS' }), env)
  assert.equal(res.status, 204)
  assert.match(res.headers.get('access-control-allow-methods'), /POST/)
})

test('rejects bad reports without calling GitHub', async () => {
  for (const bad of [
    report({ installId: 'phone-serial' }),
    report({ title: '' }),
    report({ title: 'x'.repeat(LIMITS.MAX_TITLE + 1) }),
    report({ text: 'x'.repeat(LIMITS.MAX_TEXT + 1) }),
    report({ log: 'x'.repeat(LIMITS.MAX_LOG + 1) }),
    report({ details: { app: '<img src=x>' } }),
    report({ screenshot: { type: 'image/gif', data: PNG } }),
    report({ screenshot: { type: 'constructor', data: 'UklGRgAAAABXRUJQ' } }), // not a key of its own in the type list
    report({ screenshot: { type: 'image/jpeg', data: PNG } }) // PNG bytes claiming to be a JPEG
  ]) {
    const res = await post(bad)
    assert.equal(res.status, 400, JSON.stringify(bad).slice(0, 80))
  }
  assert.equal(calls.length, 0)
  const res = await worker.fetch(new Request('https://relay.example/', { method: 'POST', body: 'not json' }), env)
  assert.equal(res.status, 400)
})

test('limits reports per install and per address', async () => {
  for (let i = 0; i < LIMITS.MAX_PER_INSTALL; i++) assert.equal((await post(report())).status, 201)
  const res = await post(report())
  assert.equal(res.status, 429)
  assert.equal(calls.length, LIMITS.MAX_PER_INSTALL)
  // Another install from another address is still fine.
  assert.equal((await post(report({ installId: 'b'.repeat(32) }), '198.51.100.9')).status, 201)
  // Many installs from one address stop at the address limit.
  let last
  for (let i = 0; i < LIMITS.MAX_PER_IP + 1; i++) last = await post(report({ installId: i.toString(16).padStart(32, 'c') }), '192.0.2.1')
  assert.equal(last.status, 429)
  // The address is never stored as it is.
  assert.ok(![...env.REPORTS.m.keys()].some(k => k.includes('192.0.2.1')))
})

test('an IPv6 address counts by its /64, and everyone has a daily total', async () => {
  let last
  for (let i = 0; i < LIMITS.MAX_PER_IP + 1; i++) last = await post(report({ installId: i.toString(16).padStart(32, 'd') }), `2001:db8:1:2::${i.toString(16)}`)
  assert.equal(last.status, 429)
  assert.equal((await post(report({ installId: 'e'.repeat(32) }), '2001:db8:1:3::1')).status, 201)
  const day = new Date().toISOString().slice(0, 10)
  env.REPORTS.m.set(`all:${day}`, { value: String(LIMITS.MAX_PER_DAY) })
  assert.equal((await post(report({ installId: 'f'.repeat(32) }), '198.51.100.77')).status, 429)
})

test('a screenshot is deleted when GitHub refuses its issue', async () => {
  answer = () => new Response('{}', { status: 403 })
  assert.equal((await post(report({ screenshot: { type: 'image/png', data: PNG } }))).status, 502)
  assert.ok(![...env.REPORTS.m.keys()].some(k => k.startsWith('shot:')))
})

test('stores a screenshot, links it from the issue and serves it', async () => {
  const res = await post(report({ screenshot: { type: 'image/png', data: PNG } }))
  assert.equal(res.status, 201)
  assert.equal((await res.json()).screenshot, true)
  const link = /!\[Screenshot\]\((https:\/\/relay\.example\/s\/[0-9a-f]{32}\.png)\)/.exec(calls[0].body.body)
  assert.ok(link, calls[0].body.body)
  const img = await worker.fetch(new Request(link[1]), env)
  assert.equal(img.status, 200)
  assert.equal(img.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), Buffer.from(PNG, 'base64'))
  assert.equal((await worker.fetch(new Request('https://relay.example/s/../secret'), env)).status, 404)
})

test('a GitHub failure or a missing setup is an error the app can fall back from', async () => {
  answer = () => new Response('{}', { status: 403 })
  assert.equal((await post(report())).status, 502)
  delete env.GITHUB_TOKEN
  assert.equal((await post(report())).status, 503)
})

test('the issue body cannot mention people or break out of a code block', () => {
  const r = readReport(report({ text: 'ping @someone\n```\nopen fence' }))
  const body = issueBody(r, '')
  assert.ok(!/@someone/.test(body))
  assert.ok(body.includes('@\u200bsomeone'))
  assert.ok(!/^```/m.test(body))
})

const LOG = 'crash java type=RuntimeException\nCANARY in the log'
const logKeys = () => [...env.REPORTS.m.keys()].filter(k => k.startsWith('log:'))
const readLog = (id, key) =>
  worker.fetch(new Request(`https://relay.example/l/${id}`, key === undefined ? {} : { headers: { authorization: `Bearer ${key}` } }), env)

test('a diagnostic log is kept privately: the public issue only names it', async () => {
  const res = await post(report({ log: LOG }))
  const answer = await res.json()
  assert.equal(res.status, 201)
  assert.equal(answer.log, true)
  const [key] = logKeys()
  assert.ok(key, 'stored')
  const id = key.slice(4)
  assert.match(id, /^[0-9a-f]{32}$/)
  assert.equal(env.REPORTS.m.get(key).ttl, LOG_DAYS * 86400, 'it expires')
  assert.ok(!calls[0].body.body.includes('CANARY'), 'the log is not in the issue')
  assert.ok(calls[0].body.body.includes(id), 'the issue names it')
  assert.ok(!JSON.stringify(env.REPORTS.m.get(key)).includes(ID), 'the stored log does not say who sent it')
})

test('reading a log takes the key, and every other answer says nothing', async () => {
  env.LOG_READ_KEY = 'the-read-key'
  await post(report({ log: LOG }))
  const id = logKeys()[0].slice(4)
  assert.equal((await readLog(id)).status, 401, 'no key')
  assert.equal((await readLog(id, 'wrong')).status, 401, 'a wrong key')
  assert.equal((await readLog(id, '')).status, 401, 'an empty key')
  const ok = await readLog(id, 'the-read-key')
  assert.equal(ok.status, 200)
  assert.equal(await ok.text(), LOG)
  assert.equal(ok.headers.get('cache-control'), 'no-store')
  assert.equal(ok.headers.get('access-control-allow-origin'), null, 'no web page may read it')
  assert.equal((await readLog('f'.repeat(32), 'the-read-key')).status, 404)
  assert.equal((await readLog('../shot', 'the-read-key')).status, 404)
})

test('with no read key set, nobody reads a log through the Worker, even with an empty key', async () => {
  delete env.LOG_READ_KEY
  await post(report({ log: LOG }))
  const id = logKeys()[0].slice(4)
  assert.equal((await readLog(id)).status, 401)
  assert.equal((await readLog(id, '')).status, 401)
  assert.equal((await readLog(id, 'undefined')).status, 401)
})

test('a log that could not be stored stays out of the issue too', async () => {
  const put = env.REPORTS.put
  env.REPORTS.put = async (k, v, o) => {
    if (k.startsWith('log:')) throw new Error('KV down')
    return put(k, v, o)
  }
  const res = await post(report({ log: LOG }))
  assert.equal(res.status, 201)
  assert.equal((await res.json()).log, false)
  assert.ok(!calls[0].body.body.includes('CANARY'))
  assert.ok(!calls[0].body.body.includes('Diagnostic log'))
})

test('no issue: its log is deleted again', async () => {
  answer = () => new Response('{}', { status: 500 })
  const res = await post(report({ log: LOG }))
  assert.equal(res.status, 502)
  assert.equal(logKeys().length, 0)
})

test('a report without a log says so and stores none', async () => {
  const res = await post(report())
  assert.equal((await res.json()).log, false)
  assert.equal(logKeys().length, 0)
  assert.ok(!calls[0].body.body.includes('Diagnostic log'))
})
