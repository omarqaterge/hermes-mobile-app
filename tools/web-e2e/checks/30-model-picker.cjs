// The chat's model picker: the list kept between opens (shown at once), the live refresh only when due or asked for,
// one refresh at a time, an error with Try again instead of "Loading models…" forever; and Setup check offered when
// the dashboard doesn't answer at all.
const { WEB, rpcs, sleep, check, mock, nativeShell } = require('../lib.cjs')

module.exports = async t => {
  const { browser } = t
  const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
  const home = async () => {
    await pg.goto(WEB + '/')
    await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
  }
  const open = async () => {
    await pg.getByRole('button', { name: 'Add', exact: true }).click()
    await pg.locator('.picker-opt', { hasText: 'mock-model' }).click()
    await pg.locator('.sheet .sheet-title', { hasText: 'Model' }).waitFor({ timeout: 5000 })
  }
  const close = async () => {
    await pg.mouse.click(187, 20) // the backdrop above the sheet
    await pg.locator('.sheet .sheet-title', { hasText: 'Model' }).waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
  }
  const live = () => rpcs('model.options').filter(c => c.params && c.params.refresh).length
  const plain = () => rpcs('model.options').filter(c => !(c.params && c.params.refresh)).length

  await mock({ models: { mark: true, fail: false } })
  await home()
  await pg.evaluate(() => localStorage.removeItem('hm.modelOptions.v1'))
  await home()

  // First open: nothing kept yet, so the live list is asked for and replaces Hermes's cached catalog.
  const live0 = live()
  await open()
  await pg.locator('.model-row', { hasText: 'mock-live' }).waitFor({ timeout: 5000 }).then(() => check(true, 'model picker: the live list arrives on the first open'), () => check(false, 'model picker: the live list arrives on the first open'))
  check(live() - live0 === 1, `model picker: one live refresh on the first open (${live() - live0})`)
  const kept = await pg.evaluate(() => JSON.parse(localStorage.getItem('hm.modelOptions.v1') || '{}'))
  check(kept.default && kept.default.list.providers[0].models.includes('mock-live') && kept.default.liveAt > 0, 'model picker: the live list is kept for the profile')
  check(!JSON.stringify(kept).includes('pricing'), 'model picker: the kept copy holds only what the picker draws')
  await close()

  // Second open: the kept list shows at once, Hermes's plain read runs, no second live refresh within 10 minutes.
  const live1 = live(), plain1 = plain()
  await mock({ models: { delay: 1500 } }) // Hermes takes a while to build the list, as on a phone
  await open()
  check((await pg.locator('.model-row', { hasText: 'mock-live' }).count()) === 1, 'model picker: a re-open shows the kept list at once')
  check((await pg.getByText('Loading models…').count()) === 0, 'model picker: no "Loading models…" when a list is kept')
  await sleep(1900)
  await mock({ models: { delay: 0 } })
  check(live() === live1, `model picker: no live refresh on a re-open soon after (${live() - live1})`)
  check(plain() - plain1 === 1, `model picker: the plain read still runs on a re-open (${plain() - plain1})`)
  // Hermes's answer is what counts: its plain read (here without the live-only model) replaces the kept list.
  check((await pg.locator('.model-row', { hasText: 'mock-live' }).count()) === 0 && (await pg.locator('.model-row', { hasText: 'mock-sonnet' }).count()) >= 1, 'model picker: Hermes’s answer replaces the kept list')
  // Refresh the list: asks for the live list now.
  await pg.getByRole('button', { name: 'Refresh the list' }).click()
  for (let i = 0; i < 30 && live() === live1; i++) await sleep(100)
  check(live() - live1 === 1, `model picker: Refresh the list asks for the live list (${live() - live1})`)
  await pg.getByRole('button', { name: 'Refresh the list' }).waitFor({ timeout: 5000 }).then(() => check(true, 'model picker: Refresh the list comes back when the refresh is done'), () => check(false, 'model picker: Refresh the list comes back when the refresh is done'))
  await close()

  // A sign-in or key change makes the next open ask for the live list again.
  await pg.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('hm.modelOptions.v1') || '{}')
    all.default.liveAt = Date.now() - 11 * 60_000 // more than 10 minutes old
    localStorage.setItem('hm.modelOptions.v1', JSON.stringify(all))
  })
  const live2 = live()
  await open()
  for (let i = 0; i < 30 && live() === live2; i++) await sleep(100)
  check(live() - live2 === 1, `model picker: a list older than 10 minutes is refreshed on open (${live() - live2})`)
  await close()

  // Hermes can't build the list and nothing is kept: an error with Try again, not "Loading models…" for ever.
  await mock({ models: { fail: true } })
  await pg.evaluate(() => localStorage.removeItem('hm.modelOptions.v1'))
  await open()
  const err = pg.locator('.sheet .load-error')
  await err.waitFor({ timeout: 5000 }).then(() => check(true, 'model picker: a failed load shows an error'), () => check(false, 'model picker: a failed load shows an error'))
  check(/model catalog unavailable/.test((await err.textContent().catch(() => '')) || ''), 'model picker: the error says Hermes’s reason')
  check((await err.getByRole('button', { name: 'Report a problem' }).count()) === 1, 'model picker: the error offers Report a problem')
  check((await err.getByRole('button', { name: 'Setup check' }).count()) === 0, 'model picker: no Setup check for an error Hermes answered')
  await mock({ models: { fail: false } })
  await err.getByRole('button', { name: 'Try again' }).click()
  await pg.locator('.model-row', { hasText: 'mock-sonnet' }).first().waitFor({ timeout: 5000 }).then(() => check(true, 'model picker: Try again loads the list'), () => check(false, 'model picker: Try again loads the list'))
  check((await pg.locator('.sheet .load-error').count()) === 0, 'model picker: the error goes once the list is there')
  await close()
  await mock({ models: { mark: false, fail: false, delay: 0 } })
  await pg.close()

  // In the app, a dashboard that doesn't answer at all ("Hermux unreachable"): the error offers Setup check, whose Back
  // returns to Settings.
  const sp = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await sp.addInitScript(nativeShell)
  await sp.addInitScript(() => {
    const real = window.HermesAndroid.httpAsync
    window.HermesAndroid.httpAsync = (key, id, m, p, b) => {
      if (window.__httpDown && p.startsWith(window.__httpDown)) return setTimeout(() => window.__hmHttp(id, 0, "Hermes isn't answering"), 20)
      return real(key, id, m, p, b)
    }
  })
  await sp.goto(WEB + '/')
  await sp.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
  await sp.evaluate(() => (window.__httpDown = '/api/config'))
  await sp.getByRole('button', { name: /^Sessions/ }).click()
  await sp.locator('.nav-tile', { hasText: 'Settings' }).click()
  await sp.locator('.set-row', { hasText: 'Model providers' }).click()
  const down = sp.locator('.load-error', { hasText: 'Hermux unreachable' }).first()
  await down.waitFor({ timeout: 8000 }).then(() => check(true, 'unreachable: Model providers shows Hermux unreachable'), () => check(false, 'unreachable: Model providers shows Hermux unreachable'))
  await down.getByRole('button', { name: 'Setup check' }).click({ timeout: 3000 }).then(() => check(true, 'unreachable: the error offers Setup check'), () => check(false, 'unreachable: the error offers Setup check'))
  await sp.locator('.screen-title, .title', { hasText: 'Setup check' }).first().waitFor({ timeout: 5000 }).then(() => check(true, 'unreachable: Setup check opens'), () => check(false, 'unreachable: Setup check opens'))
  await sp.evaluate(() => (window.__httpDown = ''))
  await sp.locator('.screen', { has: sp.locator('.topbar .title', { hasText: /^Setup check$/ }) }).locator('.back-btn').click()
  await sp.locator('.set-row', { hasText: 'Model providers' }).waitFor({ timeout: 5000 }).then(() => check(true, 'unreachable: Back from Setup check returns to Settings'), () => check(false, 'unreachable: Back from Setup check returns to Settings'))
  await sp.close()
}
