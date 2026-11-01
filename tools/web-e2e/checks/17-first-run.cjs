// First run: welcome, sign-in, model; every provider the pinned Hermes has.
const { calls, sleep, check, fail, mock, nativeShell } = require('../lib.cjs')

module.exports = async t => {
  const { browser, page } = t
  // ── first run: a Hermes with no model provider opens the welcome; sign in, pick a model, it never shows again ──
  t.established = false
  await mock({ unconfigured: true })
  const wel = await browser.newPage({ viewport: { width: 375, height: 812 } })
  wel.on('pageerror', e => { console.log('PAGEERROR', e.message); fail() })
  await wel.goto('http://127.0.0.1:5180/')
  await wel.getByText('Connect Hermes to a model').waitFor({ timeout: 15000 }).then(() => check(true, 'fresh install opens the welcome'), () => check(false, 'fresh install opens the welcome'))
  check(await wel.getByRole('button', { name: 'Connect a provider first' }).isDisabled(), 'Pick a model waits for a connected provider')
  await wel.locator('.providers .set-row', { hasText: 'OpenAI' }).first().click()
  await wel.locator('.set-row', { hasText: 'ChatGPT Plus / Pro' }).getByRole('button', { name: 'Sign in' }).click()
  await wel.getByText('ABCD-1234').waitFor({ timeout: 5000 }).then(() => check(true, 'device-code sign-in shows the code'), () => check(false, 'device-code sign-in shows the code'))
  await wel.getByText('Copy this code').waitFor({ state: 'detached', timeout: 8000 }).then(() => check(true, 'sign-in sheet closes once Hermes approves'), () => check(false, 'sign-in sheet closes once Hermes approves'))
  await wel.locator('.sheet .set-row', { hasText: 'ChatGPT Plus / Pro' }).getByText('Signed in').waitFor({ timeout: 5000 }).then(() => check(true, 'the provider sheet shows the new sign-in'), () => check(false, 'the provider sheet shows the new sign-in'))
  await wel.getByRole('button', { name: 'Choose a model' }).click({ timeout: 5000 })
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

  // ── providers: the model step offers every provider the pinned Hermes has (mock = its real /api/env + /api/providers/oauth) ──
  await mock({ unconfigured: true, pluginEnabled: true })
  {
    const pv = await browser.newPage({ viewport: { width: 375, height: 812 } })
    pv.on('pageerror', e => { console.log('PAGEERROR (providers)', e.message); fail() })
    await pv.addInitScript(s => { window.__setup = s }, { termux: true, runCommand: true, notifications: true, batteryApp: true, batteryTermux: true, startError: '' })
    await pv.addInitScript(nativeShell)
    await pv.goto('http://127.0.0.1:5180/')
    await pv.locator('.providers .set-row').first().waitFor({ timeout: 15000 }).catch(() => {})
    const section = t => pv.locator('.providers .set-section', { has: pv.locator('.set-heading', { hasText: t }) })
    const names = async t => (await section(t).locator('.set-row .key-line').allTextContents()).map(x => x.trim())
    const pop = await names('Popular')
    check(JSON.stringify(pop) === JSON.stringify(['Anthropic (Claude)', 'OpenAI', 'Google Gemini', 'OpenRouter', 'xAI (Grok)', 'DeepSeek', 'Mistral', 'Groq']), `providers: the big ones first, in order (${pop.join(', ')})`)
    const all = await names('All providers')
    check(all.length >= 40 && ['Nous Portal', 'AWS Bedrock', 'LM Studio', 'Z.AI (GLM)', 'Upstage Solar', 'Ollama (local)'].every(n => all.includes(n)), `providers: every other provider of the pinned Hermes is listed (${all.length})`)
    check(JSON.stringify(all) === JSON.stringify([...all].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))), 'providers: the rest is A–Z')
    check((await section('Connected').count()) === 0, 'providers: nothing is marked connected on a fresh Hermes')
    await pv.getByPlaceholder('Search providers (e.g. deepseek, groq)').fill('deep')
    {
      const found = await pv.locator('.providers .set-row .key-line').allTextContents()
      check(JSON.stringify(found) === JSON.stringify(['DeepSeek', 'DeepInfra']), `providers: search narrows the list (${found.join(', ')})`)
    }
    // Paste a key: it goes to this profile's .env in a JSON body, never in a URL
    await pv.locator('.providers .set-row', { hasText: 'DeepSeek' }).click()
    const sheet = pv.locator('.sheet', { has: pv.locator('.sheet-title', { hasText: 'DeepSeek' }) })
    check(await sheet.getByRole('button', { name: 'Connect it first, then choose a model' }).isDisabled(), 'providers: the model picker waits for the key')
    await sheet.getByPlaceholder('Paste API key').fill('sk-e2e-deepseek-secret-9876')
    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    await sheet.getByText('Saved key').waitFor({ timeout: 5000 }).then(() => check(true, 'providers: a saved key shows as saved'), () => check(false, 'providers: a saved key shows as saved'))
    {
      const put = calls().filter(c => c.http === 'PUT' && c.path === '/api/env').pop()
      check(put && put.body.key === 'DEEPSEEK_API_KEY' && put.body.value === 'sk-e2e-deepseek-secret-9876' && /profile=/.test(put.query), 'providers: PUT /api/env {DEEPSEEK_API_KEY} for this profile')
      check(!calls().some(c => (c.path || '').includes('sk-e2e') || (c.query || '').includes('sk-e2e')), 'providers: the key never appears in a URL')
      check(await pv.evaluate(() => !document.body.innerText.includes('sk-e2e-deepseek-secret-9876')), 'providers: the page shows only the redacted key')
    }
    // Choose a model: only DeepSeek's models
    await sheet.getByRole('button', { name: 'Choose a model' }).click()
    await pv.locator('.picker-opt', { hasText: 'deepseek-chat' }).waitFor({ timeout: 5000 }).catch(() => {})
    const groups = (await pv.locator('.picker-group').allTextContents()).map(x => x.trim())
    check(JSON.stringify(groups) === JSON.stringify(['DeepSeek']), `providers: the model picker shows only that provider (${groups.join(', ')})`)
    const closeTop = async () => {
      const n = await pv.locator('.sheet-backdrop').count()
      await pv.locator('.sheet-backdrop').last().click({ position: { x: 5, y: 5 } })
      await pv.waitForFunction(k => document.querySelectorAll('.sheet-backdrop').length < k, n, { timeout: 3000 }).catch(() => {})
    }
    await closeTop() // the model picker
    await closeTop() // the DeepSeek sheet
    await pv.getByPlaceholder('Search providers (e.g. deepseek, groq)').fill('')
    await section('Connected').locator('.set-row', { hasText: 'DeepSeek' }).waitFor({ timeout: 5000 }).then(() => check(true, 'providers: DeepSeek moves to Connected with its dot'), () => check(false, 'providers: DeepSeek moves to Connected with its dot'))
    {
      const on = await names('Connected')
      check(JSON.stringify(on) === JSON.stringify(['DeepSeek']) && (await section('Connected').locator('.dot-set').count()) === 1, `providers: only DeepSeek is connected, with one dot (${on.join(', ')})`)
    }
    // Claude: Pro / Max signs in inside the app (SignIn.tsx; Termux is its fallback); Claude Code's token login is a command to copy
    await pv.locator('.providers .set-row', { hasText: 'Anthropic (Claude)' }).click()
    const cl = pv.locator('.sheet', { has: pv.locator('.sheet-title', { hasText: 'Anthropic (Claude)' }) })
    check((await cl.getByPlaceholder('Paste API key').count()) === 1, 'providers: Anthropic offers Paste API key')
    check((await cl.locator('.set-row', { hasText: 'claude setup-token' }).getByRole('button', { name: 'Copy command' }).count()) === 1, 'providers: a login that needs another CLI is offered as a command')
    await cl.locator('.set-row', { hasText: 'Claude Pro / Max' }).getByRole('button', { name: 'Sign in' }).click()
    await pv.locator('.sheet', { hasText: 'Sign in to Claude' }).waitFor({ timeout: 5000 }).then(() => check(true, 'providers: Claude Pro / Max opens the in-app sign-in'), () => check(false, 'providers: Claude Pro / Max opens the in-app sign-in'))
    check((await pv.evaluate(() => window.__signins || [])).length === 0, 'providers: Claude Pro / Max does not open Termux')
    await closeTop() // the Claude sign-in sheet
    await closeTop() // the Anthropic sheet
    // Mistral (no built-in provider in the pinned Hermes): an OpenAI-compatible endpoint with its address filled in
    await pv.locator('.providers .set-row', { hasText: 'Mistral' }).click()
    const ms = pv.locator('.sheet', { has: pv.locator('.sheet-title', { hasText: 'Connect Mistral' }) })
    check((await ms.getByPlaceholder('http://192.168.1.20:8000/v1').inputValue()) === 'https://api.mistral.ai/v1', 'providers: Mistral comes with its address')
    await ms.getByPlaceholder('Paste here').fill('mistral-e2e-secret-5555')
    await ms.getByRole('button', { name: 'Find its models' }).click()
    await ms.getByText('Found 2 models.').waitFor({ timeout: 5000 }).then(() => check(true, 'providers: the endpoint is asked for its models'), () => check(false, 'providers: the endpoint is asked for its models'))
    await ms.getByRole('button', { name: 'Save', exact: true }).click()
    await section('Connected').locator('.set-row', { hasText: 'Mistral' }).waitFor({ timeout: 5000 }).then(() => check(true, 'providers: the saved endpoint is connected'), () => check(false, 'providers: the saved endpoint is connected'))
    {
      const post = calls().filter(c => c.http === 'POST' && c.path === '/api/providers/custom-endpoints').pop()
      check(post && post.body.name === 'Mistral' && post.body.base_url === 'https://api.mistral.ai/v1' && post.body.model === 'mistral-large-latest' && post.body.api_key === 'mistral-e2e-secret-5555' && /profile=/.test(post.query), 'providers: POST /api/providers/custom-endpoints with name, URL, model, key')
      check(!calls().some(c => (c.path || '').includes('mistral-e2e') || (c.query || '').includes('mistral-e2e')), 'providers: the endpoint key never appears in a URL')
      check((await names('Popular')).filter(n => n === 'Mistral').length === 0, 'providers: the Mistral preset is not listed twice')
    }
    await pv.close()
    await mock({ unconfigured: true }) // forgets the saved key and endpoint
    await mock({ configured: true })
  }
}
