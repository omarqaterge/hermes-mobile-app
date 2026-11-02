// Opt-in usage stats: never offered without an app key; a card once after setup; only the listed fields; off forgets.
const path = require('path')
const { WEB, SHOTS, check, sleep, nativeShell } = require('../lib.cjs')

const KEY = 'A-EU-0000000000'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, app-key', 'access-control-allow-methods': 'POST, OPTIONS' }

async function open(browser, { key, respond, seed } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
  const posts = []
  const errors = []
  await ctx.route(/aptabase\.com/, route => {
    const req = route.request()
    if (req.method() === 'POST') posts.push({ url: req.url(), appKey: req.headers()['app-key'], events: JSON.parse(req.postData()) })
    if (respond && req.method() === 'POST') return respond(route)
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{}' })
  })
  await ctx.addInitScript(([k, s]) => {
    try {
      if (!localStorage.getItem('hm.welcomeDone')) { localStorage.setItem('hm.welcomeDone', '1'); localStorage.setItem('hm.setupFlowDone', '1'); localStorage.setItem('hm.connectedOnce', '1') }
      if (k) sessionStorage.setItem('hm.devStatsKey', k)
      for (const [a, b] of Object.entries(s || {})) if (!sessionStorage.getItem('seeded.' + a)) { localStorage.setItem(a, b); sessionStorage.setItem('seeded.' + a, '1') }
    } catch {}
  }, [key || '', seed || null])
  const pg = await ctx.newPage()
  pg.on('pageerror', e => errors.push(e.message))
  await pg.goto(WEB + '/')
  await pg.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
  return { ctx, pg, posts, errors }
}
const toBackground = pg => pg.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: true })
  document.dispatchEvent(new Event('visibilitychange'))
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
})
const openSettings = async pg => {
  await pg.getByRole('button', { name: /^Sessions/ }).click()
  await pg.locator('.nav-tile', { hasText: 'Settings' }).click()
  await pg.locator('.screen .title', { hasText: 'Settings' }).waitFor({ timeout: 5000 })
}
const row = pg => pg.locator('.set-row', { hasText: 'Share anonymous usage stats' })
const card = pg => pg.locator('.sheet', { hasText: 'Share anonymous usage stats?' })
const source = pg => pg.locator('.sheet', { hasText: 'How did you hear about us?' })

module.exports = async t => {
  const { browser } = t

  // No app key (every build until the owner adds one): no card, no switch, no request.
  {
    const { ctx, pg, posts } = await open(browser)
    await sleep(2500)
    check((await card(pg).count()) === 0, 'stats: no key: the card is not offered')
    await openSettings(pg)
    check((await row(pg).count()) === 0, 'stats: no key: Settings has no switch')
    await toBackground(pg)
    await sleep(200)
    check(posts.length === 0, 'stats: no key: nothing is sent')
    await ctx.close()
  }

  // A key and No thanks: nothing is sent, the card doesn't come back, the switch stays off.
  {
    const { ctx, pg, posts, errors } = await open(browser, { key: KEY })
    await card(pg).waitFor({ timeout: 8000 }).then(() => check(true, 'stats: the card shows once setup is done'), () => check(false, 'stats: the card shows once setup is done'))
    await pg.screenshot({ path: path.join(SHOTS, 'stats-card.png') })
    const text = await card(pg).innerText()
    check(/random ID/.test(text) && /app version/.test(text) && /Android version/.test(text), 'stats: the card says what is sent')
    check(/Never your chats/.test(text), 'stats: the card says what is never sent')
    check(/Aptabase/.test(text) && /country and region/.test(text), 'stats: the card names the service and what it keeps')
    check(posts.length === 0, 'stats: nothing is sent before the answer')
    await card(pg).getByRole('button', { name: 'No thanks' }).click()
    await card(pg).waitFor({ state: 'detached', timeout: 3000 })
    check((await source(pg).count()) === 0, 'stats: No thanks does not ask where they heard of it')
    await toBackground(pg)
    await pg.reload()
    await pg.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    await sleep(2500)
    check((await card(pg).count()) === 0, 'stats: the card is shown only once')
    await openSettings(pg)
    check((await row(pg).getByRole('switch').getAttribute('aria-checked')) === 'false', 'stats: the switch is off after No thanks')
    await toBackground(pg)
    await sleep(200)
    check(posts.length === 0, 'stats: nothing is sent after No thanks')
    check(await pg.evaluate(() => localStorage.getItem('hm.statsId')) === null, 'stats: No thanks makes no install ID')
    check(errors.length === 0, 'stats: no page errors (No thanks)')
    await ctx.close()
  }

  // Yes, a source, then the switch off.
  {
    const { ctx, pg, posts, errors } = await open(browser, { key: KEY })
    await card(pg).waitFor({ timeout: 8000 })
    await card(pg).getByRole('button', { name: 'Yes' }).click()
    await source(pg).waitFor({ timeout: 3000 })
    await pg.screenshot({ path: path.join(SHOTS, 'stats-source.png') })
    const choices = await source(pg).locator('.btn').allInnerTexts()
    check(JSON.stringify(choices) === JSON.stringify(['GitHub', 'Reddit', 'X', 'YouTube', 'A friend', 'Search', 'Other', 'Skip']), 'stats: fixed choices, and a skip')
    check((await source(pg).locator('input, textarea').count()) === 0, 'stats: no free text')
    await source(pg).getByRole('button', { name: 'Reddit' }).click()
    await openSettings(pg)
    check((await row(pg).getByRole('switch').getAttribute('aria-checked')) === 'true', 'stats: the switch is on after Yes')
    await toBackground(pg)
    await sleep(300)
    const events = posts.flatMap(p => p.events)
    check(posts[0]?.url === 'https://eu.aptabase.com/api/v0/events' && posts[0]?.appKey === KEY, 'stats: sends to the host of the key\'s region')
    check(JSON.stringify(events.map(e => e.eventName)) === JSON.stringify(['app_start', 'heard_from', 'screen_open']), 'stats: app start, the source and the screen')
    check(events.find(e => e.eventName === 'heard_from')?.props.source === 'Reddit', 'stats: the source is the chosen one')
    check(events.find(e => e.eventName === 'screen_open')?.props.screen === 'settings', 'stats: the screen is its fixed name')
    const id = await pg.evaluate(() => localStorage.getItem('hm.statsId'))
    check(/^[0-9a-f]{32}$/.test(id || '') && events.every(e => e.sessionId === id), 'stats: every event has the random install ID')
    check(events.every(e => Object.keys(e.systemProps).sort().join() === 'appVersion,isDebug,osName,osVersion,sdkVersion'), 'stats: only the listed system fields (no locale, no model)')
    const n = posts.length
    await row(pg).getByRole('switch').click()
    check(await pg.evaluate(() => localStorage.getItem('hm.statsId')) === null, 'stats: off forgets the install ID')
    await pg.locator('.screen .back, .screen button[aria-label="Back"]').first().click().catch(() => {})
    await toBackground(pg)
    await sleep(300)
    check(posts.length === n, 'stats: off stops sending')
    check(errors.length === 0, 'stats: no page errors (Yes)')
    await ctx.close()
  }

  // Said no on the card, later on in Settings: the question comes once, there.
  {
    const { ctx, pg } = await open(browser, { key: KEY, seed: { 'hm.statsChoice': 'no' } })
    await openSettings(pg)
    await row(pg).getByRole('switch').click()
    await source(pg).waitFor({ timeout: 3000 }).then(() => check(true, 'stats: turning it on later asks the question'), () => check(false, 'stats: turning it on later asks the question'))
    await source(pg).getByRole('button', { name: 'Skip' }).click()
    await row(pg).getByRole('switch').click()
    await row(pg).getByRole('switch').click()
    await sleep(200)
    check((await source(pg).count()) === 0, 'stats: the question is only asked once')
    await ctx.close()
  }

  // A stats server that fails: nothing on screen, no page error.
  {
    const { ctx, pg, posts, errors } = await open(browser, { key: KEY, seed: { 'hm.statsChoice': 'yes', 'hm.statsSourceAsked': '1' }, respond: route => route.abort() })
    await sleep(300)
    await toBackground(pg)
    await sleep(300)
    check(posts.length === 1, 'stats: a failed send was tried')
    check(errors.length === 0 && (await pg.locator('.toast').count()) === 0, 'stats: a failed send is silent')
    await ctx.close()
  }

  // The Android shell ignores the development key: no build key means no stats.
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
    let posted = 0
    await ctx.route(/aptabase\.com/, r => { posted++; return r.abort() })
    await ctx.addInitScript(k => { sessionStorage.setItem('hm.devStatsKey', k); localStorage.setItem('hm.statsChoice', 'yes'); localStorage.setItem('hm.welcomeDone', '1'); localStorage.setItem('hm.setupFlowDone', '1'); localStorage.setItem('hm.connectedOnce', '1') }, KEY)
    await ctx.addInitScript(nativeShell)
    const pg = await ctx.newPage()
    await pg.goto(WEB + '/')
    await sleep(1500)
    await toBackground(pg)
    await sleep(200)
    check(posted === 0, 'stats: inside the app, the development key does nothing')
    await ctx.close()
  }
}
