// Tests for the report relay with a stand-in KV and a mocked GitHub API: `node --test` in relay/report.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import worker, { LIMITS, issueBody, readReport } from './worker.js'

const ID = 'a'.repeat(32)
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64')

function kv() {
  const m = new Map()
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k).value : null },
    async put(k, value, opts) { m.set(k, { value, metadata: opts?.metadata }) },
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
  assert.deepEqual(await res.json(), { url: 'https://github.com/owner/repo/issues/7', number: 7, screenshot: false })
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

test('the issue body cannot mention people or break out of the log block', () => {
  const r = readReport(report({ text: 'ping @someone', log: 'line\n```\n# heading' }))
  const body = issueBody(r, '')
  assert.ok(!/@someone/.test(body))
  assert.ok(body.includes('@​someone'))
  assert.equal(body.match(/^```/gm).length, 2)
})
