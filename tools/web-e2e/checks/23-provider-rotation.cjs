// Settings → Models: provider rotation. The fallback chain (config.yaml fallback_providers: add, reorder, remove, kept
// routing keys; under "If the model fails", folded until opened) and a provider's credential pool (keys, status, rotation
// strategy, add and remove). Then the one Models page and its Add a provider flow (task 07).
const { WEB, calls, check, mock, sleep, settingsPage, trayOpen } = require('../lib.cjs')

// The fallback list, opened: the fold row "Fallback models" on the Models page, then its group.
const openFallbacks = async pg => {
  await pg.getByRole('button', { name: /^Fallback models/ }).click()
  return pg.getByRole('group', { name: 'Fallback models' })
}

module.exports = async t => {
  const { browser } = t
  // DeepSeek has its .env key (seeded into its pool) and that key is cooling down; one fallback with a hand-written base_url.
  await mock({
    envSet: { DEEPSEEK_API_KEY: 'sk-deepseek-mock-0001' },
    poolSeeded: ['deepseek'], // Hermes already loaded DeepSeek's pool (a chat used it)
    poolStatus: { 'env-deepseek_api_key': 'exhausted' },
    rotation: { fallback_providers: [{ provider: 'deepseek', model: 'deepseek-chat', base_url: 'https://gw.example/v1' }] }
  })
  const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await pg.goto(WEB + '/')
  await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
  await pg.getByRole('button', { name: /^Sessions/ }).click()
  await pg.getByRole('button', { name: 'Settings', exact: true }).click()
  await settingsPage(pg, 'Models')
  const chain = await openFallbacks(pg)
  await chain.locator('.set-row', { hasText: 'deepseek-chat' }).waitFor({ timeout: 5000 }).then(() => check(true, 'rotation: the fallback list shows the saved chain'), () => check(false, 'rotation: the fallback list shows the saved chain'))
  const rows = await chain.locator('.set-row').allInnerTexts()
  check(rows[0].includes('mock-model') && rows[0].includes('Main model'), `rotation: the main model comes first (${JSON.stringify(rows[0])})`)
  check(rows[1].includes('Keys cooling down'), `rotation: a fallback whose keys are all cooling down says so (${JSON.stringify(rows[1])})`)

  // Add: the model picker without reasoning pills; the new entry goes last and the old one keeps its base_url.
  await chain.locator('.set-row', { hasText: 'Add a fallback model' }).click()
  const picker = pg.locator('.sheet', { hasText: 'Model · fallback' })
  await picker.waitFor({ timeout: 5000 })
  check((await picker.locator('.effort-row').count()) === 0, 'rotation: the fallback picker has no reasoning pills')
  await picker.locator('.picker-opt', { hasText: 'mock-sonnet' }).click()
  await chain.locator('.set-row', { hasText: 'mock-sonnet' }).waitFor({ timeout: 5000 })
  const puts = () => calls().filter(c => c.path === '/api/config' && c.http === 'PUT' && c.body?.config?.fallback_providers)
  {
    // The list shows the new entry at once and saves meanwhile: wait (up to 3 s) for the save before reading it.
    for (let i = 0; i < 30 && !puts().length; i++) await sleep(100)
    const fb = puts().pop()?.body.config.fallback_providers || []
    check(fb.length === 2 && fb[0].base_url === 'https://gw.example/v1' && fb[1].provider === 'mock' && fb[1].model === 'mock-sonnet', `rotation: adding writes the whole chain, keeping routing keys (${JSON.stringify(fb)})`)
  }
  // Reorder and remove.
  await chain.getByRole('button', { name: 'Move mock-sonnet up' }).click()
  await sleep(300)
  {
    const fb = puts().pop()?.body.config.fallback_providers || []
    check(fb.map(x => x.model).join() === 'mock-sonnet,deepseek-chat', `rotation: ↑ moves a fallback up (${fb.map(x => x.model)})`)
    check(await chain.getByRole('button', { name: 'Move mock-sonnet up' }).isDisabled(), 'rotation: the first fallback cannot move up')
  }
  await chain.getByRole('button', { name: 'Remove deepseek-chat' }).click()
  await sleep(300)
  {
    const fb = puts().pop()?.body.config.fallback_providers || []
    check(fb.length === 1 && fb[0].model === 'mock-sonnet', `rotation: ✕ removes a fallback (${JSON.stringify(fb)})`)
    check((await chain.locator('.set-row', { hasText: 'deepseek-chat' }).count()) === 0, 'rotation: the removed fallback leaves the list')
  }

  // The provider's key pool: the .env key cooling down; add a second key, which is then in use.
  await pg.locator('.providers .set-row', { hasText: 'DeepSeek' }).first().click()
  const sheet = pg.locator('.sheet', { hasText: 'Keys and logins' })
  await sheet.waitFor({ timeout: 5000 }).then(() => check(true, 'rotation: the provider sheet lists its keys'), () => check(false, 'rotation: the provider sheet lists its keys'))
  const pool = sheet.locator('.set-section', { hasText: 'Keys and logins' })
  check((await pool.locator('.set-row', { hasText: 'DEEPSEEK_API_KEY' }).innerText()).includes('Cooling down'), 'rotation: an exhausted key shows Cooling down')
  check((await pool.locator('.set-row', { hasText: 'Which key to use' }).count()) === 0, 'rotation: no strategy choice with a single key')
  await pool.getByLabel('Another DeepSeek key').fill('sk-deepseek-mock-0002')
  await pool.getByRole('button', { name: 'Add', exact: true }).click()
  await pool.locator('.set-row', { hasText: 'key #2' }).waitFor({ timeout: 5000 })
  {
    const add = calls().filter(c => c.path === '/api/credentials/pool' && c.http === 'POST').pop()
    check(add && add.body.provider === 'deepseek' && add.body.api_key === 'sk-deepseek-mock-0002' && !/sk-deepseek/.test(add.query), 'rotation: a new key goes to the pool in the body, never the URL')
    check((await pool.locator('.set-row', { hasText: 'key #2' }).innerText()).includes('In use'), 'rotation: with the first key cooling down, the new one is in use')
  }
  // Strategy: "Take turns" → credential_pool_strategies.deepseek = round_robin.
  await pool.locator('.set-row', { hasText: 'Which key to use' }).click()
  await pg.locator('.picker .picker-opt', { hasText: 'Take turns' }).click()
  await sleep(300)
  {
    const put = calls().filter(c => c.path === '/api/config' && c.http === 'PUT' && c.body?.config?.credential_pool_strategies).pop()
    check(put && put.body.config.credential_pool_strategies.deepseek === 'round_robin', 'rotation: picking a strategy saves it for the provider')
    check((await pool.locator('.set-row', { hasText: 'key #2' }).innerText()).includes('Next'), 'rotation: under Take turns the key is marked Next')
  }
  // Remove the added key (confirmed).
  await pool.locator('.set-row', { hasText: 'key #2' }).getByRole('button', { name: 'Remove' }).click()
  await pg.locator('.dialog').getByRole('button', { name: 'Remove', exact: true }).click()
  await pool.locator('.set-row', { hasText: 'key #2' }).waitFor({ state: 'detached', timeout: 5000 }).then(() => check(true, 'rotation: a removed key leaves the pool'), () => check(false, 'rotation: a removed key leaves the pool'))
  check(calls().some(c => c.http === 'DELETE' && c.path === '/api/credentials/pool/deepseek/2'), 'rotation: removal uses the 1-based index Hermes listed')
  await pg.close()
  // Leave the mock as the earlier files expect it.
  await fetch(require('../lib.cjs').MOCK + '/api/env', { method: 'DELETE', body: JSON.stringify({ key: 'DEEPSEEK_API_KEY' }) })
  await mock({ rotation: {}, poolStatus: { 'env-deepseek_api_key': null }, poolSeeded: [] })

  // The card's three states: an empty list says so (never a "Loading…" that stays), a failed load shows the error with
  // Try again, and a list with entries numbers them after the main model.
  {
    const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
    const card = pg.getByRole('group', { name: 'Fallback models' })
    // A fresh page each time; `before` changes the mock once the app is up (a failing /api/config must not break start-up).
    const open = async before => {
      await pg.goto(WEB + '/')
      await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
      if (before) await before()
      await pg.getByRole('button', { name: /^Sessions/ }).click()
      await pg.getByRole('button', { name: 'Settings', exact: true }).click()
      await settingsPage(pg, 'Models')
      await openFallbacks(pg)
    }
    const ok = (loc, name) => loc.waitFor({ timeout: 5000 }).then(() => check(true, name), () => check(false, name))

    await open()
    await ok(card.getByText('No fallback models yet'), 'rotation: an empty fallback list says “No fallback models yet”')
    check((await card.getByText('Loading…').count()) === 0, 'rotation: an empty fallback list shows no “Loading…”')
    check((await card.locator('.set-row', { hasText: 'Add a fallback model' }).count()) === 1, 'rotation: an empty fallback list keeps “Add a fallback model”')

    await open(() => mock({ routeFail: { 'GET /api/config': 500 } }))
    await ok(card.locator('.notice-error', { hasText: 'Mock failure' }), 'rotation: a failed load shows the error instead of “Loading…”')
    check((await card.getByText('Loading…').count()) === 0, 'rotation: a failed load leaves no “Loading…”')
    await mock({ routeFail: { 'GET /api/config': 0 } })
    await card.getByRole('button', { name: 'Try again' }).click()
    await ok(card.getByText('No fallback models yet'), 'rotation: Try again loads the card once Hermes answers')

    // DeepSeek connected already (its key is set), so it is a row under Connected on the Models page for the re-read below.
    await mock({ envSet: { DEEPSEEK_API_KEY: 'sk-deepseek-mock-0001' }, rotation: { fallback_providers: [{ provider: 'mock', model: 'mock-sonnet' }, { provider: 'deepseek', model: 'deepseek-chat' }] } })
    await open()
    await ok(card.locator('.set-row', { hasText: 'deepseek-chat' }), 'rotation: a list with entries shows them')
    const rows = await card.locator('.set-row').allInnerTexts()
    check(rows.length === 4 && rows[1].includes('2') && rows[1].includes('mock-sonnet') && rows[2].includes('3') && rows[2].includes('deepseek-chat'), `rotation: entries are numbered after the main model (${JSON.stringify(rows)})`)
    check((await card.getByText('No fallback models yet').count()) === 0, 'rotation: a list with entries has no empty-state line')

    // A re-read that fails (adding a key re-reads the card) must not leave the old list editable: ✕ would save it.
    await mock({ routeFail: { 'GET /api/config': 500 } })
    await pg.locator('.providers .set-row', { hasText: 'DeepSeek' }).first().click()
    const pool = pg.locator('.sheet .set-section', { hasText: 'Keys and logins' })
    await pool.getByLabel('Another DeepSeek key').fill('sk-deepseek-mock-0003')
    await pool.getByRole('button', { name: 'Add', exact: true }).click()
    await ok(card.locator('.notice-error', { hasText: 'Mock failure' }), 'rotation: a failed re-read shows the error')
    check((await card.getByRole('button', { name: 'Remove deepseek-chat' }).count()) === 0, 'rotation: a failed re-read leaves no old list to edit')
    await pg.close()
    await mock({ rotation: {}, routeFail: { 'GET /api/config': 0 } })
    const MOCK = require('../lib.cjs').MOCK
    await fetch(MOCK + '/api/env', { method: 'DELETE', body: JSON.stringify({ key: 'DEEPSEEK_API_KEY' }) })
    await fetch(MOCK + '/api/credentials/pool/deepseek/1?profile=default', { method: 'DELETE' })
    await mock({ poolSeeded: [] })
  }

  // ── The one Models page and its Add a provider flow (task 07) ──
  const ok = (loc, name, timeout = 5000) => loc.waitFor({ timeout }).then(() => check(true, name), () => check(false, name))
  {
    const MOCK = require('../lib.cjs').MOCK
    const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await pg.addInitScript(trayOpen)
    const title = () => pg.locator('.screen .title').innerText().catch(() => '')
    const toSettings = async () => {
      await pg.getByRole('button', { name: /^Sessions/ }).click()
      await pg.getByRole('button', { name: 'Settings', exact: true }).click()
    }
    // Nothing connected: one sentence stands where the model and the providers would be, then the gold Add a provider.
    await mock({ unconfigured: true })
    // An established install (the setup flow is done): only the hints show, not the first-run flow.
    await pg.addInitScript(() => { try { localStorage.setItem('hm.connectedOnce', '1'); localStorage.setItem('hm.welcomeDone', '1'); localStorage.setItem('hm.setupFlowDone', '1') } catch { /* */ } })
    await pg.goto(WEB + '/')
    await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    // The empty new-chat screen: the notice under the mark, which stays where it was without it.
    const notice = pg.getByRole('group', { name: 'No model connected yet' })
    await ok(notice, 'models: with no model, the empty new-chat screen says “No model connected yet”', 8000)
    check((await notice.getByRole('button', { name: 'Connect a model' }).count()) === 1, 'models: the notice has a Connect a model button')
    const markAt = () => pg.evaluate(() => { const r = document.querySelector('.empty svg.logo').getBoundingClientRect(); const t = [...document.querySelectorAll('.empty div')].find(e => e.textContent === 'Hermux').getBoundingClientRect(); return { top: Math.round(r.top), w: Math.round(r.width), title: Math.round(t.top) } })
    const withNotice = await markAt()
    await pg.evaluate(() => document.querySelector('.empty').classList.remove('has-notice'))
    await pg.evaluate(() => document.querySelector('.empty-notice').style.display = 'none')
    const without = await markAt()
    check(withNotice.top === without.top && withNotice.title === without.title && withNotice.w === without.w, `models: the notice does not move the Hermux mark or title (${JSON.stringify(withNotice)} with it, ${JSON.stringify(without)} without)`)
    await pg.evaluate(() => { document.querySelector('.empty').classList.add('has-notice'); document.querySelector('.empty-notice').style.display = '' })
    await notice.getByRole('button', { name: 'Connect a model' }).click()
    await pg.locator('.screen .title', { hasText: 'Add a provider' }).waitFor({ timeout: 5000 })
    check((await title()) === 'Add a provider', 'models: Connect a model on the empty screen opens Add a provider')
    await pg.evaluate(() => window.hermesBack())
    const backToChat = await pg.locator('.screen').waitFor({ state: 'detached', timeout: 4000 }).then(() => true, () => false)
    check(backToChat && (await pg.getByPlaceholder('Message Hermux').isVisible()), 'models: Back from there returns to the chat')

    await toSettings()
    await settingsPage(pg, 'Models')
    const sentence = pg.getByText('Hermux needs a model to think with. Sign in with a subscription you already have, or paste an API key.')
    await ok(sentence, 'models: with nothing connected the page says Hermux needs a model, in one sentence')
    check((await pg.locator('.screen .set-heading', { hasText: /^New chats use$/ }).count()) === 0 && (await pg.locator('.screen .set-heading', { hasText: /^Connected$/ }).count()) === 0, 'models: with nothing connected there is no New chats use or Connected section')
    const add = pg.getByRole('button', { name: 'Add a provider' })
    check((await add.count()) === 1 && (await add.evaluate(e => e.classList.contains('primary'))) && (await pg.locator('.screen .btn.primary').count()) === 1, 'models: Add a provider is the page’s one gold button')
    const heads = (await pg.locator('.screen .set-heading').allInnerTexts()).map(h => h.toLowerCase())
    check(heads.includes('if the model fails') && (await pg.locator('.screen .set-title').allInnerTexts()).pop() === 'All keys', `models: If the model fails, then All keys last (${heads.join(' | ')})`)

    // The fallback list: closed, saying None; opened, today's list and controls.
    const fold = pg.getByRole('button', { name: /^Fallback models/ })
    check((await fold.getAttribute('aria-expanded')) === 'false' && (await pg.getByRole('group', { name: 'Fallback models' }).count()) === 0, 'models: the fallback list is closed by default')
    await pg.waitForFunction(() => [...document.querySelectorAll('.set-value')].some(e => e.textContent === 'None'), null, { timeout: 5000 }).catch(() => {})
    check((await fold.innerText()).includes('None'), `models: closed, it says None when there are no fallbacks (${JSON.stringify(await fold.innerText())})`)
    await fold.click()
    const list = pg.getByRole('group', { name: 'Fallback models' })
    await ok(list.getByText('No fallback models yet'), 'models: opened, the fallback list shows today’s list')
    check((await fold.getAttribute('aria-expanded')) === 'true' && (await list.getByRole('button', { name: /^Add a fallback model/ }).count()) === 1, 'models: opened, it keeps Add a fallback model')
    await fold.click()

    // Add a provider: search, Sign in with an account you have, Use an API key, Your own server; nothing connected listed.
    await add.click()
    await pg.locator('.screen .title', { hasText: 'Add a provider' }).waitFor({ timeout: 5000 })
    await pg.locator('.screen .set-heading', { hasText: 'Use an API key' }).waitFor({ timeout: 5000 })
    const aHeads = await pg.locator('.screen .set-heading').allInnerTexts()
    const at = h => aHeads.findIndex(x => x.toLowerCase().startsWith(h))
    check(at('sign in with an account you have') >= 0 && at('sign in with an account you have') < at('use an api key') && at('use an api key') < at('all providers') && at('all providers') < at('your own server'), `add a provider: Sign in, Use an API key, All providers, Your own server, in that order (${aHeads.join(' | ')})`)
    check((await pg.getByPlaceholder('Search providers (e.g. deepseek, groq)').count()) === 1, 'add a provider: it has the provider search')
    const signIn = pg.locator('.set-section', { has: pg.locator('.set-heading', { hasText: 'Sign in with an account you have' }) })
    check((await signIn.getByRole('button', { name: /^OpenAI/ }).count()) >= 1, 'add a provider: a provider with a sign-in is under Sign in with an account you have')
    await pg.getByPlaceholder('Search providers (e.g. deepseek, groq)').fill('deeps')
    check((await pg.getByRole('button', { name: /^DeepSeek/ }).count()) >= 1, 'add a provider: the search finds a provider')
    await pg.getByPlaceholder('Search providers (e.g. deepseek, groq)').fill('')

    // Add a key with no model yet: the picker opens by itself, limited to that provider; choosing ends on Models.
    const since = Date.now()
    await pg.locator('.set-section', { has: pg.locator('.set-heading', { hasText: 'Use an API key' }) }).getByRole('button', { name: /^DeepSeek/ }).click()
    const sheet = pg.getByRole('dialog').filter({ hasText: 'API key' })
    await sheet.getByLabel('DeepSeek API key').fill('sk-deepseek-mock-0009')
    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    const picker = pg.getByRole('dialog').filter({ has: pg.getByPlaceholder('Search models…') })
    await ok(picker.getByRole('button', { name: /^deepseek-chat/ }), 'add a provider: after the first key the model picker opens by itself')
    check((await picker.getByRole('button', { name: /^mock-model/ }).count()) === 0, 'add a provider: the picker shows only the provider just connected')
    {
      const put = calls().filter(c => c.t >= since && c.path === '/api/env' && c.http === 'PUT').pop()
      check(put && put.body.value === 'sk-deepseek-mock-0009' && !/sk-deepseek/.test(put.query || ''), 'add a provider: the key goes in the body, never the URL')
    }
    await picker.getByRole('button', { name: /^deepseek-chat/ }).click()
    await pg.locator('.screen .title', { hasText: /^Models$/ }).waitFor({ timeout: 5000 }).catch(() => {})
    {
      const set = calls().filter(c => c.t >= since && c.http === 'POST' && c.path === '/api/model/set').pop()
      check(set && set.body.model === 'deepseek-chat' && set.body.provider === 'deepseek', `add a provider: choosing a model sets it for new chats (${JSON.stringify(set?.body)})`)
    }
    check((await title()) === 'Models', 'add a provider: choosing the model ends on the Models page')
    await ok(pg.getByText('New chats use deepseek-chat'), 'add a provider: the toast says “New chats use <model>”', 3000)
    await ok(pg.locator('.set-section', { has: pg.locator('.set-heading', { hasText: /^Connected$/ }) }).getByRole('button', { name: /^DeepSeek/ }), 'models: the connected provider is a row under Connected')
    check((await pg.locator('.screen .set-heading', { hasText: /^New chats use$/ }).count()) === 1, 'models: with a provider connected, New chats use is back')

    // A second provider, with a model already: no picker; the sheet's Choose a model stays the way.
    await pg.getByRole('button', { name: 'Add a provider' }).click()
    await pg.locator('.screen .set-heading', { hasText: 'Use an API key' }).waitFor({ timeout: 5000 })
    check((await pg.locator('.screen').getByRole('button', { name: /^DeepSeek/ }).count()) === 0, 'add a provider: a connected provider is not listed again')
    await pg.locator('.set-section', { has: pg.locator('.set-heading', { hasText: 'Use an API key' }) }).getByRole('button', { name: /^OpenRouter/ }).click()
    const sheet2 = pg.getByRole('dialog').filter({ hasText: 'API key' })
    await sheet2.getByLabel('OpenRouter API key').fill('sk-or-mock-0001')
    await sheet2.getByRole('button', { name: 'Save', exact: true }).click()
    await ok(sheet2.getByRole('button', { name: 'Choose a model' }), 'add a provider: a second provider keeps its sheet with Choose a model')
    await sleep(500)
    check((await pg.getByPlaceholder('Search models…').count()) === 0, 'add a provider: with a model set already, no picker opens by itself')
    await pg.evaluate(() => window.hermesBack()) // the sheet
    await pg.getByRole('dialog').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    await pg.evaluate(() => window.hermesBack()) // Add a provider → Models
    check(await pg.locator('.screen .title', { hasText: /^Models$/ }).waitFor({ timeout: 3000 }).then(() => true, () => false), 'add a provider: Back goes up to Models')
    await pg.evaluate(() => window.hermesBack())
    await pg.getByRole('textbox', { name: 'Search settings' }).waitFor({ timeout: 3000 })
    await pg.evaluate(() => window.hermesBack())
    await pg.locator('.screen').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})

    // The empty screen's notice goes once there is a model.
    await pg.reload()
    await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await pg.waitForFunction(() => !!document.querySelector('.empty svg.logo'), null, { timeout: 8000 }).catch(() => {})
    await sleep(1200)
    check((await notice.count()) === 0, 'models: with a model, the empty screen has no notice')

    // The chat's model sheet: its last row Add a provider opens Settings on the flow; Back returns to the chat.
    await pg.getByRole('button', { name: /^Model: .*Change model$/ }).click()
    await pg.getByPlaceholder('Search models…').waitFor({ timeout: 5000 })
    await pg.getByRole('button', { name: 'Add a provider', exact: true }).click()
    await pg.locator('.screen .title', { hasText: 'Add a provider' }).waitFor({ timeout: 5000 }).then(() => check(true, 'model sheet: Add a provider opens Settings on Add a provider'), () => check(false, 'model sheet: Add a provider opens Settings on Add a provider'))
    await pg.evaluate(() => window.hermesBack())
    const chatAgain = await pg.locator('.screen').waitFor({ state: 'detached', timeout: 4000 }).then(() => true, () => false)
    check(chatAgain && (await pg.getByPlaceholder('Message Hermux').isVisible()) && (await pg.getByPlaceholder('Search models…').count()) === 0, 'model sheet: Back from Add a provider returns to the chat')
    await pg.close()
    await fetch(MOCK + '/api/env', { method: 'DELETE', body: JSON.stringify({ key: 'DEEPSEEK_API_KEY' }) })
    await fetch(MOCK + '/api/env', { method: 'DELETE', body: JSON.stringify({ key: 'OPENROUTER_API_KEY' }) })
    await mock({ configured: true })
  }

  // ── Several bots: the bot chips, and the picker keeps Set one model for all bots ──
  {
    await mock({ bots: true })
    const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await pg.goto(WEB + '/')
    await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await pg.getByRole('button', { name: /^Sessions/ }).click()
    await pg.getByRole('button', { name: 'Settings', exact: true }).click()
    await settingsPage(pg, 'Models')
    await pg.locator('.screen .set-heading', { hasText: /^New chats use$/ }).waitFor({ timeout: 5000 })
    check((await pg.getByRole('button', { name: 'Work', exact: true }).count()) === 1, 'models: with several bots, the page has bot chips')
    await pg.getByRole('button', { name: 'Work', exact: true }).click()
    await ok(pg.locator('.set-section', { has: pg.locator('.set-heading', { hasText: /^New chats use$/ }) }).getByRole('button', { name: /^other-model/ }), 'models: a bot chip shows that bot’s model under New chats use')
    await pg.close()
    await mock({ bots: false })
    const one = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await one.goto(WEB + '/')
    await one.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await one.getByRole('button', { name: /^Sessions/ }).click()
    await one.getByRole('button', { name: 'Settings', exact: true }).click()
    await settingsPage(one, 'Models')
    await one.locator('.screen .set-heading', { hasText: /^New chats use$/ }).waitFor({ timeout: 5000 })
    check((await one.locator('.screen .scope-bar').count()) === 0, 'models: with one bot, no bot chips')
    await one.locator('.set-section', { has: one.locator('.set-heading', { hasText: /^New chats use$/ }) }).getByRole('button').first().click()
    await one.getByPlaceholder('Search models…').waitFor({ timeout: 5000 })
    check((await one.getByRole('switch', { name: 'Set one model for all bots' }).count()) === 0, 'models: with one bot, the picker has no Set one model for all bots')
    await one.close()
  }
}
