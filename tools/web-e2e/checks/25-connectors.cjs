// Settings → Connectors: MCP servers (add, catalog, on/off, test, browser sign-in, remove), tools with a key, keys for skills.
const { WEB, calls, check, sleep } = require('../lib.cjs')

const waitOk = (loc, name, timeout = 5000) => loc.waitFor({ timeout }).then(() => check(true, name), () => check(false, name))

module.exports = async t => {
  const { browser } = t
  const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await pg.goto(WEB + '/')
  await pg.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
  await pg.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(String(u)); return null } })
  await pg.getByRole('button', { name: /^Sessions/ }).click()
  await pg.locator('.nav-tile', { hasText: 'Settings' }).click()
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
  const files = pg.locator('.sheet', { hasText: 'Hermes can use this server’s tools' })
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
  const g3 = pg.locator('.sheet', { hasText: 'Ask Hermes about your mail' })
  await waitOk(g3, 'connectors: Google: the right address connects')
  await g3.locator('.set-row', { hasText: 'Sign out' }).click()
  await pg.locator('.dialog').getByRole('button', { name: 'Sign out' }).click()
  await waitOk(pg.locator('.sheet', { hasText: '2. Sign in with Google' }), 'connectors: Google: sign out goes back to the sign-in step')
  check(http('/api/plugins/hermes-mobile/google', 'DELETE').length === 1, 'connectors: Google: sign out calls the plugin')
  await pg.locator('.sheet-backdrop').last().click({ position: { x: 5, y: 5 } })
  await pg.close()
}
