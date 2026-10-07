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

  // ── model picked on a new chat applies only after its agent is built (Hermes drops an earlier switch) ──
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.locator('.picker-opt', { hasText: 'mock-model' }).click()
  await page.locator('.row', { hasText: 'mock-sonnet' }).click()
  await page.getByPlaceholder('Message Hermes').fill('which model?')
  await page.getByRole('button', { name: 'Send' }).click()
  await page.locator('.msg.user .bubble', { hasText: 'which model?' }).waitFor({ timeout: 5000 })
  for (let i = 0; i < 30 && !rpcs('prompt.submit').length; i++) await sleep(100)
  {
    const all = calls()
    const at = f => (all.find(f) || {}).t
    const built = at(c => c.built === 'rt-new'), set = at(c => c.rpc === 'config.set' && c.params.key === 'model'), sub = at(c => c.rpc === 'prompt.submit')
    check(built && set && sub && set >= built && sub >= set, `model switch waits for the agent build, send waits for the switch (built ${built}, set ${set}, submit ${sub})`)
  }
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

  // ── #7 show older chats ──────────────────────────────
  await page.getByRole('button', { name: 'Sessions' }).click()
  const olderBtn = page.getByRole('button', { name: 'Show older chats' })
  await olderBtn.waitFor({ timeout: 5000 })
  const before = await page.locator('.drawer .session-row').count()
  await olderBtn.click()
  await page.waitForFunction(() => document.querySelectorAll('.drawer .session-row').length > 100, null, { timeout: 5000 })
  const after = await page.locator('.drawer .session-row').count()
  const lim = rpcs('session.list').map(c => c.params.limit)
  check(before === 80 && after === 151 && lim.includes(180), `older chats load (${before} → ${after}, limits ${[...new Set(lim)]})`)
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

  // ── #11 long chats: draw the end first, earlier turns on scroll, without moving what's on screen ──
  await page.evaluate(() => window.hermesOpenSession('s-long'))
  await page.locator('.msg.assistant', { hasText: 'answer 149' }).waitFor({ timeout: 5000 })
  const drawn = await page.locator('.chat .msg').count()
  check(drawn <= 120 && drawn >= 40, `only the end is drawn on open (${drawn} of 300)`)
  const atBottom = await page.locator('.chat').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  check(atBottom, 'opens at the bottom')
  const firstSeen = await page.locator('.chat .msg').first().textContent()
  await page.locator('.chat').evaluate(el => (el.scrollTop = 0))
  const topBefore = await page.locator('.chat .msg').first().evaluate(el => el.getBoundingClientRect().top)
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
  check((await page.locator('.hub-card').count()) === 5, '…back to the Hermes hub that opened it')
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
  check(sugg[0] === 'queued hello' && sugg.includes('show media') && sugg.length === 4, `suggestions start with recent prompts (${JSON.stringify(sugg)})`)
  await page.evaluate(() => window.hermesShortcut('live'))
  await page.locator('.toast', { hasText: 'Live mode needs' }).waitFor({ timeout: 3000 }).then(() => check(true, 'Live shortcut explains itself without voice'), () => check(false, 'Live shortcut explains itself without voice'))

  // ── #30 About shows the Hermes version with no chat open (health check) ──
  await page.evaluate(() => window.hermesShortcut('new'))
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.locator('.nav-tile', { hasText: 'Settings' }).click()
  const hv = page.locator('.set-row', { hasText: /^Hermes/ }).last()
  await hv.waitFor({ timeout: 5000 })
  check(((await hv.textContent()) || '').includes('v0.21.5'), `About → Hermes version (${await hv.textContent()})`)
  await page.evaluate(() => window.hermesBack())

  // ── Hermes hub: one screen with a summary per page ──
  await page.getByRole('button', { name: /^Sessions/ }).click()
  check((await page.locator('.nav-tile').count()) === 3, 'drawer has three tiles (Hermes, Bots, Settings)')
  await page.locator('.nav-tile', { hasText: 'Hermes' }).click()
  await page.locator('.hub-card', { hasText: '2 enabled of 3' }).waitFor({ timeout: 5000 }).then(() => check(true, 'hub: skills summary'), () => check(false, 'hub: skills summary'))
  check((await page.locator('.hub-card', { hasText: '2 notes · 50% full · 1 about you' }).count()) === 1, 'hub: memory summary')
  check((await page.locator('.hub-card', { hasText: '1 active' }).count()) === 1, 'hub: cron summary')
  check((await page.locator('.hub-card', { hasText: '1 project' }).count()) === 1, 'hub: projects summary')
  await page.locator('.hub-card', { hasText: 'Memory' }).click()
  await page.locator('.screen .title', { hasText: 'Memory' }).waitFor({ timeout: 3000 })
  await page.getByRole('button', { name: 'Back' }).last().click()
  check((await page.locator('.hub-card').count()) === 5, 'Back from a page returns to the hub')
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
  await np.addInitScript(() => {
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
      listVoices: key => k(key, 'listVoices'),
      isAssistant: key => (k(key, 'isAssistant'), !!window.__assistant),
      openAssistantSettings: key => k(key, 'openAssistantSettings')
    }
  })
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
  await np.waitForFunction(() => (window.__spoken || []).some(t => /Say allow/.test(t)), null, { timeout: 8000 }).catch(() => {})
  const spoken = await np.evaluate(() => (window.__spoken || []).join(' | '))
  check(/delete the temp folder.*Say allow, allow for this chat, or deny/.test(spoken), `approval read aloud (${spoken})`)
  await sleep(300)
  await np.evaluate(() => window.__hmVoice('final', 'yes allow it'))
  await sleep(2800)
  const va = calls().filter(c => c.answer === 'srv-approval-1')
  check(va.length === 1 && va[0].result && va[0].result.choice === 'once', `answered by voice (${JSON.stringify(va)})`)
  // Opening another chat ends live mode (it would otherwise keep listening and send there).
  check(await np.locator('.live-bar').count() === 1, 'live mode still on before switching')
  await np.evaluate(() => window.hermesOpenSession('s-6'))
  await np.locator('.live-bar').waitFor({ state: 'detached', timeout: 5000 }).then(() => check(true, 'opening another chat ends live mode'), () => check(false, 'opening another chat ends live mode'))

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
      speak: (key, text) => {
        k(key, 'speak')
        ;(window.__spoken ||= []).push(text)
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

  await browser.close()
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
  process.exit(failures ? 1 : 0)
}
main().catch(e => {
  console.error(e)
  process.exit(2)
})
