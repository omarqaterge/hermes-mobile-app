// Settings' main page and the pages the redesign moves: Appearance (Dark / OLED black / Light theme, text size), the settings search, Default
// models (one model for all bots); then the main page of task 06: its seven rows in two sections, the attention cards, each
// moved row on its new page, search landing there, Back from every page, and the rows and cards at 320 px and in Light.
// Each control is found by its role and name, used, and its effect checked.
const { WEB, calls, check, sleep, mock, nativeShell, settingsPage, contrast, expectIdle } = require('../lib.cjs')

module.exports = async t => {
  const { browser } = t
  const sp = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await sp.goto(WEB + '/')
  await sp.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
  const openSettings = async () => {
    await sp.getByRole('button', { name: /^Sessions/ }).click()
    await sp.getByRole('button', { name: 'Settings' }).click()
    await sp.getByRole('searchbox', { name: 'Search settings' }).or(sp.getByRole('textbox', { name: 'Search settings' })).waitFor({ timeout: 5000 })
  }
  await openSettings()

  // ── the settings search: a match leads to its page; Clear search empties the box ──
  {
    const box = sp.getByRole('textbox', { name: 'Search settings' })
    await box.fill('text size')
    const hit = sp.getByRole('button', { name: /Text size/ }).first()
    const found = await hit.waitFor({ timeout: 3000 }).then(() => true, () => false)
    await sp.getByRole('button', { name: 'Clear search' }).click()
    check(found && (await box.inputValue()) === '' && (await sp.getByRole('button', { name: 'Clear search' }).count()) === 0, 'settings: searching finds a setting, and Clear search empties the box')
  }

  // ── Appearance: the theme changes the page's colours and is kept; the text size is kept ──
  {
    await sp.getByRole('button', { name: /^Appearance/ }).click()
    await sp.getByRole('button', { name: /^Light/ }).click()
    const light = await sp.evaluate(() => ({ theme: document.documentElement.dataset.theme, kept: localStorage.getItem('hm.theme') }))
    check(light.theme === 'light' && light.kept === 'light', `appearance: Light turns the page light and is kept (${JSON.stringify(light)})`)
    await sp.getByRole('button', { name: /^OLED black/ }).click()
    const oled = await sp.evaluate(() => ({ theme: document.documentElement.dataset.theme, oled: document.documentElement.hasAttribute('data-oled'), kept: localStorage.getItem('hm.theme') }))
    check(oled.theme === 'oled' && oled.oled && oled.kept === 'oled', `appearance: OLED black turns the page black (${JSON.stringify(oled)})`)
    await sp.getByRole('button', { name: /^Default/ }).click()
    const dark = await sp.evaluate(() => ({ theme: document.documentElement.dataset.theme, oled: document.documentElement.hasAttribute('data-oled'), kept: localStorage.getItem('hm.theme') }))
    check(dark.theme === 'default' && !dark.oled && dark.kept === 'default', `appearance: Default goes back to the dark theme (${JSON.stringify(dark)})`)
    const sample = sp.getByText('The quick brown fox jumps over the lazy dog.') // the size preview
    const fontBefore = await sample.evaluate(el => getComputedStyle(el).fontSize)
    await sp.getByRole('button', { name: '120%', exact: true }).click()
    await sp.waitForTimeout(200)
    const big = { kept: await sp.evaluate(() => localStorage.getItem('hm.textScale')), font: await sample.evaluate(el => getComputedStyle(el).fontSize) }
    check(big.kept === '1.2' && parseFloat(big.font) > parseFloat(fontBefore), `appearance: a text size is kept and makes the text bigger (${fontBefore} → ${JSON.stringify(big)})`)
    await sp.getByRole('button', { name: '100%', exact: true }).click()
    check((await sp.evaluate(() => localStorage.getItem('hm.textScale'))) === '1', 'appearance: 100% goes back to the normal size')
    await sp.evaluate(() => window.hermesBack())
  }

  // ── Default models (Settings → Models): Set one model for all bots asks Hermes to switch each bot's model ──
  {
    await settingsPage(sp, 'Models')
    await sp.getByRole('button', { name: /^Default models/ }).click()
    await sp.getByRole('button', { name: /^Set one model for all bots/ }).click()
    const since = Date.now()
    const picker = sp.getByRole('dialog').filter({ has: sp.getByPlaceholder('Search models…') })
    await picker.waitFor({ timeout: 5000 })
    await picker.getByRole('button', { name: /^mock-sonnet/ }).first().click()
    await sp.waitForTimeout(800)
    const set = calls().filter(c => c.t >= since && c.http === 'POST' && c.path === '/api/model/set')
    check(set.length >= 1 && set.every(c => c.body.model === 'mock-sonnet'), `default models: Set one model for all bots switches every bot's model (${JSON.stringify(set.map(c => c.body))})`)
  }
  await sp.close()

  // A page for the main page's checks. GitHub answers with `tag` (none: not found, so no update is offered); `native` puts
  // the page in the app shell (with the fingerprint switch's shell state); `init` adds to the page's storage.
  const page = async ({ tag, native, init, size = { width: 375, height: 812 } } = {}) => {
    const p = await browser.newPage({ viewport: size })
    await p.route('https://api.github.com/**', route => {
      const u = route.request().url()
      if (tag && u.includes('/releases/latest'))
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ tag_name: tag, assets: [{ name: 'hermes-mobile.apk', browser_download_url: `https://github.com/omarqaterge/hermes-mobile-app/releases/download/${tag}/hermes-mobile.apk` }] }) })
      return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' })
    })
    if (init) await p.addInitScript(init)
    if (native) {
      await p.addInitScript(nativeShell)
      await p.addInitScript(() => {
        window.__installed = []
        Object.assign(window.HermesAndroid, {
          installUpdate: (key, url) => window.__installed.push(url),
          approvalLockState: () => JSON.stringify({ on: true, secure: true }),
          confirmApproval: () => {}
        })
      })
    }
    await p.goto(WEB + '/')
    await p.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    return p
  }
  const openMain = async p => {
    await p.getByRole('button', { name: /^Sessions/ }).click()
    await p.getByRole('button', { name: 'Settings', exact: true }).click()
    await p.getByRole('textbox', { name: 'Search settings' }).waitFor({ timeout: 5000 })
  }
  const SEVEN = ['Models', 'Connectors', 'Behaviour', 'Access & privacy', 'Appearance', 'Voice', 'About & help']
  const back = async p => {
    await p.locator('.screen').getByRole('button', { name: 'Back', exact: true }).click()
  }
  const title = p => p.locator('.screen .title').innerText()
  const card = (p, name) => p.getByRole('group', { name })

  // ── the main page: seven rows in two sections, no switch, no card while all is well; Back from each page ──
  {
    const p = await page()
    await openMain(p)
    const heads = (await p.locator('.screen .set-heading').allInnerTexts()).map(h => h.toLowerCase())
    const rows = await p.locator('.screen .set-row .set-title').allInnerTexts()
    check(JSON.stringify(heads) === '["hermux","this app"]' && JSON.stringify(rows) === JSON.stringify(SEVEN), `settings main page: seven rows in two sections, Hermux then This app (${heads.join(' | ')}: ${rows.join(', ')})`)
    check((await p.locator('.screen').getByRole('switch').count()) === 0, 'settings main page: no switch on it')
    const value = name => p.getByRole('button', { name: new RegExp('^' + name) }).locator('.set-value').innerText().catch(() => '')
    const vals = { models: await value('Models'), access: await value('Access & privacy'), look: await value('Appearance'), about: await value('About & help') }
    check(vals.models.length > 0 && vals.models !== 'None yet' && vals.access === 'Auto off' && vals.look === 'Default' && vals.about === 'web-dev', `settings main page: the values say the model, the Auto mode, the theme and the app version (${JSON.stringify(vals)})`)
    const subs = { connectors: await p.getByRole('button', { name: /^Connectors/ }).innerText(), behaviour: await p.getByRole('button', { name: /^Behaviour/ }).innerText(), voice: await p.getByRole('button', { name: /^Voice/ }).innerText() }
    check(subs.connectors.includes('Mail, web search, apps and services') && subs.behaviour.includes('Memory, long chats, limits, sub-agents') && subs.voice.includes('Read aloud, dictation, Live mode'), `settings main page: each other row says what it holds (${JSON.stringify(subs)})`)
    await sleep(1500)
    check((await p.locator('.attn-card').count()) === 0, 'settings main page: no attention card while Hermux is online, has a model and the app is up to date')
    await expectIdle(p, 'settings main page')
    for (const name of SEVEN) {
      await settingsPage(p, name)
      const t = await title(p)
      await back(p)
      const home = await p.getByRole('textbox', { name: 'Search settings' }).waitFor({ timeout: 3000 }).then(() => true, () => false)
      check(t === name && home, `settings: ${name} opens its page and Back returns to the main page (${t})`)
    }
    // Pages under a page: Back goes to the page they came from.
    const under = [['Models', /^Default models/, 'Default models'], ['Models', /^Model providers/, 'Model providers'], ['Models', /^All keys/, 'API keys'], ['Behaviour', /^See what Hermux remembers/, 'Memory'], ['Behaviour', /^Advanced settings/, 'Advanced settings']]
    for (const [from, row, to] of under) {
      await settingsPage(p, from)
      await p.getByRole('button', { name: row }).click()
      await p.locator('.screen .title', { hasText: to }).waitFor({ timeout: 5000 })
      await p.evaluate(() => window.hermesBack())
      const t = await p.locator('.screen .title', { hasText: from }).waitFor({ timeout: 3000 }).then(() => from, () => '')
      await back(p)
      await p.getByRole('textbox', { name: 'Search settings' }).waitFor({ timeout: 3000 })
      check(t === from, `settings: ${to} opens from ${from}, and Back returns to ${from}`)
    }
    await p.close()
  }

  // ── every moved row is on its new page, in the order the pages give ──
  {
    const p = await page({ native: true })
    await openMain(p)
    await settingsPage(p, 'Access & privacy')
    await p.getByRole('button', { name: /^Allow banking, payment, password and 2FA apps/ }).or(p.locator('.set-row', { hasText: 'Allow banking, payment, password and 2FA apps' })).first().waitFor({ timeout: 5000 })
    const aHeads = await p.locator('.screen .set-heading').allInnerTexts()
    const want = ['approvals', 'phone data for the agent', 'background apps', 'kept on this phone']
    const order = aHeads.map(h => want.indexOf(h.toLowerCase())).filter(i => i >= 0)
    const aRows = await p.locator('.screen .set-row .set-title').allInnerTexts()
    check(JSON.stringify(aHeads.map(h => h.toLowerCase()).filter(h => want.includes(h))) === JSON.stringify(want.filter(w => w !== 'phone data for the agent' || aHeads.some(h => h.toLowerCase() === w))) && order.every((v, i) => !i || v > order[i - 1]), `access & privacy: Approvals, Phone data, Background apps, Kept on this phone, in that order (${aHeads.join(' | ')})`)
    check(['Auto for all chats', 'Confirm approvals with fingerprint', 'Allow banking, payment, password and 2FA apps', 'Keep a diagnostic log', 'Delete the diagnostic log'].every(r => aRows.includes(r)), `access & privacy: the approval, background app and diagnostic log rows moved here (${aRows.join(', ')})`)
    await back(p)
    await settingsPage(p, 'About & help')
    await p.locator('.set-row', { hasText: 'Hermux agent' }).waitFor({ timeout: 5000 })
    const bHeads = (await p.locator('.screen .set-heading').allInnerTexts()).map(h => h.toLowerCase())
    const bRows = await p.locator('.screen .set-row .set-title').allInnerTexts()
    check(JSON.stringify(bHeads) === '["updates","help","versions","developer","danger zone"]', `about & help: Updates, Help, Versions, Developer, then Uninstall last (${bHeads.join(' | ')})`)
    const at = r => bRows.findIndex(x => x.startsWith(r))
    check(['App', 'Check for updates', 'Report a problem', 'Setup check', 'Status', 'Reconnect / start Hermux', 'Hermux agent', 'Last start-up'].every(r => at(r) >= 0) && bRows[bRows.length - 1] === 'Uninstall Hermux', `about & help: the update, help, version and developer rows moved here, Uninstall Hermux last (${bRows.join(', ')})`)
    check((await p.locator('.screen .set-row', { hasText: 'Uninstall Hermux' }).locator('.set-title.danger').count()) === 1, 'about & help: Uninstall Hermux is red')
    await back(p)
    await settingsPage(p, 'Behaviour')
    await p.locator('.set-row', { hasText: 'Retries before a fallback' }).waitFor({ timeout: 5000 })
    const cHeads = (await p.locator('.screen .set-heading').allInnerTexts()).map(h => h.toLowerCase())
    const firstRow = await p.locator('.screen .set-section').filter({ has: p.locator('.set-heading') }).first().locator('.set-title').first().innerText()
    check(cHeads[1] === 'replies' && cHeads.filter(h => h === 'replies').length === 1 && firstRow === 'Dynamic UI', `behaviour: the first section is Replies, with Dynamic UI first (${cHeads.join(' | ')}; ${firstRow})`)
    const mem = p.locator('.set-section', { has: p.locator('.set-heading', { hasText: /^Memory$/ }) })
    check((await mem.getByRole('button', { name: /^See what Hermux remembers/ }).count()) === 1, 'behaviour: the Memory section has See what Hermux remembers')
    const last = (await p.locator('.screen .set-row .set-title').allInnerTexts()).pop()
    check(last === 'Advanced settings' && (await p.getByText('is under Settings → Advanced settings').count()) === 0, `behaviour: the last line is a row to Advanced settings (${last})`)
    await p.getByRole('button', { name: /^See what Hermux remembers/ }).click()
    await p.locator('.screen .title', { hasText: 'Memory' }).waitFor({ timeout: 5000 })
    check((await p.locator('.screen').getByRole('button', { name: 'Add', exact: true }).count()) === 1, 'memory from Behaviour: the page has its Add button in the top bar')
    await p.evaluate(() => window.hermesBack())
    await p.locator('.screen .title', { hasText: 'Behaviour' }).waitFor({ timeout: 3000 })
    await back(p)
    await settingsPage(p, 'Voice')
    check((await p.getByRole('switch', { name: 'Read every reply aloud' }).count()) === 1, 'voice: Read every reply aloud lives on the Voice page')
    await back(p)
    await settingsPage(p, 'Models')
    const mRows = await p.locator('.screen .set-row .set-title').allInnerTexts()
    check(JSON.stringify(mRows) === '["Default models","Model providers","All keys"]', `models: Default models and Model providers, then All keys (${mRows.join(', ')})`)
    await p.close()
  }

  // ── Settings search lands on moved rows, on their new pages ──
  {
    const p = await page()
    await openMain(p)
    const box = p.getByRole('textbox', { name: 'Search settings' })
    for (const [q, row, where, to] of [['auto for all', 'Auto for all chats', 'Access & privacy → Approvals', 'Access & privacy'], ['diagnostic', 'Keep a diagnostic log', 'Access & privacy → Kept on this phone', 'Access & privacy'], ['report', 'Report a problem', 'About & help → Help', 'About & help'], ['dynamic', 'Dynamic UI', 'Behaviour → Replies', 'Behaviour']]) {
      await box.fill(q)
      const hit = p.getByRole('button', { name: new RegExp('^' + row) }).first()
      await hit.waitFor({ timeout: 3000 })
      const sub = await hit.innerText()
      await hit.click()
      const flashed = await p.locator('.hit-flash').first().waitFor({ timeout: 4000 }).then(async () => (await p.locator('.hit-flash').first().innerText()).includes(row), () => false)
      const t = await title(p)
      check(sub.includes(where) && t === to && flashed, `settings search: "${q}" finds ${row} under ${where}, opens ${to} and flashes it (${t}; ${JSON.stringify(sub)})`)
      await back(p)
      await box.waitFor({ timeout: 3000 })
    }
    await box.fill('memory')
    const m = p.getByRole('button', { name: /^Memory/ }).filter({ hasText: 'See what Hermux remembers' }).first()
    const found = await m.waitFor({ timeout: 3000 }).then(() => true, () => false)
    if (found) await m.click()
    const t = found ? await p.locator('.screen .title', { hasText: 'Memory' }).waitFor({ timeout: 4000 }).then(() => 'Memory', () => '') : ''
    check(found && t === 'Memory', 'settings search: "memory" finds the Memory page and opens it')
    await p.close()
  }

  // ── the attention cards: each shows while its condition is true and goes when it is not ──
  {
    // Hermux offline: the red card, Reconnect; it goes once the connection is open again.
    const p = await page()
    await openMain(p)
    await mock({ drop: 20000 })
    const off = card(p, 'Hermux is offline')
    const shown = await off.waitFor({ timeout: 8000 }).then(() => true, () => false)
    check(shown && (await off.getByRole('button', { name: 'Reconnect' }).count()) === 1, 'attention: offline, the Hermux is offline card shows with Reconnect')
    await mock({ up: true })
    await off.getByRole('button', { name: 'Reconnect' }).click()
    const gone = await off.waitFor({ state: 'detached', timeout: 10000 }).then(() => true, () => false)
    check(gone, 'attention: back online, the offline card goes')
    // No model connected: the gold card, Add a provider opens Models; with a provider it goes.
    await mock({ unconfigured: true })
    await back(p) // Settings closes; opened again, its main page asks once more
    await p.locator('.screen').waitFor({ state: 'detached', timeout: 3000 })
    await openMain(p)
    const cm = card(p, 'Connect a model')
    const cmShown = await cm.waitFor({ timeout: 6000 }).then(() => true, () => false)
    check(cmShown && (await cm.innerText()).includes('Hermux needs a model to think with.'), 'attention: no provider connected, the Connect a model card shows')
    const btn = cm.getByRole('button', { name: 'Add a provider' })
    const gold = await btn.evaluate(e => e.classList.contains('primary')).catch(() => false)
    check(gold && (await p.locator('.screen .btn.primary').count()) === 1, 'attention: Add a provider is the one gold button on the page')
    await btn.click()
    const t = await p.locator('.screen .title', { hasText: 'Models' }).waitFor({ timeout: 4000 }).then(() => 'Models', () => '')
    check(t === 'Models', 'attention: Add a provider opens the Models page')
    await mock({ configured: true })
    await back(p)
    await p.getByRole('textbox', { name: 'Search settings' }).waitFor({ timeout: 3000 })
    await sleep(1200)
    check((await cm.count()) === 0, 'attention: with a provider connected, the Connect a model card goes')
    await p.close()
  }
  {
    // A newer release: the update card is today's update row; a tap starts the update. Up to date: no card.
    const p = await page({ native: true, tag: 'v9.9.9', init: () => { window.__appVersion = '0.8.68' } })
    await openMain(p)
    const up = card(p, 'Update to 9.9.9')
    const shown = await up.waitFor({ timeout: 6000 }).then(() => true, () => false)
    check(shown && (await up.getByRole('button', { name: /^Update to 9\.9\.9/ }).count()) === 1, 'attention: a newer release shows the Update to <version> card')
    await up.getByRole('button', { name: /^Update to 9\.9\.9/ }).click()
    await sleep(300)
    check(JSON.stringify(await p.evaluate(() => window.__installed)) === '["https://github.com/omarqaterge/hermes-mobile-app/releases/download/v9.9.9/hermes-mobile.apk"]', 'attention: the update card starts the update, as the update row does')
    await p.close()
    const q = await page({ native: true, tag: 'v0.8.68', init: () => { window.__appVersion = '0.8.68' } })
    await openMain(q)
    await settingsPage(q, 'About & help')
    await q.locator('.set-sub', { hasText: "You're on the latest version" }).waitFor({ timeout: 6000 })
    await back(q)
    await q.getByRole('textbox', { name: 'Search settings' }).waitFor({ timeout: 3000 })
    check((await q.locator('.attn-card').count()) === 0, 'attention: up to date, no update card')
    await q.close()
  }

  // ── 320 px wide, a wider font, Default, OLED black and Light: one line per row, nothing wider than the screen, the
  //    cards' text at 4.5:1 or more ──
  {
    const p = await page({ size: { width: 320, height: 700 }, init: () => { localStorage.setItem('hm.glass', '1'); localStorage.setItem('hm.motion', 'off') } })
    await openMain(p)
    await mock({ drop: 20000 })
    await card(p, 'Hermux is offline').waitFor({ timeout: 8000 })
    const measure = () => p.evaluate(() => ({
      rows: [...document.querySelectorAll('.screen .set-main .set-row')].map(r => Math.round(r.getBoundingClientRect().height)),
      over: document.documentElement.scrollWidth > window.innerWidth + 1 || [...document.querySelectorAll('.screen .set-main *')].some(e => e.getBoundingClientRect().right > window.innerWidth + 1)
    }))
    const before = await measure()
    const tag = await p.addStyleTag({ content: '.screen * { letter-spacing: 2px !important }' })
    const after = await measure()
    await tag.evaluate(x => x.remove())
    check(before.rows.length === 7 && JSON.stringify(before.rows) === JSON.stringify(after.rows) && !before.over && !after.over, `320 px: the seven rows keep one line each under a wider font and nothing is wider than the screen (${JSON.stringify(before.rows)} → ${JSON.stringify(after.rows)})`)
    const btnH = await card(p, 'Hermux is offline').getByRole('button', { name: 'Reconnect' }).evaluate(e => Math.round(e.getBoundingClientRect().height))
    check(btnH >= 44, `320 px: the card's button is at least 44 px tall (${btnH})`)
    for (const theme of ['default', 'oled', 'light']) {
      const c = await p.evaluate(theme => {
        const h = document.documentElement
        h.dataset.theme = theme
        if (theme === 'oled') h.setAttribute('data-oled', '')
        else h.removeAttribute('data-oled')
        const rgb = s => (s.match(/[\d.]+/g) || []).map(Number).slice(0, 3)
        const cardEl = document.querySelector('.attn-card')
        const bg = rgb(getComputedStyle(cardEl).backgroundColor)
        const btn = cardEl.querySelector('.attn-btn')
        return [['title', rgb(getComputedStyle(cardEl.querySelector('.attn-title')).color), bg], ['line', rgb(getComputedStyle(cardEl.querySelector('.attn-line')).color), bg], ['button', rgb(getComputedStyle(btn).color), rgb(getComputedStyle(btn).backgroundColor)]]
      }, theme)
      const low = c.map(([n, fg, bg]) => [n, contrast(fg, bg)]).filter(([, r]) => r < 4.5)
      check(low.length === 0, `${theme}: the attention card's title, line and button reach 4.5:1 (${JSON.stringify(c.map(([n, fg, bg]) => [n, contrast(fg, bg).toFixed(2)]))})`)
    }
    await mock({ up: true })
    await p.close()
  }
}
