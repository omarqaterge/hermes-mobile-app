// Report a problem: the sheet in Settings → About, the relay, the GitHub fallback, the scrubbed log, the screenshot.
const path = require('path')
const { WEB, SHOTS, check, sleep, png } = require('../lib.cjs')

const RELAY = 'https://relay.test/'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' }
const ISSUE = 'https://github.com/omarqaterge/hermes-mobile-app/issues/12'

// relay: false = no relay URL; otherwise { status, body } the stand-in relay answers POSTs with.
async function open(browser, { relay, theme, warn } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
  const posts = []
  const errors = []
  await ctx.route(/relay\.test/, route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    posts.push(JSON.parse(req.postData()))
    const r = relay || { status: 201, body: { url: ISSUE, number: 12, screenshot: false } }
    return route.fulfill({ status: r.status, headers: CORS, contentType: 'application/json', body: JSON.stringify(r.body || {}) })
  })
  await ctx.addInitScript(([url, th]) => {
    try {
      if (!localStorage.getItem('hm.welcomeDone')) { localStorage.setItem('hm.welcomeDone', '1'); localStorage.setItem('hm.setupFlowDone', '1'); localStorage.setItem('hm.connectedOnce', '1') }
      if (url) sessionStorage.setItem('hm.devReportUrl', url)
      if (th) localStorage.setItem('hm.theme', th)
    } catch {}
    window.__opened = []
    window.open = u => { window.__opened.push(String(u)); return null }
  }, [relay === false ? '' : RELAY, theme || ''])
  const pg = await ctx.newPage()
  pg.on('pageerror', e => errors.push(e.message))
  await pg.goto(WEB + '/')
  await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
  if (warn) await pg.evaluate(w => console.warn(w), warn)
  return { ctx, pg, posts, errors }
}
const openSheet = async pg => {
  await pg.getByRole('button', { name: /^Sessions/ }).click()
  await pg.locator('.nav-tile', { hasText: 'Settings' }).click()
  await pg.locator('.screen .title', { hasText: 'Settings' }).waitFor({ timeout: 5000 })
  const row = pg.locator('.set-row', { hasText: 'Report a problem' })
  await row.scrollIntoViewIfNeeded()
  await row.click()
  const sheet = pg.locator('.sheet', { hasText: 'Report a problem' })
  await sheet.getByText('Reports are public').waitFor({ timeout: 3000 })
  return sheet
}
const fill = async (sheet, title, text) => {
  await sheet.locator('input.sheet-input').fill(title)
  await sheet.locator('textarea.sheet-input').fill(text)
}
const opened = pg => pg.evaluate(() => window.__opened)

module.exports = async t => {
  const { browser } = t

  // The form, and Submit needing both fields. No relay: Continue on GitHub, no request, Back keeps the text.
  {
    const { ctx, pg, posts, errors } = await open(browser, { relay: false })
    await pg.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {})
    const sheet = await openSheet(pg)
    check(true, 'report: Settings → About has the row and it opens the sheet')
    await pg.screenshot({ path: path.join(SHOTS, 'report-form.png') })
    const txt = await sheet.innerText()
    check(/Reports are public/.test(txt), 'report: the sheet warns that reports are public')
    check(/Sent with it: app .+Android/.test(txt), 'report: the sheet lists what is sent with it')
    const btn = sheet.getByRole('button', { name: 'Continue on GitHub' })
    check((await btn.count()) === 1, 'report: no relay: the button reads Continue on GitHub')
    check((await sheet.getByText('Add a screenshot', { exact: true }).count()) === 0, 'report: no relay: no Add a screenshot row')
    check(await btn.isDisabled(), 'report: Submit is disabled when empty')
    await sheet.locator('input.sheet-input').fill('Only a title')
    check(await btn.isDisabled(), 'report: Submit is disabled with only a title')
    await fill(sheet, 'Chat stops', 'It froze after "send"')
    check(await btn.isEnabled(), 'report: Submit is enabled with title and text')
    await btn.click()
    await pg.locator('.sheet', { hasText: 'Finish on GitHub' }).waitFor({ timeout: 3000 })
    await sleep(200)
    check(posts.length === 0, 'report: no relay: nothing is sent to a relay')
    const o = await opened(pg)
    const u = o[0] ? new URL(o[0]) : null
    check(!!u && u.origin === 'https://github.com' && u.pathname === '/omarqaterge/hermes-mobile-app/issues/new', 'report: no relay: opens the GitHub new-issue page')
    check(!!u && u.searchParams.get('title') === 'Chat stops', 'report: the GitHub link carries the title')
    const body = (u && u.searchParams.get('body')) || ''
    check(body.includes('It froze after "send"') && /- App: /.test(body), 'report: the GitHub link carries the text and the details')
    check(/Reports from the app go through GitHub/.test(await pg.locator('.sheet').innerText()), 'report: no relay: the sheet says why it goes through GitHub')
    await pg.locator('.sheet').getByRole('button', { name: 'Back' }).click()
    const sheet2 = pg.locator('.sheet', { hasText: 'Report a problem' })
    check((await sheet2.locator('input.sheet-input').inputValue()) === 'Chat stops' && (await sheet2.locator('textarea.sheet-input').inputValue()) === 'It froze after "send"', 'report: Back returns to the form with the text kept')
    check(errors.length === 0, 'report: no page errors (no relay)')
    await ctx.close()
  }

  // With a relay: the posted JSON, Report sent, Open the report, and the draft cleared.
  {
    const { ctx, pg, posts, errors } = await open(browser)
    const sheet = await openSheet(pg)
    check((await sheet.getByRole('button', { name: 'Submit' }).count()) === 1, 'report: with a relay the button reads Submit')
    await fill(sheet, 'Voice cuts out', 'Voice stops after ten seconds')
    await sheet.getByRole('button', { name: 'Submit' }).click()
    await pg.locator('.sheet', { hasText: 'Report sent' }).waitFor({ timeout: 5000 })
    const p = posts[0] || {}
    check(posts.length === 1 && /^[0-9a-f]{32}$/.test(p.installId || ''), 'report: posts once with a 32-hex install ID')
    check(p.title === 'Voice cuts out' && p.text === 'Voice stops after ten seconds', 'report: posts the title and text')
    check(p.details && 'app' in p.details && 'android' in p.details && 'hermes' in p.details, 'report: posts details app, android and hermes')
    check(!('log' in p) && !('screenshot' in p), 'report: no log and no screenshot unless chosen')
    await pg.screenshot({ path: path.join(SHOTS, 'report-sent.png') })
    await pg.locator('.sheet').getByRole('button', { name: 'Open the report' }).click()
    check((await opened(pg)).includes(ISSUE), 'report: Open the report opens the issue')
    await pg.locator('.sheet').getByRole('button', { name: 'Close' }).click()
    await pg.locator('.sheet').waitFor({ state: 'detached', timeout: 3000 })
    const sheet2 = await openSheet2(pg)
    check((await sheet2.locator('input.sheet-input').inputValue()) === '' && (await sheet2.locator('textarea.sheet-input').inputValue()) === '', 'report: the draft is cleared after sending')
    check(errors.length === 0, 'report: no page errors (relay)')
    await ctx.close()
  }

  // The log: shown scrubbed, sent scrubbed.
  {
    const { ctx, pg, posts } = await open(browser, { warn: 'token=supersecret123 from 192.168.4.4 mail a@b.org' })
    const sheet = await openSheet(pg)
    await fill(sheet, 'Log test', 'Checking the log')
    check((await sheet.getByLabel('App log to send').count()) === 0, 'report: the log is hidden while the switch is off')
    await sheet.locator('.set-row', { hasText: 'Include recent app log' }).getByRole('switch').click()
    const box = sheet.getByLabel('App log to send')
    await box.waitFor({ timeout: 3000 })
    const log = await box.innerText()
    check(log.includes('[removed]') && log.includes('[ip]') && log.includes('[email]'), 'report: the log box shows [removed], [ip] and [email]')
    check(!/supersecret123|192\.168\.4\.4|a@b\.org/.test(log), 'report: the log box does not show the secret, IP or email')
    await pg.screenshot({ path: path.join(SHOTS, 'report-log.png') })
    await sheet.getByRole('button', { name: 'Submit' }).click()
    await pg.locator('.sheet', { hasText: 'Report sent' }).waitFor({ timeout: 5000 })
    check(posts[0]?.log === log && !/supersecret123|192\.168\.4\.4|a@b\.org/.test(posts[0].log), 'report: the posted log is the scrubbed text shown')
    await ctx.close()
  }

  // Limit and failure: the GitHub fallback with the reason.
  for (const [status, re, name] of [[429, /This phone has sent several reports today/, 'a limit (429)'], [500, /The app couldn't send it/, 'a failure (500)']]) {
    const { ctx, pg, posts } = await open(browser, { relay: { status, body: { error: 'x' } } })
    const sheet = await openSheet(pg)
    await fill(sheet, 'Fallback', 'Relay says no')
    await sheet.getByRole('button', { name: 'Submit' }).click()
    await pg.locator('.sheet', { hasText: 'Finish on GitHub' }).waitFor({ timeout: 5000 })
    check(posts.length === 1, `report: ${name}: the relay was tried`)
    check(re.test(await pg.locator('.sheet').innerText()), `report: ${name}: the sheet says why`)
    const o = await opened(pg)
    check(o.length === 1 && o[0].startsWith('https://github.com/omarqaterge/hermes-mobile-app/issues/new?'), `report: ${name}: GitHub opens with the report`)
    await ctx.close()
  }

  // A screenshot (relay only): preview, the public note, and the posted JPEG.
  {
    const { ctx, pg, posts } = await open(browser, { relay: { status: 201, body: { url: ISSUE, number: 12, screenshot: true } } })
    const sheet = await openSheet(pg)
    await fill(sheet, 'Looks wrong', 'See the picture')
    check((await sheet.getByText('Add a screenshot', { exact: true }).count()) === 1, 'report: with a relay there is an Add a screenshot row')
    await sheet.locator('input[type=file]').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: png })
    await sheet.getByAltText('Screenshot to send').waitFor({ timeout: 5000 })
    check(/The screenshot will be public too/.test(await sheet.innerText()), 'report: the screenshot shows with a public note')
    await pg.screenshot({ path: path.join(SHOTS, 'report-shot.png') })
    await sheet.getByRole('button', { name: 'Submit' }).click()
    await pg.locator('.sheet', { hasText: 'Report sent' }).waitFor({ timeout: 5000 })
    const s = posts[0]?.screenshot
    check(s && s.type === 'image/jpeg' && typeof s.data === 'string' && s.data.length > 20 && !s.data.startsWith('data:'), 'report: Submit posts the screenshot as a base64 JPEG')
    check(/with the screenshot/.test(await pg.locator('.sheet').innerText()), 'report: Report sent mentions the screenshot')
    await ctx.close()
  }

  // The light theme.
  {
    const { ctx, pg, errors } = await open(browser, { theme: 'light' })
    const sheet = await openSheet(pg)
    await pg.screenshot({ path: path.join(SHOTS, 'report-light.png') })
    check((await sheet.isVisible()) && errors.length === 0, 'report: the sheet renders in the light theme without page errors')
    await ctx.close()
  }
}
const openSheet2 = async pg => {
  await pg.locator('.set-row', { hasText: 'Report a problem' }).click()
  const s = pg.locator('.sheet', { hasText: 'Report a problem' })
  await s.getByText('Reports are public').waitFor({ timeout: 3000 })
  return s
}
