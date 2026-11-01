// Offline queue, attachments over a reconnect, message times, /btw, shortcut, suggestions, About, hub, setup check.
const { addFiles, WEB, calls, rpcs, sleep, check, mock, png } = require('../lib.cjs')

module.exports = async t => {
  const { browser, page } = t
  const attach = (option, files) => addFiles(page, option, files)
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

  {
  // Reopening a chat from another chat: its card must find the saved answer (the chat id at mount time is the
    // OTHER chat's while the cached copy is drawn), so no new call is made.
    const row = n => page.locator('.session-row', { hasText: n })
    const qcalls = () => calls().filter(c => c.http === 'POST' && c.path === '/api/plugins/hermes-mobile/openui/call')
    await page.getByRole('button', { name: 'Sessions' }).click()
    await row('Card chat').click()
    await page.locator('.msg.assistant .hm-openui').last().getByText('Mock result one').waitFor({ timeout: 15000 })
    const afterFirst = qcalls().length
    await page.getByRole('button', { name: 'Sessions' }).click()
    await row('Stale edit chat').click()
    await page.locator('.msg.assistant', { hasText: 'stale second answer' }).waitFor({ timeout: 5000 })
    await page.getByRole('button', { name: 'Sessions' }).click()
    await row('Card chat').click()
    await page.locator('.msg.assistant .hm-openui').last().getByText('Mock result one').waitFor({ timeout: 15000 })
    await page.waitForTimeout(800)
    check(qcalls().length === afterFirst, `reopening a card chat from another chat makes no new /openui/call (${afterFirst} → ${qcalls().length})`)
  }

  // ── pull up past the last message opens the /btw side chat ──
  {
    const pp = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await pp.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-5', profile: 'default' })))
    await pp.goto(WEB + '/')
    await pp.locator('.msg.assistant').first().waitFor({ timeout: 8000 })
    // Touch events on .chat: start near the bottom, move up `dy` px in steps, optionally report mid-gesture state, end.
    const pull = (dy, peek) => pp.evaluate(async ([dy, peek]) => {
      const el = document.querySelector('.chat')
      const r = el.getBoundingClientRect()
      const x = r.left + 60, y = r.bottom - 40
      const mk = (type, py) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: el, clientX: x, clientY: py })] })
      const wait = () => new Promise(res => setTimeout(res, 30))
      el.dispatchEvent(mk('touchstart', y))
      let mid = null
      for (let i = 1; i <= 6; i++) {
        el.dispatchEvent(mk('touchmove', y - (dy * i) / 6))
        await wait()
      }
      if (peek) mid = { pulling: el.classList.contains('pulling'), armed: el.classList.contains('pull-armed'), pull: el.style.getPropertyValue('--pull'), moved: getComputedStyle(el.querySelector('.msg')).transform }
      el.dispatchEvent(mk('touchend', y - dy))
      return mid
    }, [dy, peek])
    const btw = () => pp.locator('.sheet.btw').count()
    await pull(40)
    await sleep(400)
    check((await btw()) === 0, 'a short pull up at the bottom does not open the side chat')
    check((await pp.evaluate(() => document.querySelector('.chat').className)) === 'chat', 'a short pull springs back and leaves no pull classes')
    await pull(130)
    await sleep(400)
    check((await btw()) === 0, 'a medium pull (130 px) no longer opens the side chat')
    const mid = await pull(200, true)
    check(mid && mid.pulling && mid.armed && parseFloat(mid.pull) < -20 && mid.moved !== 'none', `a firm pull stretches the list and arms the hint (${JSON.stringify(mid)})`)
    await pp.locator('.sheet.btw').waitFor({ timeout: 3000 }).then(() => check(true, 'a firm pull up at the bottom opens the side chat'), () => check(false, 'a firm pull up at the bottom opens the side chat'))
    await pull(200)
    await sleep(300)
    check((await btw()) === 1, 'the gesture does nothing while the side chat is open')
    await pp.evaluate(() => { document.querySelector('.sheet-backdrop')?.click() })
    await sleep(400)
    // Not at the bottom: make the list taller than the screen and scroll to the top.
    await pp.evaluate(() => {
      const el = document.querySelector('.chat')
      el.querySelector('.chat-pad').style.height = '2000px'
      el.scrollTop = 0
    })
    await sleep(200)
    await pull(200)
    await sleep(400)
    check((await btw()) === 0, 'a pull when the list is not at the bottom does not open the side chat')
    await pp.close()
    const pe = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await pe.goto(WEB + '/')
    await pe.locator('.empty .suggestion').first().waitFor({ timeout: 8000 })
    await pe.evaluate(() => {
      const el = document.querySelector('.empty')
      const mk = (type, py) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: el, clientX: 100, clientY: py })] })
      el.dispatchEvent(mk('touchstart', 600))
      el.dispatchEvent(mk('touchmove', 500))
      el.dispatchEvent(mk('touchmove', 400))
      el.dispatchEvent(mk('touchend', 400))
    })
    await sleep(400)
    check((await pe.locator('.sheet.btw').count()) === 0 && (await pe.locator('.chat').count()) === 0, 'a pull on the empty new-chat screen does not open the side chat')
    await pe.close()
  }

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
}
