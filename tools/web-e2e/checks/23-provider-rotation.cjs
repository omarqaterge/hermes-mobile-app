// Settings → Model providers: provider rotation. The fallback chain (config.yaml fallback_providers: add, reorder,
// remove, kept routing keys) and a provider's credential pool (keys, status, rotation strategy, add and remove).
const { WEB, calls, check, mock, sleep } = require('../lib.cjs')

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
  await pg.locator('.nav-tile', { hasText: 'Settings' }).click()
  await pg.locator('.set-row', { hasText: 'Model providers' }).click()
  const chain = pg.locator('.set-section', { hasText: 'Fallback models' })
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
}
