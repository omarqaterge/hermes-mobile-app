// The setup flow: what is set up, resuming at the first missing step.
const fs = require('fs')
const { WEB, sleep, check, fail, mock, nativeShell } = require('../lib.cjs')

module.exports = async t => {
  const { browser, page } = t
  // ── the setup flow: works out what is set up and resumes at the first missing step ──
  const OK = { termux: true, runCommand: true, notifications: true, batteryApp: true, batteryTermux: true, startError: '' }
  const flowPage = async setup => {
    const fp = await browser.newPage({ viewport: { width: 375, height: 812 } })
    fp.on('pageerror', e => { console.log('PAGEERROR (flow page)', e.message); fail() })
    await fp.addInitScript(s => { window.__setup = s }, setup)
    await fp.addInitScript(nativeShell)
    return fp
  }
  const flowShown = fp => fp.getByText('Set up Hermes', { exact: true }).count().then(n => n > 0)
  // a. PC-installed phone, everything working: straight to chat, no flow, and it is not checked again
  await mock({ configured: true, pluginEnabled: true })
  {
    const fa = await flowPage(OK)
    await fa.goto(WEB + '/')
    await fa.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    await fa.waitForFunction(() => localStorage.getItem('hm.setupFlowDone') === '1', null, { timeout: 8000 }).catch(() => {})
    check(!(await flowShown(fa)), 'flow: everything set up → straight to chat, no setup flow')
    check(await fa.evaluate(() => localStorage.getItem('hm.setupFlowDone') === '1' && localStorage.getItem('hm.welcomeDone') === '1'), 'flow: nothing missing is remembered (not checked again)')
    await fa.close()
  }
  // b. everything fine but no model: the model step, then the recommended items once ("Almost done").
  // looseStatus: like the pinned Hermes on a fresh install, setup.status for a profile wrongly says a provider is there.
  await mock({ unconfigured: true, pluginEnabled: true, looseStatus: true })
  {
    const fb = await flowPage({ ...OK, batteryApp: false })
    await fb.goto(WEB + '/')
    await fb.getByText('Connect Hermes to a model').waitFor({ timeout: 15000 }).then(() => check(true, 'flow: no model → opens at the model step'), () => check(false, 'flow: no model → opens at the model step'))
    check((await fb.locator('.flow-progress-label').textContent()) === 'Step 1 of 1', `flow: progress counts only the missing required steps (${await fb.locator('.flow-progress-label').textContent()})`)
    await fb.locator('.providers .set-row', { hasText: 'OpenAI' }).first().click()
    await fb.locator('.set-row', { hasText: 'ChatGPT Plus / Pro' }).getByRole('button', { name: 'Sign in' }).click()
    await fb.getByText('Copy this code').waitFor({ state: 'detached', timeout: 12000 })
    await fb.getByRole('button', { name: 'Choose a model' }).click({ timeout: 5000 })
    await fb.locator('.picker-opt', { hasText: 'mock-sonnet' }).click()
    await fb.locator('.setup-hero-title', { hasText: 'Almost done' }).waitFor({ timeout: 8000 }).then(() => check(true, 'flow: after the model, the recommended items are shown once (Almost done)'), () => check(false, 'flow: after the model, the recommended items are shown once (Almost done)'))
    check((await fb.locator('.setup-item.bad').count()) === 1, 'flow: only the missing recommended item is listed')
    check((await fb.locator('.flow-done', { hasText: 'A model is connected' }).count()) === 1, 'flow: the finished step is collapsed with ✓')
    await fb.locator('.setup-item.bad', { hasText: 'run in the background' }).getByRole('button', { name: 'Allow' }).click()
    check((await fb.evaluate(() => window.__fixes || [])).includes('battery-app'), 'flow: Allow asks the shell for the battery exemption')
    await fb.evaluate(() => {
      window.__setup = { ...window.__setup, batteryApp: true }
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await fb.locator('.setup-hero-title', { hasText: 'All set' }).waitFor({ timeout: 6000 }).then(() => check(true, 'flow: coming back to the app re-checks: All set'), () => check(false, 'flow: coming back to the app re-checks: All set'))
    await fb.getByRole('button', { name: 'Done', exact: true }).click()
    await fb.getByText('Set up Hermes', { exact: true }).waitFor({ state: 'detached', timeout: 4000 }).then(() => check(true, 'flow: Done goes to the chat'), () => check(false, 'flow: Done goes to the chat'))
    await fb.reload()
    await fb.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    await sleep(2000)
    check(!(await flowShown(fb)), 'flow: not shown again after Done')
    check(await fb.evaluate(() => localStorage.getItem('hm.setupFlowDone') === '1'), 'flow: hm.setupFlowDone is set')
    await fb.close()
    await mock({ looseStatus: false })
  }
  // b2. Shizuku works but Termux isn't paired, no model: the pairing step comes BEFORE the model; Back/Next walk the pages
  // already reached and stop at the current step (owner, 2026-10-29)
  await mock({ unconfigured: true, pluginEnabled: true, looseStatus: true })
  {
    const auto = paired => ({ ...OK, shizuku: true, batteryShizuku: true, shizukuAuto: { sdk: true, wss: true, paired, last: '' } })
    const fn = await flowPage(auto(false))
    await fn.goto(WEB + '/')
    const label = () => fn.locator('.flow-progress-label').textContent().catch(() => '')
    const disabled = name => fn.getByRole('button', { name }).isDisabled().catch(() => true)
    await fn.locator('.flow-card-title', { hasText: 'Shizuku starts by itself' }).waitFor({ timeout: 15000 }).then(() => check(true, 'flow nav: Shizuku not paired → the flow opens at "Shizuku starts by itself"'), () => check(false, 'flow nav: Shizuku not paired → the flow opens at "Shizuku starts by itself"'))
    await fn.getByText('Step 1 of 2', { exact: true }).waitFor({ timeout: 6000 }).catch(() => {})
    check((await label()) === 'Step 1 of 2', `flow nav: the pairing step is step 1 of 2, before the model (${await label()})`)
    check((await fn.getByRole('button', { name: 'Previous step' }).count()) === 0 || (await disabled('Previous step')), 'flow nav: no Back on the first page')
    check((await fn.getByRole('button', { name: 'Next step' }).count()) === 0 || (await disabled('Next step')), 'flow nav: no Next on the current page')
    check(((await fn.locator('.flow-card').textContent()) || '').includes('Pair Termux with Wireless debugging once'), 'flow nav: the pairing page tells the user to pair Termux')
    await fn.getByRole('button', { name: 'Start pairing' }).click()
    check((await fn.evaluate(() => window.__fixes || [])).slice(-1)[0] === 'shizuku-pair', 'flow nav: Start pairing asks the shell for shizuku-pair')
    await fn.evaluate(() => {
      window.__setup = { ...window.__setup, shizukuAuto: { sdk: true, wss: true, paired: true, last: 'ok' } }
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await fn.getByText('Connect Hermes to a model').waitFor({ timeout: 8000 }).then(() => check(true, 'flow nav: once paired, the next page is the model step'), () => check(false, 'flow nav: once paired, the next page is the model step'))
    check((await label()) === 'Step 2 of 2', `flow nav: model is step 2 of 2 (${await label()})`)
    await fn.getByRole('button', { name: 'Previous step' }).click()
    await fn.locator('.flow-card-title', { hasText: 'Shizuku starts by itself' }).waitFor({ timeout: 4000 }).then(() => check(true, 'flow nav: Back shows the finished pairing page'), () => check(false, 'flow nav: Back shows the finished pairing page'))
    check((await fn.locator('.flow-page-done').count()) === 1, 'flow nav: a finished page is marked Done')
    check((await label()) === 'Step 1 of 2', `flow nav: the counter follows the page shown (${await label()})`)
    check(!(await disabled('Next step')) && (await disabled('Previous step')), 'flow nav: on page 1 Next is on and Back is off')
    await fn.getByRole('button', { name: 'Next step' }).click()
    await fn.getByText('Connect Hermes to a model').waitFor({ timeout: 4000 }).then(() => check(true, 'flow nav: Next walks forward to the model step'), () => check(false, 'flow nav: Next walks forward to the model step'))
    check((await fn.getByRole('button', { name: 'Next step' }).count()) === 0 || (await disabled('Next step')), 'flow nav: Next stops at the current step')
    await fn.evaluate(() => window.hermesBack())
    await fn.locator('.flow-card-title', { hasText: 'Shizuku starts by itself' }).waitFor({ timeout: 4000 }).then(() => check(true, 'flow nav: Android Back goes to the previous page'), () => check(false, 'flow nav: Android Back goes to the previous page'))
    check(await flowShown(fn), 'flow nav: Android Back did not leave the flow')
    await fn.getByRole('button', { name: 'Next step' }).click()
    await fn.getByText('Connect Hermes to a model').waitFor({ timeout: 4000 })
    await fn.getByRole('button', { name: 'Back', exact: true }).click()
    await fn.locator('.flow-card-title', { hasText: 'Shizuku starts by itself' }).waitFor({ timeout: 4000 }).then(() => check(true, 'flow nav: the header arrow goes to the previous page'), () => check(false, 'flow nav: the header arrow goes to the previous page'))
    await fn.getByRole('button', { name: 'Back', exact: true }).click()
    await fn.getByText('Set up Hermes', { exact: true }).waitFor({ state: 'detached', timeout: 4000 }).then(() => check(true, 'flow nav: the header arrow on the first page leaves the flow'), () => check(false, 'flow nav: the header arrow on the first page leaves the flow'))
    await fn.close()
    await mock({ looseStatus: false })
  }
  // c0. fresh install with Termux already there and Hermes not answering (a tablet/phone that was given Termux first):
  // the setup flow is on screen from the first moment, not after a 15 s wait over a chat retrying to connect, and on a
  // wide screen it covers the chat list too
  await mock({ configured: true, pluginEnabled: true, drop: 600000 })
  for (const vp of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
    const f0 = await browser.newPage({ viewport: vp })
    f0.on('pageerror', e => { console.log('PAGEERROR (takeover)', e.message); fail() })
    await f0.addInitScript(s => { window.__setup = s }, { ...OK, shizuku: false })
    await f0.addInitScript(nativeShell)
    const t0 = Date.now()
    await f0.goto(WEB + '/')
    const shown = await f0.locator('.screen.takeover').waitFor({ timeout: 3000 }).then(() => true, () => false)
    check(shown, `takeover (${vp.width}px): a fresh install opens the setup flow at once (${Date.now() - t0} ms)`)
    if (shown) {
      const b = await f0.locator('.screen.takeover').boundingBox()
      check(b && b.x === 0 && Math.abs(b.width - vp.width) <= 1, `takeover (${vp.width}px): the flow covers the whole window (${JSON.stringify(b)})`)
      const top = await f0.evaluate(() => { const e = document.elementFromPoint(20, 300); return e && e.closest('.screen.takeover') ? 'flow' : (e && e.className) || '' })
      check(top === 'flow', `takeover (${vp.width}px): nothing (chat list, composer) is drawn over it (${top})`)
      const step = await f0.locator('.screen.takeover .flow-card-title').first().waitFor({ timeout: 10000 }).then(() => f0.locator('.screen.takeover .flow-card-title').first().textContent(), () => '')
      check(Boolean(step), `takeover (${vp.width}px): once Hermes doesn't answer, it moves from Checking… to the first missing step (${step})`)
    }
    await f0.close()
  }
  // c. Hermes not running on a first run: opens at "Start Hermes" and moves on by itself once Hermes answers
  await mock({ configured: true, pluginEnabled: true, drop: 19000 })
  {
    const fc = await flowPage(OK)
    await fc.goto(WEB + '/')
    await fc.getByRole('button', { name: 'Start Hermes' }).waitFor({ timeout: 30000 }).then(() => check(true, 'flow: Hermes not running → opens at Start Hermes'), () => check(false, 'flow: Hermes not running → opens at Start Hermes'))
    await fc.getByRole('button', { name: 'Start Hermes' }).click().catch(() => {})
    check((await fc.evaluate(() => window.__fixes || [])).includes('start'), 'flow: Start Hermes asks the shell to start it')
    await fc.locator('.setup-hero-title', { hasText: 'All set' }).waitFor({ timeout: 40000 }).then(() => check(true, 'flow: moves on by itself once Hermes is back (All set)'), () => check(false, 'flow: moves on by itself once Hermes is back (All set)'))
    check((await fc.locator('.flow-done', { hasText: 'Hermes is running' }).count()) === 1, 'flow: Hermes is running is ticked off')
    await fc.close()
  }
  // d. Autostart: only on phones whose maker has the switch (the shell says which page it opens), never ✓/✗ until the
  // user taps Done (remembered), and it does not open the flow by itself. AOSP/Pixel: no row at all.
  await mock({ configured: true, pluginEnabled: true })
  {
    const XIAOMI = { ...OK, maker: 'xiaomi', autostart: 'list', autostartName: 'Autostart', autostartWhere: 'Settings → Apps → Background autostart' }
    const fd = await flowPage(XIAOMI)
    await fd.goto(WEB + '/')
    await fd.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    await sleep(2500)
    check(!(await flowShown(fd)), 'flow: the Autostart tip alone does not open the flow')
    await fd.locator('.conn-dot').click()
    await fd.getByRole('button', { name: 'Setup check' }).click()
    const tip = fd.locator('.setup-item.info', { hasText: 'Autostart' })
    await tip.waitFor({ timeout: 5000 }).then(() => check(true, 'setup: a phone with an Autostart page shows the Autostart tip'), () => check(false, 'setup: a phone with an Autostart page shows the Autostart tip'))
    check((await fd.locator('.setup-item.ok, .setup-item.bad', { hasText: 'Autostart' }).count()) === 0, 'setup: the Autostart tip is neither ✓ nor ✗')
    const help = (await tip.locator('.setup-help').textContent().catch(() => '')) || ''
    check(/list of apps that may start by themselves \(Autostart\): switch on Termux and Hermes Mobile/.test(help) && help.includes('tap Done'), `setup: the tip names the page that opens (${help.slice(0, 90)}…)`)
    await tip.getByRole('button', { name: 'Open Autostart' }).click()
    const fx = await fd.evaluate(() => window.__fixes || [])
    check(fx.includes('autostart') && !fx.includes('app-settings'), `setup: the Autostart button opens the phone's Autostart page (${JSON.stringify(fx)})`)
    await tip.getByRole('button', { name: 'Done' }).click()
    await fd.locator('.setup-item.ok', { hasText: 'Autostart' }).waitFor({ timeout: 5000 }).then(() => check(true, 'setup: Done ticks the Autostart row'), () => check(false, 'setup: Done ticks the Autostart row'))
    check(await fd.evaluate(() => localStorage.getItem('hm.autostartDone') === '1'), 'setup: Done on Autostart is remembered')
    await fd.close()
    // A maker whose page is per app, or none of whose pages opens: one button per app (Hermes Mobile, Termux)
    const fi = await flowPage({ ...OK, maker: 'xiaomi', autostart: 'info', autostartName: 'Autostart', autostartWhere: 'Settings → Apps → Background autostart' })
    await fi.goto(WEB + '/')
    await fi.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    await fi.locator('.conn-dot').click()
    await fi.getByRole('button', { name: 'Setup check' }).click()
    const tipI = fi.locator('.setup-item.info', { hasText: 'Autostart' })
    await tipI.waitFor({ timeout: 5000 }).catch(() => {})
    const helpI = (await tipI.locator('.setup-help').textContent().catch(() => '')) || ''
    check(helpI.includes('App info') && helpI.includes('Settings → Apps → Background autostart'), `setup: App info fallback says where else to look (${helpI.slice(0, 90)}…)`)
    await tipI.getByRole('button', { name: 'Termux', exact: true }).click().catch(() => {})
    await tipI.getByRole('button', { name: 'Hermes Mobile', exact: true }).click().catch(() => {})
    const fxI = await fi.evaluate(() => window.__fixes || [])
    check(fxI.includes('autostart-termux') && fxI.includes('autostart'), `setup: per-app Autostart buttons ask for each app (${JSON.stringify(fxI)})`)
    await fi.close()
    // AOSP emulator / Pixel: the shell reports no Autostart page → no row, even before any Done
    const fg = await flowPage({ ...OK, maker: 'google', autostart: '', autostartName: '', autostartWhere: '' })
    await fg.goto(WEB + '/')
    await fg.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    await fg.locator('.conn-dot').click()
    await fg.getByRole('button', { name: 'Setup check' }).click()
    await fg.locator('.setup-hero-title', { hasText: 'All set' }).waitFor({ timeout: 6000 })
    check((await fg.locator('.setup-item', { hasText: 'Autostart' }).count()) === 0, 'setup: AOSP (no Autostart page) has no Autostart row')
    await fg.close()
  }
  // e. app-first: only Hermes Mobile is installed. The flow opens at once at the helper apps, installs all four in order,
  // requires Start Shizuku (no Skip), asks for the Termux permission, copies the installer command, shows its progress
  // lines, and after DONE connects and lands on the model step.
  await mock({ unconfigured: true, pluginEnabled: true, drop: 600000 })
  {
    const FRESH = { ...OK, termux: false, runCommand: false, termuxApi: false, termuxBoot: false, termuxBootStopped: false, shizuku: false, canInstall: true, devOptions: false, wirelessDebugging: false, termuxSigner: '', probe: true, maker: 'google' }
    {
      // Install all stalls after the first app (Android blocked the next prompt while the app was in the background, or its
      // answer never reached the page): coming back to the app re-checks what is really installed and carries on.
      const fs = await flowPage(FRESH)
      await fs.addInitScript(() => { window.__installStall = ['termux-api', 'termux-boot'] })
      await fs.goto(WEB + '/')
      await fs.getByRole('button', { name: 'Install all' }).click()
      const apiRow = fs.locator('.app-list .setup-item', { hasText: 'Termux:API' })
      await apiRow.getByText('Tap Install on Android’s prompt').waitFor({ timeout: 4000 }).then(() => check(true, 'install-all: the 2nd app waits on Android’s prompt'), () => check(false, 'install-all: the 2nd app waits on Android’s prompt'))
      // the shell says its prompt was left unanswered (user went Home): Retry shows and a later re-check doesn't hide it
      await fs.evaluate(() => {
        window.hermesSetupInstall('termux-api', 'prompt', 100, '')
        window.hermesSetupChanged()
      })
      await apiRow.getByRole('button', { name: 'Retry' }).waitFor({ timeout: 4000 }).then(() => check(true, 'install-all: a prompt left unanswered gets a Retry button'), () => check(false, 'install-all: a prompt left unanswered gets a Retry button'))
      check((await apiRow.getByText('Android’s Install prompt was closed', { exact: false }).count()) === 1, 'install-all: the row says the prompt was closed')
      // the user installed it, but the result never reached the page; back in the app:
      await fs.evaluate(() => {
        window.__setup = { ...window.__setup, termuxApi: true, installing: '' }
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await fs.waitForFunction(() => (window.__installs || []).includes('termux-boot'), null, { timeout: 4000 }).then(() => check(true, 'install-all: back in the app, an app that got installed is ticked and the next one starts'), () => check(false, 'install-all: back in the app, an app that got installed is ticked and the next one starts'))
      // Termux:Boot stalls too, and this time it is neither installed nor in flight (its prompt was closed): Retry + what's next
      await fs.locator('.app-list .setup-item', { hasText: 'Termux:Boot' }).getByText('Tap Install on Android’s prompt').waitFor({ timeout: 4000 }).catch(() => {})
      await fs.evaluate(() => {
        window.__setup = { ...window.__setup, installing: '' }
        document.dispatchEvent(new Event('visibilitychange'))
      })
      const bootRow = fs.locator('.app-list .setup-item', { hasText: 'Termux:Boot' })
      await bootRow.getByRole('button', { name: 'Retry' }).waitFor({ timeout: 4000 }).then(() => check(true, 'install-all: an app whose install stopped gets a Retry button'), () => check(false, 'install-all: an app whose install stopped gets a Retry button'))
      check((await fs.getByText('Next: Shizuku', { exact: false }).count()) === 1, 'install-all: the list says which app comes next')
      await fs.evaluate(() => { window.__installStall = [] })
      if (await bootRow.getByRole('button', { name: 'Retry' }).count()) await bootRow.getByRole('button', { name: 'Retry' }).click()
      await fs.getByText('Start Shizuku', { exact: true }).first().waitFor({ timeout: 8000 }).then(() => check(true, 'install-all: Retry installs it and the rest of the queue follows'), () => check(false, 'install-all: Retry installs it and the rest of the queue follows'))
      const got = await fs.evaluate(() => window.__installs)
      check(JSON.stringify(got) === JSON.stringify(['termux', 'termux-api', 'termux-boot', 'termux-boot', 'shizuku']), `install-all: installs in order, each once more only on Retry (${JSON.stringify(got)})`)
      await fs.close()
    }
    {
      // Termux from another source (Play Store / GitHub): F-Droid's Termux:API / Termux:Boot can't join it. Install all is
      // still the button: it asks, opens Android's uninstall prompt for Termux, and once Termux is gone installs all four.
      const fr = await flowPage({ ...FRESH, termux: true, termuxSigner: 'other', termuxVersion: '0.118.3' })
      await fr.goto(WEB + '/')
      await fr.getByText('Get the helper apps', { exact: true }).first().waitFor({ timeout: 8000 })
      const all = fr.getByRole('button', { name: 'Install all' })
      check((await all.count()) === 1, 'other Termux: Install all is offered (was “Install Shizuku”, then no button)')
      if (!(await all.count())) { await fr.close() } else {
      // Cancel in the explanation: nothing happens
      await all.click()
      await fr.locator('.dialog').getByRole('button', { name: 'Cancel' }).click()
      check(!(await fr.evaluate(() => window.__fixes || [])).includes('replace-termux'), 'other Termux: Cancel opens nothing')
      await all.click()
      await fr.locator('.dialog').getByRole('button', { name: 'Uninstall Termux' }).click()
      check((await fr.evaluate(() => window.__fixes || [])).includes('replace-termux'), 'other Termux: confirming opens Android’s uninstall prompt for Termux')
      check(((await fr.evaluate(() => window.__installs)) || []).length === 0, 'other Termux: nothing is installed while the other Termux is still there')
      // Android's uninstall prompt was answered with OK; back in the app Termux is gone
      await fr.evaluate(() => {
        window.__setup = { ...window.__setup, termux: false, termuxSigner: '', termuxVersion: '' }
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await fr.getByText('Start Shizuku', { exact: true }).first().waitFor({ timeout: 8000 }).then(() => check(true, 'other Termux: once it is gone, all four install one by one and the flow moves on'), () => check(false, 'other Termux: once it is gone, all four install one by one and the flow moves on'))
      check(JSON.stringify(await fr.evaluate(() => window.__installs)) === JSON.stringify(['termux', 'termux-api', 'termux-boot', 'shizuku']), `other Termux: installs in order, Termux first (${JSON.stringify(await fr.evaluate(() => window.__installs))})`)
      check((await fr.evaluate(() => localStorage.getItem('hm.replaceTermux'))) === null, 'other Termux: the replace mark is cleared')
      await fr.close()
      }
    }
    {
      // Android killed the app while Termux was uninstalled: the next launch finishes the job by itself
      const fk = await flowPage({ ...FRESH })
      await fk.addInitScript(() => localStorage.setItem('hm.replaceTermux', String(Date.now() - 5000)))
      await fk.goto(WEB + '/')
      await fk.waitForFunction(() => (window.__installs || []).length === 4, null, { timeout: 8000 }).then(() => check(true, 'other Termux: after the app was killed, the next launch installs the set'), () => check(false, 'other Termux: after the app was killed, the next launch installs the set'))
      await fk.close()
    }
    {
      // F-Droid Termux, only Shizuku missing: the button still says Install all (owner: one button for every install)
      const fs1 = await flowPage({ ...FRESH, termux: true, termuxSigner: 'fdroid', termuxApi: true, termuxBoot: true })
      await fs1.goto(WEB + '/')
      await fs1.getByText('Get the helper apps', { exact: true }).first().waitFor({ timeout: 8000 })
      await fs1.getByRole('button', { name: 'Install all' }).waitFor({ timeout: 4000 }).then(() => fs1.getByRole('button', { name: 'Install all' }).click()).then(() => check(true, 'one missing app: the button is Install all'), () => check(false, 'one missing app: the button is Install all'))
      await fs1.getByText('Start Shizuku', { exact: true }).first().waitFor({ timeout: 8000 }).catch(() => {})
      check(JSON.stringify(await fs1.evaluate(() => window.__installs)) === JSON.stringify(['shizuku']), 'one missing app: Install all installs just that one')
      await fs1.close()
    }
    {
      // Android 10 and older have no Wireless debugging: the step says Shizuku starts from a computer, links the guide, no Skip.
      const fo = await flowPage({ ...FRESH, sdk: 29 })
      await fo.goto(WEB + '/')
      await fo.getByText('Get the helper apps', { exact: true }).first().waitFor({ timeout: 8000 }) // the flow opens at once while Termux is missing
      await fo.evaluate(() => {
        window.__setup = { ...window.__setup, termux: true, termuxApi: true, termuxBoot: true, shizuku: true, runCommand: true, termuxSigner: 'fdroid' }
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await fo.getByText('Start Shizuku', { exact: true }).first().waitFor({ timeout: 8000 })
      check((await fo.getByText('started from a computer', { exact: false }).count()) === 1, 'shizuku sdk<30: the step explains Shizuku is started from a computer')
      check((await fo.getByText('Turn on Wireless debugging').count()) === 0 && (await fo.getByText('Turn on Developer options').count()) === 0, 'shizuku sdk<30: no Developer options / Wireless debugging sub-items')
      check((await fo.getByRole('button', { name: /skip/i }).count()) === 0, 'shizuku sdk<30: no Skip button')
      await fo.evaluate(() => { window.__opened = [] })
      await fo.getByRole('button', { name: 'Shizuku’s guide' }).click()
      check(JSON.stringify(await fo.evaluate(() => window.__opened)) === JSON.stringify(['https://shizuku.rikka.app/guide/setup/']), 'shizuku sdk<30: the guide button opens Shizuku’s setup guide')
      // the fallback moves on (Shizuku started before the app's first launch is never seen by the app)
      await fo.getByRole('button', { name: 'Shizuku is running: continue' }).click()
      await fo.getByText('Run the installer', { exact: true }).waitFor({ timeout: 5000 }).then(() => check(true, 'shizuku fallback: “Shizuku is running: continue” moves on to the installer'), () => check(false, 'shizuku fallback: “Shizuku is running: continue” moves on to the installer'))
      await fo.close()
    }
    {
      // Android 11+ keeps the Developer options / Wireless debugging items
      const fo = await flowPage({ ...FRESH, sdk: 34 })
      await fo.goto(WEB + '/')
      await fo.getByText('Get the helper apps', { exact: true }).first().waitFor({ timeout: 8000 }) // the flow opens at once while Termux is missing
      await fo.evaluate(() => {
        window.__setup = { ...window.__setup, termux: true, termuxApi: true, termuxBoot: true, shizuku: true, runCommand: true, termuxSigner: 'fdroid' }
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await fo.getByText('Start Shizuku', { exact: true }).first().waitFor({ timeout: 8000 })
      check((await fo.getByText('Turn on Wireless debugging').count()) === 1 && (await fo.getByText('started from a computer', { exact: false }).count()) === 0, 'shizuku sdk>=30: Wireless debugging item stays, no computer note')
      await fo.close()
    }
    const fe = await flowPage(FRESH)
    await fe.goto(WEB + '/')
    await fe.getByText('Get the helper apps', { exact: true }).first().waitFor({ timeout: 6000 }).then(() => check(true, 'app-first: no Termux → the flow opens at once at the helper apps'), () => check(false, 'app-first: no Termux → the flow opens at once at the helper apps'))
    check((await fe.locator('.app-list .setup-item.bad').count()) === 4, 'app-first: four install rows (Termux, Termux:API, Termux:Boot, Shizuku)')
    check((await fe.evaluate(() => window.__probes || 0)) === 0, 'app-first: no Termux command is sent while Termux is missing')
    {
      // each missing helper app has a link to its official page; Termux apps must share one source
      await fe.evaluate(() => { window.__opened = [] })
      const links = fe.locator('.app-list .app-own-link')
      check((await links.count()) === 4, 'helper apps: every missing app has an "install it yourself" link')
      for (let i = 0; i < (await links.count()); i++) await links.nth(i).click()
      const opened = await fe.evaluate(() => window.__opened)
      check(JSON.stringify(opened) === JSON.stringify(['https://f-droid.org/packages/com.termux/', 'https://f-droid.org/packages/com.termux.api/', 'https://f-droid.org/packages/com.termux.boot/', 'https://github.com/RikkaApps/Shizuku/releases']), `helper apps: links go to the F-Droid pages and Shizuku's releases (${JSON.stringify(opened)})`)
      check((await fe.getByText('must all come from the same source (F-Droid)').count()) === 1, 'helper apps: note that Termux apps must share one source')
    }
    await fe.getByRole('button', { name: 'Install all' }).click()
    await fe.getByText('Start Shizuku', { exact: true }).first().waitFor({ timeout: 8000 }).then(() => check(true, 'app-first: once all four are installed the flow moves on to Start Shizuku'), () => check(false, 'app-first: once all four are installed the flow moves on to Start Shizuku'))
    check(JSON.stringify(await fe.evaluate(() => window.__installs)) === JSON.stringify(['termux', 'termux-api', 'termux-boot', 'shizuku']), `app-first: Install all installs them one after another, Termux first (${JSON.stringify(await fe.evaluate(() => window.__installs))})`)
    await fe.getByRole('button', { name: 'Open Shizuku' }).click()
    check((await fe.evaluate(() => window.__fixes || [])).includes('open-shizuku'), 'app-first: Open Shizuku opens it')
    check((await fe.getByText('Shizuku uses Android’s own wireless debugging to start itself').count()) === 1, 'Wireless debugging step explains why it is needed')
    // Shizuku auto-detect: the step stays put while the app says Shizuku is not running, then shows a green row and moves on by itself
    await fe.waitForTimeout(3600)
    check((await fe.getByRole('button', { name: /skip/i }).count()) === 0, 'shizuku required: no Skip button on Start Shizuku')
    check((await fe.getByText('Hermes needs Shizuku', { exact: false }).count()) === 1 && (await fe.getByText(/recommended|optional|skip it/i).count()) === 0, 'shizuku required: the step says Hermes needs Shizuku, never recommended/optional')
    check((await fe.locator('.setup-item.ok', { hasText: 'Shizuku is running' }).count()) === 0, 'shizuku-check: no green row before it runs')
    check((await fe.getByRole('button', { name: 'Shizuku is running: continue' }).count()) === 1, 'shizuku-check: the fallback button is “Shizuku is running: continue”')
    check((await fe.getByText('Rooted phone: open Shizuku and tap Start.').count()) === 1, 'shizuku required: rooted phones get their one line')
    await fe.evaluate(() => (window.__setup = { ...window.__setup, shizukuRunning: true }))
    await fe.locator('.setup-item.ok', { hasText: 'Shizuku is running' }).waitFor({ timeout: 6000 }).then(() => check(true, 'shizuku-check: detected → green “Shizuku is running” row (no tap)'), () => check(false, 'shizuku-check: detected → green “Shizuku is running” row (no tap)'))
    await fe.getByRole('button', { name: 'Allow' }).waitFor({ timeout: 5000 }).then(() => check(true, 'app-first: after Shizuku, the Termux permission comes before the installer'), () => check(false, 'app-first: after Shizuku, the Termux permission comes before the installer'))
    await fe.getByRole('button', { name: 'Allow' }).click()
    await fe.evaluate(() => {
      window.__setup = { ...window.__setup, runCommand: true }
      window.__probe = { result: 'not-allowed' }
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await fe.getByText('Run the installer', { exact: true }).waitFor({ timeout: 5000 }).then(() => check(true, 'app-first: Termux refuses commands → Run the installer'), () => check(false, 'app-first: Termux refuses commands → Run the installer'))
    check((await fe.evaluate(() => window.__probes || 0)) >= 1, 'app-first: the flow probed Termux once it was allowed to')
    // "Hermes already installed? Check": the only probe the shell sends before Termux accepted a command (a user tap)
    check((await fe.evaluate(() => window.__probesNow || 0)) === 0, 'app-first: no forced Termux probe without a tap')
    await fe.getByRole('button', { name: 'Hermes already installed? Check' }).click({ timeout: 3000 }).catch(() => {})
    check((await fe.evaluate(() => window.__probesNow || 0)) === 1, 'app-first: Check sends the one forced probe')
    await fe.locator('.toast', { hasText: 'Run the installer' }).waitFor({ timeout: 3000 }).then(() => check(true, 'app-first: Check, Termux still refuses → says to run the installer'), () => check(false, 'app-first: Check, Termux still refuses → says to run the installer'))
    check((await fe.getByText('Run the installer', { exact: true }).count()) === 1, 'app-first: Check without Hermes keeps the installer step')
    await fe.getByRole('button', { name: 'Copy the command' }).click()
    check((await fe.evaluate(() => window.__copied)) === 1, 'app-first: Copy the command asks the shell for the command (the page never builds it)')
    await fe.getByText('Waiting for the installer to start', { exact: false }).waitFor({ timeout: 3000 }).then(() => check(true, 'app-first: after copying it waits for the installer'), () => check(false, 'app-first: after copying it waits for the installer'))
    const push = (lines, extra = {}) => fe.evaluate(([ls, ex]) => {
      for (const l of ls) {
        window.__t = (window.__t || Math.floor(Date.now() / 1000) - 400) + (window.__dt || 0)
        window.__progress = { ...window.__progress, ...ex, lines: [...window.__progress.lines, l], times: [...(window.__progress.times || []), window.__t], fail: l.startsWith('FAIL ') ? l.split(' ')[1] : l.startsWith('STEP ') ? '' : window.__progress.fail }
        window.hermesSetupLine(l)
      }
    }, [lines, extra])
    await fe.evaluate(() => (window.__dt = 0))
    await push(['STEP packages Termux packages'])
    await fe.evaluate(() => (window.__dt = 102))
    await push(['STEP access Access'])
    await fe.evaluate(() => (window.__dt = 10))
    await push([ 'phone: tap Allow on Android’s prompt, so Hermes can read and save your files', 'STEP android limit', 'android: child-process limit lifted (via Shizuku)', 'STEP debian Debian'])
    check((await fe.locator('.install-step', { hasText: 'Termux packages' }).locator('.install-time').textContent()) === '1:42', 'step times: a finished step shows how long it took (1:42)')
    const t0 = await fe.locator('.install-step.run .install-time').textContent()
    await sleep(2300)
    const t1 = await fe.locator('.install-step.run .install-time').textContent()
    check(t0 !== t1 && /^\d+:\d\d$/.test(t1), `step times: the running step counts up live (${t0} → ${t1})`)
    check(/^So far \d+:\d\d$/.test(((await fe.locator('.install-total').textContent()) || '').trim()), 'step times: a running total is shown')
    check((await fe.locator('.install-step.todo .install-time').count()) === 0, 'step times: steps still to come show no time')
    await fe.locator('.install-step.run', { hasText: 'Debian' }).waitFor({ timeout: 3000 }).then(() => check(true, 'app-first: progress lines show the running step'), () => check(false, 'app-first: progress lines show the running step'))
    check((await fe.locator('.install-step.ok').count()) === 3, 'app-first: finished installer steps are ticked')
    check((await fe.locator('.install-hint', { hasText: 'tap Allow on Android' }).count()) === 1, 'app-first: the latest “phone:” hint is shown')
    check(!(await fe.evaluate(() => window.__fixes || [])).includes('start'), 'app-first: Start Hermes is never asked for while the installer runs')
    await push(['FAIL debian (line 120)'])
    await fe.getByText('The installer stopped', { exact: true }).waitFor({ timeout: 3000 }).then(() => check(true, 'app-first: FAIL says where it stopped, with Copy again'), () => check(false, 'app-first: FAIL says where it stopped, with Copy again'))
    check((await fe.getByRole('button', { name: 'Copy the command' }).count()) === 1, 'app-first: FAIL offers the command again')
    await push(['STEP debian Debian', 'STEP hermes Hermes', 'STEP plugin Plugin', 'STEP start Start'])
    await mock({ up: true })
    await push(['DONE'], { done: true, active: false })
    check(/^Total \d+:\d\d$/.test(((await fe.locator('.install-total').textContent().catch(() => '')) || '').trim()) || (await fe.locator('.install-total').count()) === 0, 'step times: after DONE the total stops (or the view has moved on)')
    await fe.getByText('Connect Hermes to a model').waitFor({ timeout: 20000 }).then(() => check(true, 'app-first: DONE → connects → the model step'), () => check(false, 'app-first: DONE → connects → the model step'))
    await fe.close()
  }
  // f. a PC-installed phone on a new app build: the new rows never show, and Termux is not probed while Hermes answers
  await mock({ configured: true, pluginEnabled: true })
  {
    const ff = await flowPage({ ...OK, termuxApi: true, termuxBoot: true, termuxBootStopped: false, shizuku: true, canInstall: true, devOptions: true, wirelessDebugging: true, termuxSigner: 'fdroid', probe: true, maker: 'google' })
    await ff.goto(WEB + '/')
    await ff.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    await sleep(2000)
    check(!(await flowShown(ff)), 'app-first: a set-up phone goes straight to chat')
    await ff.locator('.conn-dot').click()
    await ff.getByRole('button', { name: 'Setup check' }).click()
    await ff.locator('.setup-hero-title', { hasText: 'All set' }).waitFor({ timeout: 6000 }).then(() => check(true, 'app-first: Setup check is All set with the new rows'), () => check(false, 'app-first: Setup check is All set with the new rows'))
    check((await ff.locator('.setup-item', { hasText: 'Start Shizuku' }).count()) === 0, 'app-first: no Start Shizuku row on a set-up phone')
    check((await ff.locator('.setup-item.ok', { hasText: 'Hermes is installed' }).count()) === 1 && (await ff.locator('.setup-item.ok', { hasText: 'Shizuku are installed' }).count()) === 1, 'app-first: the apps and installer rows are ✓ on a set-up phone')
    check((await ff.evaluate(() => window.__probes || 0)) === 0, 'app-first: Termux is not probed while Hermes answers')
    await ff.close()
  }
  await mock({ configured: true, pluginEnabled: true })

  // e. the flow at "Hermes can see and use the screen": Shizuku was started (the app sees it) but Termux can't use it yet.
  // The page says so (not "isn't running") and moves on by itself once Hermes reaches Shizuku, with no return to the app.
  await mock({ configured: true, pluginEnabled: true, phone: { files: true, shizuku: 'off' } })
  {
    const fs = await flowPage({ ...OK, termuxApi: true, termuxBoot: true, shizuku: true, shizukuRunning: true })
    await fs.goto(WEB + '/')
    const card = fs.locator('.flow-card', { hasText: 'Hermes can see and use the screen' })
    await card.waitFor({ timeout: 15000 }).then(() => check(true, 'flow: Shizuku not reachable → opens at the Shizuku step'), () => check(false, 'flow: Shizuku not reachable → opens at the Shizuku step'))
    const t = (await card.textContent().catch(() => '')) || ''
    check(t.includes('Shizuku is running, but Termux can’t use it yet') && !t.includes('isn’t running'), `flow: the app sees Shizuku running → says Termux can't use it yet, not "isn't running" (${t.slice(0, 120)})`)
    await mock({ phone: { files: true, shizuku: 'ok' } })
    await card.waitFor({ state: 'detached', timeout: 12000 }).then(() => check(true, 'flow: moves on by itself once Hermes reaches Shizuku (re-checks while on screen)'), () => check(false, 'flow: moves on by itself once Hermes reaches Shizuku (re-checks while on screen)'))
    await fs.close()
  }
}
