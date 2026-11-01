// Drives the built web UI (served by web/devserver.py on :5180) against mock.cjs on :9119. Run via run.sh.
// The checks are in checks/*.cjs, one file per feature, run in file-name order against one browser and one mock: later
// files expect the chats and settings earlier ones left behind. Each file exports `async t => {}`; `t` holds the
// browser, the main page and anything a file hands to a later one.
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const { LOG, sleep, fail, failures } = require('./lib.cjs')

async function main() {
  // Pages until the first-run section play an app that has reached Hermes before: a fresh install now opens the setup
  // flow over everything at start-up (openFirstRun), which those checks are not about.
  const t = { established: true }
  // Never drive the real phone: 9119 must be the mock (an adb forward to the phone uses the same port).
  const home = await fetch('http://127.0.0.1:9119/').then(r => r.text(), () => '')
  if (!home.includes('MOCK-HERMES')) {
    console.error('127.0.0.1:9119 is not the mock (real Hermes / adb forward?). Refusing to run.')
    process.exit(3)
  }
  fs.writeFileSync(LOG, '')
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined })
  const newPage = browser.newPage.bind(browser)
  browser.newPage = async opts => {
    const p = await newPage(opts)
    if (t.established) await p.addInitScript(() => { try { if (!localStorage.getItem('hm.connectedOnce')) localStorage.setItem('hm.connectedOnce', '1') } catch { /* */ } })
    return p
  }
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } })
  page.on('pageerror', e => {
    console.log('PAGEERROR', e.message)
    fail()
  })
  await page.goto('http://127.0.0.1:5180/')
  await page.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
  await sleep(500)
  Object.assign(t, { browser, page })
  const dir = path.join(__dirname, 'checks')
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.cjs')).sort()) await require(path.join(dir, f))(t)

  await browser.close()
  console.log(failures() ? `\n${failures()} FAILED` : '\nALL PASSED')
  process.exit(failures() ? 1 : 0)
}
main().catch(e => {
  console.error(e)
  process.exit(2)
})
