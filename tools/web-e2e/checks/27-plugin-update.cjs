// Settings → About → Hermux plugin (the app's own plugin update, PluginSync.java), and the app against an old plugin
// that lacks newer routes (an app updated before its plugin caught up): no broken pages, the sections just stay away.
const { WEB, check, sleep, nativeShell } = require('../lib.cjs')

const OLD_ROUTES = /\/api\/plugins\/hermes-mobile\/(google|openui|bgapps|plugin-info|sent-counts)(\?|$|\/)/

async function open(browser, { oldPlugin } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
  if (oldPlugin) await ctx.route(OLD_ROUTES, r => r.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Not Found"}' }))
  await ctx.addInitScript(nativeShell)
  await ctx.addInitScript(() => {
    try { localStorage.setItem('hm.welcomeDone', '1'); localStorage.setItem('hm.setupFlowDone', '1'); localStorage.setItem('hm.connectedOnce', '1') } catch {}
  })
  const pg = await ctx.newPage()
  const errors = []
  pg.on('pageerror', e => errors.push(e.message))
  await pg.goto(WEB + '/')
  await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
  await pg.getByRole('button', { name: /^Sessions/ }).click()
  await pg.locator('.nav-tile', { hasText: 'Settings' }).click()
  await pg.locator('.screen .title', { hasText: 'Settings' }).waitFor({ timeout: 5000 })
  return { ctx, pg, errors }
}
const row = pg => pg.locator('.set-row', { hasText: 'Hermux plugin' })
const setState = (pg, s) => pg.evaluate(s => {
  window.__plug = { state: 'current', detail: '', installed: '1793648698', apk: '1793648698', running: '', tries: 0, maxTries: 3, ...s }
  window.hermesPluginState()
}, s).then(() => sleep(150)) // React renders the new state on its next tick

module.exports = async t => {
  const { browser } = t
  {
    const { ctx, pg, errors } = await open(browser)
    await row(pg).scrollIntoViewIfNeeded()
    check(/Up to date with this app/.test(await row(pg).innerText()), 'plugin: About shows the plugin up to date')
    check(/2026-11-02/.test(await row(pg).innerText()), 'plugin: the installed version shows as a date')
    check(await row(pg).isDisabled(), 'plugin: nothing to tap when up to date')

    await setState(pg, { state: 'older', installed: '0' })
    check(/Old version/.test(await row(pg).innerText()) && /installs by itself/.test(await row(pg).innerText()), 'plugin: an old copy: says it updates by itself')
    await row(pg).click()
    check(JSON.stringify(await pg.evaluate(() => window.__plugLog)) === '[false]', 'plugin: tap updates now (no force)')

    await setState(pg, { state: 'older', running: 'apply' })
    check(/Updating…/.test(await row(pg).innerText()) && await row(pg).isDisabled(), 'plugin: while updating: no tap')

    await setState(pg, { state: 'failed', detail: 'load rolled-back', tries: 3 })
    const failed = await row(pg).innerText()
    check(/rolled-back/.test(failed) && /still works/.test(failed) && /only when you tap/.test(failed), 'plugin: a failure is shown, with the old plugin still working')
    await pg.evaluate(() => { window.__plugAnswer = 'working' })
    await row(pg).click()
    await pg.getByText('Hermux is working. Try again when it has finished').waitFor({ timeout: 3000 }).then(() => check(true, 'plugin: retry while Hermes works says so'), () => check(false, 'plugin: retry while Hermes works says so'))
    await pg.evaluate(() => { window.__plugAnswer = 'ok'; window.__plugLog = [] })

    await setState(pg, { state: 'modified', installed: '1790000000' })
    await row(pg).click()
    const dlg = pg.locator('.dialog', { hasText: 'Replace the plugin?' })
    await dlg.waitFor({ timeout: 3000 })
    await dlg.locator('button', { hasText: 'Cancel' }).click()
    await sleep(200)
    check(JSON.stringify(await pg.evaluate(() => window.__plugLog)) === '[]', 'plugin: a hand-changed copy: Cancel replaces nothing')
    await row(pg).click()
    await dlg.locator('button', { hasText: 'Replace' }).click()
    await sleep(200)
    check(JSON.stringify(await pg.evaluate(() => window.__plugLog)) === '[true]', 'plugin: Replace forces the update')

    await setState(pg, { state: 'newer', installed: '1900000000' })
    check(/left as it is/.test(await row(pg).innerText()) && await row(pg).isDisabled(), 'plugin: a newer plugin is left alone, nothing to tap')
    check(errors.length === 0, 'plugin: no page errors', errors.join('; '))
    await ctx.close()
  }

  // An old plugin (no /google, /openui, /bgapps, /plugin-info, /sent-counts): Settings, Connectors and Hermes settings open.
  {
    const { ctx, pg, errors } = await open(browser, { oldPlugin: true })
    await sleep(800)
    check((await pg.locator('.set-row', { hasText: 'Dynamic UI' }).count()) === 0, 'old plugin: no cards switch (its route is missing)')
    await pg.locator('.set-row', { hasText: 'Connectors' }).click()
    await pg.locator('.screen .title', { hasText: 'Connectors' }).waitFor({ timeout: 5000 })
    await pg.locator('.set-row', { hasText: 'server-filesystem' }).waitFor({ timeout: 5000 }).then(() => check(true, 'old plugin: Connectors lists MCP servers'), () => check(false, 'old plugin: Connectors lists MCP servers'))
    check((await pg.locator('.set-row', { hasText: 'Gmail, Calendar, Drive' }).count()) === 0, 'old plugin: no Google row (its route is missing)')
    check(errors.length === 0, 'old plugin: no page errors', errors.join('; '))
    await ctx.close()
  }
}
