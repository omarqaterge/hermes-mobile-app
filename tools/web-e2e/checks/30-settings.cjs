// Settings' main page and the pages the redesign moves: Appearance (Dark / OLED black / Light theme, text size), the settings search, Default
// models (one model for all bots). Each control is found by its role and name, used, and its effect checked.
const { WEB, calls, check } = require('../lib.cjs')

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
    const fontBefore = await sp.evaluate(() => getComputedStyle(document.querySelector('.size-preview')).fontSize)
    await sp.getByRole('button', { name: '120%', exact: true }).click()
    await sp.waitForTimeout(200)
    const big = await sp.evaluate(() => ({ kept: localStorage.getItem('hm.textScale'), font: getComputedStyle(document.querySelector('.size-preview')).fontSize }))
    check(big.kept === '1.2' && parseFloat(big.font) > parseFloat(fontBefore), `appearance: a text size is kept and makes the text bigger (${fontBefore} → ${JSON.stringify(big)})`)
    await sp.getByRole('button', { name: '100%', exact: true }).click()
    check((await sp.evaluate(() => localStorage.getItem('hm.textScale'))) === '1', 'appearance: 100% goes back to the normal size')
    await sp.evaluate(() => window.hermesBack())
  }

  // ── Default models: Set one model for all bots asks Hermes to switch each bot's model ──
  {
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
}
