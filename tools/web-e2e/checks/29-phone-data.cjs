// Settings → Phone data for the agent: master + per-kind switches, decided by the shell (faked here: window.__pd is the
// shell's state and window.__pd.result its answer to phoneDataSet). The page only flips a switch on "ok".
const { WEB, check, sleep, nativeShell } = require('../lib.cjs')

module.exports = async t => {
  const { browser } = t
  const open = async (pd, { bridge = true } = {}) => {
    const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await pg.addInitScript(nativeShell)
    if (bridge) {
      await pg.addInitScript(pd => {
        window.__pd = pd
        window.__pdCalls = []
        const kinds = ['contacts', 'calendar', 'calls', 'sms', 'location', 'photos']
        const state = () => ({
          ready: pd.ready,
          master: !!pd.switches.master,
          kinds: Object.fromEntries(kinds.map(k => [k, !!(pd.switches.master && pd.switches[k] && pd.perms[k])])),
          switches: pd.switches,
          perms: pd.perms,
          secure: pd.secure
        })
        Object.assign(window.HermesAndroid, {
          phoneDataState: key => JSON.stringify(state()),
          phoneDataSet: (key, id, kind, on) => {
            window.__pdCalls.push({ key, kind, on })
            if (!on) {
              pd.switches[kind] = false
              setTimeout(() => window.hermesPhoneData(id, 'ok'), 10)
              return
            }
            setTimeout(() => {
              if (pd.result === 'ok') {
                pd.switches[kind] = true
                if (kind !== 'master') pd.perms[kind] = true
              }
              window.hermesPhoneData(id, pd.result)
            }, 40)
          },
          phoneDataOpenSettings: key => window.__pdCalls.push({ key, settings: true })
        })
      }, pd)
    }
    await pg.goto(WEB + '/')
    await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await pg.getByRole('button', { name: /^Sessions/ }).click()
    await pg.locator('.nav-tile', { hasText: 'Settings' }).click()
    await pg.locator('.screen .title', { hasText: 'Settings' }).waitFor({ timeout: 5000 })
    return pg
  }
  const fresh = (over = {}) => ({ ready: true, secure: true, result: 'ok', switches: {}, perms: {}, ...over })
  const row = (pg, text) => pg.locator('.set-row', { hasText: text }).first()
  const sw = (pg, text) => row(pg, text).getByRole('switch')
  const isOn = async (pg, text) => (await sw(pg, text).getAttribute('aria-checked', { timeout: 1500 }).catch(() => null)) === 'true'
  const calls = pg => pg.evaluate(() => window.__pdCalls)
  const MASTER = 'Let the agent read phone data'
  const KINDS = ['Contacts', 'Calendar', 'Call log', 'Messages (SMS)', 'Location (approximate)', 'Latest photos']

  {
    // not ready, or no bridge: hidden
    let pg = await open(fresh({ ready: false }))
    check((await pg.getByText('Phone data for the agent').count()) === 0, 'phone data: hidden when the feature is not ready')
    await pg.close()
    pg = await open(fresh(), { bridge: false })
    check((await pg.getByText('Phone data for the agent').count()) === 0, 'phone data: hidden without the native methods')
    await pg.close()
  }
  {
    const pg = await open(fresh())
    await row(pg, MASTER).waitFor({ timeout: 5000 })
    check(!(await isOn(pg, MASTER)), 'phone data: the master switch starts off')
    check((await pg.getByText('Applies to new chats.').count()) > 0 && (await pg.getByText(/Results go to your chosen model provider/).count()) > 0, 'phone data: the footer explains where results go')
    for (const k of KINDS) check((await row(pg, k).isVisible().catch(() => false)) === false, `phone data: ${k} is hidden while the master is off`)

    // turn the master on: the shell is asked, the switch flips on "ok"
    await row(pg, MASTER).click()
    await sleep(400)
    let c = await calls(pg)
    check(c.length === 1 && c[0].key === 'K' && c[0].kind === 'master' && c[0].on === true, `phone data: turning the master on calls phoneDataSet with the key (${JSON.stringify(c)})`)
    check(await isOn(pg, MASTER), 'phone data: the master flips on after ok')
    for (const k of KINDS) {
      await row(pg, k).waitFor({ timeout: 3000 }).then(() => check(true, `phone data: ${k} row shows`), () => check(false, `phone data: ${k} row shows`))
      check(!(await isOn(pg, k)), `phone data: ${k} starts off`)
    }
    check((await pg.getByText('Date, size and dimensions only. Never the pictures').count()) > 0, 'phone data: photos say details only')

    // a kind on ok
    await row(pg, 'Contacts').click()
    await sleep(400)
    check(await isOn(pg, 'Contacts'), 'phone data: a kind flips on after ok')

    // turning off: instant, no prompt, no permission
    await row(pg, 'Contacts').click()
    await sleep(250)
    c = await calls(pg)
    check(!(await isOn(pg, 'Contacts')) && c[c.length - 1].on === false, 'phone data: turning a kind off is immediate')
    check((await pg.locator('.sheet').count()) === 0 && (await pg.getByText('Not changed').count()) === 0, 'phone data: turning off shows no prompt')
    await pg.close()
  }
  for (const [result, msg] of [['cancel', 'Not changed: confirm it’s you to change this'], ['nolock', 'Set a screen lock first'], ['denied', 'Android refused the permission']]) {
    const pg = await open(fresh({ result }))
    await row(pg, MASTER).click()
    await pg.getByText(msg).first().waitFor({ timeout: 3000 }).then(() => check(true, `phone data: ${result} shows "${msg}"`), () => check(false, `phone data: ${result} shows "${msg}"`))
    check(!(await isOn(pg, MASTER)), `phone data: ${result} leaves the master off`)
    await pg.close()
  }
  {
    // denied for a kind stays off; blocked shows the way to Android settings
    const pg = await open(fresh({ switches: { master: true }, result: 'blocked' }))
    await row(pg, 'Calendar').click()
    await row(pg, 'Allow it in Android settings').waitFor({ timeout: 3000 }).then(() => check(true, 'phone data: blocked shows the Android settings row'), () => check(false, 'phone data: blocked shows the Android settings row'))
    check(!(await isOn(pg, 'Calendar')), 'phone data: blocked leaves the kind off')
    await row(pg, 'Allow it in Android settings').click()
    await sleep(200)
    check((await calls(pg)).some(c => c.settings && c.key === 'K'), 'phone data: the row opens Android settings')
    await pg.close()
  }
  {
    // permission removed by Android: shows off with the reason, turning on goes through the normal flow
    const pg = await open(fresh({ switches: { master: true, sms: true }, perms: { sms: false } }))
    await row(pg, 'Messages (SMS)').waitFor({ timeout: 5000 })
    check(!(await isOn(pg, 'Messages (SMS)')), 'phone data: a kind whose permission is gone shows off')
    check((await row(pg, 'Messages (SMS)').innerText()).includes('Android removed this permission'), 'phone data: it says Android removed the permission')
    await row(pg, 'Messages (SMS)').click()
    await sleep(400)
    const c = await calls(pg)
    check(c.length === 1 && c[0].kind === 'sms' && c[0].on === true && (await isOn(pg, 'Messages (SMS)')), 'phone data: turning it on again goes through phoneDataSet')
    await pg.close()
  }
  {
    // Settings search finds it
    const pg = await open(fresh())
    await pg.getByLabel('Search settings').fill('phone data')
    await pg.locator('.set-row', { hasText: 'Let the agent read phone data' }).first().waitFor({ timeout: 3000 }).then(() => check(true, 'phone data: Settings search finds it'), () => check(false, 'phone data: Settings search finds it'))
    await pg.close()
  }
}
