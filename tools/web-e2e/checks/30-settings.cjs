// Settings' main page and the pages the redesign moves: Appearance (Dark / OLED black / Light theme, text size), the settings search, New
// chats use on the Models page (one model for all bots); then the main page of task 06: its eight rows (Notifications from task 12) in two sections, the attention cards, each
// moved row on its new page, search landing there, Back from every page, and the rows and cards at 320 px and in Light.
// Each control is found by its role and name, used, and its effect checked.
const { WEB, calls, check, mock, nativeShell, settingsPage, contrast, lowContrast, fadedText, expectIdle, openPage, pageTitle, pageHeadings, settingsSection } = require('../lib.cjs')

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

  // ── New chats use (Settings → Models, two bots): Set one model for all bots asks Hermes to switch each bot's model ──
  {
    // Two bots: Settings closed and opened again reads the bot list once more.
    await mock({ bots: true })
    // On Settings' main page first (the Back above leaves Appearance), so this Back closes Settings.
    await sp.getByRole('searchbox', { name: 'Search settings' }).or(sp.getByRole('textbox', { name: 'Search settings' })).waitFor({ timeout: 3000 }).catch(() => {})
    await sp.evaluate(() => window.hermesBack())
    await openPage(sp).waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    await openSettings()
    await settingsPage(sp, 'Models')
    await settingsSection(sp, /^New chats use$/).getByRole('button').first().click()
    await sp.getByRole('switch', { name: 'Set one model for all bots' }).click()
    const since = Date.now()
    const picker = sp.getByRole('dialog').filter({ has: sp.getByPlaceholder('Search models…') })
    await picker.waitFor({ timeout: 5000 })
    await picker.getByRole('button', { name: /^mock-sonnet/ }).first().click()
    await sp.waitForTimeout(800)
    const set = calls().filter(c => c.t >= since && c.http === 'POST' && c.path === '/api/model/set')
    check(set.length >= 1 && set.every(c => c.body.model === 'mock-sonnet'), `default models: Set one model for all bots switches every bot's model (${JSON.stringify(set.map(c => c.body))})`)
    await mock({ bots: false })
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
  const EIGHT = ['Models', 'Connectors', 'Behaviour', 'Access & privacy', 'Appearance', 'Voice', 'Notifications', 'About & help']
  const back = async p => {
    await p.locator('.screen').getByRole('button', { name: 'Back', exact: true }).click()
  }
  const title = p => p.locator('.screen .title').innerText()
  const card = (p, name) => p.getByRole('group', { name })

  // ── the main page: eight rows in two sections, no switch, no card while all is well; Back from each page ──
  {
    const p = await page()
    const opened = Date.now()
    await openMain(p)
    const heads = (await p.locator('.screen .set-heading').allInnerTexts()).map(h => h.toLowerCase())
    const rows = await p.locator('.screen .set-row .set-title').allInnerTexts()
    check(JSON.stringify(heads) === '["hermux","this app"]' && JSON.stringify(rows) === JSON.stringify(EIGHT), `settings main page: eight rows in two sections, Hermux then This app (${heads.join(' | ')}: ${rows.join(', ')})`)
    check((await p.locator('.screen').getByRole('switch').count()) === 0, 'settings main page: no switch on it')
    const value = name => p.getByRole('button', { name: new RegExp('^' + name) }).locator('.set-value').innerText().catch(() => '')
    const vals = { models: await value('Models'), access: await value('Access & privacy'), look: await value('Appearance'), about: await value('About & help') }
    check(vals.models.length > 0 && vals.models !== 'None yet' && vals.access === 'Auto off' && vals.look === 'Default' && vals.about === 'web-dev', `settings main page: the values say the model, the Auto mode, the theme and the app version (${JSON.stringify(vals)})`)
    const subs = { connectors: await p.getByRole('button', { name: /^Connectors/ }).innerText(), behaviour: await p.getByRole('button', { name: /^Behaviour/ }).innerText(), voice: await p.getByRole('button', { name: /^Voice/ }).innerText() }
    check(subs.connectors.includes('Mail, web search, apps and services') && subs.behaviour.includes('Memory, long chats, limits, sub-agents') && subs.voice.includes('Read aloud, dictation, Live mode'), `settings main page: each other row says what it holds (${JSON.stringify(subs)})`)
    // No card is an absence: wait until the page has asked whether a model is connected (the one question that could
    // bring a card here; the update check finds no release in this page), then two frames for its answer to draw.
    const asked = Date.now() + 5000
    while (!calls().some(c => c.rpc === 'setup.runtime_check' && c.t >= opened) && Date.now() < asked) await new Promise(r => setTimeout(r, 50))
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    check((await p.locator('.attn-card').count()) === 0, 'settings main page: no attention card while Hermux is online, has a model and the app is up to date')
    await expectIdle(p, 'settings main page')
    for (const name of EIGHT) {
      await settingsPage(p, name)
      const t = await title(p)
      await back(p)
      const home = await p.getByRole('textbox', { name: 'Search settings' }).waitFor({ timeout: 3000 }).then(() => true, () => false)
      check(t === name && home, `settings: ${name} opens its page and Back returns to the main page (${t})`)
    }
    // Pages under a page: Back goes to the page they came from.
    const under = [['Models', /^Add a provider/, 'Add a provider'], ['Models', /^All keys/, 'API keys'], ['Behaviour', /^See what Hermux remembers/, 'Memory'], ['Behaviour', /^Advanced settings/, 'Advanced settings']]
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
    check(cHeads.filter(h => h !== 'bot')[0] === 'replies' && cHeads.filter(h => h === 'replies').length === 1 && firstRow === 'Dynamic UI', `behaviour: the first section is Replies, with Dynamic UI first (${cHeads.join(' | ')}; ${firstRow})`)
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
    await openPage(p).getByRole('button', { name: /^All keys/ }).waitFor({ timeout: 5000 })
    const mHeads = (await pageHeadings(p).allInnerTexts()).map(h => h.toLowerCase())
    const mRows = await p.locator('.screen .set-row .set-title').allInnerTexts()
    const addAt = await pageHeadings(p).or(openPage(p).getByRole('button')).evaluateAll(es => es.filter(e => e.getAttribute('role') === 'heading' || /^H[1-6]$/.test(e.tagName) || e.classList.contains('primary')).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)).map(e => e.textContent.trim().toLowerCase()))
    check(mHeads[0] === 'new chats use' && mHeads.includes('if the model fails') && addAt.indexOf('add a provider') > addAt.indexOf('new chats use') && addAt.indexOf('add a provider') < addAt.indexOf('if the model fails') && mRows.includes('Fallback models') && mRows[mRows.length - 1] === 'All keys', `models: New chats use, then Add a provider, If the model fails and All keys last (${addAt.join(' | ')}; ${mRows.join(', ')})`)
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
    const t = await pageTitle(p, 'Add a provider').waitFor({ timeout: 4000 }).then(() => 'Add a provider', () => '')
    check(t === 'Add a provider', 'attention: Add a provider opens the Add a provider flow')
    await mock({ configured: true })
    await back(p) // Add a provider → Models
    await pageTitle(p, /^Models$/).waitFor({ timeout: 3000 }).catch(() => {})
    await back(p)
    await p.getByRole('textbox', { name: 'Search settings' }).waitFor({ timeout: 3000 })
    await cm.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
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
    await p.waitForFunction(() => (window.__installed || []).length > 0, null, { timeout: 5000 }).catch(() => {})
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
    check(before.rows.length === 8 && JSON.stringify(before.rows) === JSON.stringify(after.rows) && !before.over && !after.over, `320 px: the eight rows keep one line each under a wider font and nothing is wider than the screen (${JSON.stringify(before.rows)} → ${JSON.stringify(after.rows)})`)
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

  // ── Text size follows the phone (task 12): Android's font size, read through the keyed bridge, clamped to 90 to 135 %,
  //    until a size is picked; Phone default forgets the pick. The shell's answer is window.__fs; each call is recorded
  //    with its key (window.__fsCalls) ──
  {
    const scaled = async (fs, stored) => {
      const p = await browser.newPage({ viewport: { width: 375, height: 812 } })
      await p.addInitScript(nativeShell)
      await p.addInitScript(([fs, stored]) => {
        window.__fs = fs
        window.__fsCalls = []
        if (stored != null && !sessionStorage.getItem('seeded')) {
          sessionStorage.setItem('seeded', '1')
          localStorage.setItem('hm.textScale', stored)
        }
        localStorage.setItem('hm.motion', 'off')
        Object.assign(window.HermesAndroid, { phoneTextScale: key => (window.__fsCalls.push(key), key === 'K' ? window.__fs : 0) })
      }, [fs, stored])
      await p.goto(WEB + '/')
      await p.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
      return p
    }
    const scaleOf = p => p.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--scale')))
    for (const [fs, want] of [[1.3, 1.3], [2, 1.35], [0.85, 0.9], [1, 1]]) {
      const p = await scaled(fs)
      const got = await scaleOf(p)
      const keys = await p.evaluate(() => window.__fsCalls)
      check(Math.abs(got - want) < 0.001 && keys.length > 0 && keys.every(k => k === 'K'), `text size: with no size picked, the phone's ${fs * 100}% font gives ${want * 100}% (${got}; asked with the key: ${JSON.stringify(keys)})`)
      await p.close()
    }
    {
      const p = await scaled(1.3, '1.2')
      check(Math.abs((await scaleOf(p)) - 1.2) < 0.001, 'text size: a size picked earlier wins over the phone (120% with the phone at 130%)')
      await p.close()
    }
    const p = await scaled(1.3)
    await p.getByRole('button', { name: /^Sessions/ }).click()
    await p.getByRole('button', { name: 'Settings', exact: true }).click()
    await p.getByRole('textbox', { name: 'Search settings' }).waitFor({ timeout: 5000 })
    await settingsPage(p, 'Appearance')
    const pressed = async name => (await p.getByRole('button', { name, exact: true }).getAttribute('aria-pressed')) === 'true'
    const names = await p.locator('.seg-text button').allInnerTexts()
    check(JSON.stringify(names) === '["Phone default","90%","100%","110%","120%","135%"]' && await pressed('Phone default'), `text size: Phone default is the first choice and is chosen while no size is picked (${names.join(', ')})`)
    check((await p.locator('.screen').innerText()).includes('Phone default follows your phone’s font size (130% here).'), 'text size: the footer says the phone\'s size')
    await p.getByRole('button', { name: '110%', exact: true }).click()
    const picked = { kept: await p.evaluate(() => localStorage.getItem('hm.textScale')), scale: await scaleOf(p) }
    check(picked.kept === '1.1' && Math.abs(picked.scale - 1.1) < 0.001 && await pressed('110%') && !(await pressed('Phone default')), `text size: picking 110% overrides the phone and is kept (${JSON.stringify(picked)})`)
    await p.getByRole('button', { name: 'Phone default', exact: true }).click()
    const back = { kept: await p.evaluate(() => localStorage.getItem('hm.textScale')), scale: await scaleOf(p) }
    check(back.kept === null && Math.abs(back.scale - 1.3) < 0.001 && await pressed('Phone default'), `text size: Phone default forgets the size and follows the phone again (${JSON.stringify(back)})`)
    await p.close()
  }

  // ── The largest size on a 320 px screen: the chat, the composer, the side panel, a sheet and Settings keep every
  //    button on the screen and nothing wider than it ──
  {
    const p = await browser.newPage({ viewport: { width: 320, height: 640 } })
    await p.addInitScript(() => { localStorage.setItem('hm.textScale', '1.35'); localStorage.setItem('hm.motion', 'off'); localStorage.setItem('hm.modelBar', 'open') })
    await p.goto(WEB + '/')
    await p.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    // Buttons, switches and text boxes outside the screen's width, or cut by their own box (text wider than the box that
    // hides it), in the part of the page `sel` names.
    const outside = sel => p.evaluate(sel => {
      const bad = []
      const root = document.querySelector(sel) || document.body
      if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('page ' + document.documentElement.scrollWidth)
      for (const e of root.querySelectorAll('button, [role="switch"], input, textarea')) {
        const r = e.getBoundingClientRect()
        const st = getComputedStyle(e)
        if (!r.width || !r.height || st.visibility === 'hidden' || e.closest('[aria-hidden="true"], .chat, .drawer:not(.open)')) continue
        if (r.right > innerWidth + 1 || r.left < -1) bad.push((e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30) + ` ${Math.round(r.left)}..${Math.round(r.right)}`)
        else if (e.tagName === 'BUTTON' && st.overflow === 'hidden' && st.textOverflow !== 'ellipsis' && e.scrollWidth > e.clientWidth + 1) bad.push((e.textContent || '').trim().slice(0, 30) + ' cut')
      }
      return bad
    }, sel)
    const seen = {}
    seen.chat = await outside('body')
    await p.getByRole('button', { name: /^Sessions/ }).click()
    await p.getByRole('textbox', { name: 'Search chats' }).waitFor({ timeout: 5000 })
    seen.panel = await outside('.drawer')
    await p.getByRole('button', { name: 'Settings', exact: true }).click()
    await p.getByRole('textbox', { name: 'Search settings' }).waitFor({ timeout: 5000 })
    seen.settings = await outside('.screen')
    await settingsPage(p, 'Appearance')
    seen.appearance = await outside('.screen')
    await p.evaluate(() => window.hermesBack())
    await p.getByRole('textbox', { name: 'Search settings' }).waitFor({ timeout: 5000 })
    await p.evaluate(() => window.hermesBack())
    await p.getByPlaceholder('Message Hermux').waitFor({ timeout: 5000 })
    await p.locator('header').getByRole('button', { name: 'Chat options' }).click()
    await p.locator('.sheet').first().waitFor({ timeout: 5000 })
    seen.sheet = await outside('.sheet')
    const bad = Object.entries(seen).filter(([, v]) => v.length)
    check(bad.length === 0, `text size 135% at 320 px: the chat, the composer, the side panel, a sheet and Settings keep every control on the screen (${JSON.stringify(bad)})`)
    await p.close()
  }

  // ── Light: the gold reaches 4.5:1 on white and on the surfaces, and the text on the chat, the side panel and Settings
  //    with Appearance does too ──
  {
    const p = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await p.addInitScript(() => { localStorage.setItem('hm.theme', 'light'); localStorage.setItem('hm.motion', 'off'); localStorage.setItem('hm.glass', '0') })
    await p.goto(WEB + '/')
    await p.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    const pairs = await p.evaluate(() => {
      const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
      const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
      return { accent: hex(v('--accent')), bg: hex(v('--bg')), surface: hex(v('--surface')), surface2: hex(v('--surface-2')), ink: hex(v('--accent-ink')) }
    })
    const r = { bg: contrast(pairs.accent, pairs.bg), surface: contrast(pairs.accent, pairs.surface), surface2: contrast(pairs.accent, pairs.surface2), ink: contrast(pairs.ink, pairs.accent) }
    check(Object.values(r).every(x => x >= 4.5), `light: --accent reaches 4.5:1 as text on white, --surface and --surface-2, and under white text (${JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, x]) => [k, x.toFixed(2)])))})`)
    const low = {}
    const faded = {}
    const both = async (name, sel) => {
      low[name] = await lowContrast(p, sel)
      faded[name] = await fadedText(p, sel)
    }
    await both('chat', '.app > :not(.drawer):not(.drawer-backdrop)')
    await p.getByRole('button', { name: /^Sessions/ }).click()
    await p.getByRole('textbox', { name: 'Search chats' }).waitFor({ timeout: 5000 })
    await both('panel', '.drawer')
    await p.getByRole('button', { name: 'Settings', exact: true }).click()
    await p.getByRole('textbox', { name: 'Search settings' }).waitFor({ timeout: 5000 })
    await both('settings', '.screen')
    await settingsPage(p, 'Appearance')
    await both('appearance', '.screen')
    const bad = Object.entries(low).filter(([, v]) => v.length)
    check(bad.length === 0, `light: every text on the chat, the side panel, Settings and Appearance reaches 4.5:1 (${JSON.stringify(bad)})`)
    const dim = Object.entries(faded).filter(([, v]) => v.length)
    check(dim.length === 0, `light: no text there is faded by opacity below 4.5:1 (${JSON.stringify(dim)})`)
    await p.close()
  }

  // ── Live phone font-size changes: Appearance stays open, footer updates live, Phone default rescales,
  //    and a picked size stays fixed while the footer still tracks the phone ──
  {
    const p = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await p.addInitScript(nativeShell)
    await p.addInitScript(() => {
      window.__fs = 1.1
      localStorage.setItem('hm.motion', 'off')
      localStorage.removeItem('hm.textScale')
      Object.assign(window.HermesAndroid, { phoneTextScale: key => (key === 'K' ? window.__fs : 0) })
    })
    await p.goto(WEB + '/')
    await p.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await p.getByRole('button', { name: /^Sessions/ }).click()
    await p.getByRole('button', { name: 'Settings', exact: true }).click()
    await p.getByRole('textbox', { name: 'Search settings' }).waitFor({ timeout: 5000 })
    await settingsPage(p, 'Appearance')
    const scaleOf = () => p.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--scale')))
    await p.evaluate(() => { window.__fs = 2.0; window.__hmPhoneTextScale && window.__hmPhoneTextScale() })
    await p.waitForFunction(() => document.querySelector('.screen')?.innerText.includes('(135% here)'), null, { timeout: 3000 }).catch(() => {})
    const afterDefault = { scale: await scaleOf(), foot: (await p.locator('.screen').innerText()).includes('Phone default follows your phone’s font size (135% here).') }
    check(Math.abs(afterDefault.scale - 1.35) < 0.001 && afterDefault.foot, `text size: live phone font-size change rescales Phone default and updates the footer in place (${JSON.stringify(afterDefault)})`)
    await p.getByRole('button', { name: '110%', exact: true }).click()
    await p.evaluate(() => { window.__fs = 1.2; window.__hmPhoneTextScale && window.__hmPhoneTextScale() })
    await p.waitForFunction(() => document.querySelector('.screen')?.innerText.includes('(120% here)'), null, { timeout: 3000 }).catch(() => {})
    const afterPicked = { scale: await scaleOf(), foot: (await p.locator('.screen').innerText()).includes('Phone default follows your phone’s font size (120% here).') }
    check(Math.abs(afterPicked.scale - 1.1) < 0.001 && afterPicked.foot, `text size: with 110% picked, a live phone font-size change updates only the footer (${JSON.stringify(afterPicked)})`)
    await p.close()
  }
}
