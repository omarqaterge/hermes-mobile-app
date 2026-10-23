// Drives the built web UI (served by web/devserver.py on :5180) against mock.cjs on :9119. Run via run.sh.
const { chromium } = require('playwright')
const fs = require('fs')
const os = require('os')
const path = require('path')

const LOG = process.env.HM_E2E_LOG || path.join(os.tmpdir(), 'hm-web-e2e-calls.jsonl')
const SHOTS = process.env.HM_E2E_SHOTS || os.tmpdir()
const calls = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
const rpcs = m => calls().filter(c => c.rpc === m)
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`)
  if (!ok) failures++
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

// The app shell's bridge, faked (injected before the page loads): window.__setup / __fixes drive the Setup check.
const nativeShell = () => {
    const calls = (window.__nativeCalls = [])
    let taken = false
    const k = (key, name) => {
      calls.push(name)
      if (key !== 'K') throw new Error('bridge call without the key: ' + name)
    }
    window.HermesAndroid = {
      handshake: () => (taken ? '' : ((taken = true), 'K')),
      getBaseUrl: key => (k(key, 'getBaseUrl'), 'http://127.0.0.1:9119'),
      getToken: key => (k(key, 'getToken'), 'tok'),
      getTokenAsync: (key, id) => {
        k(key, 'getTokenAsync')
        setTimeout(() => window.__hmToken(id, 'tok'), 50)
      },
      httpAsync: (key, id, m, p, b) => {
        k(key, 'httpAsync')
        fetch('/__api' + p, { method: m, headers: b != null ? { 'Content-Type': 'application/json' } : undefined, body: b ?? undefined }).then(async r => window.__hmHttp(id, r.status, await r.text()))
      },
      isInForeground: key => (k(key, 'isInForeground'), true),
      appVersion: key => (k(key, 'appVersion'), 'test'),
      isSystemDark: key => (k(key, 'isSystemDark'), true),
      setBackground: key => k(key, 'setBackground'),
      haptic: key => k(key, 'haptic'),
      notify: key => k(key, 'notify'),
      cancelNotification: key => k(key, 'cancelNotification'),
      setLastChat: key => k(key, 'setLastChat'),
      chatSeen: (key, id) => (k(key, 'chatSeen'), (window.__seen ||= []).push(id)),
      setReadAloud: key => k(key, 'setReadAloud'),
      mediaBase: key => (k(key, 'mediaBase'), ''),
      // Voice: speaking "finishes" after 50 ms; the test plays the recogniser through window.__hmVoice.
      speak: (key, text) => {
        k(key, 'speak')
        ;(window.__spoken ||= []).push(text)
        setTimeout(() => window.__hmVoice('tts-done', ''), 50)
      },
      stopSpeaking: key => k(key, 'stopSpeaking'),
      startListening: key => k(key, 'startListening'),
      stopListening: key => k(key, 'stopListening'),
      // Setup check: the test sets window.__setup; fixes are recorded in window.__fixes.
      setupState: key => (k(key, 'setupState'), JSON.stringify(window.__setup || { termux: true, runCommand: true, notifications: true, batteryApp: true, batteryTermux: true, startError: '' })),
      setupFix: (key, what) => (k(key, 'setupFix'), (window.__fixes ||= []).push(what)),
      // App-first setup: installs "succeed" after a moment and flip the app to installed in window.__setup; the probe
      // answers window.__probe; window.__progress is the installer's progress (the test pushes lines itself).
      installHelperApp: (key, which) => {
        k(key, 'installHelperApp')
        ;(window.__installs ||= []).push(which)
        const field = { termux: 'termux', 'termux-api': 'termuxApi', 'termux-boot': 'termuxBoot', shizuku: 'shizuku' }[which]
        setTimeout(() => window.hermesSetupInstall(which, 'downloading', 40, ''), 30)
        setTimeout(() => window.hermesSetupInstall(which, 'installing', 100, ''), 80)
        setTimeout(() => {
          window.__setup = { ...window.__setup, [field]: true }
          window.hermesSetupInstall(which, 'done', 100, '')
        }, 150)
      },
      probeTermux: key => {
        k(key, 'probeTermux')
        window.__probes = (window.__probes || 0) + 1
        if (window.__probe) setTimeout(() => window.hermesTermuxProbe(JSON.stringify(window.__probe)), 20)
      },
      setupCommand: key => {
        k(key, 'setupCommand')
        window.__copied = (window.__copied || 0) + 1
        window.__progress = { active: true, lines: [], done: false, fail: '' }
        return true
      },
      setupProgress: key => (k(key, 'setupProgress'), window.__progress ? JSON.stringify(window.__progress) : ''),
      listVoices: key => k(key, 'listVoices'),
      startHermes: key => k(key, 'startHermes'),
      isAssistant: key => (k(key, 'isAssistant'), !!window.__assistant),
      openAssistantSettings: key => k(key, 'openAssistantSettings'),
      // Background app: the test sets state through window.__hmBg; frames come back 120 ms after each request.
      bgState: key => (k(key, 'bgState'), window.__bgNative ? JSON.stringify(window.__bgNative) : ''),
      bgFrameAsync: (key, id, w) => {
        k(key, 'bgFrameAsync')
        const log = (window.__bgAsked ||= [])
        log.push({ t: Date.now(), w })
        window.__bgInflight = (window.__bgInflight || 0) + 1
        window.__bgMaxInflight = Math.max(window.__bgMaxInflight || 0, window.__bgInflight)
        setTimeout(() => {
          window.__bgInflight--
          window.__hmBgFrame(id, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
        }, 120)
      },
      bgAction: (key, what) => {
        k(key, 'bgAction')
        ;(window.__bgActs ||= []).push(what)
        setTimeout(() => window.__hmBg(null), 30) // the shell clears the state once the host answered
        return 'ok'
      }
    }
}

async function main() {
  // Never drive the real phone: 9119 must be the mock (an adb forward to the phone uses the same port).
  const home = await fetch('http://127.0.0.1:9119/').then(r => r.text(), () => '')
  if (!home.includes('MOCK-HERMES')) {
    console.error('127.0.0.1:9119 is not the mock (real Hermes / adb forward?). Refusing to run.')
    process.exit(3)
  }
  fs.writeFileSync(LOG, '')
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined })
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } })
  page.on('pageerror', e => {
    console.log('PAGEERROR', e.message)
    failures++
  })
  await page.goto('http://127.0.0.1:5180/')
  await page.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
  await sleep(500)
  {
    const stages = await page.evaluate(() => (JSON.parse(localStorage.getItem('hm.boot.v1') || '{}').marks || []).map(m => m[0]))
    check(['script', 'painted', 'socket', 'sessions'].every(s => stages.includes(s)), `start-up timing marks recorded (${stages.join(', ')})`)
  }

  // ── model picked before the first message: the chat is created with it (no switch, so no model-switch marker
  //    in Hermes's history that would swallow the first message) ──
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.locator('.picker-opt', { hasText: 'mock-model' }).click()
  await page.locator('.row', { hasText: 'mock-sonnet' }).click()
  await page.getByPlaceholder('Message Hermes').fill('which model?')
  await page.getByRole('button', { name: 'Send' }).click()
  await page.locator('.msg.user .bubble', { hasText: 'which model?' }).waitFor({ timeout: 5000 })
  for (let i = 0; i < 30 && !rpcs('prompt.submit').length; i++) await sleep(100)
  {
    const cr = rpcs('session.create'), sets = rpcs('config.set').filter(c => c.params.key === 'model'), sub = rpcs('prompt.submit')
    check(cr.length === 1 && cr[0].params.model === 'mock-sonnet' && cr[0].params.provider === 'mock', `new chat is created with the picked model (${JSON.stringify(cr.map(c => c.params))})`)
    check(sets.length === 0, 'no config.set model on a chat with no messages')
    check(sub.length === 1 && sub[0].params.session_id === 'rt-new-m1', `the message goes to that chat (${JSON.stringify(sub.map(c => c.params.session_id))})`)
  }
  // ── /yolo goes through config.set (in-process, like Desktop), never the slash worker ──
  await page.locator('.msg.assistant', { hasText: 'OK' }).first().waitFor({ timeout: 5000 })
  await page.getByPlaceholder('Message Hermes').fill('/yolo')
  await page.getByRole('button', { name: 'Send' }).click()
  await sleep(500)
  check(rpcs('config.set').some(c => c.params.key === 'yolo' && c.params.value === '1' && c.params.session_id === 'rt-new-m1'), '/yolo → config.set yolo=1 on this chat')
  check(!rpcs('slash.exec').some(c => /^yolo\b/.test(c.params.command || '')), '/yolo never reaches slash.exec')
  check((await page.getByText('Full access on').count()) > 0, '/yolo shows a notice')
  check((await page.locator('.yolo-chip').count()) === 1, 'Full access chip shown above the composer')
  check((await page.locator('.auto-btn.full').count()) === 1, 'header Auto button shows Full access')
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('hm.yolo.v1') || '{}')['s-new-m1'] === true), 'YOLO remembered for this chat (re-applied on resume)')
  if (await page.locator('.yolo-chip').count()) await page.locator('.yolo-chip').click()
  await sleep(400)
  check(rpcs('config.set').some(c => c.params.key === 'yolo' && c.params.value === '0'), 'tapping the chip turns YOLO off')
  check((await page.locator('.yolo-chip').count()) === 0, 'chip gone after off')
  check(await page.evaluate(() => !JSON.parse(localStorage.getItem('hm.yolo.v1') || '{}')['s-new-m1']), 'YOLO forgotten for this chat after off')
  // ── the header's Auto button: Auto access (plugin list first, then /yolo) and Full access (warning first) ──
  {
    const autoPuts = () => calls().filter(c => c.http === 'PUT' && c.path === '/api/plugins/hermes-mobile/auto')
    const yolos = () => rpcs('config.set').filter(c => c.params.key === 'yolo')
    check((await page.locator('.auto-btn.off', { hasText: 'Auto' }).count()) === 1, 'Auto button in the header, off')
    await page.locator('.auto-btn').click()
    await page.getByText('Auto access', { exact: true }).click()
    await sleep(500)
    const put = autoPuts().pop(), y = yolos().pop()
    check(put && put.body.session === 's-new-m1' && put.body.mode === 'auto', `Auto access tells the plugin this chat's id (${JSON.stringify(put && put.body)})`)
    check(put && y && y.params.value === '1' && put.t <= y.t, 'the plugin list is written BEFORE /yolo goes on')
    check((await page.locator('.auto-btn.auto').count()) === 1, 'button shows Auto access')
    check((await page.locator('.yolo-chip').count()) === 0, 'no Full access chip in Auto access')
    check(await page.evaluate(() => JSON.parse(localStorage.getItem('hm.yolo.v1') || '{}')['s-new-m1'] === 'auto'), 'Auto access remembered for this chat')
    // Full access asks first; Cancel changes nothing
    const n = yolos().length
    await page.locator('.auto-btn').click()
    await page.getByText('Full access', { exact: true }).click()
    await page.getByText('Give Hermes full access?').waitFor({ timeout: 3000 })
    check((await page.getByText(/without asking you first/).count()) === 1, 'Full access shows a warning first')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await sleep(300)
    check(yolos().length === n && (await page.locator('.auto-btn.auto').count()) === 1, 'Cancel keeps Auto access')
    await page.locator('.auto-btn').click()
    await page.getByText('Full access', { exact: true }).click()
    await page.getByRole('button', { name: 'Allow full access' }).click()
    await sleep(500)
    const off = autoPuts().pop()
    check((await page.locator('.auto-btn.full').count()) === 1 && off.body.mode === '', 'Allow → Full access, the plugin entry removed')
    await page.locator('.auto-btn').click()
    await page.getByText('Off', { exact: true }).click()
    await sleep(500)
    check(yolos().pop().params.value === '0' && (await page.locator('.auto-btn.off').count()) === 1, 'Off turns /yolo off')
    check(await page.evaluate(() => !JSON.parse(localStorage.getItem('hm.yolo.v1') || '{}')['s-new-m1']), 'nothing remembered after Off')
  }
  // /fast too: Hermes's session-scoped config.set fast (toggle), like Desktop's speed switch
  await page.getByPlaceholder('Message Hermes').fill('/fast')
  await page.getByRole('button', { name: 'Send' }).click()
  await sleep(500)
  check(rpcs('config.set').some(c => c.params.key === 'fast' && c.params.value === 'toggle' && c.params.session_id === 'rt-new-m1'), '/fast → config.set fast=toggle on this chat')
  check(!rpcs('slash.exec').some(c => /^fast\b/.test(c.params.command || '')), '/fast never reaches slash.exec')
  check((await page.getByText('Fast mode on').count()) > 0, '/fast shows a notice')
  await page.getByPlaceholder('Message Hermes').fill('/fast off')
  await page.getByRole('button', { name: 'Send' }).click()
  await sleep(500)
  check(rpcs('config.set').some(c => c.params.key === 'fast' && c.params.value === 'off') && (await page.getByText('Fast mode off').count()) > 0, '/fast off turns it off')
  await page.evaluate(() => localStorage.clear())
  await page.goto('http://127.0.0.1:5180/')
  await page.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
  fs.writeFileSync(LOG, '')

  // ── model picker favourites: ☆ stars a model (without picking it), Favourites shows at the top and survives a reload ──
  {
    const openModels = async () => {
      await page.getByRole('button', { name: 'Add', exact: true }).click()
      await page.locator('.picker-opt', { hasText: 'mock-model' }).click()
      await page.locator('.model-row', { hasText: 'mock-sonnet' }).first().waitFor({ timeout: 5000 })
    }
    await openModels()
    check((await page.locator('.fav-group').count()) === 0, 'no Favourites section before anything is starred')
    await page.getByRole('button', { name: 'Star mock-sonnet' }).click()
    await sleep(300)
    check((await page.locator('.sheet .sheet-title', { hasText: 'Model' }).count()) === 1, 'starring keeps the picker open')
    check(rpcs('session.create').length === 0 && rpcs('config.set').filter(c => c.params.key === 'model').length === 0, 'starring does not pick the model')
    const titles = await page.locator('.sheet-scroll .group-title').allInnerTexts()
    check(/favourites/i.test(titles[0] || ''), `Favourites is the first section (${JSON.stringify(titles)})`)
    check((await page.locator('.fav-group .model-row').allInnerTexts()).join('|').includes('mock-sonnet'), 'the starred model is listed in Favourites with its provider')
    check(await page.evaluate(() => JSON.parse(localStorage.getItem('hm.favModels.v1') || '[]').some(f => f.p === 'mock' && f.m === 'mock-sonnet')), 'favourite saved')
    await page.getByPlaceholder('Search models…').fill('model')
    await sleep(200)
    check((await page.locator('.fav-group').count()) === 0, 'search hides favourites that do not match')
    await page.reload()
    await page.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    await openModels()
    check((await page.locator('.fav-group .model-row', { hasText: 'mock-sonnet' }).count()) === 1, 'favourite survives a reload')
    await page.locator('.fav-group').getByRole('button', { name: 'Unstar mock-sonnet' }).click()
    await sleep(300)
    check((await page.locator('.fav-group').count()) === 0, 'unstarring removes it from Favourites')
    await page.getByRole('button', { name: 'Star mock-sonnet' }).click()
    await page.locator('.fav-group .model-pick', { hasText: 'mock-sonnet' }).click()
    await sleep(500)
    check(rpcs('session.create').some(c => c.params.model === 'mock-sonnet'), 'tapping a favourite picks it')
  }
  await page.evaluate(() => localStorage.clear())
  await page.goto('http://127.0.0.1:5180/')
  await page.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
  fs.writeFileSync(LOG, '')

  // ── a model picked on an empty chat (a photo added and removed) replaces it; typed text stays ──
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.picker-opt', { hasText: 'Photo' }).click()])
    await chooser.setFiles([{ name: 'x.png', mimeType: 'image/png', buffer: png }])
  }
  await page.locator('.attach-thumb img[alt="x.png"]').waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'Remove x.png' }).click()
  await page.getByPlaceholder('Message Hermes').fill('kept text')
  await sleep(300)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.locator('.picker-opt', { hasText: 'mock-model' }).click()
  await page.locator('.row', { hasText: 'mock-sonnet' }).click()
  await sleep(800)
  {
    const cr = rpcs('session.create'), sets = rpcs('config.set').filter(c => c.params.key === 'model')
    const closed = rpcs('session.close').map(c => c.params.session_id)
    check(cr.length === 2 && cr[1].params.model === 'mock-sonnet' && sets.length === 0, `empty chat: model pick creates a new chat, no switch (${cr.length} creates, ${sets.length} switches)`)
    check(closed.includes('rt-new'), `the empty chat is closed (${JSON.stringify(closed)})`)
    check((await page.getByPlaceholder('Message Hermes').inputValue()) === 'kept text', 'typed text stays in the composer')
  }
  await page.getByPlaceholder('Message Hermes').fill('')
  await page.evaluate(() => localStorage.clear())
  await page.goto('http://127.0.0.1:5180/')
  await page.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
  fs.writeFileSync(LOG, '')

  // ── #1 / #4 attachments ──────────────────────────────
  const attach = async (option, files) => {
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.picker-opt', { hasText: option }).click()])
    await chooser.setFiles(files)
  }
  await attach('Photo', [{ name: 'a.png', mimeType: 'image/png', buffer: png }, { name: 'b.png', mimeType: 'image/png', buffer: png }])
  await page.locator('.attach-thumb img[alt="b.png"]').waitFor({ timeout: 5000 })
  check(await page.locator('.attach-thumb img[alt="b.png"]').evaluate(i => i.complete && i.naturalWidth > 0), 'composer shows a real image preview')
  check(rpcs('image.attach_bytes').length === 2, 'two photos queued with image.attach_bytes')
  await page.getByRole('button', { name: 'Remove a.png' }).click()
  await sleep(400)
  const det = rpcs('image.detach')
  check(det.length === 1 && det[0].params.path === '/root/.hermes/images/a.png', `✕ detaches the photo in Hermes (${JSON.stringify(det.map(d => d.params.path))})`)
  check((await page.locator('.attach-thumb img[alt="a.png"]').count()) === 0, 'removed preview is gone')

  await attach('File', [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello notes') }])
  await page.locator('.attach-chip', { hasText: 'notes.txt' }).waitFor({ timeout: 5000 })
  const fa = rpcs('file.attach')
  check(fa.length === 1 && fa[0].params.name === 'notes.txt' && String(fa[0].params.data_url).startsWith('data:text/plain;base64,'), 'file goes through file.attach as a data URL')

  await page.getByPlaceholder('Message Hermes').fill('summarize')
  await page.getByRole('button', { name: 'Send' }).click()
  await page.locator('.msg.user .bubble', { hasText: 'summarize' }).waitFor({ timeout: 5000 })
  const sub = rpcs('prompt.submit').pop()
  check(sub && sub.params.text === '@file:ws/notes.txt\n\nsummarize', `prompt carries the file reference (${JSON.stringify(sub && sub.params.text)})`)
  const bubble = page.locator('.msg.user').last()
  check((await bubble.locator('img.msg-thumb[alt="b.png"]').count()) === 1 && (await bubble.locator('img.msg-thumb').evaluate(i => i.naturalWidth > 0)) && (await bubble.locator('.chip', { hasText: 'notes.txt' }).count()) === 1, 'sent bubble shows photo thumbnail + file chip')
  check((await page.locator('.composer-wrap .attach-chip').count()) === 0, 'composer attachments emptied after send')
  // ── a just-sent photo opens full screen: double-tap zoom, Save (a download in a browser), Share, Back closes ──
  await bubble.locator('img.msg-thumb[alt="b.png"]').click()
  const lb = page.locator('.lightbox')
  await lb.waitFor({ timeout: 3000 }).then(() => check(true, 'tapping a sent photo opens the lightbox'), () => check(false, 'tapping a sent photo opens the lightbox'))
  if (await lb.count()) {
    check((await lb.getByRole('button', { name: 'Save' }).count()) === 1 && (await lb.getByRole('button', { name: 'Share' }).count()) === 1, 'the lightbox has Save and Share')
    check((await page.locator('.msg.user .msg-time').count()) === 0, 'opening the photo does not toggle the message time')
    await lb.locator('img').dblclick()
    await sleep(200)
    check(/scale\(2\.5\)/.test(await lb.locator('img').evaluate(i => i.style.transform)), 'double-tap zooms in')
    await lb.locator('img').dblclick()
    await sleep(200)
    check(/scale\(1\)/.test(await lb.locator('img').evaluate(i => i.style.transform)), 'double-tap again zooms back out')
    const dl = page.waitForEvent('download', { timeout: 3000 }).catch(() => null)
    await lb.getByRole('button', { name: 'Save' }).click()
    const got = await dl
    check(got && got.suggestedFilename() === 'b.png', `Save downloads the photo in a browser (${got && got.suggestedFilename()})`)
    await lb.getByRole('button', { name: 'Share' }).click()
    await page.locator('.toast', { hasText: 'Sharing works in the phone app' }).waitFor({ timeout: 2000 }).then(() => check(true, 'Share explains it needs the phone app'), () => check(false, 'Share explains it needs the phone app'))
    await page.evaluate(() => window.hermesBack())
    await sleep(300)
    check((await page.locator('.lightbox').count()) === 0, 'Back closes the lightbox')
  }

  await attach('Photo', [{ name: 'c.png', mimeType: 'image/png', buffer: png }, { name: 'd.png', mimeType: 'image/png', buffer: png }])
  await page.locator('.attach-thumb img[alt="d.png"]').waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'clear', exact: true }).click()
  await sleep(500)
  const det2 = rpcs('image.detach').map(d => d.params.path)
  check(det2.includes('/root/.hermes/images/c.png') && det2.includes('/root/.hermes/images/d.png'), 'clear detaches every queued photo')
  check((await page.locator('.composer-wrap .attach-chip').count()) === 0, 'clear empties the row')
  // #4 camera: the chooser asks for capture (Android opens the camera app), the photo is queued like any other.
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const [cam] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.picker-opt', { hasText: 'Camera' }).click()])
  check((await cam.element().getAttribute('capture')) === 'environment' && !cam.isMultiple(), 'Camera opens a capture chooser')
  await cam.setFiles([{ name: 'photo-1.jpg', mimeType: 'image/jpeg', buffer: png }])
  await page.locator('.attach-thumb img[alt="photo-1.jpg"]').waitFor({ timeout: 5000 })
  check(rpcs('image.attach_bytes').some(r => r.params.filename === 'photo-1.jpg'), 'camera photo queued with image.attach_bytes')
  await page.getByRole('button', { name: 'Remove photo-1.jpg' }).click()
  await sleep(300)
  await page.screenshot({ path: path.join(SHOTS, 'hm-shot-attach.png') })

  // ── #5 share to Hermes: a new chat with the text in the composer and the files attached ──
  const draftsBefore = rpcs('session.create').length
  await page.evaluate(b64 => {
    const items = [{ name: 'shared.pdf', mime: 'application/pdf', b64: btoa('%PDF-1.4 shared') }, { name: 'shot.png', mime: 'image/png', b64 }]
    window.HermesAndroid = { sharedItem: i => JSON.stringify(items[i] || { error: 'gone' }) }
    window.hermesShared(2, 'Look at this https://example.com/a')
  }, png.toString('base64'))
  await page.locator('.attach-thumb img[alt="shot.png"]').waitFor({ timeout: 5000 })
  await page.evaluate(() => delete window.HermesAndroid)
  check((await page.getByPlaceholder('Message Hermes').inputValue()) === 'Look at this https://example.com/a', 'shared text lands in the composer')
  check(rpcs('session.create').length === draftsBefore + 1, 'sharing starts a new chat')
  const sf = rpcs('file.attach').pop()
  check(sf && sf.params.name === 'shared.pdf' && String(sf.params.data_url).startsWith('data:application/pdf;base64,'), 'shared PDF attached through file.attach')
  check(rpcs('image.attach_bytes').some(r => r.params.filename === 'shot.png'), 'shared photo attached through image.attach_bytes')
  check(rpcs('prompt.submit').length === 1, 'nothing is sent by itself')
  await page.getByRole('button', { name: 'clear', exact: true }).click()
  await page.getByPlaceholder('Message Hermes').fill('')

  // ── edit / retry keep the photos of the message (re-queued with image.attach) ──
  await attach('Photo', [{ name: 'e.png', mimeType: 'image/png', buffer: png }])
  await page.locator('.attach-thumb img[alt="e.png"]').waitFor({ timeout: 5000 })
  await page.getByPlaceholder('Message Hermes').fill('what colour?')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  await page.locator('.msg.assistant', { hasText: 'OK' }).last().waitFor({ timeout: 5000 })
  await sleep(300)
  await page.locator('.msg.user', { hasText: 'what colour?' }).last().getByRole('button', { name: 'Edit' }).click()
  check((await page.locator('.msg.user.editing img[alt="e.png"]').count()) === 1, 'editing shows the message photo')
  await page.locator('.edit-box').fill('what colour now?')
  await page.locator('.edit-send').click()
  await sleep(700)
  {
    const att = rpcs('image.attach')
    const sub = rpcs('prompt.submit').pop()
    check(att.length === 1 && att[0].params.path === '/root/.hermes/images/e.png', `edit re-queues the photo with image.attach (${JSON.stringify(att.map(a => a.params.path))})`)
    check(sub && sub.params.text === 'what colour now?' && typeof sub.params.truncate_before_row_id === 'number', 'edited text sent in place of the old turn')
    const b = page.locator('.msg.user', { hasText: 'what colour now?' }).last()
    check((await b.locator('img.msg-thumb[alt="e.png"]').count()) === 1, 'edited bubble still shows the photo')
  }
  await page.locator('.msg.assistant', { hasText: 'OK' }).last().waitFor({ timeout: 5000 })
  await sleep(300)
  await page.locator('.msg.assistant').last().getByRole('button', { name: 'Retry' }).click()
  await sleep(700)
  check(rpcs('image.attach').length === 2, `retry re-queues the photo too (${rpcs('image.attach').length})`)
  check((await page.locator('.msg.user', { hasText: 'what colour now?' }).last().locator('img.msg-thumb').count()) === 1, 'retried bubble still shows the photo')
  await page.locator('.msg.assistant', { hasText: 'OK' }).last().waitFor({ timeout: 5000 })
  await sleep(300)
  // ── edit / retry keep the attached FILES too (their @file: refs go out again) ──
  await attach('File', [{ name: 'report.txt', mimeType: 'text/plain', buffer: Buffer.from('hello report') }])
  await page.locator('.attach-chip', { hasText: 'report.txt' }).waitFor({ timeout: 5000 })
  await page.getByPlaceholder('Message Hermes').fill('about the report')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  await page.locator('.msg.assistant', { hasText: 'OK' }).last().waitFor({ timeout: 5000 })
  await sleep(300)
  check(rpcs('prompt.submit').pop().params.text === '@file:ws/report.txt\n\nabout the report', 'file message sent with its ref')
  await page.locator('.msg.user', { hasText: 'about the report' }).last().getByRole('button', { name: 'Edit' }).click()
  check((await page.locator('.msg.user.editing .attach-chip', { hasText: 'report.txt' }).count()) === 1, 'editing shows the file chip')
  await page.locator('.edit-box').fill('about the report, shorter')
  await page.locator('.edit-send').click()
  await sleep(700)
  {
    const sub = rpcs('prompt.submit').pop()
    check(sub && sub.params.text === '@file:ws/report.txt\n\nabout the report, shorter' && typeof sub.params.truncate_before_row_id === 'number', `edit sends the file ref again (${JSON.stringify(sub && sub.params.text)})`)
    const b = page.locator('.msg.user', { hasText: 'about the report, shorter' }).last()
    check((await b.locator('.chip', { hasText: 'report.txt' }).count()) === 1, 'edited bubble still shows the file chip')
  }
  await page.locator('.msg.assistant', { hasText: 'OK' }).last().waitFor({ timeout: 5000 })
  await sleep(300)
  await page.locator('.msg.assistant').last().getByRole('button', { name: 'Retry' }).click()
  await sleep(700)
  check(rpcs('prompt.submit').pop().params.text === '@file:ws/report.txt\n\nabout the report, shorter', 'retry sends the file ref again')
  await page.locator('.msg.assistant', { hasText: 'OK' }).last().waitFor({ timeout: 5000 })
  await sleep(300)
  await page.locator('.msg.user', { hasText: 'about the report, shorter' }).last().getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('button', { name: 'Remove report.txt' }).click()
  await page.locator('.edit-box').fill('without the file')
  await page.locator('.edit-send').click()
  await sleep(700)
  check(rpcs('prompt.submit').pop().params.text === 'without the file', '✕ on the file chip drops it from the edit')
  await page.locator('.msg.assistant', { hasText: 'OK' }).last().waitFor({ timeout: 5000 })
  await sleep(300)

  // ── #3 streaming a long code reply ───────────────────
  await page.getByPlaceholder('Message Hermes').fill('long code please')
  await page.getByRole('button', { name: 'Send' }).click()
  const more = page.locator('.codeblock-more')
  await more.waitFor({ timeout: 10000 })
  await page.locator('.codeblock-bar button', { hasText: 'Wrap' }).click()
  await more.click() // "Show all N lines" while still streaming
  await sleep(600)
  const midWrap = await page.locator('.codeblock.wrap').count()
  const midOpen = await page.locator('.codeblock:not(.collapsed)').count()
  check(midWrap === 1 && midOpen === 1, `Wrap + Show all survive further streamed updates (wrap=${midWrap}, open=${midOpen})`)
  await page.locator('.msg.assistant', { hasText: 'Done.' }).waitFor({ timeout: 15000 })
  await sleep(300)
  const txt = await page.locator('.msg.assistant').last().innerText()
  check(/line_39 = compute\(39\)/.test(txt) && (txt.match(/Here is the code/g) || []).length === 1, 'full reply rendered once, nothing lost')
  check((await page.locator('.codeblock.wrap').count()) === 1, 'Wrap still on after the reply finished')
  check((await page.locator('.codeblock .hljs-keyword, .codeblock .hljs-title, .codeblock .hljs-number').count()) > 0, 'code is highlighted')

  // ── #2 opening a chat mid-reply ──────────────────────
  await page.getByRole('button', { name: 'Sessions' }).click()
  await page.locator('.session-row', { hasText: 'Running chat' }).click()
  // The mock sends the first new delta 700 ms after the resume: the reply so far must be there before it.
  await page.locator('.msg.assistant', { hasText: 'First answer' }).waitFor({ timeout: 5000 })
  await sleep(250)
  check((await page.locator('.msg.assistant', { hasText: 'Streams are a sequence of' }).count()) === 1, 'reply so far is shown right away (before new deltas)')
  check((await page.locator('.msg.user .bubble', { hasText: 'Explain streams' }).count()) === 1, 'the running question shows once')
  check((await page.locator('.todos-head').innerText()).includes('1/2'), 'task list restored from todo_state')
  await sleep(1500)
  const replies = await page.locator('.msg.assistant').allInnerTexts()
  const last = replies[replies.length - 1]
  check(/^Streams are a sequence of values over time\./.test(last.trim()), `reply continues from the snapshot (${JSON.stringify(last.slice(0, 60))})`)
  check(replies.filter(r => r.includes('Streams are')).length === 1, 'no duplicate reply bubble')
  await page.screenshot({ path: path.join(SHOTS, 'hm-shot-inflight.png') })

  // ── editing a message Hermes no longer holds, with later turns: never appended at the end ──
  fs.writeFileSync(LOG, '')
  await page.getByRole('button', { name: 'Sessions' }).click()
  await page.locator('.session-row', { hasText: 'Stale edit chat' }).click()
  await page.locator('.msg.user .bubble', { hasText: 'stale first question' }).waitFor({ timeout: 5000 })
  await page.locator('.msg.user', { hasText: 'stale first question' }).getByRole('button', { name: 'Edit' }).click()
  await page.locator('.edit-box').fill('stale edited question')
  await page.locator('.edit-send').click()
  await sleep(1200)
  {
    const subs = rpcs('prompt.submit')
    check(subs.length === 1 && subs[0].params.truncate_before_row_id === 999, `only the truncating submit was sent, no plain append (${JSON.stringify(subs.map(c => c.params))})`)
    check((await page.locator('.toast', { hasText: "isn't in this chat's history" }).count()) === 1, 'the user is told why')
    const users = await page.locator('.msg.user .bubble').allInnerTexts()
    check(users.join('|') === 'stale first question|stale second question', `chat reloaded as Hermes holds it (${JSON.stringify(users)})`)
  }

  // ── #7 show older chats ──────────────────────────────
  await page.getByRole('button', { name: 'Sessions' }).click()
  const olderBtn = page.getByRole('button', { name: 'Show older chats' })
  await olderBtn.waitFor({ timeout: 5000 })
  const before = await page.locator('.drawer .session-row').count()
  await olderBtn.click()
  await page.waitForFunction(() => document.querySelectorAll('.drawer .session-row').length > 100, null, { timeout: 5000 })
  const after = await page.locator('.drawer .session-row').count()
  const lim = rpcs('session.list').map(c => c.params.limit)
  check(before === 80 && after === 152 && lim.includes(180), `older chats load (${before} → ${after}, limits ${[...new Set(lim)]})`)
  check((await olderBtn.count()) === 0, 'button hides when everything is loaded')

  // ── deleting a chat also clears its leftover photos/files/canvas on the phone ──
  const lastRow = page.locator('.drawer .session-row').last()
  const delId = await lastRow.evaluate(el => el.textContent)
  await lastRow.getByRole('button', { name: 'Chat options' }).click()
  await page.locator('.menu-item.danger').click()
  await page.locator('.dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await sleep(600)
  const delRpcs = rpcs("session.delete")
  const cleanups = calls().filter(c => c.http === 'POST' && c.path === '/api/plugins/hermes-mobile/cleanup')
  check(delRpcs.length === 1 && cleanups.length === 1 && Array.isArray(cleanups[0].body?.keep), `deleting a chat asks the plugin to clean up (${delRpcs.length} delete, ${cleanups.length} cleanup, row ${JSON.stringify(delId.slice(0, 30))})`)
  await page.mouse.click(360, 400) // close drawer (backdrop)
  await sleep(400)

  // ── #8 canvas: an edit made right before switching chats is saved ──
  await page.getByRole('button', { name: 'Canvas' }).first().click()
  await page.locator('.canvas-panel').waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'New document' }).first().click()
  await page.locator('.picker-opt, .set-row', { hasText: 'Notes / document' }).click()
  await page.locator('.dialog input').fill('Plan')
  await page.locator('.dialog button', { hasText: 'Create' }).click()
  const editor = page.locator('textarea.editor-text')
  await editor.waitFor({ timeout: 5000 })
  const storedBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('hm.lastSession') || '{}').id)
  await editor.fill('typed just before switching')
  await page.evaluate(() => window.hermesOpenSession('s-5')) // e.g. a notification tapped right away
  await sleep(800)
  const puts = calls().filter(c => c.http === 'PUT' && c.path === '/api/plugins/hermes-mobile/canvas/doc')
  check(puts.length === 1 && puts[0].body.content === 'typed just before switching' && puts[0].body.session === storedBefore, `pending canvas edit saved to its own chat (${JSON.stringify(puts.map(p => [p.body.session, p.body.content]))}, chat ${storedBefore})`)

  // ── #9 canvas html: offline CSP blocks forms; alert() → app toast ──
  await page.locator('.msg.assistant', { hasText: 'answer s-5' }).waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'Canvas' }).first().click()
  await page.getByRole('button', { name: 'New document' }).first().click()
  await page.locator('.picker-opt, .set-row', { hasText: 'Web page' }).click()
  await page.locator('.dialog input').fill('Page')
  await page.locator('.dialog button', { hasText: 'Create' }).click()
  await editor.waitFor({ timeout: 5000 })
  await editor.fill('<p>hi</p><script>alert("hello from the page")</script>')
  await page.locator('.canvas-toolbar .seg button', { hasText: 'Run' }).click()
  await page.locator('.toast', { hasText: 'hello from the page' }).waitFor({ timeout: 5000 }).then(
    () => check(true, 'alert() shows as an app toast'),
    () => check(false, 'alert() shows as an app toast')
  )
  const srcdoc = await page.locator('iframe.html-frame').getAttribute('srcdoc')
  check(srcdoc.includes("form-action 'none'"), 'offline CSP includes form-action none')
  // A link in the page asks to open outside instead of loading inside the frame.
  await page.locator('.canvas-toolbar .seg button', { hasText: 'Edit' }).click()
  await editor.fill('<a id="l" href="https://example.com/x">go</a>')
  await page.locator('.canvas-toolbar .seg button', { hasText: 'Run' }).click()
  // Tap once the page has loaded (a click racing the srcdoc load was sometimes lost in headless Chromium).
  await page.frameLocator('iframe.html-frame').locator('#l').waitFor()
  await sleep(300)
  await page.frameLocator('iframe.html-frame').locator('#l').click()
  const linkDlg = page.locator('.dialog', { hasText: 'https://example.com/x' })
  await linkDlg.waitFor({ timeout: 5000 }).then(() => check(true, 'canvas link asks to open outside'), () => check(false, 'canvas link asks to open outside'))
  const frameUrl = await page.frameLocator('iframe.html-frame').locator('body').evaluate(() => location.href)
  check(frameUrl === 'about:srcdoc', `frame stayed on the document (${frameUrl})`)
  await linkDlg.locator('button', { hasText: 'Cancel' }).click()
  await page.screenshot({ path: path.join(SHOTS, 'hm-shot-canvas.png') })

  // ── Canvas gallery: every chat's canvas documents by type, searchable, opened on their own chat's canvas ──
  await page.getByRole('button', { name: 'New document' }).first().click()
  await page.locator('.picker-opt, .set-row', { hasText: 'Notes / document' }).click()
  await page.locator('.dialog input').fill('Soup')
  await page.locator('.dialog button', { hasText: 'Create' }).click()
  await editor.waitFor({ timeout: 5000 })
  await editor.fill('# Soup\n\nTomato and basil')
  await sleep(1200) // autosave
  await page.getByRole('button', { name: 'More' }).click()
  check((await page.locator('.set-row', { hasText: /Save to library|Gallery category/ }).count()) === 0, 'gallery: nothing to save or file from the canvas menu')
  await page.evaluate(() => window.hermesBack())
  await page.getByRole('button', { name: 'Close canvas' }).click()
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.locator('.nav-tile', { hasText: 'Hermes' }).click()
  await page.locator('.hub-card', { hasText: 'Canvas gallery' }).filter({ hasText: /\d+ documents/ }).waitFor({ timeout: 5000 }).then(() => check(true, 'hub: gallery summary'), () => check(false, 'hub: gallery summary'))
  await page.locator('.hub-card', { hasText: 'Canvas gallery' }).click()
  await page.locator('.lib-cats button', { hasText: 'HTML 1' }).waitFor({ timeout: 5000 }).then(() => check(true, 'gallery: categories are the types, with counts'), () => check(false, 'gallery: categories are the types, with counts'))
  check((await page.locator('.lib-cats button', { hasText: /^Markdown \d/ }).count()) === 1, 'gallery: a Markdown category')
  check((await page.locator('.gallery-card', { hasText: 'Plan' }).count()) === 1 && (await page.locator('.gallery-card', { hasText: 'Page' }).count()) === 1, 'gallery: documents from every chat, nothing saved by hand')
  check((await page.locator('.gallery-card', { hasText: 'Soup' }).locator('.gallery-from', { hasText: 'Chat 5' }).count()) === 1, 'gallery: each card names its chat')
  await page.screenshot({ path: path.join(SHOTS, 'hm-shot-gallery.png') })
  await page.locator('.lib-cats button', { hasText: 'HTML 1' }).click()
  check((await page.locator('.gallery-card').count()) === 1 && (await page.locator('.gallery-card', { hasText: 'Page' }).count()) === 1, 'gallery: a type chip filters the list')
  await page.locator('.lib-cats button', { hasText: /^All/ }).click()
  // Search: by content (Soup's text), then by title, then no match.
  await page.getByPlaceholder('Search titles and text…').fill('basil')
  await page.waitForFunction(() => document.querySelectorAll('.gallery-card').length === 1, null, { timeout: 5000 }).then(() => check(true, 'gallery: search finds a document by its text'), () => check(false, 'gallery: search finds a document by its text'))
  check((await page.locator('.gallery-card', { hasText: 'Soup' }).count()) === 1, 'gallery: the right one')
  {
    const s = calls().filter(c => c.http === 'GET' && c.path === '/api/plugins/hermes-mobile/gallery' && /q=/.test(c.query))
    check(s.length >= 1 && new URLSearchParams(s[s.length - 1].query).get('q') === 'basil', `gallery: Hermes is asked to search (${s.map(c => c.query).join(' ')})`)
    check(s.length <= 2, `gallery: typing doesn't send a search per key (${s.length})`)
  }
  await page.getByPlaceholder('Search titles and text…').fill('plan')
  await page.waitForFunction(() => [...document.querySelectorAll('.gallery-card .gallery-title')].map(e => e.textContent).join() === 'Plan', null, { timeout: 5000 }).then(() => check(true, 'gallery: search by title'), () => check(false, 'gallery: search by title'))
  await page.getByPlaceholder('Search titles and text…').fill('zzz-nothing')
  await page.getByText('Nothing matches “zzz-nothing”').waitFor({ timeout: 5000 }).then(() => check(true, 'gallery: no match says so'), () => check(false, 'gallery: no match says so'))
  // Leaving and coming back starts with an empty search box and the whole gallery.
  await page.evaluate(() => window.hermesBack())
  await page.locator('.hub-card', { hasText: 'Canvas gallery' }).click()
  check((await page.getByPlaceholder('Search titles and text…').inputValue()) === '', 'gallery: the last search is not kept')
  await page.waitForFunction(() => document.querySelectorAll('.gallery-card').length >= 3, null, { timeout: 5000 }).then(() => check(true, 'gallery: back to the whole list'), () => check(false, 'gallery: back to the whole list'))
  check((await page.getByText(/Nothing matches/).count()) === 0, 'gallery: no stale "Nothing matches"')
  // An old Library copy saved without a chat: "Saved copy", not "Chat deleted"; its ⋮ shares the label's row.
  check((await page.locator('.gallery-card', { hasText: 'Old notes' }).locator('.gallery-from', { hasText: 'Saved copy' }).count()) === 1, 'gallery: a copy saved without a chat says Saved copy')
  check((await page.locator('.gallery-card', { hasText: 'Old notes' }).locator('.gallery-from', { hasText: 'Chat deleted' }).count()) === 0, 'gallery: no "Chat deleted" for it')
  await page.locator('.gallery-card', { hasText: 'Old notes' }).click()
  await page.locator('.lib-viewer .canvas-md', { hasText: 'Kept from before' }).waitFor({ timeout: 5000 }).then(() => check(true, 'gallery: saved copy preview'), () => check(false, 'gallery: saved copy preview'))
  {
    const bar = page.locator('.lib-viewer-bar')
    check((await bar.getByRole('button', { name: /Open canvas|Go to chat/ }).count()) === 0, 'gallery: a saved copy has no chat buttons')
    check((await bar.locator('span', { hasText: 'saved copy' }).count()) === 1, 'gallery: the preview says saved copy')
    const label = await bar.locator('> span').boundingBox()
    const dots = await bar.getByRole('button', { name: 'Item options' }).boundingBox()
    check(!!label && !!dots && dots.y < label.y + label.height && dots.x > label.x, `gallery: the ⋮ sits on the label's row, not alone (${JSON.stringify({ label, dots })})`)
  }
  await page.evaluate(() => window.hermesBack())
  await page.locator('.lib-viewer').waitFor({ state: 'detached', timeout: 3000 })
  await page.waitForFunction(() => document.querySelectorAll('.gallery-card').length >= 3, null, { timeout: 5000 })
  await page.locator('.gallery-card', { hasText: 'Page' }).click()
  await page.locator('.lib-viewer iframe.html-frame').waitFor({ timeout: 5000 }).then(() => check(true, 'gallery: a web page runs in the preview (offline sandbox)'), () => check(false, 'gallery: a web page runs in the preview (offline sandbox)'))
  await page.evaluate(() => window.hermesBack())
  await page.locator('.gallery-card', { hasText: 'Soup' }).click()
  await page.locator('.lib-viewer .canvas-md', { hasText: 'Tomato and basil' }).waitFor({ timeout: 5000 }).then(() => check(true, 'gallery: markdown preview'), () => check(false, 'gallery: markdown preview'))
  check((await page.locator('.lib-viewer-bar', { hasText: 'from “Chat 5”' }).count()) === 1, 'gallery: the preview says which chat it is from')
  await page.getByRole('button', { name: 'Item options' }).click()
  check((await page.locator('.set-row', { hasText: 'Move to category' }).count()) === 0, 'gallery: no hand-made categories')
  await page.evaluate(() => window.hermesBack())
  await sleep(300)
  await page.evaluate(() => window.hermesBack())
  await page.locator('.lib-viewer').waitFor({ state: 'detached', timeout: 3000 })
  // Open canvas: goes to the chat the document was made in (not the one on screen) with its canvas on it.
  await page.locator('.gallery-card', { hasText: 'Plan' }).click()
  await page.getByRole('button', { name: 'Open canvas' }).click()
  await page.locator('.canvas-panel').waitFor({ timeout: 5000 })
  await sleep(800)
  {
    const now = await page.evaluate(() => JSON.parse(localStorage.getItem('hm.lastSession') || '{}').id)
    check(now === storedBefore, `gallery: Open canvas went to the document's own chat (${now}, want ${storedBefore})`)
    check((await page.locator('.screen').count()) === 0, 'gallery: the screen closes for the canvas')
    check((await page.locator('.canvas-tab.on', { hasText: 'Plan' }).count()) === 1, 'gallery: the canvas shows that document')
  }
  await page.getByRole('button', { name: 'Close canvas' }).click()
  // Go to chat: back to Chat 5 without the canvas.
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.locator('.nav-tile', { hasText: 'Hermes' }).click()
  await page.locator('.hub-card', { hasText: 'Canvas gallery' }).click()
  await page.locator('.gallery-card', { hasText: 'Soup' }).click()
  await page.getByRole('button', { name: 'Go to chat' }).click()
  await page.locator('.msg.assistant', { hasText: 'answer s-5' }).waitFor({ timeout: 5000 }).then(() => check(true, 'gallery: Go to chat opens the chat it was made in'), () => check(false, 'gallery: Go to chat opens the chat it was made in'))
  check((await page.locator('.canvas-panel').count()) === 0 && (await page.locator('.screen').count()) === 0, 'gallery: Go to chat leaves the canvas closed')
  // Delete removes it from its chat's canvas.
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.locator('.nav-tile', { hasText: 'Hermes' }).click()
  await page.locator('.hub-card', { hasText: 'Canvas gallery' }).click()
  await page.locator('.gallery-card', { hasText: 'Plan' }).click()
  await page.getByRole('button', { name: 'Item options' }).click()
  await page.locator('.set-row', { hasText: 'Delete' }).click()
  await page.locator('.dialog button', { hasText: 'Delete' }).click()
  await page.locator('.gallery-card', { hasText: 'Plan' }).waitFor({ state: 'detached', timeout: 5000 }).then(() => check(true, 'gallery: delete'), () => check(false, 'gallery: delete'))
  {
    const del = calls().filter(c => c.http === 'DELETE' && c.path === '/api/plugins/hermes-mobile/canvas/doc')
    check(del.length === 1 && new URLSearchParams(del[0].query).get('session') === storedBefore, `gallery: delete removes it from its own chat's canvas (${JSON.stringify(del.map(d => d.query))})`)
  }
  await page.evaluate(() => window.hermesBack())
  await page.evaluate(() => window.hermesBack())
  await sleep(300)
  check((await page.locator('.screen').count()) === 0, 'gallery: Back returns to the hub, then the chat')
  await page.getByRole('button', { name: 'Canvas' }).first().click()
  await page.locator('.canvas-panel').waitFor({ timeout: 5000 })

  // ── #6 answers typed into a notification (RemoteInput → HermesService → window.hermesAnswer) ──
  await page.getByRole('button', { name: 'Close canvas' }).click()
  await page.getByPlaceholder('Message Hermes').fill('ask me')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  await page.getByText('Which colour?').first().waitFor({ timeout: 5000 })
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hm.lastSession') || '{}').id)
  check((await page.evaluate(s => window.hermesAnswer('ask', s, 'Blue'), stored)) === 'y', 'notification answer taken by the page')
  await sleep(400)
  const ans = calls().filter(c => c.answer === 'srv-clarify-1')
  check(ans.length === 1 && ans[0].result && ans[0].result.answer === 'Blue', `clarify answered with the typed text (${JSON.stringify(ans)})`)
  check((await page.getByText('Which colour?').count()) === 0, 'question sheet closes')
  check((await page.evaluate(s => window.hermesAnswer('ask', s, 'again'), stored)) === 'n', 'no open question → not taken (service offers to open the app)')
  check((await page.evaluate(() => window.hermesAnswer('reply', 's-7', 'sent from the notification'))) === 'y', 'notification reply taken')
  await page.locator('.msg.user .bubble', { hasText: 'sent from the notification' }).waitFor({ timeout: 5000 })
  const rs = rpcs('prompt.submit').pop()
  check(rs && rs.params.text === 'sent from the notification' && rs.params.session_id === 'rt-s-7', `reply goes to its own chat (${JSON.stringify(rs && rs.params)})`)

  // ── A huge approval warning: buttons stay on screen, a repeated finding shows once with its count ──
  await page.getByPlaceholder('Message Hermes').fill('run the long thing')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  await page.locator('.sheet .sheet-title', { hasText: 'Approve' }).waitFor({ timeout: 5000 })
  const vh = page.viewportSize().height
  for (const label of ['Allow once', 'Deny']) {
    const box = await page.locator('.sheet').getByRole('button', { name: label }).boundingBox()
    check(box && box.y >= 0 && box.y + box.height <= vh, `long approval: "${label}" button on screen (${JSON.stringify(box)})`)
  }
  const descText = (await page.locator('.sheet .sheet-desc').textContent()) || ''
  check(/\(×20\)/.test(descText) && descText.split('[HIGH]').length === 2, `repeated finding shown once with ×20 (${descText.slice(0, 160)})`)
  await page.locator('.sheet').getByRole('button', { name: 'Allow once' }).click()
  await sleep(400)
  const la = calls().filter(c => c.answer === 'srv-approval-long')
  check(la.length === 1 && la[0].result && la[0].result.choice === 'once', `long approval answered from its button (${JSON.stringify(la)})`)

  // ── #11 long chats: draw the end first, earlier turns on scroll, without moving what's on screen ──
  await page.evaluate(() => window.hermesOpenSession('s-long'))
  await page.locator('.msg.assistant', { hasText: 'answer 149' }).waitFor({ timeout: 5000 })
  const drawn = await page.locator('.chat .msg').count()
  check(drawn <= 120 && drawn >= 40, `only the end is drawn on open (${drawn} of 300)`)
  const atBottom = await page.locator('.chat').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  check(atBottom, 'opens at the bottom')
  const firstSeen = await page.locator('.chat .msg').first().textContent()
  await page.locator('.chat').evaluate(el => (el.scrollTop = 0))
  // Measure the message that WAS first (by its text): the earlier turns may already be in by now, and then
  // `.first()` would be one of them (seen as a flaky "-3935 → 125").
  const topBefore = await page.locator('.chat .msg', { hasText: firstSeen }).first().evaluate(el => el.getBoundingClientRect().top)
  await page.waitForFunction(n => document.querySelectorAll('.chat .msg').length > n, drawn, { timeout: 5000 }).catch(() => {})
  await sleep(300)
  const topAfter = await page.locator('.chat .msg', { hasText: firstSeen }).first().evaluate(el => el.getBoundingClientRect().top)
  check((await page.locator('.chat .msg').count()) > drawn, 'scrolling up draws earlier turns')
  check(Math.abs(topAfter - topBefore) < 4, `the message that was first stays where it was (${Math.round(topBefore)} → ${Math.round(topAfter)})`)
  for (let k = 0; k < 10 && (await page.locator('.msg.user', { hasText: 'question 0' }).count()) === 0; k++) {
    await page.locator('.chat').evaluate(el => (el.scrollTop = 0))
    await sleep(400)
  }
  check((await page.locator('.msg.user .bubble').filter({ hasText: /^question 0$/ }).count()) === 1, `scrolling to the very top reaches the first turn (${firstSeen.slice(0, 20)}…)`)
  check((await page.locator('.chat-earlier').count()) === 0, 'no "earlier" row once everything is drawn')

  // ── opening chats: the cached copy shows at once, the chat you left is not closed first ──
  const mark = calls().length
  const since = () => calls().slice(mark)
  const open = async id => {
    await page.evaluate(i => window.hermesOpenSession(i), id)
    await page.locator('.msg.assistant', { hasText: `answer ${id}` }).waitFor({ timeout: 5000 })
    await page.waitForFunction(() => !document.querySelector('.composer textarea')?.placeholder.startsWith('Opening'), null, { timeout: 5000 })
  }
  await open('s-slow')
  await open('s-3')
  const t0 = Date.now()
  await page.evaluate(() => window.hermesOpenSession('s-slow'))
  await page.locator('.msg.assistant', { hasText: 'answer s-slow' }).waitFor({ timeout: 1000 })
  const shownIn = Date.now() - t0
  check(shownIn < 600, `reopened chat drawn from the cache before Hermes answers (${shownIn} ms, resume takes 1500)`)
  check((await page.locator('.title', { hasText: 's-slow' }).count()) === 1, 'header shows the opening chat while it loads')
  check((await page.locator('.msg-actions button, .msg-act').count()) === 0, 'no message actions on the cached copy')
  check((await page.getByPlaceholder('Opening your chat…').count()) === 1, 'composer waits for the real chat')
  await page.getByPlaceholder('Message Hermes').waitFor({ timeout: 5000 })
  check((await page.locator('.msg.assistant', { hasText: 'answer s-slow' }).count()) === 1, 'real transcript replaces the cached one, no duplicates')
  await open('s-4')
  await open('s-6')
  const seq = since().filter(c => c.rpc === 'session.resume' || c.rpc === 'session.close').map(c => `${c.rpc === 'session.close' ? 'close' : 'resume'}:${c.params.session_id}`)
  check(!seq.some(x => x.startsWith('close')), `nothing closed on the way into a chat (${seq.join(' ')})`)
  await sleep(3500)
  const closed = since().filter(c => c.rpc === 'session.close').map(c => c.params.session_id)
  check(closed.includes('rt-s-3') && closed.includes('rt-s-long') && !['rt-s-4', 'rt-s-slow', 'rt-s-6'].some(x => closed.includes(x)), `older chats closed afterwards, the open one and the last 2 left stay live (${closed})`)

  // two chats opened in a row: the second wins even though the first one's answer arrives later
  await page.evaluate(() => { window.hermesOpenSession('s-slow'); window.hermesOpenSession('s-3') })
  await page.locator('.msg.assistant', { hasText: 'answer s-3' }).waitFor({ timeout: 5000 })
  await sleep(2200) // s-slow's resume (1500 ms) lands now and must not replace s-3
  check((await page.locator('.msg.assistant', { hasText: 'answer s-slow' }).count()) === 0 && (await page.locator('.msg.assistant', { hasText: 'answer s-3' }).count()) === 1, 'second chat opened wins over the slower first one')

  // ── #25 Mermaid ships as inert text in the built page and runs on the first diagram ──
  check(await page.evaluate(() => document.getElementById('hm-mermaid')?.type === 'text/hm-lazy' && !window.__hmMermaid), 'Mermaid not run at start')
  await page.getByPlaceholder('Message Hermes').fill('show diagram')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  await page.locator('.msg.assistant svg', { hasText: 'Start' }).first().waitFor({ timeout: 15000 }).then(() => check(true, 'diagram renders from the lazy Mermaid'), () => check(false, 'diagram renders from the lazy Mermaid'))

  // ── OpenUI: ```openui-lang blocks render as cards from the lazy bundle; buttons and forms answer ──
  check(await page.evaluate(() => document.getElementById('hm-openui')?.type === 'text/hm-lazy' && !window.__hmOpenUI), 'OpenUI not run at start')
  {
    const idle = () => page.locator('.composer').getByRole('button', { name: 'Send' }).waitFor({ timeout: 8000 }).catch(() => {})
    const lastSubmit = () => rpcs('prompt.submit').pop()?.params.text
    await page.getByPlaceholder('Message Hermes').fill('show ui')
    await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
    const card = page.locator('.msg.assistant .hm-openui').last()
    await card.getByText('Pick a plan').waitFor({ timeout: 15000 }).then(() => check(true, 'openui card renders'), () => check(false, 'openui card renders'))
    check((await page.locator('.msg.assistant .codeblock', { hasText: 'Pick a plan' }).count()) === 0, 'the card replaces the code')
    await idle()
    let n = rpcs('prompt.submit').length
    await card.getByRole('button', { name: 'Option A' }).click({ timeout: 5000 }).catch(() => {})
    for (let i = 0; i < 30 && rpcs('prompt.submit').length === n; i++) await sleep(100)
    check(lastSubmit() === 'Pick A', `a card button sends its words (${lastSubmit()})`)
    await idle()
    n = rpcs('prompt.submit').length
    await card.locator('input[name="name"]').fill('Omar', { timeout: 5000 }).catch(() => {})
    await card.getByRole('button', { name: 'Send' }).click({ timeout: 5000 }).catch(() => {})
    for (let i = 0; i < 30 && rpcs('prompt.submit').length === n; i++) await sleep(100)
    check(lastSubmit() === 'Here are my details\n\n- name: Omar', `a form sends its values (${JSON.stringify(lastSubmit())})`)
    await idle()
    n = rpcs('prompt.submit').length
    await card.getByText('Compare both').click({ timeout: 5000 }).catch(() => {})
    for (let i = 0; i < 30 && rpcs('prompt.submit').length === n; i++) await sleep(100)
    check(lastSubmit() === 'Compare both', `a follow-up sends its words, without the form's values (${JSON.stringify(lastSubmit())})`)
    await idle()
    await page.getByPlaceholder('Message Hermes').fill('show ui streaming')
    await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
    const card2 = page.locator('.msg.assistant .hm-openui').last()
    await card2.getByText('Pick a plan').waitFor({ timeout: 15000 }).then(() => check(true, 'a streamed card renders'), () => check(false, 'a streamed card renders'))
    await idle()
    check((await page.locator('.msg.assistant', { hasText: 'Streaming plans' }).locator('.codeblock').count()) === 0, 'no "not shown" fallback after a streamed card')
    await page.getByPlaceholder('Message Hermes').fill('show broken ui')
    await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
    await page.locator('.msg.assistant .codeblock', { hasText: 'openui-lang (not shown)' }).waitFor({ timeout: 15000 }).then(() => check(true, 'broken openui-lang falls back to the code'), () => check(false, 'broken openui-lang falls back to the code'))
    await idle()
  }

  // ── tool calls fold into one "Ran N tools" line; tap opens them ──
  await page.getByPlaceholder('Message Hermes').fill('use tools')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  await page.locator('.msg.assistant', { hasText: 'All four done.' }).waitFor({ timeout: 5000 })
  const run = page.locator('.tool-run').last()
  check(((await run.textContent()) || '').includes('Ran 4 tools · 6s'), `one folded line for the run (${await run.textContent()})`)
  const visibleCards = () => page.locator('.tool:visible', { hasText: /step [0-3]/ }).count()
  check((await visibleCards()) === 0, 'its cards are hidden')
  await run.click()
  check((await visibleCards()) === 4, `tap shows all four (${await visibleCards()})`)
  await run.click()
  check((await visibleCards()) === 0, 'tap again folds them')

  // ── web addresses in plain text open with the phone's default handler (window.open in a browser) ──
  await page.getByPlaceholder('Message Hermes').fill('see https://example.com/b')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  await page.locator('.msg.assistant', { hasText: 'Read' }).last().waitFor({ timeout: 5000 })
  {
    // openExternal's browser path is window.open; record the calls instead of opening real tabs.
    await page.evaluate(() => { window.__opened = []; window.__realOpen = window.open; window.open = u => { window.__opened.push(String(u)); return null } })
    const own = page.locator('.msg.user .bubble a.auto-link', { hasText: 'https://example.com/b' })
    check((await own.count()) === 1, 'a web address in my own message is a link')
    if (await own.count()) await own.click()
    const head = page.locator('.tool-head', { hasText: 'web_extract' }).last()
    if (await head.count()) await head.click()
    else await page.locator('.tool-run').last().click().then(() => page.locator('.tool-head', { hasText: 'web_extract' }).last().click())
    const out = page.locator('.tool-pre a.auto-link', { hasText: 'https://example.com/a' })
    check((await out.count()) >= 1 && (await out.last().textContent()) === 'https://example.com/a', 'a web address in a tool output is a link (trailing dot left out)')
    if (await out.count()) await out.last().click()
    const code = page.locator('.msg.assistant a.code-link code', { hasText: 'https://example.com/c' })
    check((await code.count()) === 1, 'a web address in inline code is a link')
    if (await code.count()) await code.click()
    check((await page.locator('.msg.assistant pre a', { hasText: 'example.com/d' }).count()) === 0, 'a code block stays plain')
    await sleep(300)
    const opened = await page.evaluate(() => window.__opened)
    check(['https://example.com/b', 'https://example.com/a', 'https://example.com/c'].every(u => opened.includes(u)), `tapping each opens it (${JSON.stringify(opened)})`)
    check((await page.locator('.msg.user .msg-time').count()) === 0, 'a link tap does not toggle the message time')
    await page.evaluate(() => { window.open = window.__realOpen })
  }

  // ── battery: while the open chat's turn waits on a command, the app doesn't poll the canvas (closed) and
  //    polls the activity feed at the idle pace, not every 3 s; one poll right after the turn ends ──
  const waitMark = calls().length
  await page.getByPlaceholder('Message Hermes').fill('wait a while')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  await sleep(6500)
  const during = calls().slice(waitMark)
  const canvasPolls = during.filter(c => c.http === 'GET' && c.path === '/api/plugins/hermes-mobile/canvas').length
  const activityPolls = during.filter(c => c.path === '/api/plugins/hermes-mobile/activity').length
  check(canvasPolls === 0, `no canvas polling during a turn with the panel closed (${canvasPolls})`)
  check(activityPolls <= 1, `activity polled at the idle pace during the open chat's own turn (${activityPolls} in 6.5 s)`)
  await page.locator('.msg.assistant', { hasText: 'Waited.' }).waitFor({ timeout: 5000 })
  const endMark = calls().length
  await sleep(3500)
  check(calls().slice(endMark).some(c => c.path === '/api/plugins/hermes-mobile/activity'), 'activity polled once right after the turn (the review starts then)')

  // ── the model Hermes reports sits above the composer; tap opens the picker ──
  const chip = page.locator('.model-chip')
  check(((await chip.textContent()) || '').includes('mock-model'), `model chip shows the chat's model (${await chip.textContent()})`)
  await chip.click()
  await page.locator('.sheet', { hasText: 'mock-sonnet' }).first().waitFor({ timeout: 3000 }).then(() => check(true, 'chip opens the model picker'), () => check(false, 'chip opens the model picker'))
  await page.evaluate(() => window.hermesBack())

  // ── canvas: a long canvas call opens the panel on a "writing" state, then shows the document ──
  await page.getByPlaceholder('Message Hermes').fill('write canvas')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  await sleep(400)
  check((await page.locator('.canvas-panel').count()) === 0, 'a short tool call does not open the canvas')
  await page.locator('.canvas-writing .canvas-skeleton').waitFor({ timeout: 4000 }).then(() => check(true, 'still writing after a moment: panel opens with the writing state'), () => check(false, 'still writing after a moment: panel opens with the writing state'))
  check((await page.locator('.canvas-btn.writing').count()) === 1, 'the header canvas button pulses')
  await page.locator('.canvas-writing-preview', { hasText: 'Step one' }).waitFor({ timeout: 4000 }).then(() => check(true, 'the text shows once the call starts'), () => check(false, 'the text shows once the call starts'))
  await page.locator('.canvas-tab', { hasText: 'Plan' }).waitFor({ timeout: 5000 }).then(() => check(true, 'then the saved document replaces it'), () => check(false, 'then the saved document replaces it'))
  check((await page.locator('.canvas-writing').count()) === 0 && (await page.locator('.canvas-btn.writing').count()) === 0, 'writing state gone')
  // ── canvas: "Saved ✓" goes back to "<when> · <who>" (it used to stay forever) ──
  await sleep(300)
  check(/just now · Hermes/.test(await page.locator('.save-state').innerText()), `idle label says who wrote it (${await page.locator('.save-state').innerText()})`)
  await page.locator('.canvas-toolbar .seg button', { hasText: 'Edit' }).click()
  await page.locator('textarea.editor-text').fill('# Plan\n\nStep one x')
  await page.locator('.save-state', { hasText: 'Saved ✓' }).waitFor({ timeout: 3000 }).then(() => check(true, 'canvas edit shows Saved ✓'), () => check(false, 'canvas edit shows Saved ✓'))
  await sleep(2600)
  {
    const s = await page.locator('.save-state').innerText()
    check(/just now · You/.test(s), `"Saved ✓" returns to "just now · You" (${s})`)
  }
  await page.locator('.canvas-x').click()

  // ── #12 media streams through the shell's URL (no base64 through /api/files/read) ──
  await page.evaluate(() => (window.HermesAndroid = { mediaBase: () => 'http://127.0.0.1:9119/m?k=K&p=' }))
  await page.getByPlaceholder('Message Hermes').fill('show media')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  const img = page.locator('img.media').last()
  await img.waitFor({ state: 'attached', timeout: 5000 })
  await img.evaluate(i => i.scrollIntoView())
  await page.waitForFunction(() => { const i = [...document.querySelectorAll('img.media')].pop(); return i && i.complete && i.naturalWidth > 0 }, null, { timeout: 5000 }).catch(() => {})
  const src = await img.getAttribute('src')
  check(src === 'http://127.0.0.1:9119/m?k=K&p=' + encodeURIComponent('/root/pics/my pic.png'), `image uses the streamed URL (${src})`)
  check(await img.evaluate(i => i.naturalWidth > 0), 'streamed image loads')
  check(!calls().some(c => c.path === '/api/files/read'), 'nothing read as base64')
  await page.evaluate(() => delete window.HermesAndroid)

  // ── #13 unread dot + time ago: a reply finishes in another chat while the app is open ──
  const mock = b => fetch('http://127.0.0.1:9119/__mock', { method: 'POST', body: JSON.stringify(b) })
  check((await page.locator('.unread-dot').count()) === 0, 'nothing unread at first, nor after "Show older chats"')
  await mock({ activity: [{ session: 's-9', text: 'Thinking…', short: 'Thinking', profile: 'default', review: false, ts: Date.now() / 1000 }] })
  // The feed is polled every 9 s while empty (#34), then every 3 s while something runs.
  await page.locator('.activity-banner').first().waitFor({ timeout: 12000 }).then(() => check(true, 'activity banner within one idle poll'), () => check(false, 'activity banner within one idle poll'))
  await sleep(500)
  await mock({ activity: [], bump: 's-9' })
  await page.locator('.unread-dot.on-menu').waitFor({ timeout: 8000 }).then(() => check(true, 'menu button shows an unread dot'), () => check(false, 'menu button shows an unread dot'))
  await page.getByRole('button', { name: /^Sessions/ }).click()
  const row9 = page.locator('.session-row').filter({ has: page.locator('.session-title', { hasText: /^Chat 9$/ }) })
  check((await row9.locator('.unread-dot').count()) === 1, 'the chat with the new reply has a dot')
  check(/^now · 4 msgs/.test((await row9.locator('.dim.small').textContent()) || ''), `row shows when it changed (${await row9.locator('.dim.small').textContent()})`)
  check(/^\d+ h · /.test((await page.locator('.session-row').filter({ has: page.locator('.session-title', { hasText: /^Chat 12$/ }) }).locator('.dim.small').textContent()) || ''), 'older chats show hours ago')
  await row9.click()
  await page.locator('.msg.assistant', { hasText: 'answer s-9' }).waitFor({ timeout: 5000 })
  check((await page.locator('.unread-dot').count()) === 0, 'opening the chat clears the dot')

  // ── #14 drafts are kept per chat ──
  const box = page.getByPlaceholder('Message Hermes')
  await box.fill('draft for nine')
  await page.evaluate(() => window.hermesOpenSession('s-8'))
  await page.locator('.msg.assistant', { hasText: 'answer s-8' }).waitFor({ timeout: 5000 })
  check((await box.inputValue()) === '', 'another chat starts with an empty box')
  await box.fill('eight')
  await page.evaluate(() => window.hermesOpenSession('s-9'))
  await page.locator('.msg.assistant', { hasText: 'answer s-9' }).waitFor({ timeout: 5000 })
  check((await box.inputValue()) === 'draft for nine', `back in the first chat its draft is there (${await box.inputValue()})`)
  await page.evaluate(() => window.hermesOpenSession('s-8'))
  await page.locator('.msg.assistant', { hasText: 'answer s-8' }).waitFor({ timeout: 5000 })
  check((await box.inputValue()) === 'eight', 'and the other one keeps its own')

  // ── #16 share a chat as Markdown (browser: copied) ──
  await page.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve() } })
  await page.locator('header.topbar').getByRole('button', { name: 'Chat options' }).click()
  await page.locator('.menu-item', { hasText: 'Share chat' }).click()
  await page.locator('.toast', { hasText: 'Copied as Markdown' }).waitFor({ timeout: 3000 }).catch(() => {})
  const md = await page.evaluate(() => window.__copied)
  check(md && md.startsWith('# s-8\n') && md.includes('**You:**\n\nhello s-8') && md.includes('**Hermes:**\n\nanswer s-8'), `chat exported as Markdown (${JSON.stringify(md && md.slice(0, 90))})`)

  // ── #17 compress suggestion near a full context ──
  await page.evaluate(() => window.hermesOpenSession('s-full'))
  const hint = page.locator('.compress-hint')
  await hint.waitFor({ timeout: 5000 }).then(() => check(true, 'hint shows at 85% context'), () => check(false, 'hint shows at 85% context'))
  await hint.getByRole('button', { name: 'Compress' }).click()
  await page.locator('.notice', { hasText: 'Context compressed: 40 → 6 messages' }).waitFor({ timeout: 5000 }).then(() => check(true, 'compress runs and leaves a notice'), () => check(false, 'compress runs and leaves a notice'))
  check(rpcs('session.compress').some(r => r.params.session_id === 'rt-s-full'), 'session.compress sent for the open chat')
  await sleep(300)
  check((await hint.count()) === 0, 'hint gone afterwards')
  await page.evaluate(() => window.hermesOpenSession('s-8'))
  await page.locator('.msg.assistant', { hasText: 'answer s-8' }).waitFor({ timeout: 5000 })
  check((await hint.count()) === 0, 'no hint at 10%')

  // ── #18 message search opens the chat at the hit ──
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.getByPlaceholder('Search sessions…').fill('question 17')
  await page.locator('.hit-row', { hasText: 'Long chat' }).click({ timeout: 5000 })
  const hitMsg = page.locator('.msg.user').filter({ has: page.locator('.bubble', { hasText: /^question 17$/ }) })
  await hitMsg.waitFor({ timeout: 5000 }).catch(() => {})
  await sleep(400)
  const inView = await hitMsg.evaluate(el => { const r = el.getBoundingClientRect(), c = el.closest('.chat').getBoundingClientRect(); return r.top >= c.top && r.bottom <= c.bottom }).catch(() => false)
  check(inView, 'the hit (far above the drawn window) is scrolled into view')
  check(await hitMsg.evaluate(el => el.classList.contains('hit-flash')).catch(() => false), 'and flashes')
  check(await page.evaluate(() => CSS.highlights && CSS.highlights.has('hm-hit')), 'its words are highlighted')
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.getByPlaceholder('Search sessions…').fill('')
  await page.evaluate(() => window.hermesBack())

  // ── #20 file checkpoints: every folder the chat edited, diff, restore (folder or one file) ──
  await page.locator('header.topbar').getByRole('button', { name: 'Chat options' }).click()
  await page.locator('.menu-item', { hasText: 'File checkpoints' }).click()
  await page.locator('.cp-folder', { hasText: '~/projects/site' }).waitFor({ timeout: 5000 }).then(() => check(true, 'checkpoints grouped by folder'), () => check(false, 'checkpoints grouped by folder'))
  check((await page.locator('.cp-folder').allTextContents()).includes('~/…/cache/scratch'), 'second folder listed (not the chat cwd)')
  check(await page.getByText('1 older snapshot pruned').isVisible().catch(() => false), 'pruned snapshots counted')
  await page.locator('.menu-item', { hasText: 'app.py, notes.md' }).click({ timeout: 5000 })
  await page.locator('.diff-view .dl', { hasText: '+new line' }).waitFor({ timeout: 5000 }).then(() => check(true, 'checkpoint diff shown'), () => check(false, 'checkpoint diff shown'))
  const diffCall = calls().filter(c => c.path === '/api/plugins/hermes-mobile/checkpoints/diff').pop()
  check(diffCall && /workdir=%2Froot%2Fprojects%2Fsite/.test(diffCall.query) && /snap=t1%40/.test(diffCall.query), 'diff asks for that folder + snapshot')
  check((await page.locator('.cp-file-head .btn').count()) === 1, 'per-file restore only for files that existed (not the new one)')
  await page.getByRole('button', { name: 'Restore these 2 files' }).click()
  const listed = await page.locator('.dialog-list li').allTextContents()
  check(listed.length === 2 && listed[0] === 'app.py: back to how it was' && /notes\.md: deleted/.test(listed[1]), `confirmation lists what changes (${JSON.stringify(listed)})`)
  await page.locator('.dialog button', { hasText: 'Restore 2 files' }).click()
  await page.locator('.toast', { hasText: 'Restored 2 files' }).waitFor({ timeout: 5000 }).then(() => check(true, 'restore reports the files'), () => check(false, 'restore reports the files'))
  const rr = calls().filter(c => c.path === '/api/plugins/hermes-mobile/checkpoints/restore').pop()
  check(rr && rr.body.workdir === '/root/projects/site' && rr.body.snap.startsWith('t1@') && rr.body.file === '', 'restore sent for the folder and snapshot')
  check(rpcs('rollback.restore').length === 0, 'no chat-history rewind (rollback.restore not used)')
  await page.locator('.menu-item', { hasText: 'app.py, notes.md' }).click({ timeout: 5000 })
  await page.locator('.cp-file-head .btn').click({ timeout: 5000 })
  await page.locator('.dialog button', { hasText: 'Restore 1 file' }).click()
  await page.locator('.toast', { hasText: 'Restored app.py' }).waitFor({ timeout: 5000 }).then(() => check(true, 'single-file restore'), () => check(false, 'single-file restore'))
  check(calls().filter(c => c.path === '/api/plugins/hermes-mobile/checkpoints/restore').pop()?.body.file === 'app.py', 'single-file restore sends the file')
  await page.evaluate(() => window.hermesBack())

  // ── #21 Files: Back goes up one folder, then leaves ──
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.locator('.nav-tile', { hasText: 'Hermes' }).click()
  await page.locator('.hub-card', { hasText: 'Files' }).click()
  const crumbText = () => page.locator('.crumbs').textContent()
  await page.locator('.file-row', { hasText: /^📁a/ }).click()
  await page.locator('.crumbs', { hasText: 'sdcard/a/' }).waitFor({ timeout: 5000 })
  await page.locator('.file-row', { hasText: /^📁b/ }).click()
  await page.locator('.crumbs', { hasText: 'sdcard/a/b/' }).waitFor({ timeout: 5000 })
  check(await page.evaluate(() => window.hermesBack()), 'Back is handled inside Files')
  await sleep(300)
  check((await crumbText()) === '/sdcard/a/', `Back goes up one folder (${await crumbText()})`)
  await page.evaluate(() => window.hermesBack())
  await sleep(300)
  check((await crumbText()) === '/sdcard/', `…and again (${await crumbText()})`)
  await page.evaluate(() => window.hermesBack())
  await sleep(300)
  check((await page.locator('.crumbs').count()) === 0, 'at the root chip Back leaves Files')
  check((await page.locator('.hub-card').count()) === 6, '…back to the Hermes hub that opened it')
  await page.evaluate(() => window.hermesBack())
  await sleep(200)
  check((await page.locator('.hub-card').count()) === 0, 'Back again closes the hub')

  // ── #22 Projects: tap a chat to open it ──
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.locator('.nav-tile', { hasText: 'Hermes' }).click()
  await page.locator('.hub-card', { hasText: 'Projects' }).click()
  await page.locator('.card', { hasText: 'Thesis' }).click()
  await page.locator('.project-chat', { hasText: 'Chat 4' }).click({ timeout: 5000 })
  await page.locator('.msg.assistant', { hasText: 'answer s-4' }).waitFor({ timeout: 5000 }).then(() => check(true, 'project chat opens'), () => check(false, 'project chat opens'))
  check((await page.locator('.card', { hasText: 'Thesis' }).count()) === 0, 'Projects screen closed')

  // ── #23 Cron: edit a job (falls back to replace when PUT isn't there), open a run's output ──
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.locator('.nav-tile', { hasText: 'Hermes' }).click()
  await page.locator('.hub-card', { hasText: 'Scheduled jobs' }).click()
  await page.locator('.card', { hasText: 'Morning brief' }).getByRole('button', { name: 'Edit' }).click()
  check((await page.locator('.field textarea').inputValue()) === 'Brief me', 'edit form is filled in')
  await page.locator('.field textarea').fill('Brief me, shorter')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.locator('.toast', { hasText: 'Saved as a new job' }).waitFor({ timeout: 5000 }).catch(() => {})
  const cronCalls = calls().filter(c => c.path && c.path.startsWith('/api/cron/jobs'))
  const put = cronCalls.find(c => c.http === 'PUT'), post = cronCalls.filter(c => c.http === 'POST').pop(), del = cronCalls.find(c => c.http === 'DELETE')
  check(put && put.body.updates?.prompt === 'Brief me, shorter' && put.body.updates?.schedule === '0 9 * * *', 'tries PUT with the edited job ({updates: …}, the dashboard\'s shape)')
  check(post && post.body.prompt === 'Brief me, shorter' && del && del.path === '/api/cron/jobs/j1', 'falls back to create + delete')
  await page.locator('.card', { hasText: 'Morning brief' }).getByRole('button', { name: 'Runs' }).click()
  await page.locator('.card.as-button', { hasText: 'saved output' }).click({ timeout: 5000 })
  await page.locator('.sheet h1', { hasText: 'Result' }).waitFor({ timeout: 5000 }).then(() => check(true, 'a run’s saved output opens'), () => check(false, 'a run’s saved output opens'))
  await page.evaluate(() => window.hermesBack())
  await page.locator('.card.as-button', { hasText: 'chat run' }).click()
  await page.locator('.msg.assistant', { hasText: 'answer s-6' }).waitFor({ timeout: 5000 }).then(() => check(true, 'a run with a chat opens that chat'), () => check(false, 'a run with a chat opens that chat'))

  // ── #26 title tap = the ⋮ menu; Chat details is read-only ──
  await page.locator('header.topbar .title-btn').click()
  await page.locator('.menu-item', { hasText: 'Chat details' }).click({ timeout: 3000 })
  const details = page.locator('.sheet', { hasText: 'Chat details' })
  await details.waitFor({ timeout: 3000 })
  check((await details.locator('input').count()) === 0 && (await details.getByRole('button', { name: /Delete|Undo/ }).count()) === 0, 'details sheet has no duplicate actions')
  await page.evaluate(() => window.hermesBack())

  // ── #28 a message typed while offline is queued and sent on reconnect ──
  const openBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('hm.lastSession') || '{}').id)
  await mock({ drop: 4000 })
  await page.getByPlaceholder(/^Offline/).waitFor({ timeout: 8000 })
  await page.getByPlaceholder(/^Offline/).fill('queued hello')
  await page.locator('.composer').getByRole('button', { name: 'Send when back online' }).click()
  check((await page.locator('.queued-chip', { hasText: 'queued hello' }).count()) === 1, 'queued chip shows while offline')
  check(!rpcs('prompt.submit').some(r => r.params.text === 'queued hello'), 'nothing sent while offline')
  await page.locator('.msg.user .bubble', { hasText: 'queued hello' }).waitFor({ timeout: 30000 }).then(() => check(true, 'sent after reconnect'), () => check(false, 'sent after reconnect'))
  const qs = rpcs('prompt.submit').filter(r => r.params.text === 'queued hello')
  check(qs.length === 1 && qs[0].params.session_id === 'rt-' + openBefore, `sent once, to the chat it was typed in (${JSON.stringify(qs.map(q => q.params.session_id))}, ${openBefore})`)
  check((await page.locator('.queued-chip').count()) === 0, 'chip gone')

  // ── photos/files in the composer survive a reconnect, and go with a message queued offline ──
  {
    const sid = openBefore
    await attach('Photo', [{ name: 'keep.png', mimeType: 'image/png', buffer: png }])
    await page.locator('.attach-thumb img[alt="keep.png"]').waitFor({ timeout: 5000 })
    // Hermes reattaches the parked runtime: the photo is still queued there, nothing to redo.
    let n0 = rpcs('image.attach').length
    await mock({ drop: 3000 })
    await page.getByPlaceholder(/^Offline/).waitFor({ timeout: 8000 })
    await page.getByPlaceholder('Message Hermes').waitFor({ timeout: 30000 })
    await sleep(500)
    check((await page.locator('.attach-thumb img[alt="keep.png"]').count()) === 1, 'photo chip survives a reconnect')
    check(rpcs('image.attach').length === n0, 'same runtime: photo not queued twice')
    // Hermes reaped it: a new runtime gets the photo queued again.
    await mock({ drop: 3000, newRuntime: true })
    await page.getByPlaceholder(/^Offline/).waitFor({ timeout: 8000 })
    await page.getByPlaceholder('Message Hermes').waitFor({ timeout: 30000 })
    await sleep(500)
    const ra = rpcs('image.attach').slice(n0)
    check((await page.locator('.attach-thumb img[alt="keep.png"]').count()) === 1 && ra.some(r => r.params.session_id === 'rt1-' + sid && r.params.path === '/root/.hermes/images/keep.png'), `new runtime: photo queued again (${JSON.stringify(ra.map(r => r.params))})`)
    // Offline with a photo + a file attached: the queued message takes them along.
    await attach('File', [{ name: 'q.txt', mimeType: 'text/plain', buffer: Buffer.from('q') }])
    await page.locator('.attach-chip', { hasText: 'q.txt' }).waitFor({ timeout: 5000 })
    n0 = rpcs('image.attach').length
    await mock({ drop: 4000, newRuntime: true })
    await page.getByPlaceholder(/^Offline/).waitFor({ timeout: 8000 })
    await page.getByPlaceholder(/^Offline/).fill('queued with files')
    await page.locator('.composer').getByRole('button', { name: 'Send when back online' }).click()
    check((await page.locator('.queued-chip', { hasText: '2 attached' }).count()) === 1, 'queued chip counts the attachments')
    await page.locator('.msg.user .bubble', { hasText: 'queued with files' }).waitFor({ timeout: 30000 }).catch(() => {})
    const qf = rpcs('prompt.submit').filter(r => String(r.params.text).endsWith('queued with files'))
    check(qf.length === 1 && qf[0].params.text === '@file:ws/q.txt\n\nqueued with files' && qf[0].params.session_id === 'rt2-' + sid, `queued message carries the file (${JSON.stringify(qf.map(q => q.params))})`)
    check(rpcs('image.attach').slice(n0).some(r => r.params.session_id === 'rt2-' + sid && r.params.path === '/root/.hermes/images/keep.png'), 'queued message carries the photo')
    const qb = page.locator('.msg.user').last()
    check((await qb.locator('img.msg-thumb[alt="keep.png"]').count()) === 1 && (await qb.locator('.chip', { hasText: 'q.txt' }).count()) === 1, 'sent bubble shows the photo and the file')
    check((await page.locator('.attach-thumb, .attach-chip').count()) === 0, 'composer empty after the queued send')
    await mock({ gen: 0 })
  }

  // ── #29 tap a message to see when it was sent ──
  await page.evaluate(() => window.hermesOpenSession('s-11'))
  const u11 = page.locator('.msg.user', { hasText: 'hello s-11' })
  await u11.waitFor({ timeout: 5000 })
  check((await page.locator('.msg-time').count()) === 0, 'no times by default')
  await u11.locator('.bubble').click()
  const shown = (await u11.locator('.msg-time').textContent().catch(() => '')) || ''
  const want = new Date(1790000000 * 1000).toLocaleString('en-US', { day: 'numeric', month: 'short' })
  check(/\d/.test(shown) && shown.includes(want.split(' ')[0]), `tap shows the time (${shown})`)
  await page.locator('.msg.assistant', { hasText: 'answer s-11' }).locator('p').first().click()
  check((await page.locator('.msg.assistant .msg-time').count()) === 1, 'replies too')
  await u11.locator('.bubble').click()
  check((await u11.locator('.msg-time').count()) === 0, 'tap again hides it')

  // ── #15 launcher shortcut "New chat" (the shell calls hermesShortcut) ──
  await page.evaluate(() => window.hermesShortcut('new'))
  await page.locator('.empty .suggestion').first().waitFor({ timeout: 5000 }).then(() => check(true, 'New chat shortcut opens the new-chat screen'), () => check(false, 'New chat shortcut opens the new-chat screen'))
  // #27 the empty screen suggests what you asked lately
  const sugg = await page.locator('.empty .suggestion').allTextContents()
  check(sugg[0] === 'queued with files' && sugg[1] === 'queued hello' && sugg.includes('show media') && sugg.length === 4, `suggestions start with recent prompts (${JSON.stringify(sugg)})`)
  await page.evaluate(() => window.hermesShortcut('live'))
  await page.locator('.toast', { hasText: 'Live mode needs' }).waitFor({ timeout: 3000 }).then(() => check(true, 'Live shortcut explains itself without voice'), () => check(false, 'Live shortcut explains itself without voice'))

  // ── a photo attached on the new-chat screen survives Hermes restarting (the empty chat had no row yet) ──
  {
    await attach('Photo', [{ name: 'draft.png', mimeType: 'image/png', buffer: png }])
    await page.locator('.attach-thumb img[alt="draft.png"]').waitFor({ timeout: 5000 })
    const draftRt = rpcs('image.attach_bytes').filter(r => r.params.filename === 'draft.png').pop()?.params.session_id
    const c0 = rpcs('session.create').length
    await mock({ drop: 3000, forgetDrafts: true })
    await page.getByPlaceholder(/^Offline/).waitFor({ timeout: 8000 })
    await page.getByPlaceholder('Message Hermes').waitFor({ timeout: 30000 })
    await sleep(800)
    const cr = rpcs('session.create').slice(c0)
    const fresh = cr.length === 1 ? 'rt-new-m' : ''
    const ra = rpcs('image.attach').filter(r => r.params.path === '/root/.hermes/images/draft.png')
    check(cr.length === 1 && ra.length === 1 && ra[0].params.session_id !== draftRt && ra[0].params.session_id.startsWith(fresh), `gone empty chat is made again and the photo queued there (${cr.length} creates, ${JSON.stringify(ra.map(r => r.params.session_id))}, was ${draftRt})`)
    check((await page.locator('.attach-thumb img[alt="draft.png"]').count()) === 1, 'photo chip still in the composer')
    await page.getByPlaceholder('Message Hermes').fill('draft photo')
    await page.getByRole('button', { name: 'Send' }).click()
    await page.locator('.msg.user .bubble', { hasText: 'draft photo' }).waitFor({ timeout: 5000 })
    await sleep(300)
    const ps = rpcs('prompt.submit').filter(r => r.params.text === 'draft photo')
    check(ps.length === 1 && ps[0].params.session_id === ra[0]?.params.session_id, `sent to the new chat (${JSON.stringify(ps.map(p => p.params.session_id))})`)
    check((await page.locator('.notice', { hasText: 'Send failed' }).count()) === 0, 'no "Send failed: session not found"')
    await mock({ draftGen: 0 })
    await page.evaluate(() => window.hermesShortcut('new'))
    await page.locator('.empty .suggestion').first().waitFor({ timeout: 5000 })
  }

  // ── #30 About shows the Hermes version with no chat open (health check) ──
  await page.evaluate(() => window.hermesShortcut('new'))
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.locator('.nav-tile', { hasText: 'Settings' }).click()
  const hv = page.locator('.set-row', { hasText: /Hermes.*v0\.21\.5/ }).last()
  await hv.waitFor({ timeout: 5000 })
  check(((await hv.textContent()) || '').includes('v0.21.5'), `About → Hermes version (${await hv.textContent()})`)
  check(!((await hv.textContent()) || '').includes('Tap to update'), 'About → Hermes has no update button')
  check(!((await hv.textContent()) || '').includes('Different from what the app was made for'), 'a Hermes build equal to the tested one raises no warning')
  await page.evaluate(() => window.hermesBack())

  // ── Hermes hub: one screen with a summary per page ──
  await page.getByRole('button', { name: /^Sessions/ }).click()
  check((await page.locator('.nav-tile').count()) === 3, 'drawer has three tiles (Hermes, Bots, Settings)')
  await page.locator('.nav-tile', { hasText: 'Hermes' }).click()
  await page.locator('.hub-card', { hasText: '2 enabled of 3' }).waitFor({ timeout: 5000 }).then(() => check(true, 'hub: skills summary'), () => check(false, 'hub: skills summary'))
  check((await page.locator('.hub-card', { hasText: '2 notes · 50% full · 1 about you' }).count()) === 1, 'hub: memory summary')
  check((await page.locator('.hub-card', { hasText: '1 active' }).count()) === 1, 'hub: cron summary')
  check((await page.locator('.hub-card', { hasText: '1 project' }).count()) === 1, 'hub: projects summary')
  check((await page.locator('.hub-card', { hasText: 'Canvas gallery' }).filter({ hasText: /\d+ documents? · \d+ categor/ }).count()) === 1, 'hub: gallery summary counts every chat\'s documents')
  await page.locator('.hub-card', { hasText: 'Memory' }).click()
  await page.locator('.screen .title', { hasText: 'Memory' }).waitFor({ timeout: 3000 })
  await page.getByRole('button', { name: 'Back' }).last().click()
  check((await page.locator('.hub-card').count()) === 6, 'Back from a page returns to the hub')
  await page.evaluate(() => window.hermesBack())

  // ── setup check (browser: only the Hermes checks) ──
  await page.locator('.conn-dot').click()
  await page.getByRole('button', { name: 'Setup check' }).click()
  await page.locator('.setup-item.bad', { hasText: 'Plugin enabled' }).waitFor({ timeout: 5000 }).then(() => check(true, 'setup: a profile without the plugin shows ✕'), () => check(false, 'setup: a profile without the plugin shows ✕'))
  check((await page.locator('.setup-item.ok', { hasText: 'Hermes is running' }).count()) === 1, 'setup: Hermes running ✓')
  check((await page.locator('.setup-item.ok', { hasText: 'plugin is installed' }).count()) === 1, 'setup: plugin installed ✓')
  check(((await page.locator('.setup-hero-title').textContent()) || '').includes('1 thing to fix'), 'setup: counts what is left')
  await page.locator('.setup-item.bad').getByRole('button', { name: 'Enable' }).click()
  await page.locator('.setup-hero-title', { hasText: 'All set' }).waitFor({ timeout: 5000 }).then(() => check(true, 'Enable fixes it: All set'), () => check(false, 'Enable fixes it: All set'))
  const cfgPut = calls().filter(c => c.http === 'PUT' && c.path === '/api/config').pop()
  check(cfgPut && JSON.stringify(cfgPut.body.config.plugins.enabled) === '["other","hermes-mobile"]', `keeps the other plugins (${JSON.stringify(cfgPut && cfgPut.body)})`)
  await page.evaluate(() => window.hermesBack())

  // ── #19 in the app shell: the token comes asynchronously (no blocking getToken), every call carries the key ──
  const np = await browser.newPage({ viewport: { width: 375, height: 812 } })
  np.on('pageerror', e => {
    console.log('PAGEERROR (native page)', e.message)
    failures++
  })
  await np.addInitScript(nativeShell)
  const listsBefore = rpcs('session.list').length
  await np.goto('http://127.0.0.1:5180/')
  await np.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
  await sleep(1500)
  const nc = await np.evaluate(() => window.__nativeCalls)
  check(nc.includes('getTokenAsync') && !nc.includes('getToken'), `token fetched asynchronously (${[...new Set(nc)].join(',')})`)
  check(rpcs('session.list').length > listsBefore, 'connected with it (session.list)')
  check(await np.evaluate(() => typeof window.HermesAndroid.handshake === 'undefined'), 'page only sees the key-adding wrapper')

  // ── #33 Live mode: an approval is read out and answered by voice ──
  await np.evaluate(() => window.hermesShortcut('live'))
  await np.waitForFunction(() => window.__nativeCalls.includes('startListening'), null, { timeout: 5000 })
  await np.evaluate(() => window.__hmVoice('final', 'run the thing'))
  await np.waitForFunction(() => (window.__spoken || []).some(t => /Allow or deny/.test(t)), null, { timeout: 8000 }).catch(() => {})
  const spoken = await np.evaluate(() => (window.__spoken || []).join(' | '))
  check(/Hermes needs your permission\. Allow or deny\?/.test(spoken) && !/temp folder|rm -rf/.test(spoken), `approval asked in one short question, the command isn't read out (${spoken})`)
  await sleep(300)
  await np.evaluate(() => window.__hmVoice('final', 'yes allow it'))
  await sleep(2800)
  const va = calls().filter(c => c.answer === 'srv-approval-1')
  check(va.length === 1 && va[0].result && va[0].result.choice === 'once', `answered by voice (${JSON.stringify(va)})`)
  // A chat created by its first message tells the service it is on screen (returning to the app = seen).
  const seenNew = await np.evaluate(() => window.__seen || [])
  check(seenNew.some(id => /^s-new/.test(id)), `new chat reported on screen (${JSON.stringify(seenNew)})`)
  // Opening another chat ends live mode (it would otherwise keep listening and send there).
  check(await np.locator('.live-bar').count() === 1, 'live mode still on before switching')
  await np.evaluate(() => window.hermesOpenSession('s-6'))
  await np.locator('.live-bar').waitFor({ state: 'detached', timeout: 5000 }).then(() => check(true, 'opening another chat ends live mode'), () => check(false, 'opening another chat ends live mode'))
  check(await np.evaluate(() => (window.__seen || []).slice(-1)[0] === 's-6'), 'opened chat reported on screen')


  // ── Hermes working in an app on a hidden display: card above the composer, viewer sheet, bounded frame polling ──
  {
    const nAsked = () => np.evaluate(() => (window.__bgAsked || []).length)
    const setBg = st => np.evaluate(s => window.__hmBg && window.__hmBg(s), st)
    const mine = a => ({ session: 's-6', pkg: 'com.example.notes', label: 'Notes', action: 'tapping "New note"', since: Date.now(), ...a })
    await np.evaluate(() => {
      window.alert = window.confirm = window.prompt = () => ((window.__dialogs ||= []).push(1), null)
    })
    await np.locator('.msg').first().waitFor({ timeout: 5000 }).catch(() => {})
    await setBg(mine({ session: 's-other' }))
    await sleep(1300)
    check((await np.locator('.bg-card').count()) === 0 && (await nAsked()) === 0, 'bg app of another chat: no card, no frame requests')
    await setBg(mine())
    await np.locator('.bg-card').waitFor({ timeout: 3000 }).then(() => check(true, 'bg app of this chat: card shows'), () => check(false, 'bg app of this chat: card shows'))
    const ct = (await np.locator('.bg-card').textContent({ timeout: 1500 }).catch(() => '')) || ''
    check(/Using Notes/.test(ct) && /tapping "New note"/.test(ct), `card names the app and the action (${ct})`)
    await np.waitForFunction(() => (window.__bgAsked || []).length >= 3, null, { timeout: 5000 }).catch(() => {})
    await np.locator('.bg-thumb img').waitFor({ timeout: 3000 }).then(() => check(true, 'card shows the live thumbnail'), () => check(false, 'card shows the live thumbnail'))
    {
      const asked = await np.evaluate(() => window.__bgAsked || [])
      const gaps = asked.slice(1).map((a, i) => a.t - asked[i].t)
      check(asked.length >= 3 && gaps.every(g => g >= 450), `frame requests are at least 500 ms apart (${gaps.join(',')})`)
      check((await np.evaluate(() => window.__bgMaxInflight)) === 1, 'never two frame requests in flight')
      check(asked.length > 0 && asked.every(a => a.w <= 240), `the thumbnail asks for a small frame (${asked.length ? asked[0].w : 'none'})`)
    }
    await np.locator('.bg-card').click({ timeout: 1500 }).catch(() => {})
    const viewer = np.locator('.bg-viewer')
    await viewer.waitFor({ timeout: 3000 }).then(() => check(true, 'tapping the card opens the viewer'), () => check(false, 'tapping the card opens the viewer'))
    check((await viewer.getByRole('button', { name: 'Take over' }).count()) === 1 && (await viewer.getByRole('button', { name: 'Stop' }).count()) === 1, 'viewer has Take over and Stop')
    check(/tapping "New note"/.test((await viewer.textContent({ timeout: 1500 }).catch(() => '')) || ''), 'viewer shows the action caption')
    await np.waitForFunction(() => (window.__bgAsked || []).length > 0 && window.__bgAsked.slice(-1)[0].w >= 400, null, { timeout: 3000 }).then(() => check(true, 'viewer asks for a bigger frame'), () => check(false, 'viewer asks for a bigger frame'))
    check((await np.locator('.bg-card select, .bg-viewer select, .bg-viewer input, .bg-viewer textarea, .bg-card input, dialog').count()) === 0, 'card and viewer use no native controls')
    await np.evaluate(() => window.hermesBack())
    await viewer.waitFor({ state: 'detached', timeout: 3000 }).then(() => check(true, 'Back closes the viewer'), () => check(false, 'Back closes the viewer'))
    await sleep(900)
    check(await np.evaluate(() => (window.__bgAsked || []).slice(-1).every(a => a.w <= 240) && (window.__bgAsked || []).length > 0), 'after closing the viewer only the small thumbnail is requested')
    check((await np.locator('.bg-card').count()) === 1, 'card stays after closing the viewer')
    // Page hidden: no more requests; visible again: they resume.
    await np.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await sleep(500)
    const hiddenAt = await nAsked()
    await sleep(1600)
    check((await nAsked()) === hiddenAt, `no frame requests while the page is hidden (${hiddenAt})`)
    await np.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await np.waitForFunction(n => (window.__bgAsked || []).length > n, hiddenAt, { timeout: 3000 }).then(() => check(true, 'frame requests resume when the page is visible'), () => check(false, 'frame requests resume when the page is visible'))
    // Take over: one bridge call; the shell then clears the state, the card goes and the polling stops.
    await np.locator('.bg-card').click({ timeout: 1500 }).catch(() => {})
    await viewer.getByRole('button', { name: 'Take over' }).click({ timeout: 1500 }).catch(() => {})
    await np.locator('.bg-card').waitFor({ state: 'detached', timeout: 3000 }).then(() => check(true, 'card disappears once the state is cleared'), () => check(false, 'card disappears once the state is cleared'))
    check(JSON.stringify(await np.evaluate(() => window.__bgActs)) === '["take_over"]', `Take over calls bgAction once (${JSON.stringify(await np.evaluate(() => window.__bgActs))})`)
    check((await viewer.count()) === 0, 'viewer closes after Take over')
    await sleep(400)
    const clearedAt = await nAsked()
    await sleep(1500)
    check((await nAsked()) === clearedAt, 'no frame requests once there is no bg app')
    // Stop.
    await setBg(mine({ action: 'typing' }))
    await np.locator('.bg-card').click({ timeout: 1500 }).catch(() => {})
    await viewer.getByRole('button', { name: 'Stop' }).click({ timeout: 1500 }).catch(() => {})
    await viewer.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    check(JSON.stringify(await np.evaluate(() => window.__bgActs)) === '["take_over","stop"]', 'Stop calls bgAction("stop")')
    // The app comes back (resume push) for this chat, then another chat is opened: card and polling go.
    await setBg(mine())
    await np.locator('.bg-card').waitFor({ timeout: 3000 }).catch(() => {})
    await np.evaluate(() => window.hermesOpenSession('s-5'))
    await np.locator('.bg-card').waitFor({ state: 'detached', timeout: 5000 }).then(() => check(true, 'opening another chat hides the card'), () => check(false, 'opening another chat hides the card'))
    await sleep(500)
    const swAt = await nAsked()
    await sleep(1500)
    check((await nAsked()) === swAt, 'no frame requests for a chat without the bg app')
    await setBg(null)
    check((await np.evaluate(() => window.__dialogs || [])).length === 0, 'no alert/confirm dialogs')
    // Settings → Background apps
    await np.getByRole('button', { name: /^Sessions/ }).click()
    await np.locator('.nav-tile', { hasText: 'Settings' }).click()
    const bgRow = np.locator('.set-row', { hasText: 'Allow banking, payment, password and 2FA apps' })
    await bgRow.waitFor({ timeout: 5000 }).then(() => check(true, 'Settings has the Background apps row'), () => check(false, 'Settings has the Background apps row'))
    check(/Off: Hermes won't open them in the background/.test((await bgRow.textContent({ timeout: 1500 }).catch(() => '')) || ''), 'row explains what Off means')
    check((await bgRow.getByRole('switch').getAttribute('aria-checked', { timeout: 1500 }).catch(() => null)) === 'false', 'switch starts off')
    await bgRow.click({ timeout: 1500 }).catch(() => {})
    await sleep(500)
    {
      const puts = calls().filter(c => c.http === 'PUT' && c.path === '/api/plugins/hermes-mobile/bgapps')
      check(puts.length === 1 && puts[0].body.allow_sensitive === true, `toggling PUTs allow_sensitive (${JSON.stringify(puts.map(c => c.body))})`)
      check((await bgRow.getByRole('switch').getAttribute('aria-checked', { timeout: 1500 }).catch(() => null)) === 'true', 'switch shows on')
    }
    // Settings → Replies: cards in replies (plugin /openui), on by default
    const ouiRow = np.locator('.set-row', { hasText: 'Cards and buttons in replies' })
    await ouiRow.waitFor({ timeout: 5000 }).then(() => check(true, 'Settings has the cards row'), () => check(false, 'Settings has the cards row'))
    check((await ouiRow.getByRole('switch').getAttribute('aria-checked', { timeout: 1500 }).catch(() => null)) === 'true', 'cards: on by default')
    await ouiRow.click({ timeout: 1500 }).catch(() => {})
    await sleep(500)
    {
      const puts = calls().filter(c => c.http === 'PUT' && c.path === '/api/plugins/hermes-mobile/openui')
      check(puts.length === 1 && puts[0].body.enabled === false, `cards toggle PUTs enabled:false (${JSON.stringify(puts.map(c => c.body))})`)
    }
    await ouiRow.click({ timeout: 1500 }).catch(() => {}) // back on for the rest of the run
    await np.evaluate(() => window.hermesBack())
    await fetch('http://127.0.0.1:9119/__mock', { method: 'POST', body: JSON.stringify({ bgapps: { allow_sensitive: false, available: false, reason: 'Needs Shizuku running' } }) })
    await np.getByRole('button', { name: /^Sessions/ }).click()
    await np.locator('.nav-tile', { hasText: 'Settings' }).click()
    const noRow = np.locator('.set-row', { hasText: 'Needs Shizuku running' })
    await noRow.waitFor({ timeout: 5000 }).then(() => check(true, 'unavailable: the reason is the row text'), () => check(false, 'unavailable: the reason is the row text'))
    check((await noRow.getByRole('switch').count()) === 0, 'unavailable: no switch')
    check((await np.locator('.set-row select, .set-row input').count()) === 0, 'settings row uses no native controls')
    await np.evaluate(() => window.hermesBack())
    await fetch('http://127.0.0.1:9119/__mock', { method: 'POST', body: JSON.stringify({ bgapps: { available: true, reason: undefined } }) })
  }

  // ── Phone assistant: Settings → Voice opens the system picker and shows the role once Hermes holds it ──
  await np.getByRole('button', { name: /^Sessions/ }).click()
  await np.locator('.nav-tile', { hasText: 'Settings' }).click()
  await np.locator('.set-row', { hasText: 'Voice' }).first().click()
  const ar = np.locator('.set-row', { hasText: 'Use Hermes as phone assistant' })
  await ar.waitFor({ timeout: 5000 })
  check(/Off/.test((await ar.textContent()) || ''), `assistant row says Off (${await ar.textContent()})`)
  await ar.click()
  check((await np.evaluate(() => window.__nativeCalls)).includes('openAssistantSettings'), 'assistant row opens the system picker')
  await np.evaluate(() => {
    window.__assistant = true
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await sleep(200)
  check(/On/.test((await ar.textContent()) || ''), `assistant row says On after returning (${await ar.textContent()})`)
  await np.evaluate(() => window.hermesBack())
  await np.evaluate(() => window.hermesBack())

  // ── setup check with the Android checks: ✗ items have buttons that ask the shell to fix them ──
  await np.evaluate(() => (window.__setup = { termux: true, runCommand: false, notifications: true, batteryApp: false, batteryTermux: true, startError: '' }))
  await np.evaluate(() => window.hermesBack && window.hermesBack())
  await np.locator('.conn-dot').click()
  await np.getByRole('button', { name: 'Setup check' }).click()
  await np.locator('.setup-hero-title', { hasText: '2 things to fix' }).waitFor({ timeout: 5000 }).then(() => check(true, 'native: two failing checks counted'), () => check(false, 'native: two failing checks counted'))
  // The Hermes-side checks answer a moment later than the Android ones.
  await np.waitForFunction(() => document.querySelectorAll('.setup-item.ok').length >= 6, null, { timeout: 6000 }).catch(() => {})
  check((await np.locator('.setup-item.ok').count()) >= 6, `native: the rest are ✓ (${await np.locator('.setup-item.ok').count()})`)
  await np.locator('.setup-item.bad', { hasText: 'may start Hermes' }).getByRole('button', { name: 'Allow' }).click()
  await np.locator('.setup-item.bad', { hasText: 'run in the background' }).getByRole('button', { name: 'Allow' }).click()
  check(JSON.stringify(await np.evaluate(() => window.__fixes)) === '["permissions","battery-app"]', `fix buttons ask the shell (${JSON.stringify(await np.evaluate(() => window.__fixes))})`)
  await np.evaluate(() => (window.__setup = { termux: true, runCommand: true, notifications: true, batteryApp: true, batteryTermux: true, startError: '' }))
  await np.locator('.setup-hero-title', { hasText: 'All set' }).waitFor({ timeout: 6000 }).then(() => check(true, 'checks again by itself: All set'), () => check(false, 'checks again by itself: All set'))
  // Hermes's access to the phone: a missing app is told by Android, the rest by the plugin.
  check((await np.locator('.setup-item.ok', { hasText: 'see and use the screen' }).count()) === 1, 'phone access: Shizuku ✓ from the plugin')
  await np.evaluate(() => (window.__setup = { ...window.__setup, termuxApi: false, shizuku: true }))
  await fetch('http://127.0.0.1:9119/__mock', { method: 'POST', body: JSON.stringify({ phone: { files: false, shizuku: 'off' } }) })
  await np.locator('.setup-hero-title', { hasText: '3 things to fix' }).waitFor({ timeout: 6000 }).then(() => check(true, 'phone access: files, Termux:API and Shizuku counted'), () => check(false, 'phone access: files, Termux:API and Shizuku counted'))
  await np.locator('.setup-item.bad', { hasText: 'Termux:API' }).getByRole('button', { name: 'Get Termux:API' }).click()
  await np.locator('.setup-item.bad', { hasText: 'Shizuku' }).getByRole('button', { name: 'Open Shizuku' }).click()
  await np.locator('.setup-item.bad', { hasText: 'your files' }).getByRole('button', { name: 'Restart Hermes' }).click()
  const fx = JSON.stringify((await np.evaluate(() => window.__fixes)).slice(-3))
  check(fx === '["get-termux-api","open-shizuku","restart-hermes"]', `phone access fix buttons (${fx})`)
  await fetch('http://127.0.0.1:9119/__mock', { method: 'POST', body: JSON.stringify({ phone: { files: true, shizuku: 'ok' } }) })
  await np.close()

  // ── player, chat links, dictation, model in the + menu, learning dot (fake native bridge, speech never ends by itself) ──
  const vp = await browser.newPage({ viewport: { width: 375, height: 812 } })
  vp.on('pageerror', e => {
    console.log('PAGEERROR (voice page)', e.message)
    failures++
  })
  await vp.addInitScript(() => {
    let taken = false
    const calls = (window.__nc = [])
    const k = (key, name) => {
      if (key !== 'K') throw new Error('bridge call without the key: ' + name)
      calls.push(name)
    }
    window.HermesAndroid = {
      handshake: () => (taken ? '' : ((taken = true), 'K')),
      getBaseUrl: key => (k(key, 'getBaseUrl'), 'http://127.0.0.1:9119'),
      getToken: key => (k(key, 'getToken'), 'tok'),
      getTokenAsync: (key, id) => {
        k(key, 'getTokenAsync')
        setTimeout(() => window.__hmToken(id, 'tok'), 50)
      },
      httpAsync: (key, id, m, p, b) => {
        k(key, 'httpAsync')
        fetch('/__api' + p, { method: m, headers: b != null ? { 'Content-Type': 'application/json' } : undefined, body: b ?? undefined }).then(async r => window.__hmHttp(id, r.status, await r.text()))
      },
      isInForeground: key => (k(key, 'isInForeground'), true),
      appVersion: key => (k(key, 'appVersion'), 'test'),
      isSystemDark: key => (k(key, 'isSystemDark'), true),
      setBackground: key => k(key, 'setBackground'),
      haptic: key => k(key, 'haptic'),
      notify: key => k(key, 'notify'),
      cancelNotification: key => k(key, 'cancelNotification'),
      setLastChat: key => k(key, 'setLastChat'),
      setReadAloud: key => k(key, 'setReadAloud'),
      mediaBase: key => (k(key, 'mediaBase'), ''),
      speak: (key, text, cfg) => {
        k(key, 'speak')
        ;(window.__spoken ||= []).push(text)
        ;(window.__spokenCfg ||= []).push(cfg)
      },
      stopSpeaking: key => {
        k(key, 'stopSpeaking')
        setTimeout(() => window.__hmVoice('tts-done', ''), 10) // like Voice.java
      },
      startListening: key => k(key, 'startListening'),
      stopListening: key => k(key, 'stopListening')
    }
  })
  await vp.goto('http://127.0.0.1:5180/')
  const vbox = vp.getByPlaceholder('Message Hermes')
  await vbox.waitFor({ timeout: 15000 })
  // model moved from the header into the + menu
  check((await vp.locator('header .model-chip').count()) === 0, 'no model chip in the header')
  await vp.getByRole('button', { name: 'Add', exact: true }).click()
  check((await vp.locator('.picker-opt', { hasText: 'Model' }).count()) === 1, '+ menu has the model row')
  await vp.locator('.picker-opt', { hasText: 'Model' }).click()
  check((await vp.locator('.sheet').count()) > 0, 'tapping the model row opens the model picker')
  await vp.evaluate(() => window.hermesBack())
  await sleep(300)
  // chat links
  await vbox.fill('link chats')
  await vp.getByRole('button', { name: 'Send' }).click()
  await vp.locator('.msg.assistant a.chat-link').first().waitFor({ timeout: 5000 })
  check((await vp.locator('.msg.assistant a.chat-link').count()) === 2, 'markdown chat link and a bare session id both become chat links (' + (await vp.locator('.msg.assistant').last().innerHTML()).slice(0, 700) + ')')
  const vResumesBefore = rpcs('session.resume').length
  await vp.locator('.msg.assistant a.chat-link').first().click()
  await sleep(800)
  check(rpcs('session.resume').length > vResumesBefore && rpcs('session.resume').pop().params.session_id === 's-6', 'tapping a chat link opens that chat ' + JSON.stringify(rpcs('session.resume').slice(-2)))
  await vp.evaluate(() => window.hermesShortcut('new'))
  await vbox.fill('link chats')
  await vp.getByRole('button', { name: 'Send' }).click()
  await vp.locator('.msg.assistant a.chat-link').first().waitFor({ timeout: 5000 })
  // player
  await vp.getByRole('button', { name: 'Read aloud' }).last().click()
  await vp.locator('.tts-player').waitFor({ timeout: 3000 })
  check(true, 'reading a reply shows the player')
  const said = () => vp.evaluate(() => window.__spoken.slice())
  const nativeCount = n => vp.evaluate(x => window.__nc.filter(c => c === x).length, n)
  await vbox.fill('another question')
  await vp.getByRole('button', { name: 'Send' }).click()
  await sleep(600)
  check((await nativeCount('stopSpeaking')) === 0 && (await vp.locator('.tts-player').count()) === 1, 'sending a new prompt does not stop the reading')
  await vp.evaluate(() => window.__hmVoice('tts-seg', '30,50'))
  const total = Number(await vp.locator('.tts-seek').getAttribute('max'))
  const seek0 = Number(await vp.locator('.tts-seek').inputValue())
  check(seek0 >= 30 && seek0 <= 40, `player follows the reading position (${seek0})`)
  await vp.evaluate(() => window.__hmVoice('tts-seek', '70')) // the card's forward 10 s
  await sleep(50)
  const seekd = Number(await vp.locator('.tts-seek').inputValue())
  check(seekd === 70 && (await vp.locator('.tts-player').count()) === 1, `a native 10 s jump moves the player to its position (${seekd})`)
  await vp.getByRole('button', { name: 'Pause reading' }).click()
  await sleep(200)
  const paused = Number(await vp.locator('.tts-seek').inputValue())
  check((await vp.locator('.tts-player').count()) === 1 && (await vp.getByRole('button', { name: 'Resume reading' }).count()) === 1, 'pause keeps the player (stop from native does not close it)')
  const n0 = (await said()).length
  await vp.getByRole('button', { name: 'Resume reading' }).click()
  const sp = await said()
  const full = sp[0]
  check(sp.length === n0 + 1 && sp[n0] === full.slice(paused), `resume reads on from the paused position (${paused})`)
  await vp.locator('.tts-seek').fill(String(Math.floor(total / 2)))
  await sleep(100)
  const sp2 = await said()
  check(sp2[sp2.length - 1] === full.slice(Math.floor(total / 2)), 'scrubbing re-reads from that point')
  await vp.getByRole('button', { name: /^Reading speed/ }).click()
  check(JSON.parse(await vp.evaluate(() => localStorage.getItem('hm.tts'))).rate > 1, 'speed button raises the rate')
  await vp.evaluate(() => window.__hmVoice('tts-done', ''))
  await sleep(300) // inside the re-speak guard, the replaced speech "ending" is ignored
  check((await vp.locator('.tts-player').count()) === 1, 'the replaced speech ending does not close the player')
  await sleep(500)
  await vp.evaluate(() => window.__hmVoice('tts-done', ''))
  await sleep(100)
  check((await vp.locator('.tts-player').count()) === 0, 'player closes when the reading ends')
  // the "Reading aloud" notification: Voice.java owns pause/play; the page follows its tts-paused / tts-resumed
  const lastCfg = JSON.parse(await vp.evaluate(() => window.__spokenCfg[window.__spokenCfg.length - 1]))
  check(lastCfg.notify === true && typeof lastCfg.title === 'string' && 'session' in lastCfg, 'read-aloud asks for the notification card ' + JSON.stringify(lastCfg))
  await vp.evaluate(() => {
    window.__ctl = []
    window.HermesAndroid.ttsControl = cmd => {
      window.__ctl.push(cmd)
      setTimeout(() => window.__hmVoice(cmd === 'pause' ? 'tts-paused' : 'tts-resumed', cmd === 'pause' ? '20' : ''), 10) // like Voice.java
    }
  })
  await vp.getByRole('button', { name: 'Read aloud' }).last().click()
  await vp.locator('.tts-player').waitFor({ timeout: 3000 })
  const spokenBefore = (await said()).length
  const stopsBefore = await nativeCount('stopSpeaking')
  const at = Math.floor(Number(await vp.locator('.tts-seek').getAttribute('max')) / 2)
  await vp.evaluate(x => window.__hmVoice('tts-paused', String(x)), at) // Pause in the notification shade
  await sleep(100)
  check((await vp.getByRole('button', { name: 'Resume reading' }).count()) === 1 && Number(await vp.locator('.tts-seek').inputValue()) === at, 'pause from the notification shows the player paused at that chunk (' + (await vp.locator('.tts-seek').inputValue()) + ' of ' + (await vp.locator('.tts-seek').getAttribute('max')) + ')')
  await vp.evaluate(() => window.__hmVoice('tts-resumed', ''))
  await sleep(100)
  check((await vp.getByRole('button', { name: 'Pause reading' }).count()) === 1, 'play from the notification resumes the player')
  await vp.getByRole('button', { name: 'Pause reading' }).click()
  await sleep(100)
  await vp.getByRole('button', { name: 'Resume reading' }).click()
  await sleep(100)
  check(JSON.stringify(await vp.evaluate(() => window.__ctl)) === '["pause","play"]' && (await said()).length === spokenBefore && (await nativeCount('stopSpeaking')) === stopsBefore, 'in-app pause / resume go through ttsControl (one state with the notification) ' + JSON.stringify(await vp.evaluate(() => window.__ctl)))
  await vp.evaluate(() => window.__hmVoice('tts-paused', '0'))
  await sleep(50)
  await vp.evaluate(() => window.__hmVoice('tts-done', 'stop')) // ✕ in the notification while paused
  await sleep(100)
  check((await vp.locator('.tts-player').count()) === 0, 'stop from the notification closes even a paused player')
  await vp.evaluate(() => delete window.HermesAndroid.ttsControl)
  // dictation: edits made while dictating are kept, the keyboard is not summoned at the end
  await vp.evaluate(() => window.hermesShortcut('new'))
  await vp.getByRole('button', { name: 'Dictate' }).click()
  const ta = vp.getByPlaceholder('Message Hermes')
  await vp.evaluate(() => window.__hmVoice('partial', 'hello wor'))
  await vp.evaluate(() => window.__hmVoice('final', 'hello world'))
  await sleep(150)
  check((await ta.inputValue()) === 'hello world', 'dictated phrase appears: ' + (await ta.inputValue()))
  await ta.focus()
  await ta.press('End')
  await vp.keyboard.insertText(' brave')
  await vp.evaluate(() => window.__hmVoice('partial', 'and more'))
  await vp.evaluate(() => window.__hmVoice('final', 'and more'))
  await sleep(150)
  check((await ta.inputValue()) === 'hello world brave and more', `keyboard edit survives the next dictated phrase (${await ta.inputValue()})`)
  await ta.click({ position: { x: 1, y: 8 } }) // a tap at the very start of the text
  await sleep(150)
  await vp.evaluate(() => window.__hmVoice('partial', 'there'))
  await vp.evaluate(() => window.__hmVoice('final', 'there'))
  await sleep(150)
  check((await ta.inputValue()) === 'there hello world brave and more', `moving the cursor makes dictation insert there (${await ta.inputValue()})`)
  await ta.evaluate(el => el.blur())
  await vp.evaluate(() => window.__hmVoice('end', ''))
  await sleep(200)
  check(await vp.evaluate(() => document.activeElement === document.body || document.activeElement.tagName !== 'TEXTAREA'), 'stopping dictation does not focus the box (no keyboard)')
  await vp.close()

  // ── start-up: the slow profiles.list waits until the chat is open (it competes with session.resume in Hermes) ──
  const spf = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await spf.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-slowstart', profile: 'default' })))
  const nBoot = calls().length
  await spf.goto('http://127.0.0.1:5180/')
  await sleep(1200) // connected, the slow resume (2.5 s) is in flight
  const early = calls().slice(nBoot).map(c => c.rpc)
  check(early.includes('session.resume') && early.includes('session.list') && !early.includes('profiles.list'), `profiles.list not sent while the chat opens (${early.filter(Boolean).join(',')})`)
  await spf.locator('.msg', { hasText: 'old answer' }).waitFor({ timeout: 6000 })
  await sleep(300)
  check(calls().slice(nBoot).some(c => c.rpc === 'profiles.list'), 'profiles.list sent once the chat is open')
  await spf.close()

  // ── start-up resume must not pull you out of a new chat you started while it was loading ──
  const slp = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await slp.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-slowstart', profile: 'default' })))
  await slp.goto('http://127.0.0.1:5180/')
  await sleep(900) // connected, the slow resume is in flight
  await slp.evaluate(() => window.hermesShortcut('new'))
  await slp.locator('.empty .suggestion').first().waitFor({ timeout: 5000 })
  await sleep(2800) // the slow resume answers now
  check(await slp.locator('.empty .suggestion').count() > 0 && (await slp.locator('.msg').count()) === 0, 'late start-up resume does not replace the new chat you started')
  await slp.close()

  // ── the canvas button while the start-up resume loads: that chat's canvas (loading first), never a new chat ──
  const scv = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await scv.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-slowstart', profile: 'default' })))
  await scv.goto('http://127.0.0.1:5180/')
  await sleep(600) // connected, the slow resume is in flight
  check(await scv.evaluate(() => !document.querySelector('.msg.user')), 'slow start-up chat still loading when the canvas is tapped')
  await scv.locator('.canvas-btn').click()
  await scv.locator('.canvas-panel').waitFor({ timeout: 3000 })
  check((await scv.locator('.canvas-panel [aria-busy="true"]').count()) === 1 && (await scv.locator('.canvas-empty-title').count()) === 0, 'canvas opened on a loading chat shows a loading state, not "empty"')
  await scv.locator('.canvas-tab-title', { hasText: 'Life' }).waitFor({ timeout: 3000 })
  check(true, 'canvas opened on a loading chat shows that chat\'s documents')
  await sleep(2800) // the slow resume answers now
  check((await scv.locator('.msg', { hasText: 'old answer' }).count()) === 1, 'the chat that was loading still opens after tapping the canvas (no new empty chat)')
  check((await scv.locator('.canvas-panel').count()) === 1 && (await scv.locator('.canvas-tab-title', { hasText: 'Life' }).count()) === 1, 'canvas stays open on the chat once it has loaded')
  await scv.close()

  // ── swipe right on a chat opens the sessions drawer ──
  const swp = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await swp.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-5', profile: 'default' })))
  await swp.goto('http://127.0.0.1:5180/')
  await swp.locator('.msg.assistant').first().waitFor({ timeout: 8000 })
  const swipe = (sel, dx, dy) => swp.evaluate(([sel, dx, dy]) => {
    const el = document.querySelector(sel)
    const r = el.getBoundingClientRect()
    const x = r.left + 40, y = r.top + Math.min(r.height / 2, 30)
    const mk = (type, px, py) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: el, clientX: px, clientY: py })] })
    el.dispatchEvent(mk('touchstart', x, y))
    el.dispatchEvent(mk('touchmove', x + dx / 2, y + dy / 2))
    el.dispatchEvent(mk('touchmove', x + dx, y + dy))
    el.dispatchEvent(mk('touchend', x + dx, y + dy))
  }, [sel, dx, dy])
  await swipe('.msg.assistant', 40, 0)
  await sleep(300)
  check((await swp.locator('.drawer.open').count()) === 0, 'a short swipe does not open the drawer')
  await swipe('.msg.assistant', 20, 120)
  await sleep(300)
  check((await swp.locator('.drawer.open').count()) === 0, 'a mostly vertical swipe (scrolling) does not open the drawer')
  await swipe('textarea', 160, 0)
  await sleep(300)
  check((await swp.locator('.drawer.open').count()) === 0, 'a swipe starting in the composer does not open the drawer')
  await swipe('.msg.assistant', 160, 10)
  await swp.locator('.drawer.open').waitFor({ timeout: 2000 }).then(() => check(true, 'swipe right on a chat opens the drawer'), () => check(false, 'swipe right on a chat opens the drawer'))
  await swp.close()

  // ── first run: a Hermes with no model provider opens the welcome; sign in, pick a model, it never shows again ──
  await mock({ unconfigured: true })
  const wel = await browser.newPage({ viewport: { width: 375, height: 812 } })
  wel.on('pageerror', e => { console.log('PAGEERROR', e.message); failures++ })
  await wel.goto('http://127.0.0.1:5180/')
  await wel.getByText('Connect Hermes to a model').waitFor({ timeout: 15000 }).then(() => check(true, 'fresh install opens the welcome'), () => check(false, 'fresh install opens the welcome'))
  check((await wel.locator('.set-row', { hasText: 'Anthropic OAuth' }).count()) === 0, 'logins that need another CLI are hidden')
  check(await wel.getByRole('button', { name: 'Connect one of the above first' }).isDisabled(), 'Pick a model waits for a connected provider')
  await wel.locator('.set-row', { hasText: 'ChatGPT / Codex' }).getByRole('button', { name: 'Sign in' }).click()
  await wel.getByText('ABCD-1234').waitFor({ timeout: 5000 }).then(() => check(true, 'device-code sign-in shows the code'), () => check(false, 'device-code sign-in shows the code'))
  await wel.getByText('Copy this code').waitFor({ state: 'detached', timeout: 8000 }).then(() => check(true, 'sign-in sheet closes once Hermes approves'), () => check(false, 'sign-in sheet closes once Hermes approves'))
  await wel.getByRole('button', { name: 'Pick a model' }).click({ timeout: 5000 })
  await wel.locator('.picker-opt', { hasText: 'mock-sonnet' }).click()
  await wel.getByText('Connect Hermes to a model').waitFor({ state: 'detached', timeout: 5000 }).then(() => check(true, 'picking a model closes the welcome'), () => check(false, 'picking a model closes the welcome'))
  {
    const set = calls().filter(c => c.path === '/api/model/set').pop()
    check(set && set.body.model === 'mock-sonnet', 'the welcome sets the default model')
    check(calls().some(c => c.path === '/api/model/options' && /refresh=true/.test(c.query)), 'the model list is refreshed after a new sign-in')
  }
  await wel.reload()
  await wel.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
  await sleep(1500)
  check((await wel.getByText('Connect Hermes to a model').count()) === 0, 'the welcome does not come back')
  await wel.close()

  // ── the setup flow: works out what is set up and resumes at the first missing step ──
  const OK = { termux: true, runCommand: true, notifications: true, batteryApp: true, batteryTermux: true, startError: '' }
  const flowPage = async setup => {
    const fp = await browser.newPage({ viewport: { width: 375, height: 812 } })
    fp.on('pageerror', e => { console.log('PAGEERROR (flow page)', e.message); failures++ })
    await fp.addInitScript(s => { window.__setup = s }, setup)
    await fp.addInitScript(nativeShell)
    return fp
  }
  const flowShown = fp => fp.getByText('Set up Hermes', { exact: true }).count().then(n => n > 0)
  // a. PC-installed phone, everything working: straight to chat, no flow, and it is not checked again
  await mock({ configured: true, pluginEnabled: true })
  {
    const fa = await flowPage(OK)
    await fa.goto('http://127.0.0.1:5180/')
    await fa.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    await fa.waitForFunction(() => localStorage.getItem('hm.setupFlowDone') === '1', null, { timeout: 8000 }).catch(() => {})
    check(!(await flowShown(fa)), 'flow: everything set up → straight to chat, no setup flow')
    check(await fa.evaluate(() => localStorage.getItem('hm.setupFlowDone') === '1' && localStorage.getItem('hm.welcomeDone') === '1'), 'flow: nothing missing is remembered (not checked again)')
    await fa.close()
  }
  // b. everything fine but no model: the model step, then the recommended items once ("Almost done").
  // looseStatus: like the pinned Hermes on a fresh install, setup.status for a profile wrongly says a provider is there.
  await mock({ unconfigured: true, pluginEnabled: true, looseStatus: true })
  {
    const fb = await flowPage({ ...OK, batteryApp: false })
    await fb.goto('http://127.0.0.1:5180/')
    await fb.getByText('Connect Hermes to a model').waitFor({ timeout: 15000 }).then(() => check(true, 'flow: no model → opens at the model step'), () => check(false, 'flow: no model → opens at the model step'))
    check((await fb.locator('.flow-progress-label').textContent()) === 'Step 1 of 1', `flow: progress counts only the missing required steps (${await fb.locator('.flow-progress-label').textContent()})`)
    await fb.locator('.set-row', { hasText: 'ChatGPT / Codex' }).getByRole('button', { name: 'Sign in' }).click()
    await fb.getByText('Copy this code').waitFor({ state: 'detached', timeout: 12000 })
    await fb.getByRole('button', { name: 'Pick a model' }).click({ timeout: 5000 })
    await fb.locator('.picker-opt', { hasText: 'mock-sonnet' }).click()
    await fb.locator('.setup-hero-title', { hasText: 'Almost done' }).waitFor({ timeout: 8000 }).then(() => check(true, 'flow: after the model, the recommended items are shown once (Almost done)'), () => check(false, 'flow: after the model, the recommended items are shown once (Almost done)'))
    check((await fb.locator('.setup-item.bad').count()) === 1, 'flow: only the missing recommended item is listed')
    check((await fb.locator('.flow-done', { hasText: 'A model is connected' }).count()) === 1, 'flow: the finished step is collapsed with ✓')
    await fb.locator('.setup-item.bad', { hasText: 'run in the background' }).getByRole('button', { name: 'Allow' }).click()
    check((await fb.evaluate(() => window.__fixes || [])).includes('battery-app'), 'flow: Allow asks the shell for the battery exemption')
    await fb.evaluate(() => {
      window.__setup = { ...window.__setup, batteryApp: true }
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await fb.locator('.setup-hero-title', { hasText: 'All set' }).waitFor({ timeout: 6000 }).then(() => check(true, 'flow: coming back to the app re-checks: All set'), () => check(false, 'flow: coming back to the app re-checks: All set'))
    await fb.getByRole('button', { name: 'Done', exact: true }).click()
    await fb.getByText('Set up Hermes', { exact: true }).waitFor({ state: 'detached', timeout: 4000 }).then(() => check(true, 'flow: Done goes to the chat'), () => check(false, 'flow: Done goes to the chat'))
    await fb.reload()
    await fb.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    await sleep(2000)
    check(!(await flowShown(fb)), 'flow: not shown again after Done')
    check(await fb.evaluate(() => localStorage.getItem('hm.setupFlowDone') === '1'), 'flow: hm.setupFlowDone is set')
    await fb.close()
    await mock({ looseStatus: false })
  }
  // c. Hermes not running on a first run: opens at "Start Hermes" and moves on by itself once Hermes answers
  await mock({ configured: true, pluginEnabled: true, drop: 19000 })
  {
    const fc = await flowPage(OK)
    await fc.goto('http://127.0.0.1:5180/')
    await fc.getByRole('button', { name: 'Start Hermes' }).waitFor({ timeout: 30000 }).then(() => check(true, 'flow: Hermes not running → opens at Start Hermes'), () => check(false, 'flow: Hermes not running → opens at Start Hermes'))
    await fc.getByRole('button', { name: 'Start Hermes' }).click().catch(() => {})
    check((await fc.evaluate(() => window.__fixes || [])).includes('start'), 'flow: Start Hermes asks the shell to start it')
    await fc.locator('.setup-hero-title', { hasText: 'All set' }).waitFor({ timeout: 40000 }).then(() => check(true, 'flow: moves on by itself once Hermes is back (All set)'), () => check(false, 'flow: moves on by itself once Hermes is back (All set)'))
    check((await fc.locator('.flow-done', { hasText: 'Hermes is running' }).count()) === 1, 'flow: Hermes is running is ticked off')
    await fc.close()
  }
  // d. Xiaomi family: a tip with a button to the app settings, never ✓/✗, and it does not open the flow by itself
  await mock({ configured: true, pluginEnabled: true })
  {
    const fd = await flowPage({ ...OK, maker: 'xiaomi' })
    await fd.goto('http://127.0.0.1:5180/')
    await fd.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    await sleep(2500)
    check(!(await flowShown(fd)), 'flow: the Autostart tip alone does not open the flow')
    await fd.locator('.conn-dot').click()
    await fd.getByRole('button', { name: 'Setup check' }).click()
    const tip = fd.locator('.setup-item.info', { hasText: 'Autostart' })
    await tip.waitFor({ timeout: 5000 }).then(() => check(true, 'setup: Xiaomi shows the Autostart tip'), () => check(false, 'setup: Xiaomi shows the Autostart tip'))
    check((await fd.locator('.setup-item.ok, .setup-item.bad', { hasText: 'Autostart' }).count()) === 0, 'setup: the Autostart tip is neither ✓ nor ✗')
    await tip.getByRole('button', { name: 'Hermes Mobile settings' }).click()
    check((await fd.evaluate(() => window.__fixes || [])).includes('app-settings'), 'setup: the Autostart button opens the app settings')
    await fd.close()
    const fg = await flowPage({ ...OK, maker: 'google' })
    await fg.goto('http://127.0.0.1:5180/')
    await fg.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    await fg.locator('.conn-dot').click()
    await fg.getByRole('button', { name: 'Setup check' }).click()
    await fg.locator('.setup-hero-title', { hasText: 'All set' }).waitFor({ timeout: 6000 })
    check((await fg.locator('.setup-item', { hasText: 'Autostart' }).count()) === 0, 'setup: other makers have no Autostart row')
    await fg.close()
  }
  // e. app-first: only Hermes Mobile is installed. The flow opens at once at the helper apps, installs all four in order,
  // offers Start Shizuku (skippable), asks for the Termux permission, copies the installer command, shows its progress
  // lines, and after DONE connects and lands on the model step.
  await mock({ unconfigured: true, pluginEnabled: true, drop: 600000 })
  {
    const FRESH = { ...OK, termux: false, runCommand: false, termuxApi: false, termuxBoot: false, termuxBootStopped: false, shizuku: false, canInstall: true, devOptions: false, wirelessDebugging: false, termuxSigner: '', probe: true, maker: 'google' }
    const fe = await flowPage(FRESH)
    await fe.goto('http://127.0.0.1:5180/')
    await fe.getByText('Get the helper apps', { exact: true }).first().waitFor({ timeout: 6000 }).then(() => check(true, 'app-first: no Termux → the flow opens at once at the helper apps'), () => check(false, 'app-first: no Termux → the flow opens at once at the helper apps'))
    check((await fe.locator('.app-list .setup-item.bad').count()) === 4, 'app-first: four install rows (Termux, Termux:API, Termux:Boot, Shizuku)')
    check((await fe.evaluate(() => window.__probes || 0)) === 0, 'app-first: no Termux command is sent while Termux is missing')
    await fe.getByRole('button', { name: 'Install all' }).click()
    await fe.getByText('Start Shizuku', { exact: true }).first().waitFor({ timeout: 8000 }).then(() => check(true, 'app-first: once all four are installed the flow moves on to Start Shizuku'), () => check(false, 'app-first: once all four are installed the flow moves on to Start Shizuku'))
    check(JSON.stringify(await fe.evaluate(() => window.__installs)) === JSON.stringify(['termux', 'termux-api', 'termux-boot', 'shizuku']), `app-first: Install all installs them one after another, Termux first (${JSON.stringify(await fe.evaluate(() => window.__installs))})`)
    await fe.getByRole('button', { name: 'Open Shizuku' }).click()
    check((await fe.evaluate(() => window.__fixes || [])).includes('open-shizuku'), 'app-first: Open Shizuku opens it')
    await fe.getByRole('button', { name: 'Skip for now' }).click()
    await fe.getByRole('button', { name: 'Allow' }).waitFor({ timeout: 5000 }).then(() => check(true, 'app-first: after Shizuku, the Termux permission comes before the installer'), () => check(false, 'app-first: after Shizuku, the Termux permission comes before the installer'))
    await fe.getByRole('button', { name: 'Allow' }).click()
    await fe.evaluate(() => {
      window.__setup = { ...window.__setup, runCommand: true }
      window.__probe = { result: 'not-allowed' }
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await fe.getByText('Run the installer', { exact: true }).waitFor({ timeout: 5000 }).then(() => check(true, 'app-first: Termux refuses commands → Run the installer'), () => check(false, 'app-first: Termux refuses commands → Run the installer'))
    check((await fe.evaluate(() => window.__probes || 0)) >= 1, 'app-first: the flow probed Termux once it was allowed to')
    await fe.getByRole('button', { name: 'Copy the command' }).click()
    check((await fe.evaluate(() => window.__copied)) === 1, 'app-first: Copy the command asks the shell for the command (the page never builds it)')
    await fe.getByText('Waiting for the installer to start', { exact: false }).waitFor({ timeout: 3000 }).then(() => check(true, 'app-first: after copying it waits for the installer'), () => check(false, 'app-first: after copying it waits for the installer'))
    const push = (lines, extra = {}) => fe.evaluate(([ls, ex]) => {
      for (const l of ls) {
        window.__progress = { ...window.__progress, ...ex, lines: [...window.__progress.lines, l], fail: l.startsWith('FAIL ') ? l.split(' ')[1] : l.startsWith('STEP ') ? '' : window.__progress.fail }
        window.hermesSetupLine(l)
      }
    }, [lines, extra])
    await push(['STEP packages Termux packages', 'STEP access Access', 'phone: tap Allow on Android’s prompt, so Hermes can read and save your files', 'STEP android limit', 'android: child-process limit lifted (via Shizuku)', 'STEP debian Debian'])
    await fe.locator('.install-step.run', { hasText: 'Debian' }).waitFor({ timeout: 3000 }).then(() => check(true, 'app-first: progress lines show the running step'), () => check(false, 'app-first: progress lines show the running step'))
    check((await fe.locator('.install-step.ok').count()) === 3, 'app-first: finished installer steps are ticked')
    check((await fe.locator('.install-hint', { hasText: 'tap Allow on Android' }).count()) === 1, 'app-first: the latest “phone:” hint is shown')
    check(!(await fe.evaluate(() => window.__fixes || [])).includes('start'), 'app-first: Start Hermes is never asked for while the installer runs')
    await push(['FAIL debian (line 120)'])
    await fe.getByText('The installer stopped', { exact: true }).waitFor({ timeout: 3000 }).then(() => check(true, 'app-first: FAIL says where it stopped, with Copy again'), () => check(false, 'app-first: FAIL says where it stopped, with Copy again'))
    check((await fe.getByRole('button', { name: 'Copy the command' }).count()) === 1, 'app-first: FAIL offers the command again')
    await push(['STEP debian Debian', 'STEP hermes Hermes', 'STEP plugin Plugin', 'STEP start Start'])
    await mock({ up: true })
    await push(['DONE'], { done: true, active: false })
    await fe.getByText('Connect Hermes to a model').waitFor({ timeout: 20000 }).then(() => check(true, 'app-first: DONE → connects → the model step'), () => check(false, 'app-first: DONE → connects → the model step'))
    await fe.close()
  }
  // f. a PC-installed phone on a new app build: the new rows never show, and Termux is not probed while Hermes answers
  await mock({ configured: true, pluginEnabled: true })
  {
    const ff = await flowPage({ ...OK, termuxApi: true, termuxBoot: true, termuxBootStopped: false, shizuku: true, canInstall: true, devOptions: true, wirelessDebugging: true, termuxSigner: 'fdroid', probe: true, maker: 'google' })
    await ff.goto('http://127.0.0.1:5180/')
    await ff.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    await sleep(2000)
    check(!(await flowShown(ff)), 'app-first: a set-up phone goes straight to chat')
    await ff.locator('.conn-dot').click()
    await ff.getByRole('button', { name: 'Setup check' }).click()
    await ff.locator('.setup-hero-title', { hasText: 'All set' }).waitFor({ timeout: 6000 }).then(() => check(true, 'app-first: Setup check is All set with the new rows'), () => check(false, 'app-first: Setup check is All set with the new rows'))
    check((await ff.locator('.setup-item', { hasText: 'Start Shizuku' }).count()) === 0, 'app-first: no Start Shizuku row on a set-up phone')
    check((await ff.locator('.setup-item.ok', { hasText: 'Hermes is installed' }).count()) === 1 && (await ff.locator('.setup-item.ok', { hasText: 'Shizuku are installed' }).count()) === 1, 'app-first: the apps and installer rows are ✓ on a set-up phone')
    check((await ff.evaluate(() => window.__probes || 0)) === 0, 'app-first: Termux is not probed while Hermes answers')
    await ff.close()
  }
  await mock({ configured: true, pluginEnabled: true })

  await browser.close()
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
  process.exit(failures ? 1 : 0)
}
main().catch(e => {
  console.error(e)
  process.exit(2)
})
