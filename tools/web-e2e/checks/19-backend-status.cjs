// The Shizuku row in the Backend status sheet.
const { sleep, check, mock, nativeShell } = require('../lib.cjs')

module.exports = async t => {
  const { browser } = t
  // ── Shizuku row in the Backend status sheet ──
  {
    const base = { termux: true, runCommand: true, notifications: true, batteryApp: true, batteryTermux: true, startError: '', termuxApi: true, termuxBoot: true, shizuku: true, shizukuRunning: true }
    const sp = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await sp.addInitScript(s => { window.__setup = s }, base)
    await sp.addInitScript(nativeShell)
    await sp.goto('http://127.0.0.1:5180/')
    await sp.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
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
}
