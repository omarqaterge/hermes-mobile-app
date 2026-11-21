// Settings → Connectors: MCP servers (add, catalog, on/off, test, browser sign-in, remove), tools with a key, keys for skills.
const { WEB, calls, check, mock, sleep, lowContrast } = require('../lib.cjs')

const waitOk = (loc, name, timeout = 5000) => loc.waitFor({ timeout }).then(() => check(true, name), () => check(false, name))

module.exports = async t => {
  const { browser } = t
  const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await pg.goto(WEB + '/')
  await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
  await pg.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(String(u)); return null } })
  await pg.getByRole('button', { name: /^Sessions/ }).click()
  await pg.getByRole('button', { name: 'Settings', exact: true }).click()
  await pg.locator('.set-row', { hasText: 'Connectors' }).click()
  await pg.locator('.screen .title', { hasText: 'Connectors' }).waitFor({ timeout: 5000 })
  const http = (path, method) => calls().filter(c => c.path === path && (!method || c.http === method))

  // The list: the configured server with its state, the connector toolsets only (no Files), keys for skills.
  await waitOk(pg.locator('.set-row', { hasText: 'server-filesystem' }).getByText('Connected'), 'connectors: a configured MCP server is listed as connected')
  await waitOk(pg.locator('.set-row', { hasText: 'Web search' }).getByText('Connected'), 'connectors: web search is connected (keyless provider)')
  await waitOk(pg.locator('.set-row', { hasText: 'Home Assistant' }).getByText('Off'), 'connectors: Home Assistant is off')
  check((await pg.locator('.set-row', { hasText: 'File Operations' }).count()) === 0, 'connectors: toolsets that only work on the phone are not connectors')
  await waitOk(pg.locator('.set-row', { hasText: 'NOTION_API_KEY' }), 'connectors: keys bundled skills read are listed')

  // Turn a server off from its sheet.
  await pg.locator('.set-row', { hasText: 'files' }).first().click()
  const files = pg.locator('.sheet', { hasText: 'Hermux can use this server’s tools' })
  await files.getByRole('switch', { name: 'On' }).click()
  await sleep(300)
  {
    const put = http('/api/mcp/servers/files/enabled', 'PUT').pop()
    check(put?.body?.enabled === false && /profile=default/.test(put.query), `connectors: the switch turns the server off for the bot (${JSON.stringify(put?.body)})`)
  }
  await files.locator('.set-row', { hasText: 'Test' }).click()
  await waitOk(files.getByText('Works: 2 tools'), 'connectors: Test lists the server’s tools')
  await pg.keyboard.press('Escape').catch(() => null)
  await pg.locator('.sheet-backdrop').last().click({ position: { x: 5, y: 5 } })
  await waitOk(pg.locator('.set-row', { hasText: 'files' }).getByText('Off'), 'connectors: the list shows the server off')

  // Add a server by its address with an account sign-in, then sign in: the page opens in the browser and the sheet waits.
  await pg.locator('.set-row', { hasText: 'Add a server' }).click()
  const add = pg.locator('.sheet', { hasText: 'Add a server' }).last()
  await add.getByLabel('Name').fill('my tracker')
  check((await add.getByLabel('Name').inputValue()) === 'mytracker', 'connectors: a server name keeps only the characters Hermes accepts')
  await add.getByLabel('Address').fill('mcp.example.com')
  await waitOk(add.getByText('The address starts with https://'), 'connectors: an address without https:// is refused')
  await add.getByLabel('Address').fill('https://mcp.example.com/mcp')
  await add.getByRole('button', { name: 'Account' }).click()
  await add.getByRole('button', { name: 'Add', exact: true }).click()
  const tracker = pg.locator('.sheet', { hasText: 'Account sign-in (OAuth)' })
  await waitOk(tracker, 'connectors: adding opens the new server')
  {
    const post = http('/api/mcp/servers', 'POST').pop()
    check(post?.body?.name === 'mytracker' && post.body.url === 'https://mcp.example.com/mcp' && post.body.auth === 'oauth', `connectors: the add request (${JSON.stringify(post?.body)})`)
  }
  await tracker.locator('.set-row', { hasText: 'Sign in' }).click()
  await waitOk(tracker.getByText('Signed in.'), 'connectors: the sheet waits for the browser sign-in and says when it’s done', 10000)
  check((await pg.evaluate(() => window.__opened)).some(u => u.startsWith('https://auth.example.com/authorize?server=mytracker')), 'connectors: the sign-in page opens in the browser')
  // Remove it.
  await tracker.getByRole('button', { name: 'Remove' }).click()
  await pg.locator('.dialog').getByRole('button', { name: 'Remove' }).click()
  await tracker.waitFor({ state: 'detached', timeout: 5000 })
  check(http('/api/mcp/servers/mytracker', 'DELETE').length === 1, 'connectors: Remove deletes the server')

  // From the catalog: an entry with a key asks for it and sends only that key.
  await pg.locator('.set-row', { hasText: 'Add from the catalog' }).click()
  const cat = pg.locator('.sheet', { hasText: 'Add from the catalog' })
  await cat.getByPlaceholder('Search (e.g. notion, linear)').fill('docs')
  await cat.locator('.set-row', { hasText: 'context7' }).click()
  const c7 = pg.locator('.sheet', { hasText: 'Up-to-date library docs' })
  check(await c7.getByRole('button', { name: 'Add', exact: true }).isDisabled(), 'connectors: a catalog entry waits for its required key')
  await c7.getByLabel('Context7 API key').fill('ctx-test-value')
  await c7.getByRole('button', { name: 'Add', exact: true }).click()
  await waitOk(pg.locator('.sheet', { hasText: 'npx -y @upstash/context7-mcp' }), 'connectors: the added catalog server opens')
  {
    const post = http('/api/mcp/catalog/install', 'POST').pop()
    check(post?.body?.name === 'context7' && post.body.env.CONTEXT7_API_KEY === 'ctx-test-value', `connectors: the catalog install request (${JSON.stringify(post?.body)})`)
  }
  await pg.locator('.sheet-backdrop').last().click({ position: { x: 5, y: 5 } })

  // A tool with a key: Home Assistant on, its two values saved, and it reads connected.
  await pg.locator('.set-row', { hasText: 'Home Assistant' }).click()
  const ha = pg.locator('.sheet', { hasText: 'Lights, switches and sensors' })
  await ha.getByRole('switch', { name: 'On' }).click()
  await ha.locator('.set-row', { hasText: 'Needs a key' }).click()
  await ha.getByLabel('Home Assistant URL').fill('http://homeassistant.local:8123')
  await ha.getByLabel('Long-lived access token').fill('hass-test-value')
  check((await ha.getByLabel('Home Assistant URL').getAttribute('type')) === 'text' && (await ha.getByLabel('Long-lived access token').getAttribute('type')) === 'password', 'connectors: an address is shown, a token is hidden')
  await ha.getByRole('button', { name: 'Save', exact: true }).click()
  await waitOk(ha.locator('.set-row', { hasText: 'Key saved' }), 'connectors: saved keys show on the service')
  {
    const put = http('/api/tools/toolsets/homeassistant/env', 'PUT').pop()
    check(put?.body?.env?.HASS_TOKEN === 'hass-test-value' && put.body.env.HASS_URL === 'http://homeassistant.local:8123', `connectors: keys go to the toolset's env route (${JSON.stringify(put?.body)})`)
    check(http('/api/tools/toolsets/homeassistant', 'PUT').pop()?.body?.enabled === true, 'connectors: the switch turns the tool on')
  }
  await pg.locator('.sheet-backdrop').last().click({ position: { x: 5, y: 5 } })
  await waitOk(pg.locator('.set-row', { hasText: 'Home Assistant' }).getByText('Connected'), 'connectors: Home Assistant now reads connected')

  // Web search: switch to Exa by saving its key (it becomes the one in use), then disconnect it.
  await pg.locator('.set-row', { hasText: 'Web search' }).click()
  const web = pg.locator('.sheet', { hasText: 'Search the web and read pages' })
  await web.locator('.set-row', { hasText: 'Exa' }).click()
  await web.getByLabel('Exa API key').fill('exa-test-value')
  await web.getByRole('button', { name: 'Save', exact: true }).click()
  await waitOk(web.locator('.set-row', { hasText: 'Exa' }).getByText('In use · Neural search · Key saved'), 'connectors: a service whose key was just saved becomes the one in use')
  check(http('/api/tools/toolsets/web/provider', 'PUT').pop()?.body?.provider === 'Exa', 'connectors: the provider route picks the service')
  await web.getByRole('button', { name: 'Disconnect' }).click() // the service stays open after saving
  await pg.locator('.dialog').getByRole('button', { name: 'Disconnect' }).click()
  await waitOk(web.locator('.set-row', { hasText: 'Exa' }).getByText(/Needs a key/), 'connectors: Disconnect deletes the key')
  check(http('/api/env', 'DELETE').some(c => c.body?.key === 'EXA_API_KEY'), 'connectors: the key is deleted from the bot’s .env')
  await pg.locator('.sheet-backdrop').last().click({ position: { x: 5, y: 5 } })

  // A key for a skill.
  await pg.locator('.set-row', { hasText: 'NOTION_API_KEY' }).click()
  const nk = pg.locator('.sheet', { hasText: 'used by the `notion` skill' })
  await nk.getByLabel('Key').fill('ntn-test-value')
  await nk.getByRole('button', { name: 'Save', exact: true }).click()
  await nk.waitFor({ state: 'detached', timeout: 5000 })
  check(http('/api/env', 'PUT').some(c => c.body?.key === 'NOTION_API_KEY' && c.body.value === 'ntn-test-value'), 'connectors: a skill key is saved to the .env')
  await waitOk(pg.locator('.set-row', { hasText: 'NOTION_API_KEY' }).getByText('Saved'), 'connectors: the skill key reads saved')

  // Google: paste the client file, open Google's consent page, paste back the address the browser lands on, sign out.
  await pg.locator('.set-row', { hasText: 'Gmail, Calendar, Drive' }).getByText('Needs setup').waitFor({ timeout: 5000 })
  await pg.locator('.set-row', { hasText: 'Gmail, Calendar, Drive' }).click()
  const g = pg.locator('.sheet', { hasText: 'Your Google sign-in app' })
  await g.getByLabel('The client file (JSON)').fill('{"other": {}}')
  await g.getByRole('button', { name: 'Save', exact: true }).click()
  await waitOk(g.getByText('That isn’t an OAuth client file'), 'connectors: Google: a file that isn’t an OAuth client is refused')
  await g.getByLabel('The client file (JSON)').fill('{"installed": {"client_id": "x"}}')
  await g.getByRole('button', { name: 'Save', exact: true }).click()
  const g2 = pg.locator('.sheet', { hasText: '2. Sign in with Google' })
  await waitOk(g2, 'connectors: Google: after the client file, the sign-in step')
  check(http('/api/plugins/hermes-mobile/google/client', 'PUT').pop()?.body?.text === '{"installed": {"client_id": "x"}}', 'connectors: Google: the client file is sent as text')
  await g2.locator('.set-row', { hasText: 'Sign in' }).first().click()
  await waitOk(g2.getByLabel('The address the browser shows'), 'connectors: Google: the sheet asks for the address the browser lands on')
  check((await pg.evaluate(() => window.__opened)).some(u => u.startsWith('https://accounts.google.com/')), 'connectors: Google: the consent page opens in the browser')
  await g2.getByLabel('The address the browser shows').fill('http://localhost:1/?state=other&code=x')
  await g2.getByRole('button', { name: 'Finish' }).click()
  await waitOk(g2.getByText('OAuth state mismatch'), 'connectors: Google: an address from another sign-in shows the reason')
  await g2.getByLabel('The address the browser shows').fill('http://localhost:1/?state=mock&code=4/abc')
  await g2.getByRole('button', { name: 'Finish' }).click()
  const g3 = pg.locator('.sheet', { hasText: 'Ask Hermux about your mail' })
  await waitOk(g3, 'connectors: Google: the right address connects')
  await g3.locator('.set-row', { hasText: 'Sign out' }).click()
  await pg.locator('.dialog').getByRole('button', { name: 'Sign out' }).click()
  await waitOk(pg.locator('.sheet', { hasText: '2. Sign in with Google' }), 'connectors: Google: sign out goes back to the sign-in step')
  check(http('/api/plugins/hermes-mobile/google', 'DELETE').length === 1, 'connectors: Google: sign out calls the plugin')
  await pg.locator('.sheet-backdrop').last().click({ position: { x: 5, y: 5 } })
  await pg.close()

  // A failed server list shows its error with Try again inside its section (it used to show nothing at all).
  {
    const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await pg.goto(WEB + '/')
    await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await mock({ routeFail: { 'GET /api/mcp/servers': 500 } })
    await pg.getByRole('button', { name: /^Sessions/ }).click()
    await pg.getByRole('button', { name: 'Settings', exact: true }).click()
    await pg.locator('.set-row', { hasText: 'Connectors' }).click()
    const mcp = pg.locator('.set-section', { hasText: 'Apps and services (MCP)' })
    await waitOk(mcp.locator('.notice-error', { hasText: 'Mock failure' }), 'connectors: a failed server list shows the error in its section')
    await mock({ routeFail: { 'GET /api/mcp/servers': 0 } })
    await mcp.getByRole('button', { name: 'Try again' }).click()
    await waitOk(mcp.locator('.set-row', { hasText: 'server-filesystem' }), 'connectors: Try again loads the server list')
    await pg.close()
  }

  // ── Task 10: Applies to new chats with New chat, the empty state, the bot chips and the top bar, 320 px, Light ──
  {
    const open = async (w = 375, h = 812, store = {}) => {
      const p = await browser.newPage({ viewport: { width: w, height: h } })
      await p.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v) }, store)
      await p.goto(WEB + '/')
      await p.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
      await p.getByRole('button', { name: /^Sessions/ }).click()
      await p.getByRole('button', { name: 'Settings', exact: true }).click()
      await p.getByRole('button', { name: /^Connectors/ }).click()
      await p.locator('.screen .title', { hasText: 'Connectors' }).waitFor({ timeout: 5000 })
      return p
    }
    // A server switched on or off: the toast says it applies to new chats and offers New chat, which starts one.
    let p = await open()
    await p.locator('.set-row', { hasText: 'server-filesystem' }).click()
    const sheet = p.getByRole('dialog').filter({ hasText: 'Hermux can use this server’s tools' })
    const sw = sheet.getByRole('switch').first()
    await sw.click()
    await p.locator('.toast').filter({ has: p.getByRole('button', { name: 'New chat' }) }).first().waitFor({ timeout: 5000 })
    await sw.click()
    // Both switches' toasts first, so the one read is the one tapped (a locator is found again at each use).
    const withNew = p.locator('.toast').filter({ has: p.getByRole('button', { name: 'New chat' }) })
    await waitOk(withNew.nth(1), 'connectors: switching a server shows a toast with New chat')
    const said = (await withNew.last().locator('.toast-text').innerText()) || ''
    const toastEl = p.locator('.toast').filter({ has: p.locator('.toast-text', { hasText: said }) }).first()
    check(/new chats/i.test(said), `connectors: the toast says the change applies to new chats (${said})`)
    await toastEl.getByRole('button', { name: 'New chat' }).click()
    await p.locator('.screen').waitFor({ state: 'detached', timeout: 5000 }).then(() => check(true, 'connectors: New chat on the toast closes Settings'), () => check(false, 'connectors: New chat on the toast closes Settings'))
    check((await p.locator('.msg').count()) === 0 && (await p.getByPlaceholder('Message Hermux').count()) === 1, 'connectors: …and a new, empty chat is open')
    // A toast that leaves fades out first (marked aria-hidden meanwhile): wait for that, then read what is still shown.
    const shownToasts = p.locator('.toast:not([aria-hidden="true"])')
    await shownToasts.filter({ hasText: said }).waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    const left = await shownToasts.allInnerTexts()
    check(!left.some(x => x.includes(said)), `connectors: the tapped toast goes away (${JSON.stringify(said)} → ${JSON.stringify(left)})`)
    await p.close()

    // One bot: no chips and no bot in the top bar. Several: the chips, and the top bar names the chosen bot.
    p = await open()
    await p.locator('.set-row', { hasText: 'server-filesystem' }).waitFor({ timeout: 5000 })
    check((await p.getByRole('group', { name: 'Connectors for' }).count()) === 0 && (await p.getByRole('note', { name: /^Bot:/ }).count()) === 0, 'connectors, one bot: no bot chips and no bot in the top bar')
    const bad = await lowContrast(p, '.screen')
    check(bad.length === 0, `connectors: Default theme text reaches 4.5:1 (${JSON.stringify(bad)})`)
    await p.close()
    await mock({ bots: true })
    p = await open()
    await waitOk(p.getByRole('group', { name: 'Connectors for' }), 'connectors, several bots: the bot chips show')
    await waitOk(p.getByRole('note', { name: 'Bot: default' }), 'connectors, several bots: the top bar names the bot')
    await p.getByRole('group', { name: 'Connectors for' }).getByRole('button', { name: 'Work', exact: true }).click()
    await waitOk(p.getByRole('note', { name: 'Bot: Work' }), 'connectors, several bots: choosing a chip changes the bot in the top bar')
    await p.close()
    await mock({ bots: false })

    // No servers: what a connector gives, and Add from the catalogue opens the catalogue.
    await mock({ empty: true })
    p = await open()
    const empty = p.getByRole('group', { name: 'No apps or services yet' })
    await waitOk(empty, 'connectors, no servers: the empty state says what a connector is')
    check((await p.locator('.set-row', { hasText: 'Add from the catalog' }).count()) === 0 && (await p.locator('.set-row', { hasText: 'Add a server' }).count()) === 1, 'connectors, no servers: the empty state’s button stands for the catalogue row; Add a server stays')
    await empty.getByRole('button', { name: 'Add from the catalogue' }).click()
    await waitOk(p.getByRole('dialog').filter({ hasText: 'Add from the catalog' }), 'connectors, no servers: Add from the catalogue opens the catalogue')
    await p.close()
    await mock({ empty: false })

    // 320 px: nothing wider than the screen; Light: every word reaches 4.5:1.
    p = await open(320, 640, { 'hm.theme': 'light' })
    await p.locator('.set-row', { hasText: 'server-filesystem' }).waitFor({ timeout: 5000 })
    await sleep(500) // the page's slide-in ends before widths and colours are read (nothing to wait on but time)
    const over = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || document.querySelector('.screen-body').scrollWidth > document.querySelector('.screen-body').clientWidth + 1)
    check(!over, 'connectors, 320 px: nothing is wider than the screen')
    const badL = await lowContrast(p, '.screen')
    check(badL.length === 0, `connectors, Light: text reaches 4.5:1 (${JSON.stringify(badL)})`)
    await p.close()
  }
}
