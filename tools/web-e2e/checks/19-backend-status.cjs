// The Shizuku row in the Backend status sheet, and the local authentication alert banner.
const { WEB, sleep, check, mock, nativeShell } = require('../lib.cjs')

module.exports = async t => {
  const { browser } = t
  // ── Shizuku row in the Backend status sheet ──
  {
    const base = { termux: true, runCommand: true, notifications: true, batteryApp: true, batteryTermux: true, startError: '', termuxApi: true, termuxBoot: true, shizuku: true, shizukuRunning: true }
    const sp = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await sp.addInitScript(s => { window.__setup = s }, base)
    await sp.addInitScript(nativeShell)
    await sp.goto(WEB + '/')
    await sp.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    const shRow = async () => {
      await sp.locator('.conn-dot').first().click()
      await sp.locator('.status-row', { hasText: 'Shizuku' }).waitFor({ timeout: 5000 }).catch(() => {})
      await sp.locator('.status-row', { hasText: 'Checking…' }).waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
      const t = ((await sp.locator('.status-row', { hasText: 'Shizuku' }).first().textContent().catch(() => '')) || '')
      await sp.evaluate(() => window.hermesBack())
      await sleep(400)
      return t
    }
    await mock({ phone: { files: true, shizuku: 'ok' } })
    check((await shRow()).includes('Running'), 'status: Shizuku row says Running')
    check(!(await shRow()).includes('by itself'), 'status: no restart line on an older app build')
    await sp.evaluate(s => (window.__setup = { ...s, shizukuAuto: { sdk: true, wss: true, paired: true, last: 'ok' } }), base)
    check((await shRow()).includes('Restarts by itself'), 'status: Shizuku row says Restarts by itself when paired')
    await sp.evaluate(s => (window.__setup = { ...s, shizukuAuto: { sdk: true, wss: true, paired: false, last: '' } }), base)
    check((await shRow()).includes('Start it by hand after a restart'), 'status: Shizuku row says to start it by hand when not paired')
    await sp.evaluate(s => (window.__setup = s), base)
    await sp.evaluate(s => (window.__setup = { ...s, shizukuRunning: false }), base)
    { const t = await shRow(); check(t.includes('Not running'), `status: Shizuku not running (${t})`) }
    await sp.evaluate(s => (window.__setup = s), base)
    await mock({ phone: { files: true, shizuku: 'denied' } })
    check((await shRow()).includes('Termux not allowed'), 'status: Shizuku denied for Termux')
    await mock({ phone: { files: true, shizuku: 'ok' } })
    await sp.evaluate(s => (window.__setup = { ...s, shizuku: false, shizukuRunning: false }), base)
    { const t = await shRow(); check(t.includes('Not installed'), `status: Shizuku not installed (${t})`) }
    await sp.close()
    await mock({ phone: { files: true, shizuku: 'ok' } })
  }
  // ── Local authentication alert banner (the shell calls window.__hmLocalAlert; the page shows only fixed text) ──
  {
    const ap = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await ap.addInitScript(nativeShell)
    await ap.goto(WEB + '/')
    await ap.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await ap.locator('.conn-banner').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
    const banner = ap.locator('.local-alert')
    const shell = v => ap.evaluate(v => window.__hmLocalAlert && window.__hmLocalAlert(v), v)
    const text = async sel => ((await banner.locator(sel).textContent().catch(() => '')) || '').trim()
    check((await banner.count()) === 0, 'local alert: no banner before the shell says so')

    await shell('dashboard')
    await banner.waitFor({ timeout: 3000 }).catch(() => {})
    check((await banner.getAttribute('role').catch(() => '')) === 'alert', 'local alert: the dashboard banner shows, as an alert')
    check((await text('.local-alert-title')) === 'Hermux stopped talking to Hermes', 'local alert: dashboard title is the fixed text')
    check((await text('.local-alert-body')) === 'Something else on this phone answered instead of Hermes, so Hermux sent it nothing. Restart the phone to fix it.', 'local alert: dashboard body is the fixed text')
    check((await text('.local-alert-more')) === 'If this comes back, an app installed recently may be the cause.', 'local alert: dashboard extra line is the fixed text')
    const retry = banner.getByRole('button', { name: 'Try again' })
    check((await retry.count()) === 1, 'local alert: the dashboard banner has Try again')
    const asks = () => ap.evaluate(() => window.__nativeCalls.filter(c => c === 'getTokenAsync').length)
    const before = await asks()
    await retry.click()
    let after = before
    for (let i = 0; i < 40 && after === before; i++) await sleep(100), (after = await asks())
    check(after > before, 'local alert: Try again asks the shell for a fresh token (which checks the dashboard again)')
    check((await banner.count()) === 1, 'local alert: the banner stays until the shell clears it')
    // Taps while a try runs start nothing more: three taps in a row ask for one token.
    for (let i = 0; i < 30 && (await retry.isDisabled()); i++) await sleep(100)
    const before3 = await asks()
    await ap.evaluate(() => {
      const b = document.querySelector('.local-alert-retry')
      b.click()
      b.click()
      b.click()
    })
    await sleep(600)
    check((await asks()) === before3 + 1, `local alert: repeated taps run one try (${(await asks()) - before3})`)
    check(!(await retry.isDisabled()), 'local alert: Try again works again once the try has ended')
    await shell(null)
    await banner.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    check((await banner.count()) === 0, 'local alert: the banner goes when the shell clears it')

    await shell('events')
    await banner.waitFor({ timeout: 3000 }).catch(() => {})
    check((await text('.local-alert-title')) === "Hermux can't hear from Hermes", 'local alert: events title is the fixed text')
    check((await text('.local-alert-body')) === 'Another app on this phone is using the connection Hermux listens on. Restart the phone to fix it.', 'local alert: events body is the fixed text')
    check((await banner.locator('button').count()) === 0, 'local alert: the events banner has no Try again')
    await shell(null)
    await banner.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})

    // Offline: Try again reconnects. The connection opening doesn't take the banner away (a newer alert may be on);
    // only the shell's clear does.
    await mock({ drop: 20000 })
    await ap.getByPlaceholder(/^Offline/).waitFor({ timeout: 8000 })
    await shell('dashboard')
    await banner.waitFor({ timeout: 3000 }).catch(() => {})
    check((await banner.count()) === 1, 'local alert: the dashboard banner shows while offline')
    await mock({ up: true })
    const before2 = await asks()
    await banner.getByRole('button', { name: 'Try again' }).click()
    await ap.getByPlaceholder('Message Hermux').waitFor({ timeout: 10000 }).catch(() => {})
    check((await asks()) > before2, 'local alert: Try again while offline reconnects')
    check((await ap.getByPlaceholder('Message Hermux').count()) === 1 && (await banner.count()) === 1,
      'local alert: the dashboard banner stays when the connection opens')
    await shell(null)
    await banner.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    check((await banner.count()) === 0, 'local alert: then goes when the shell clears it')

    for (const v of ['ticker', '<b>dashboard</b>', 'Dashboard', 42, { kind: 'dashboard' }]) await shell(v)
    await sleep(200)
    check((await banner.count()) === 0, 'local alert: an unknown kind shows nothing')
    check(!((await ap.locator('body').textContent()) || '').includes('<b>dashboard</b>'), 'local alert: the argument is never shown')
    await ap.close()
  }
}
