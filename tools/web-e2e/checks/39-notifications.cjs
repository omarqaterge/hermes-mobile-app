// Settings → Notifications (task 12): the eighth row of the main page and its page. The shell's side is faked: window.__nc
// holds the two choices and Android's state, and every call is recorded with the key it came with (window.__ncCalls);
// a call without the per-page key throws, as the shell would ignore it. Each control is found by its role and name, used,
// and its effect checked: the call the page makes and what the page shows. Turning "When Hermux needs me" off asks first,
// and an approval then still opens the in-app sheet (the shell, not the page, stops posting the notification).
const { WEB, check, sleep, nativeShell, settingsPage, lowContrast, expectIdle } = require('../lib.cjs')

module.exports = async t => {
  const { browser } = t
  const open = async (nc, { size = { width: 375, height: 812 }, native = true, theme } = {}) => {
    const pg = await browser.newPage({ viewport: size })
    await pg.addInitScript(theme => {
      localStorage.setItem('hm.motion', 'off')
      if (theme) localStorage.setItem('hm.theme', theme)
    }, theme)
    if (native) {
      await pg.addInitScript(nativeShell)
      await pg.addInitScript(nc => {
        window.__nc = nc
        window.__ncCalls = []
        const k = (key, what) => {
          window.__ncCalls.push({ key, ...what })
          if (key !== 'K') throw new Error('bridge call without the key')
        }
        Object.assign(window.HermesAndroid, {
          notifyChoices: key => (k(key, { read: true }), JSON.stringify(window.__nc)),
          setNotifyChoice: (key, which, value) => {
            k(key, { which, value })
            if (window.__nc.refuse) return false
            window.__nc[which] = value === 'true'
            return true
          },
          approvalLockState: () => JSON.stringify({ on: true, secure: true }),
          confirmApproval: () => {}
        })
      }, nc)
    }
    await pg.goto(WEB + '/')
    await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    return pg
  }
  const toSettings = async pg => {
    await pg.getByRole('button', { name: /^Sessions/ }).click()
    await pg.getByRole('button', { name: 'Settings', exact: true }).click()
    await pg.getByRole('textbox', { name: 'Search settings' }).waitFor({ timeout: 5000 })
  }
  const sw = (pg, name) => pg.getByRole('switch', { name })
  const on = async (pg, name) => (await sw(pg, name).getAttribute('aria-checked')) === 'true'
  const sets = pg => pg.evaluate(() => window.__ncCalls.filter(c => 'which' in c))
  const fixes = pg => pg.evaluate(() => window.__fixes || [])
  const ALL = { finishes: true, needsMe: true, allowed: true, canAsk: false }

  // ── the row, the page, each switch, the confirmation, Android's page ──
  {
    const pg = await open({ ...ALL })
    await toSettings(pg)
    const row = pg.getByRole('button', { name: /^Notifications/ })
    check((await row.innerText()).includes('On'), `notifications: the main page's row says both kinds are on (${JSON.stringify(await row.innerText())})`)
    await settingsPage(pg, 'Notifications')
    check(await on(pg, 'When a task finishes') && await on(pg, 'When Hermux needs me'), 'notifications: both switches are on by default')
    const text = await pg.locator('.screen').innerText()
    check(text.includes('A reply, a scheduled job or a background task is done.') && text.includes('An approval or a question is waiting.'), 'notifications: each switch says what it covers')
    check((await pg.getByRole('group', { name: 'Notifications are off' }).count()) === 0, 'notifications: no notice while Android shows them')
    const reads = await pg.evaluate(() => window.__ncCalls.filter(c => c.read))
    check(reads.length > 0 && reads.every(c => c.key === 'K'), `notifications: the page reads the choices through the bridge with the per-page key (${reads.length} reads)`)

    await sw(pg, 'When a task finishes').click()
    let s = await sets(pg)
    check(s.length === 1 && s[0].key === 'K' && s[0].which === 'finishes' && s[0].value === 'false' && !(await on(pg, 'When a task finishes')), `notifications: When a task finishes off sends exactly "false" with the key and the switch shows off (${JSON.stringify(s)})`)
    check((await pg.getByRole('alertdialog').count()) === 0, 'notifications: turning When a task finishes off asks nothing')

    await sw(pg, 'When Hermux needs me').click()
    const dlg = pg.getByRole('alertdialog')
    await dlg.waitFor({ timeout: 3000 })
    check((await dlg.innerText()).includes('Hermux will wait silently until you open the app.'), 'notifications: turning When Hermux needs me off asks first, saying Hermux will wait silently')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await dlg.waitFor({ state: 'detached', timeout: 3000 })
    s = await sets(pg)
    check(s.length === 1 && await on(pg, 'When Hermux needs me'), `notifications: Cancel sends nothing and the switch stays on (${s.length} sets)`)
    await sw(pg, 'When Hermux needs me').click()
    await dlg.waitFor({ timeout: 3000 })
    await dlg.getByRole('button', { name: 'Turn off' }).click()
    await dlg.waitFor({ state: 'detached', timeout: 3000 })
    s = await sets(pg)
    check(s.length === 2 && s[1].key === 'K' && s[1].which === 'needsMe' && s[1].value === 'false' && !(await on(pg, 'When Hermux needs me')), `notifications: Turn off sends needsMe "false" with the key (${JSON.stringify(s[1])})`)
    await sw(pg, 'When Hermux needs me').click()
    await sleep(200)
    s = await sets(pg)
    check(s.length === 3 && s[2].which === 'needsMe' && s[2].value === 'true' && (await pg.getByRole('alertdialog').count()) === 0 && await on(pg, 'When Hermux needs me'), `notifications: turning it back on asks nothing and sends "true" (${JSON.stringify(s[2])})`)

    await pg.getByRole('button', { name: /^Sound, vibration and the lock screen/ }).click()
    check(JSON.stringify(await fixes(pg)) === '["notifications"]', `notifications: Sound, vibration and the lock screen opens Android's page for the app's notifications (${JSON.stringify(await fixes(pg))})`)
    await expectIdle(pg, 'notifications page')

    await pg.evaluate(() => window.hermesBack())
    await pg.getByRole('textbox', { name: 'Search settings' }).waitFor({ timeout: 3000 })
    const val = await pg.getByRole('button', { name: /^Notifications/ }).innerText()
    check(val.includes('Only when needed'), `notifications: Back goes to the main page, whose row now says only when needed (${JSON.stringify(val)})`)
    await pg.getByRole('textbox', { name: 'Search settings' }).fill('needs me')
    const hit = pg.getByRole('button', { name: /^When Hermux needs me/ })
    await hit.click()
    await pg.locator('.screen .title', { hasText: 'Notifications' }).waitFor({ timeout: 3000 })
    check(true, 'notifications: the settings search finds When Hermux needs me and opens its page')
    await pg.close()
  }

  // ── the shell refuses: the page says so and the switch stays as it was ──
  {
    const pg = await open({ ...ALL, refuse: true })
    await toSettings(pg)
    await settingsPage(pg, 'Notifications')
    await sw(pg, 'When a task finishes').click()
    const toast = await pg.getByText('Couldn’t change it').waitFor({ timeout: 3000 }).then(() => true, () => false)
    check(toast && await on(pg, 'When a task finishes'), 'notifications: a refused change shows "Couldn’t change it" and the switch stays on')
    await pg.close()
  }

  // ── Android shows none of them: the notice and its button, then the page reads again when Android answers ──
  for (const canAsk of [true, false]) {
    const pg = await open({ ...ALL, allowed: false, canAsk })
    await toSettings(pg)
    check((await pg.getByRole('button', { name: /^Notifications/ }).innerText()).includes('Off in Android'), `notifications (canAsk ${canAsk}): the main page's row says Android has them off`)
    await settingsPage(pg, 'Notifications')
    const notice = pg.getByRole('group', { name: 'Notifications are off' })
    await notice.waitFor({ timeout: 3000 })
    const label = canAsk ? 'Turn on notifications' : 'Open Android settings'
    const btn = notice.getByRole('button', { name: label })
    const h = await btn.evaluate(e => Math.round(e.getBoundingClientRect().height))
    await btn.click()
    check(JSON.stringify(await fixes(pg)) === '["notify-permission"]' && h >= 44, `notifications (canAsk ${canAsk}): the notice's ${label} asks the shell, which shows Android's dialog or its page (${JSON.stringify(await fixes(pg))}, ${h} px)`)
    await pg.evaluate(() => {
      window.__nc.allowed = true
      window.hermesNotifyChanged()
    })
    const gone = await notice.waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false)
    check(gone, `notifications (canAsk ${canAsk}): when Android answers, the page reads again and the notice goes`)
    await pg.close()
  }

  // ── "needs me" off: an approval still waits in the app, with its sheet ──
  {
    const pg = await open({ ...ALL, needsMe: false })
    await pg.getByPlaceholder('Message Hermux').fill('run the thing')
    await pg.locator('.composer').getByRole('button', { name: 'Send' }).click()
    const sheet = await pg.locator('.sheet .sheet-title', { hasText: 'Approve' }).waitFor({ timeout: 5000 }).then(() => true, () => false)
    check(sheet && (await pg.locator('.sheet').getByRole('button', { name: 'Allow once' }).count()) === 1, 'notifications: with When Hermux needs me off, an approval still opens its sheet in the app')
    await pg.close()
  }

  // ── 320 px, the largest text, Light: nothing wider than the screen, every text at 4.5:1 ──
  {
    const pg = await open({ ...ALL, allowed: false, canAsk: true }, { size: { width: 320, height: 700 }, theme: 'light' })
    await pg.evaluate(() => localStorage.setItem('hm.textScale', '1.35'))
    await pg.reload()
    await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await toSettings(pg)
    await settingsPage(pg, 'Notifications')
    await pg.getByRole('group', { name: 'Notifications are off' }).waitFor({ timeout: 3000 })
    const over = await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll('.screen button, .screen [role="switch"]')].some(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1) }))
    check(!over, 'notifications: at 320 px with the largest text no button or switch is off the screen')
    const low = await lowContrast(pg, '.screen')
    check(low.length === 0, `notifications: in Light every text on the page reaches 4.5:1 (${JSON.stringify(low)})`)
    await pg.close()
  }

  // ── a plain browser: the page says where it is set ──
  {
    const pg = await open(null, { native: false })
    await toSettings(pg)
    await settingsPage(pg, 'Notifications')
    const text = await pg.locator('.screen').innerText()
    check(text.includes('Not available here') && (await pg.getByRole('switch').count()) === 0, 'notifications: without the Android app the page says it is not available here')
    await pg.close()
  }
}
