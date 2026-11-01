// In the app shell: token and key, test build, remote debugging, Live mode, hidden display, assistant, setup, uninstall, Claude sign-in.
const fs = require('fs')
const path = require('path')
const { MOCK, WEB, calls, rpcs, sleep, check, fail, mock, nativeShell } = require('../lib.cjs')

module.exports = async t => {
  const { browser, page } = t
  // ── #19 in the app shell: the token comes asynchronously (no blocking getToken), every call carries the key ──
  const np = await browser.newPage({ viewport: { width: 375, height: 812 } })
  np.on('pageerror', e => {
    console.log('PAGEERROR (native page)', e.message)
    fail()
  })
  await np.addInitScript(nativeShell)
  const listsBefore = rpcs('session.list').length
  await np.goto(WEB + '/')
  await np.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
  await sleep(1500)
  const nc = await np.evaluate(() => window.__nativeCalls)
  check(nc.includes('getTokenAsync') && !nc.includes('getToken'), `token fetched asynchronously (${[...new Set(nc)].join(',')})`)
  check(rpcs('session.list').length > listsBefore, 'connected with it (session.list)')
  check(await np.evaluate(() => typeof window.HermesAndroid.handshake === 'undefined'), 'page only sees the key-adding wrapper')

  // ── test build (plan 13): the strip shows when appVersion ends with +devtools, never on a normal page ──
  {
    const dv = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await dv.addInitScript(() => { window.__appVersion = '0.8.66+devtools' })
    await dv.addInitScript(nativeShell)
    await dv.goto(WEB + '/')
    await dv.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    const strip = dv.getByText('Test build: remote debugging is on')
    check(await strip.isVisible(), 'devtools: a +devtools build shows the warning strip')
    const box = await strip.boundingBox()
    check(box && box.y < 40 && box.height > 0, 'devtools: the strip is at the top of the page')
    await dv.getByRole('button', { name: /^Sessions/ }).click()
    await dv.locator('.nav-tile', { hasText: 'Settings' }).click()
    await dv.locator('.screen .title', { hasText: 'Settings' }).waitFor({ timeout: 5000 })
    check(await strip.isVisible(), 'devtools: the strip stays visible over a full screen')
    check((await dv.getByText('Test build: remote debugging is on').count()) === 1 && (await dv.locator('.devtools-strip button, .devtools-strip a').count()) === 0, 'devtools: one strip, nothing to dismiss')
    await dv.close()
    check((await np.getByText('Test build: remote debugging is on').count()) === 0, 'devtools: a normal page has no strip')
  }


  // ── plan 14: Settings → About → Remote debugging (the page can only ask; it never turns anything on) ──
  {
    const bridgeSrc = require('fs').readFileSync(require('path').join(__dirname, '../../../web/src/secure-bridge.ts'), 'utf8')
    const names = [...bridgeSrc.matchAll(/'([A-Za-z]+)'/g)].map(m => m[1])
    check(names.filter(n => /^(enable|turnOn|startRemote|setRemote|allowRemote)/i.test(n) || /(enable|turnon)(remote|debug|devtools)/i.test(n)).length === 0, 'remote debugging: secure-bridge.ts lists no method that enables it')
    check(['openRemoteDebugging', 'remoteDebuggingState', 'turnOffRemoteDebugging'].every(n => names.includes(n)), 'remote debugging: the three methods are in secure-bridge.ts')
    const rdPage = async init => {
      const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
      await pg.addInitScript(init)
      await pg.addInitScript(nativeShell)
      await pg.goto(WEB + '/')
      await pg.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
      await pg.getByRole('button', { name: /^Sessions/ }).click()
      await pg.locator('.nav-tile', { hasText: 'Settings' }).click()
      await pg.locator('.screen .title', { hasText: 'Settings' }).waitFor({ timeout: 5000 })
      return pg
    }
    const strip = pg => pg.locator('.devtools-strip')
    // not available (Developer options off): no row, no strip
    let rd = await rdPage(() => { window.__rd = { available: false, on: false, minutesLeft: 0 } })
    check((await rd.getByText('Remote debugging', { exact: true }).count()) === 0, 'remote debugging: no row while Developer options are off')
    check((await strip(rd).count()) === 0, 'remote debugging: no strip while off')
    await rd.close()
    // off: row says Off, tap asks the shell to open its confirmation (and nothing else)
    rd = await rdPage(() => { window.__rd = { available: true, on: false, minutesLeft: 0 } })
    const rowOff = rd.locator('button, .row', { hasText: 'Remote debugging' }).first()
    check(await rowOff.isVisible(), 'remote debugging: the row shows when Developer options are on')
    check((await rowOff.innerText()).includes('Off'), 'remote debugging: the row says Off')
    check((await strip(rd).count()) === 0, 'remote debugging: no strip while off (available)')
    await rowOff.click()
    check(JSON.stringify(await rd.evaluate(() => window.__rdCalls)) === '["open"]', 'remote debugging: tapping Off calls openRemoteDebugging only')
    // the shell turns it on (after the lock screen): the page follows when the shell says so
    await rd.evaluate(() => { window.__rd = { available: true, on: true, minutesLeft: 42 }; window.dispatchEvent(new Event('hm-devtools')) })
    await rd.locator('.set-sub', { hasText: 'On · 42 min left' }).waitFor({ timeout: 5000 })
    check(await strip(rd).isVisible() && (await strip(rd).innerText()).includes('Remote debugging is on · 42 min left'), 'remote debugging: the strip shows while on')
    await rd.locator('button, .row', { hasText: 'Remote debugging' }).first().click()
    await rd.locator('.devtools-strip').waitFor({ state: 'detached', timeout: 5000 })
    check(JSON.stringify(await rd.evaluate(() => window.__rdCalls)) === '["open","off"]', 'remote debugging: tapping On calls turnOffRemoteDebugging')
    check((await strip(rd).count()) === 0, 'remote debugging: the strip goes when it is turned off')
    await rd.close()
    // already on when the page loads
    rd = await rdPage(() => { window.__rd = { available: true, on: true, minutesLeft: 42 } })
    check((await rd.locator('.set-sub', { hasText: 'On · 42 min left' }).count()) === 1 && (await strip(rd).isVisible()), 'remote debugging: shows "On · 42 min left" and the strip when already on')
    await rd.close()
  }

  // ── #33 Live mode: an approval is read out and answered by voice ──
  await np.evaluate(() => window.hermesShortcut('live'))
  await np.waitForFunction(() => window.__nativeCalls.includes('startListening'), null, { timeout: 5000 })
  await np.evaluate(() => window.__hmVoice('final', 'run the thing'))
  await np.waitForFunction(() => (window.__spoken || []).some(t => /Allow or deny/.test(t)), null, { timeout: 8000 }).catch(() => {})
  const spoken = await np.evaluate(() => (window.__spoken || []).join(' | '))
  check(/Hermes needs your permission\. Allow or deny\?/.test(spoken) && !/temp folder|rm -rf/.test(spoken), `approval asked in one short question, the command isn't read out (${spoken})`)
  await sleep(300)
  await np.evaluate(() => window.__hmVoice('final', 'yes allow it'))
  await sleep(2800)
  const va = calls().filter(c => c.answer === 'srv-approval-1')
  check(va.length === 1 && va[0].result && va[0].result.choice === 'once', `answered by voice (${JSON.stringify(va)})`)
  // Over the lock screen (the shell calls hermesLockView): talking works, allowing asks for an unlock first, Deny goes
  // through, the drawer asks for an unlock instead of opening, and ending Live mode puts the lock screen back.
  {
    await np.locator('.live-bar').getByRole('button', { name: 'End' }).click()
    check(!(await np.evaluate(() => window.__nativeCalls)).includes('leaveLockScreen'), 'unlocked: ending Live mode does not touch the lock screen')
    // Settings → default access Auto: a chat made over the lock screen must still ask (talking only).
    await np.evaluate(() => localStorage.setItem('hm.defaultAccess.v1', 'auto'))
    const yoloOn = () => rpcs('config.set').filter(r => r.params.key === 'yolo' && r.params.value === '1').length
    const autoPuts = () => calls().filter(c => c.http === 'PUT' && c.path === '/api/plugins/hermes-mobile/auto' && c.body && c.body.mode === 'auto').length
    const yoloBefore = yoloOn()
    const autoBefore = autoPuts()
    await np.evaluate(() => window.hermesLockView(true))
    const unlocks = () => np.evaluate(() => window.__nativeCalls.filter(c => c === 'requestUnlock').length)
    const listens = await np.evaluate(() => window.__nativeCalls.filter(c => c === 'startListening').length)
    await np.evaluate(() => window.hermesShortcut('live'))
    await np.waitForFunction(n => window.__nativeCalls.filter(c => c === 'startListening').length > n, listens, { timeout: 5000 })
    await np.evaluate(() => window.__hmVoice('final', 'run the thing'))
    await np.locator('.sheet .sheet-title', { hasText: 'Approve' }).waitFor({ timeout: 8000 }).catch(() => {})
    await np.waitForFunction(() => (window.__spoken || []).filter(t => /Allow or deny/.test(t)).length >= 2, null, { timeout: 8000 }).catch(() => {})
    await sleep(300)
    await np.evaluate(() => window.__hmVoice('final', 'yes allow it'))
    await sleep(2800)
    check(yoloOn() === yoloBefore && autoPuts() === autoBefore, `locked: default Auto access is not applied to the Live chat (yolo on ${yoloOn() - yoloBefore}, auto PUTs ${autoPuts() - autoBefore})`)
    check(calls().filter(c => c.answer === 'srv-approval-1').length === 1, 'locked: "allow" by voice is not sent')
    check((await unlocks()) === 1, `locked: "allow" by voice asks for an unlock (${await unlocks()})`)
    await np.locator('.sheet').getByRole('button', { name: 'Allow once' }).click()
    await sleep(300)
    check(calls().filter(c => c.answer === 'srv-approval-1').length === 1, 'locked: Allow once on the sheet is not sent')
    check((await unlocks()) === 2, `locked: Allow once asks for an unlock (${await unlocks()})`)
    await np.locator('.sheet').getByRole('button', { name: 'Deny' }).click()
    await sleep(300)
    const dn = calls().filter(c => c.answer === 'srv-approval-1')
    check(dn.length === 2 && dn[1].result && dn[1].result.choice === 'deny', `locked: Deny goes through (${JSON.stringify(dn.slice(1))})`)
    await np.getByRole('button', { name: /^Sessions/ }).click().catch(() => {})
    await sleep(300)
    check((await np.locator('.drawer.open, .drawer-open').count()) === 0 && (await unlocks()) === 3, `locked: the chat list asks for an unlock instead of opening (${await unlocks()})`)
    check(await np.locator('.live-bar').count() === 1, 'locked: still talking in Live mode')
    await np.locator('.live-bar').getByRole('button', { name: 'End' }).click()
    await sleep(200)
    check((await np.evaluate(() => window.__nativeCalls)).includes('leaveLockScreen'), 'locked: ending Live mode puts the lock screen back')
    await np.evaluate(() => window.hermesLockView(false))
    await np.evaluate(() => localStorage.removeItem('hm.defaultAccess.v1'))
    await np.evaluate(() => window.hermesShortcut('live'))
    await np.locator('.live-bar').waitFor({ timeout: 5000 }).catch(() => {})
  }
  // A chat created by its first message tells the service it is on screen (returning to the app = seen).
  const seenNew = await np.evaluate(() => window.__seen || [])
  check(seenNew.some(id => /^s-new/.test(id)), `new chat reported on screen (${JSON.stringify(seenNew)})`)
  // Opening another chat ends live mode (it would otherwise keep listening and send there).
  check(await np.locator('.live-bar').count() === 1, 'live mode still on before switching')
  await np.evaluate(() => window.hermesOpenSession('s-6'))
  await np.locator('.live-bar').waitFor({ state: 'detached', timeout: 5000 }).then(() => check(true, 'opening another chat ends live mode'), () => check(false, 'opening another chat ends live mode'))
  check(await np.evaluate(() => (window.__seen || []).slice(-1)[0] === 's-6'), 'opened chat reported on screen')


  // ── Hermes working in an app on a hidden display: card above the composer, viewer sheet, bounded frame polling ──
  {
    const nAsked = () => np.evaluate(() => (window.__bgAsked || []).length)
    const setBg = st => np.evaluate(s => window.__hmBg && window.__hmBg(s), st)
    const mine = a => ({ session: 's-6', pkg: 'com.example.notes', label: 'Notes', action: 'tapping "New note"', since: Date.now(), ...a })
    await np.evaluate(() => {
      window.alert = window.confirm = window.prompt = () => ((window.__dialogs ||= []).push(1), null)
    })
    await np.locator('.msg').first().waitFor({ timeout: 5000 }).catch(() => {})
    await setBg(mine({ session: 's-other' }))
    await sleep(1300)
    check((await np.locator('.bg-card').count()) === 0 && (await nAsked()) === 0, 'bg app of another chat: no card, no frame requests')
    await setBg(mine())
    await np.locator('.bg-card').waitFor({ timeout: 3000 }).then(() => check(true, 'bg app of this chat: card shows'), () => check(false, 'bg app of this chat: card shows'))
    const ct = (await np.locator('.bg-card').textContent({ timeout: 1500 }).catch(() => '')) || ''
    check(/Using Notes/.test(ct) && /tapping "New note"/.test(ct), `card names the app and the action (${ct})`)
    await np.waitForFunction(() => (window.__bgAsked || []).length >= 3, null, { timeout: 5000 }).catch(() => {})
    await np.locator('.bg-thumb img').waitFor({ timeout: 3000 }).then(() => check(true, 'card shows the live thumbnail'), () => check(false, 'card shows the live thumbnail'))
    {
      const asked = await np.evaluate(() => window.__bgAsked || [])
      const gaps = asked.slice(1).map((a, i) => a.t - asked[i].t)
      check(asked.length >= 3 && gaps.every(g => g >= 450), `frame requests are at least 500 ms apart (${gaps.join(',')})`)
      check((await np.evaluate(() => window.__bgMaxInflight)) === 1, 'never two frame requests in flight')
      check(asked.length > 0 && asked.every(a => a.w <= 240), `the thumbnail asks for a small frame (${asked.length ? asked[0].w : 'none'})`)
    }
    await np.locator('.bg-card').click({ timeout: 1500 }).catch(() => {})
    const viewer = np.locator('.bg-viewer')
    await viewer.waitFor({ timeout: 3000 }).then(() => check(true, 'tapping the card opens the viewer'), () => check(false, 'tapping the card opens the viewer'))
    check((await viewer.getByRole('button', { name: 'Take over' }).count()) === 1 && (await viewer.getByRole('button', { name: 'Stop' }).count()) === 1, 'viewer has Take over and Stop')
    check(/tapping "New note"/.test((await viewer.textContent({ timeout: 1500 }).catch(() => '')) || ''), 'viewer shows the action caption')
    await np.waitForFunction(() => (window.__bgAsked || []).length > 0 && window.__bgAsked.slice(-1)[0].w >= 400, null, { timeout: 3000 }).then(() => check(true, 'viewer asks for a bigger frame'), () => check(false, 'viewer asks for a bigger frame'))
    check((await np.locator('.bg-card select, .bg-viewer select, .bg-viewer input, .bg-viewer textarea, .bg-card input, dialog').count()) === 0, 'card and viewer use no native controls')
    await np.evaluate(() => window.hermesBack())
    await viewer.waitFor({ state: 'detached', timeout: 3000 }).then(() => check(true, 'Back closes the viewer'), () => check(false, 'Back closes the viewer'))
    await sleep(900)
    check(await np.evaluate(() => (window.__bgAsked || []).slice(-1).every(a => a.w <= 240) && (window.__bgAsked || []).length > 0), 'after closing the viewer only the small thumbnail is requested')
    check((await np.locator('.bg-card').count()) === 1, 'card stays after closing the viewer')
    // Page hidden: no more requests; visible again: they resume.
    await np.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await sleep(500)
    const hiddenAt = await nAsked()
    await sleep(1600)
    check((await nAsked()) === hiddenAt, `no frame requests while the page is hidden (${hiddenAt})`)
    await np.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await np.waitForFunction(n => (window.__bgAsked || []).length > n, hiddenAt, { timeout: 3000 }).then(() => check(true, 'frame requests resume when the page is visible'), () => check(false, 'frame requests resume when the page is visible'))
    // Take over: one bridge call; the shell then clears the state, the card goes and the polling stops.
    await np.locator('.bg-card').click({ timeout: 1500 }).catch(() => {})
    await viewer.getByRole('button', { name: 'Take over' }).click({ timeout: 1500 }).catch(() => {})
    await np.locator('.bg-card').waitFor({ state: 'detached', timeout: 3000 }).then(() => check(true, 'card disappears once the state is cleared'), () => check(false, 'card disappears once the state is cleared'))
    check(JSON.stringify(await np.evaluate(() => window.__bgActs)) === '["take_over"]', `Take over calls bgAction once (${JSON.stringify(await np.evaluate(() => window.__bgActs))})`)
    check((await viewer.count()) === 0, 'viewer closes after Take over')
    await sleep(400)
    const clearedAt = await nAsked()
    await sleep(1500)
    check((await nAsked()) === clearedAt, 'no frame requests once there is no bg app')
    // Stop.
    await setBg(mine({ action: 'typing' }))
    await np.locator('.bg-card').click({ timeout: 1500 }).catch(() => {})
    await viewer.getByRole('button', { name: 'Stop' }).click({ timeout: 1500 }).catch(() => {})
    await viewer.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    check(JSON.stringify(await np.evaluate(() => window.__bgActs)) === '["take_over","stop"]', 'Stop calls bgAction("stop")')
    // The app comes back (resume push) for this chat, then another chat is opened: card and polling go.
    await setBg(mine())
    await np.locator('.bg-card').waitFor({ timeout: 3000 }).catch(() => {})
    await np.evaluate(() => window.hermesOpenSession('s-5'))
    await np.locator('.bg-card').waitFor({ state: 'detached', timeout: 5000 }).then(() => check(true, 'opening another chat hides the card'), () => check(false, 'opening another chat hides the card'))
    await sleep(500)
    const swAt = await nAsked()
    await sleep(1500)
    check((await nAsked()) === swAt, 'no frame requests for a chat without the bg app')
    await setBg(null)
    check((await np.evaluate(() => window.__dialogs || [])).length === 0, 'no alert/confirm dialogs')
    // Settings → Background apps
    await np.getByRole('button', { name: /^Sessions/ }).click()
    await np.locator('.nav-tile', { hasText: 'Settings' }).click()
    const bgRow = np.locator('.set-row', { hasText: 'Allow banking, payment, password and 2FA apps' })
    await bgRow.waitFor({ timeout: 5000 }).then(() => check(true, 'Settings has the Background apps row'), () => check(false, 'Settings has the Background apps row'))
    check(/Off: Hermes won't open them in the background/.test((await bgRow.textContent({ timeout: 1500 }).catch(() => '')) || ''), 'row explains what Off means')
    check((await bgRow.getByRole('switch').getAttribute('aria-checked', { timeout: 1500 }).catch(() => null)) === 'false', 'switch starts off')
    await bgRow.click({ timeout: 1500 }).catch(() => {})
    await sleep(500)
    {
      const puts = calls().filter(c => c.http === 'PUT' && c.path === '/api/plugins/hermes-mobile/bgapps')
      check(puts.length === 1 && puts[0].body.allow_sensitive === true, `toggling PUTs allow_sensitive (${JSON.stringify(puts.map(c => c.body))})`)
      check((await bgRow.getByRole('switch').getAttribute('aria-checked', { timeout: 1500 }).catch(() => null)) === 'true', 'switch shows on')
    }
    // Settings → Replies: cards in replies (plugin /openui), on by default
    const ouiRow = np.locator('.set-row', { hasText: 'Dynamic UI' })
    await ouiRow.waitFor({ timeout: 5000 }).then(() => check(true, 'Settings has the cards row'), () => check(false, 'Settings has the cards row'))
    check((await ouiRow.getByRole('switch').getAttribute('aria-checked', { timeout: 1500 }).catch(() => null)) === 'true', 'cards: on by default')
    await ouiRow.click({ timeout: 1500 }).catch(() => {})
    await sleep(500)
    {
      const puts = calls().filter(c => c.http === 'PUT' && c.path === '/api/plugins/hermes-mobile/openui')
      check(puts.length === 1 && puts[0].body.enabled === false, `cards toggle PUTs enabled:false (${JSON.stringify(puts.map(c => c.body))})`)
    }
    await ouiRow.click({ timeout: 1500 }).catch(() => {}) // back on for the rest of the run
    await np.evaluate(() => window.hermesBack())
    await fetch(MOCK + '/__mock', { method: 'POST', body: JSON.stringify({ bgapps: { allow_sensitive: false, available: false, reason: 'Needs Shizuku running' } }) })
    await np.getByRole('button', { name: /^Sessions/ }).click()
    await np.locator('.nav-tile', { hasText: 'Settings' }).click()
    const noRow = np.locator('.set-row', { hasText: 'Needs Shizuku running' })
    await noRow.waitFor({ timeout: 5000 }).then(() => check(true, 'unavailable: the reason is the row text'), () => check(false, 'unavailable: the reason is the row text'))
    check((await noRow.getByRole('switch').count()) === 0, 'unavailable: no switch')
    check((await np.locator('.set-row select, .set-row input').count()) === 0, 'settings row uses no native controls')
    await np.evaluate(() => window.hermesBack())
    await fetch(MOCK + '/__mock', { method: 'POST', body: JSON.stringify({ bgapps: { available: true, reason: undefined } }) })
  }

  // ── Phone assistant: Settings → Voice opens the system picker and shows the role once Hermes holds it ──
  await np.getByRole('button', { name: /^Sessions/ }).click()
  await np.locator('.nav-tile', { hasText: 'Settings' }).click()
  await np.locator('.set-row', { hasText: 'Voice' }).first().click()
  const ar = np.locator('.set-row', { hasText: 'Use Hermes as phone assistant' })
  await ar.waitFor({ timeout: 5000 })
  check(/Off/.test((await ar.textContent()) || ''), `assistant row says Off (${await ar.textContent()})`)
  await ar.click()
  check((await np.evaluate(() => window.__nativeCalls)).includes('openAssistantSettings'), 'assistant row opens the system picker')
  await np.evaluate(() => {
    window.__assistant = true
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await sleep(200)
  check(/On/.test((await ar.textContent()) || ''), `assistant row says On after returning (${await ar.textContent()})`)
  // "Talk to Hermes on the lock screen": off by default, each change saved and pushed to the shell.
  const lr = np.locator('.set-row', { hasText: 'Talk to Hermes on the lock screen' })
  await lr.waitFor({ timeout: 5000 }).then(() => check(true, 'lock-screen row shown'), () => check(false, 'lock-screen row shown'))
  check((await lr.getByRole('switch').getAttribute('aria-checked')) === 'false', 'lock-screen row is off by default')
  check(/asks you to unlock first/.test((await np.locator('.set-section', { has: ar }).locator('.set-foot').textContent()) || ''), 'footer says the lock screen asks to unlock first')
  await lr.click()
  check((await lr.getByRole('switch').getAttribute('aria-checked')) === 'true', 'lock-screen row turns on')
  check(JSON.stringify(await np.evaluate(() => window.__lockAssist)) === '[true]' && (await np.evaluate(() => localStorage.getItem('hm.lockAssist.v1'))) === '1', `on: pushed to the shell and saved (${JSON.stringify(await np.evaluate(() => window.__lockAssist))})`)
  await lr.click()
  check(JSON.stringify(await np.evaluate(() => window.__lockAssist)) === '[true,false]' && (await np.evaluate(() => localStorage.getItem('hm.lockAssist.v1'))) === '0', `off again: pushed and saved (${JSON.stringify(await np.evaluate(() => window.__lockAssist))})`)
  await sleep(200)
  await np.evaluate(() => window.hermesBack())
  await sleep(200)
  await np.evaluate(() => window.hermesBack())

  // ── setup check with the Android checks: ✗ items have buttons that ask the shell to fix them ──
  await np.evaluate(() => (window.__setup = { termux: true, runCommand: false, notifications: true, batteryApp: false, batteryTermux: true, startError: '' }))
  await np.evaluate(() => window.hermesBack && window.hermesBack())
  await np.locator('.conn-dot').click()
  await np.getByRole('button', { name: 'Setup check' }).click()
  await np.locator('.setup-hero-title', { hasText: '2 things to fix' }).waitFor({ timeout: 5000 }).then(() => check(true, 'native: two failing checks counted'), () => check(false, 'native: two failing checks counted'))
  // The Hermes-side checks answer a moment later than the Android ones.
  await np.waitForFunction(() => document.querySelectorAll('.setup-item.ok').length >= 6, null, { timeout: 6000 }).catch(() => {})
  check((await np.locator('.setup-item.ok').count()) >= 6, `native: the rest are ✓ (${await np.locator('.setup-item.ok').count()})`)
  await np.locator('.setup-item.bad', { hasText: 'may start Hermes' }).getByRole('button', { name: 'Allow' }).click()
  await np.locator('.setup-item.bad', { hasText: 'run in the background' }).getByRole('button', { name: 'Allow' }).click()
  check(JSON.stringify(await np.evaluate(() => window.__fixes)) === '["permissions","battery-app"]', `fix buttons ask the shell (${JSON.stringify(await np.evaluate(() => window.__fixes))})`)
  await np.evaluate(() => (window.__setup = { termux: true, runCommand: true, notifications: true, batteryApp: true, batteryTermux: true, startError: '' }))
  await np.locator('.setup-hero-title', { hasText: 'All set' }).waitFor({ timeout: 6000 }).then(() => check(true, 'checks again by itself: All set'), () => check(false, 'checks again by itself: All set'))
  // Hermes's access to the phone: a missing app is told by Android, the rest by the plugin.
  check((await np.locator('.setup-item.ok', { hasText: 'see and use the screen' }).count()) === 1, 'phone access: Shizuku ✓ from the plugin')
  // Shizuku battery step: Android can stop Shizuku in the background; a recommended row with a button to its app info.
  await np.evaluate(() => (window.__setup = { ...window.__setup, shizuku: true, batteryShizuku: false }))
  const batRow = np.locator('.setup-item', { hasText: 'Shizuku may run in the background' })
  await batRow.waitFor({ timeout: 6000 }).then(() => check(true, 'shizuku battery: the row appears when Shizuku is limited'), () => check(false, 'shizuku battery: the row appears when Shizuku is limited'))
  check((await np.locator('.setup-item.bad', { hasText: 'Shizuku may run in the background' }).count()) === 1, 'shizuku battery: the row is not ✓ while Shizuku is limited')
  await batRow.getByRole('button', { name: 'Open Shizuku settings' }).click()
  check((await np.evaluate(() => window.__fixes)).slice(-1)[0] === 'battery-shizuku', `shizuku battery: the button asks the shell for battery-shizuku (${JSON.stringify((await np.evaluate(() => window.__fixes)).slice(-1))})`)
  await np.evaluate(() => (window.__setup = { ...window.__setup, batteryShizuku: true }))
  await np.locator('.setup-item.ok', { hasText: 'Shizuku may run in the background' }).waitFor({ timeout: 6000 }).then(() => check(true, 'shizuku battery: ✓ once Shizuku is unrestricted'), () => check(false, 'shizuku battery: ✓ once Shizuku is unrestricted'))
  // "Shizuku starts by itself" (Android 11+): required row once Shizuku works; states come from setupState().shizukuAuto.
  {
    const autoRow = np.locator('.setup-item', { hasText: 'Shizuku starts by itself' })
    const setAuto = a => np.evaluate(a => (window.__setup = { ...window.__setup, shizuku: true, batteryShizuku: true, ...(a ? { shizukuAuto: a } : { shizukuAuto: undefined }) }), a)
    await setAuto(null)
    await sleep(500)
    check((await autoRow.count()) === 0, 'shizuku auto: no row on an older app build (no shizukuAuto)')
    await setAuto({ sdk: true, wss: true, paired: true, last: 'ok' })
    await np.locator('.setup-item.ok', { hasText: 'Shizuku starts by itself' }).waitFor({ timeout: 6000 }).then(() => check(true, 'shizuku auto: ✓ when paired and allowed'), () => check(false, 'shizuku auto: ✓ when paired and allowed'))
    await setAuto({ sdk: true, wss: true, paired: false, last: 'not-paired' })
    await np.locator('.setup-item.bad', { hasText: 'Shizuku starts by itself' }).waitFor({ timeout: 6000 }).then(() => check(true, 'shizuku auto: ✗ when not paired'), () => check(false, 'shizuku auto: ✗ when not paired'))
    check(((await autoRow.textContent()) || '').includes('Pair Termux with Wireless debugging once'), 'shizuku auto: the help says the user pairs Termux')
    await autoRow.getByRole('button', { name: 'Start pairing' }).click()
    check((await np.evaluate(() => window.__fixes)).slice(-1)[0] === 'shizuku-pair', `shizuku auto: Start pairing asks the shell for shizuku-pair (${JSON.stringify((await np.evaluate(() => window.__fixes)).slice(-1))})`)
    check(((await autoRow.textContent()) || '').includes('Allow wireless debugging on this network') === false, 'shizuku auto: no trust hint before Android asked')
    await setAuto({ sdk: true, wss: true, paired: false, last: 'untrusted-network' })
    await np.locator('.setup-item.bad', { hasText: 'Allow wireless debugging on this network' }).waitFor({ timeout: 6000 }).then(() => check(true, 'shizuku auto: untrusted network help names the Android question'), () => check(false, 'shizuku auto: untrusted network help names the Android question'))
    await setAuto({ sdk: true, wss: false, paired: true, last: '' })
    await np.locator('.setup-item.bad', { hasText: 'Run the installer again' }).waitFor({ timeout: 6000 }).then(() => check(true, 'shizuku auto: ✗ with "Run the installer again" when the app lacks the permission'), () => check(false, 'shizuku auto: ✗ with "Run the installer again" when the app lacks the permission'))
    check((await autoRow.getByRole('button', { name: 'Set up' }).count()) === 0, 'shizuku auto: no Set up button when only the installer can fix it')
    await setAuto({ sdk: false, wss: false, paired: false, last: '' })
    await autoRow.waitFor({ state: 'detached', timeout: 6000 }).then(() => check(true, 'shizuku auto: hidden on Android 10 and older'), () => check(false, 'shizuku auto: hidden on Android 10 and older'))
    // On Android 10 and older the Shizuku row says it has to be started from a computer after each restart.
    await fetch(MOCK + '/__mock', { method: 'POST', body: JSON.stringify({ phone: { files: true, shizuku: 'off' } }) })
    await setAuto({ sdk: true, wss: true, paired: true, last: 'ok' })
    await np.locator('.setup-item.bad', { hasText: 'see and use the screen' }).waitFor({ timeout: 6000 }).catch(() => {})
    check(!((await np.locator('.setup-item.bad', { hasText: 'see and use the screen' }).textContent().catch(() => '')) || '').includes('Android 10'), 'shizuku auto: no Android 10 sentence on Android 11+')
    await setAuto({ sdk: false, wss: false, paired: false, last: '' })
    await np.locator('.setup-item.bad', { hasText: 'Android 10 and older' }).waitFor({ timeout: 6000 }).then(() => check(true, 'shizuku auto: Shizuku row says Android 10 and older needs a computer'), () => check(false, 'shizuku auto: Shizuku row says Android 10 and older needs a computer'))
    await fetch(MOCK + '/__mock', { method: 'POST', body: JSON.stringify({ phone: { files: true, shizuku: 'ok' } }) })
    await setAuto(null)
  }
  await np.evaluate(() => (window.__setup = { ...window.__setup, termuxApi: false, shizuku: true }))
  await fetch(MOCK + '/__mock', { method: 'POST', body: JSON.stringify({ phone: { files: false, shizuku: 'off' } }) })
  await np.locator('.setup-hero-title', { hasText: '3 things to fix' }).waitFor({ timeout: 6000 }).then(() => check(true, 'phone access: files, Termux:API and Shizuku counted'), () => check(false, 'phone access: files, Termux:API and Shizuku counted'))
  await np.locator('.setup-item.bad', { hasText: 'Termux:API' }).getByRole('button', { name: 'Get Termux:API' }).click()
  await np.locator('.setup-item.bad', { hasText: 'Shizuku' }).getByRole('button', { name: 'Open Shizuku' }).click()
  await np.locator('.setup-item.bad', { hasText: 'your files' }).getByRole('button', { name: 'Restart Hermes' }).click()
  const fx = JSON.stringify((await np.evaluate(() => window.__fixes)).slice(-3))
  check(fx === '["get-termux-api","open-shizuku","restart-hermes"]', `phone access fix buttons (${fx})`)
  await fetch(MOCK + '/__mock', { method: 'POST', body: JSON.stringify({ phone: { files: true, shizuku: 'ok' } }) })

  // ── Settings → Uninstall Hermes: what goes is listed, backup offered (keys off), typed confirm, the Termux cleanup
  //    first (a failed backup removes nothing and can be retried), then each app in order, this app last ──
  {
    await np.evaluate(() => {
      window.__setup = { termux: true, runCommand: true, notifications: true, batteryApp: true, batteryTermux: true, startError: '', termuxApi: true, termuxBoot: true, shizuku: true }
      localStorage.setItem('hm.theme', 'oled')
      window.hermesBack && window.hermesBack()
    })
    await np.getByRole('button', { name: /^Sessions/ }).click()
    await np.locator('.nav-tile', { hasText: 'Settings' }).click()
    const unRow = np.locator('.set-row', { hasText: 'Uninstall Hermes' })
    await unRow.waitFor({ timeout: 5000 }).then(() => check(true, 'uninstall: Settings has the Uninstall Hermes row'), () => check(false, 'uninstall: Settings has the Uninstall Hermes row'))
    check((await np.locator('.set-heading', { hasText: 'Danger zone' }).count()) === 1, 'uninstall: in its own Danger zone section')
    await unRow.click()
    const sheet = np.locator('.sheet', { hasText: 'Uninstall Hermes' }).last()
    await sheet.locator('.setup-title', { hasText: 'Debian' }).first().waitFor({ timeout: 3000 }).catch(() => {})
    const listed = (await sheet.locator('.setup-list .setup-title').allTextContents()).join(' | ')
    const squeezed = await sheet.locator('.setup-list').first().evaluate(el => el.scrollHeight - el.clientHeight)
    check(squeezed <= 1, `uninstall: the list is shown whole, not squeezed into a scroll box (${squeezed}px hidden)`)
    check(['Hermes, with all chats', 'Debian', 'installer’s files', 'phone setting', 'Termux:API', 'Termux:Boot', 'Shizuku', 'App: Termux', 'Hermes Mobile'].every(t => listed.includes(t)), `uninstall: lists everything that goes (${listed})`)
    const bk = sheet.locator('.set-row', { hasText: 'Save a backup to Downloads' })
    const ky = sheet.locator('.set-row', { hasText: 'Include API keys and sign-ins' })
    check((await bk.getByRole('switch').getAttribute('aria-checked')) === 'true', 'uninstall: backup offered, on by default')
    check((await ky.getByRole('switch').getAttribute('aria-checked')) === 'false', 'uninstall: keys left out by default')
    check(/left out/.test((await ky.textContent()) || ''), 'uninstall: says .env/auth.json are left out')
    check((await sheet.locator('select, input[type=checkbox], input[type=radio]').count()) === 0, 'uninstall: no native controls')
    check(!(await np.evaluate(() => window.__unLog || [])).length, 'uninstall: nothing called before confirming')
    await sheet.getByRole('button', { name: 'Uninstall…' }).click()
    const dlg = np.locator('.dialog', { hasText: 'Uninstall Hermes?' })
    await dlg.waitFor({ timeout: 3000 })
    const okBtn = dlg.getByRole('button', { name: 'Uninstall', exact: true })
    check(await okBtn.isDisabled(), 'uninstall: confirm disabled until typed')
    await dlg.locator('input').fill('uninst')
    check(await okBtn.isDisabled(), 'uninstall: a partial word does not confirm')
    await dlg.locator('input').fill('uninstall')
    await okBtn.click()
    await sheet.locator('.uninstall-running').waitFor({ timeout: 3000 }).then(() => check(true, 'uninstall: progress shown while Termux works'), () => check(false, 'uninstall: progress shown while Termux works'))
    let log = await np.evaluate(() => window.__unLog || [])
    const st0 = log[0] && log[0].start
    check(log.length === 1 && st0 && st0.backup === true && st0.keys === false, `uninstall: cleanup started with backup, without keys (${JSON.stringify(log)})`)
    check(st0 && JSON.parse(st0.settings).settings['hm.theme'] === 'oled', 'uninstall: the app settings go into the backup')
    // the backup fails: nothing removed, the reason, Try again
    await np.evaluate(() => {
      window.__un = { started: false, running: false, removed: false, result: { exit: 3, stdout: "HMUNINSTALL STEP stop Stopping Hermes\nHMUNINSTALL OK stop 1\nHMUNINSTALL STEP backup x\nHMUNINSTALL FAIL backup can't write to Downloads (does Termux have access to files?); nothing was removed\n" } }
      window.hermesUninstallDone()
    })
    await sheet.locator('.uninstall-err', { hasText: 'Stopped before removing anything' }).waitFor({ timeout: 3000 }).then(() => check(true, 'uninstall: failed backup says nothing was removed'), () => check(false, 'uninstall: failed backup says nothing was removed'))
    check((await sheet.locator('.uninstall-apps').count()) === 0, 'uninstall: no app buttons after a failed backup')
    await sheet.getByRole('button', { name: 'Try again' }).click()
    log = await np.evaluate(() => window.__unLog || [])
    check(log.length === 2 && log[1].start && log[1].start.backup === true, 'uninstall: Try again runs the cleanup again (with the backup)')
    await np.evaluate(() => {
      window.__un = { started: true, running: false, removed: true, result: { exit: 0, stdout: [
        'HMUNINSTALL STEP stop Stopping Hermes', 'HMUNINSTALL OK stop 3', 'HMUNINSTALL STEP backup x',
        'HMUNINSTALL BACKUP /storage/emulated/0/Download/hermes-backup-20261023-101500.tar.gz', 'HMUNINSTALL OK backup ok',
        'HMUNINSTALL STEP android x', "HMUNINSTALL SKIP android Shizuku isn't running", 'HMUNINSTALL STEP debian x', 'HMUNINSTALL OK debian removed',
        'HMUNINSTALL STEP files x', 'HMUNINSTALL OK files', 'HMUNINSTALL STEP termux x', 'HMUNINSTALL OK termux', 'HMUNINSTALL DONE'].join('\n') } }
      window.hermesUninstallDone()
    })
    await sheet.locator('.uninstall-apps').waitFor({ timeout: 3000 }).then(() => check(true, 'uninstall: after the cleanup the apps are next'), () => check(false, 'uninstall: after the cleanup the apps are next'))
    check(/hermes-backup-20261023-101500\.tar\.gz/.test((await sheet.textContent()) || ''), 'uninstall: names the backup file')
    check((await sheet.locator('[data-step=debian][data-state=ok]').count()) === 1 && (await sheet.locator('[data-step=android][data-state=skip]').count()) === 1, 'uninstall: each step’s outcome (Debian ✓, phone setting skipped)')
    const field = { 'termux-api': 'termuxApi', 'termux-boot': 'termuxBoot', shizuku: 'shizuku', termux: 'termux' }
    for (const [id, name] of [['termux-api', 'Termux:API'], ['termux-boot', 'Termux:Boot'], ['shizuku', 'Shizuku'], ['termux', 'Termux']]) {
      const b = sheet.locator(`[data-app="${id}"]`).getByRole('button', { name: `Uninstall ${name}`, exact: true })
      check(/danger-solid/.test((await b.getAttribute('class')) || ''), `uninstall: ${name} is the next one`)
      await b.click()
      await sleep(100)
      // Android's prompt removed it; back in the app the shell says so
      await np.evaluate(f => {
        window.__setup = { ...window.__setup, [f]: false }
        window.hermesSetupChanged()
      }, field[id])
      await sheet.locator(`[data-app="${id}"]`, { hasText: 'Removed' }).waitFor({ timeout: 3000 }).catch(() => {})
    }
    const self = sheet.locator('[data-app="self"]')
    check(/Removed so far: Hermes, its chats and Debian, the installer’s files, Termux:API, Termux:Boot, Shizuku, Termux/.test((await self.textContent()) || ''), `uninstall: the last screen says what was removed (${await self.textContent()})`)
    check((await np.locator('.dialog').count()) === 0, 'uninstall: Termux after a finished cleanup needs no extra warning')
    await self.getByRole('button', { name: 'Uninstall Hermes Mobile' }).click()
    log = await np.evaluate(() => window.__unLog || [])
    check(JSON.stringify(log.slice(2).map(x => x.app)) === '["termux-api","termux-boot","shizuku","termux","self"]', `uninstall: apps in order, this app last (${JSON.stringify(log.slice(2))})`)
    check((await np.evaluate(() => window.__dialogs || [])).length === 0, 'uninstall: no alert/confirm dialogs')
    await np.evaluate(() => {
      window.hermesBack()
      delete window.__un
    })
    // Uninstalling Termux makes Android kill this app (RUN_COMMAND is Termux's permission): opened again, the
    // app goes straight back to the uninstall sheet so the last steps aren't lost.
    await np.evaluate(() => localStorage.setItem('__hmUn', JSON.stringify({ started: true, running: false, removed: true, result: { exit: 0, stdout: 'HMUNINSTALL STEP debian x\nHMUNINSTALL OK debian removed\nHMUNINSTALL DONE' } })))
    await np.reload()
    await np.locator('.sheet', { hasText: 'Uninstall Hermes' }).locator('.uninstall-apps').waitFor({ timeout: 8000 }).then(() => check(true, 'uninstall: reopened after a cleanup, the app shows the remaining apps'), () => check(false, 'uninstall: reopened after a cleanup, the app shows the remaining apps'))
    check(/open Hermes Mobile again/.test((await np.locator('.sheet', { hasText: 'Uninstall Hermes' }).textContent()) || ''), 'uninstall: says Android closes the app when Termux goes')
    await np.evaluate(() => localStorage.removeItem('__hmUn'))
  }
  await np.close()

  // ── Claude sign-in (Settings → Model providers → Anthropic). Like the pinned Hermes, a Claude login (Termux's
  // `hermes auth add anthropic` or the plugin's in-app login) only lands in the credential pool: the app must read it there. ──
  {
    const cs = await browser.newPage({ viewport: { width: 375, height: 812 } })
    cs.on('pageerror', e => { console.log('PAGEERROR (claude page)', e.message); fail() })
    await cs.addInitScript(nativeShell)
    await mock({ claudeSignedIn: true })
    await cs.goto(WEB + '/')
    await cs.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    const openAccounts = async () => {
      await cs.getByRole('button', { name: /^Sessions/ }).click()
      await cs.locator('.nav-tile', { hasText: 'Settings' }).click()
      await cs.locator('.set-row', { hasText: 'Model providers' }).click()
      await cs.locator('.providers .set-row', { hasText: 'Anthropic (Claude)' }).click()
    }
    const claudeRow = cs.locator('.sheet .set-row', { hasText: 'Claude Pro / Max' })
    await openAccounts()
    await claudeRow.locator('text=Signed in').waitFor({ timeout: 5000 }).then(() => check(true, 'claude: a login in the credential pool shows as Signed in'), () => check(false, 'claude: a login in the credential pool shows as Signed in'))
    check(/anthropic-oauth-1/.test((await claudeRow.textContent({ timeout: 1000 }).catch(() => '')) || ''), 'claude: the row names the login')
    // Sign out clears it (Hermes's DELETE), then the in-app sign-in
    await claudeRow.getByRole('button', { name: 'Sign out' }).click({ timeout: 3000 }).catch(() => {})
    await claudeRow.getByRole('button', { name: 'Sign in' }).waitFor({ timeout: 5000 }).then(() => check(true, 'claude: Sign out → Sign in'), () => check(false, 'claude: Sign out → Sign in'))
    await claudeRow.getByRole('button', { name: 'Sign in' }).click({ timeout: 3000 }).catch(() => {})
    const sheet = cs.locator('.sheet', { hasText: 'Sign in to Claude' })
    await sheet.getByRole('button', { name: /Open claude\.ai/ }).click({ timeout: 5000 }).then(() => check(true, 'claude: in-app sheet with Open claude.ai'), () => check(false, 'claude: in-app sheet with Open claude.ai'))
    check((await cs.evaluate(() => window.__opened || [])).some(u => u.startsWith('https://claude.ai/oauth/authorize')), 'claude: opens the authorize link in the browser')
    check((await cs.evaluate(() => window.__termuxSignins || [])).length === 0, 'claude: Termux is not opened')
    const field = sheet.getByPlaceholder('Paste the code here')
    const liveLists = () => rpcs('model.options').filter(c => c.params && c.params.refresh).length
    const listsAt = liveLists()
    await field.fill('wrong-code')
    await sheet.getByRole('button', { name: 'Sign in', exact: true }).click()
    await sheet.locator('.notice-error', { hasText: 'whole code' }).waitFor({ timeout: 3000 }).then(() => check(true, 'claude: a wrong code shows Hermes’s reason'), () => check(false, 'claude: a wrong code shows Hermes’s reason'))
    await field.fill('  the-code#st-cl1 \n')
    await sheet.getByRole('button', { name: 'Sign in', exact: true }).click()
    await sheet.waitFor({ state: 'detached', timeout: 5000 }).then(() => check(true, 'claude: the sheet closes once signed in'), () => check(false, 'claude: the sheet closes once signed in'))
    await cs.locator('.toast', { hasText: 'Signed in to Claude' }).waitFor({ timeout: 3000 }).then(() => check(true, 'claude: toast Signed in to Claude'), () => check(false, 'claude: toast Signed in to Claude'))
    await claudeRow.locator('text=Signed in').waitFor({ timeout: 5000 }).then(() => check(true, 'claude: row shows Signed in after the in-app login'), () => check(false, 'claude: row shows Signed in after the in-app login'))
    {
      const fin = calls().filter(c => c.path === '/api/plugins/hermes-mobile/claude-login/finish')
      check(fin.length === 2 && /profile=default/.test(fin[1].query) && !/code/.test(fin[1].query) && fin[1].body.code === 'the-code#st-cl1', `claude: the code goes in the body, trimmed, for this profile (${JSON.stringify(fin.map(c => [c.query, c.body]))})`)
      check(liveLists() > listsAt, 'claude: the live model list is fetched after the sign-in (Claude models show up)')
    }
    // Termux fallback (button in the sheet): back from Termux, the app re-checks and says how it went
    await claudeRow.getByRole('button', { name: 'Sign out' }).click({ timeout: 3000 }).catch(() => {})
    await claudeRow.getByRole('button', { name: 'Sign in' }).click({ timeout: 5000 }).catch(() => {})
    await sheet.getByRole('button', { name: /Termux/ }).click({ timeout: 5000 }).catch(() => {})
    check(JSON.stringify(await cs.evaluate(() => window.__termuxSignins || [])) === '[["anthropic","default"]]', `claude: Termux fallback runs auth add anthropic for this profile (${JSON.stringify(await cs.evaluate(() => window.__termuxSignins))})`)
    await cs.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))) // back without signing in
    await cs.locator('.toast', { hasText: 'not signed in' }).waitFor({ timeout: 3000 }).then(() => check(true, 'claude: back from Termux without a login says so'), () => check(false, 'claude: back from Termux without a login says so'))
    await claudeRow.getByRole('button', { name: 'Sign in' }).click({ timeout: 3000 }).catch(() => {})
    await sheet.getByRole('button', { name: /Termux/ }).click({ timeout: 5000 }).catch(() => {})
    await mock({ claudeSignedIn: true }) // `hermes auth add anthropic` finished in Termux
    await cs.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await cs.locator('.toast', { hasText: 'Signed in to Claude' }).waitFor({ timeout: 3000 }).then(() => check(true, 'claude: back from Termux after auth add → Signed in to Claude'), () => check(false, 'claude: back from Termux after auth add → Signed in to Claude'))
    await claudeRow.locator('text=Signed in').waitFor({ timeout: 5000 }).then(() => check(true, 'claude: row shows Signed in after Termux'), () => check(false, 'claude: row shows Signed in after Termux'))
    // An older plugin without the in-app login: the sheet offers Termux instead
    await mock({ claudeSignedIn: false, claudeLoginMissing: true })
    await cs.goto(WEB + '/')
    await cs.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    await openAccounts()
    await claudeRow.getByRole('button', { name: 'Sign in' }).click({ timeout: 5000 }).catch(() => {})
    await sheet.getByText('Termux').first().waitFor({ timeout: 5000 }).then(() => check(true, 'claude: without the plugin route the sheet offers Termux'), () => check(false, 'claude: without the plugin route the sheet offers Termux'))
    check((await sheet.getByRole('button', { name: /Open claude\.ai/ }).count()) === 0, 'claude: no dead Open claude.ai button then')
    check((await cs.locator('.sheet input[type=checkbox], .sheet select').count()) === 0, 'claude: no native form controls')
    await mock({ claudeLoginMissing: false })
    await cs.close()
  }
}
