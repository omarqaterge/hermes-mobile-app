// Settings → Phone data for the agent: master + per-kind switches, decided by the shell (faked here: window.__pd is the
// shell's state and window.__pd.result its answer to phoneDataSet). The page only flips a switch on "ok".
// Not covered here, because it is Java: the biometric itself, Android's permission dialog, the generation counter that
// lets an off win over an on in flight, the switch cleared when a permission is seen missing, and blocked detection.
// Those were only compiled; they need a real phone (docs/status/phone-data.md).
const { WEB, check, sleep, nativeShell, png } = require('../lib.cjs')

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
          removed: pd.removed || {},
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
    // (the shell has already cleared the switch and set the removed flag)
    const pg = await open(fresh({ switches: { master: true }, removed: { sms: true }, perms: { sms: false } }))
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
    // coming back to the foreground re-reads the state
    const pg = await open(fresh())
    await row(pg, MASTER).waitFor({ timeout: 5000 })
    check(!(await isOn(pg, MASTER)), 'phone data: foreground re-read starts with the master off')
    await pg.evaluate(() => {
      window.__pd.switches.master = true
      window.__pd.removed = { calls: true }
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await row(pg, 'Call log').waitFor({ timeout: 3000 }).then(() => check(true, 'phone data: coming back to the foreground re-reads the switches'), () => check(false, 'phone data: coming back to the foreground re-reads the switches'))
    check(await isOn(pg, MASTER), 'phone data: the master shows the re-read state')
    check((await row(pg, 'Call log').innerText()).includes('Android removed this permission'), 'phone data: a removed permission shows after the re-read')
    await pg.close()
  }
  {
    // Settings search finds it
    const pg = await open(fresh())
    await pg.getByLabel('Search settings').fill('phone data')
    await pg.locator('.set-row', { hasText: 'Let the agent read phone data' }).first().waitFor({ timeout: 3000 }).then(() => check(true, 'phone data: Settings search finds it'), () => check(false, 'phone data: Settings search finds it'))
    await pg.close()
  }
  {
    // A phone_data result is the user's own text (an SMS can carry a URL): opening its card shows plain text only, with no media
    // preview, no fetch and no link. Another tool's card with the same text still has both.
    const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await pg.addInitScript(nativeShell)
    await pg.addInitScript(() => {
      window.__socks = []
      window.__sid = ''
      const Orig = window.WebSocket
      window.WebSocket = class extends Orig {
        constructor(...a) {
          super(...a)
          window.__socks.push(this)
          this.addEventListener('message', e => {
            try {
              const m = JSON.parse(e.data)
              if (m.params && m.params.session_id) window.__sid = m.params.session_id
            } catch {
              /* not JSON */
            }
          })
        }
      }
    })
    const hits = []
    await pg.route('http://beacon.test/**', r => {
      hits.push(r.request().url())
      return r.fulfill({ status: 200, contentType: 'image/png', body: png })
    })
    await pg.goto(WEB + '/')
    const box = pg.getByPlaceholder('Message Hermux')
    await box.waitFor({ timeout: 15000 })
    await box.fill('hello')
    await pg.locator('.composer').getByRole('button', { name: 'Send' }).click()
    await pg.waitForFunction(() => window.__sid, null, { timeout: 8000 })
    await sleep(2500)
    const text = 'Your code is at http://beacon.test/track.png?u=1 and see http://beacon.test/page'
    const tool = (name, id) =>
      pg.evaluate(([name, id, text]) => {
        const s = window.__socks.filter(x => x.readyState === 1).pop()
        const ev = (type, payload) => s.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, session_id: window.__sid, payload } }) }))
        ev('tool.start', { tool_id: id, name, args: { kind: 'sms' } })
        ev('tool.complete', { tool_id: id, name, args: { kind: 'sms' }, duration_s: 0.1, result: text })
      }, [name, id, text])
    const expandAll = async () => {
      for (let k = 0; k < 3; k++) {
        const runs = pg.locator('.tool-run[aria-expanded="false"]')
        if (!(await runs.count())) break
        await runs.first().click()
        await sleep(200)
      }
      const heads = pg.locator('.tool-head')
      for (let k = 0; k < (await heads.count()); k++) if ((await heads.nth(k).getAttribute('aria-expanded')) !== 'true') await heads.nth(k).click()
      await sleep(700)
    }
    const card = name =>
      pg.evaluate(name => {
        const c = [...document.querySelectorAll('.tool')].find(x => x.querySelector('.tool-name')?.getAttribute('title') === name)
        return c && { imgs: c.querySelectorAll('img, video, audio').length, links: c.querySelectorAll('a').length, text: c.innerText }
      }, name)
    await tool('phone_data', 'pdtool-1')
    await sleep(500)
    await expandAll()
    const pdc = await card('phone_data')
    check(pdc && pdc.text.includes('http://beacon.test/track.png?u=1'), 'phone data card: the result text is shown as it is')
    check(pdc && pdc.imgs === 0 && pdc.links === 0, `phone data card: no media preview and no link (${JSON.stringify(pdc && { imgs: pdc.imgs, links: pdc.links })})`)
    check(hits.length === 0, `phone data card: opening it fetches nothing (${JSON.stringify(hits)})`)
    await tool('terminal', 'othertool-1')
    await sleep(500)
    await expandAll()
    const oth = await card('terminal')
    check(oth && oth.imgs > 0 && oth.links > 0 && hits.length > 0, `phone data card: another tool's card still shows media and links (${JSON.stringify(oth && { imgs: oth.imgs, links: oth.links })}, ${hits.length} fetches)`)
    await pg.close()
  }
  {
    // A chat that has read phone data (a phone_data tool item, whatever its outcome): text the agent wrote can't load anything
    // remote before a tap, and an address is shown in full before it opens. Every access mode, Full access included. A chat
    // with no phone_data call is unchanged. Derived from the chat's items, so it comes back with a reload.
    const hits = []
    const setup = async sid => {
      const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
      await pg.addInitScript(sid => {
        localStorage.setItem('hm.lastSession', JSON.stringify({ id: sid, profile: 'default' }))
        window.__opened = []
        window.open = u => (window.__opened.push(String(u)), null) // openExternal's browser path
        window.__socks = []
        const Orig = window.WebSocket
        window.WebSocket = class extends Orig {
          constructor(...a) {
            super(...a)
            window.__socks.push(this)
          }
        }
      }, sid)
      await pg.route(/^https?:\/\/beacon\.test\//, r => {
        hits.push(r.request().url())
        return r.fulfill({ status: 200, contentType: 'image/png', body: png })
      })
      await pg.goto(WEB + '/')
      await pg.locator('.msg.assistant').first().waitFor({ timeout: 15000 })
      await sleep(700)
      return pg
    }
    const media = pg => pg.evaluate(() => ({ imgs: [...document.querySelectorAll('.msg.assistant img.media')].length, holds: [...document.querySelectorAll('.msg.assistant .remote-hold')].map(h => h.innerText) }))
    const dialogText = pg => pg.locator('.dialog').innerText({ timeout: 3000 }).catch(() => null)
    const opened = pg => pg.evaluate(() => window.__opened)

    // control: no phone_data call -> exactly as before
    hits.length = 0
    let pg = await setup('s-pd-ctl')
    let m = await media(pg)
    check(m.imgs === 1 && m.holds.length === 0 && hits.some(h => h.includes('/p.png')), `phone data taint: a chat with no phone_data call loads its image as before (${JSON.stringify(m)}, ${hits.length} fetches)`)
    await pg.locator('.msg.assistant a', { hasText: 'see more' }).click()
    await sleep(300)
    check((await pg.locator('.dialog').count()) === 0 && (await opened(pg)).length === 1 && (await opened(pg))[0].includes('/page?d=ROWS'), 'phone data taint: a link in a chat with no phone_data call opens at once')
    await pg.locator('.hm-openui').last().getByRole('button', { name: 'Visit site' }).click({ timeout: 15000 })
    await sleep(300)
    check((await pg.locator('.dialog').count()) === 0 && (await opened(pg)).some(u => u.startsWith('https://beacon.test/card')), 'phone data taint: a card open_url in a chat with no phone_data call opens at once')

    // taint appears while the items are already drawn: the image goes back behind a tap
    await pg.evaluate(() => {
      const s = window.__socks.filter(x => x.readyState === 1).pop()
      const ev = (type, payload) => s.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, session_id: 'rt-s-pd-ctl', payload } }) }))
      ev('tool.start', { tool_id: 'pd-live', name: 'phone_data', args: { kind: 'sms' } })
      ev('tool.complete', { tool_id: 'pd-live', name: 'phone_data', args: { kind: 'sms' }, duration_s: 0.1, result: 'x' })
    })
    await sleep(700)
    m = await media(pg)
    check(m.imgs === 0 && m.holds.length === 1, `phone data taint: a read that happens after the reply was drawn covers it too (${JSON.stringify(m)})`)
    await pg.close()

    // tainted: nothing before the tap
    hits.length = 0
    pg = await setup('s-pd')
    m = await media(pg)
    check(m.imgs === 0 && m.holds.length === 1 && /beacon\.test/.test(m.holds[0]) && /Tap to load/.test(m.holds[0]), `phone data taint: the image waits behind its host name and "Tap to load" (${JSON.stringify(m)})`)
    check(hits.length === 0, `phone data taint: no network request before the tap (${JSON.stringify(hits)})`)
    await pg.locator('.msg.assistant .remote-hold').click()
    await sleep(700)
    m = await media(pg)
    check(m.imgs === 1 && hits.some(h => h.includes('/p.png?d=ROWS')), `phone data taint: it loads after the tap (${JSON.stringify(m)})`)

    // links and cards show the address first
    await pg.locator('.msg.assistant a', { hasText: 'see more' }).click()
    const d1 = await dialogText(pg)
    check(d1 && d1.includes('http://beacon.test/page?d=ROWS') && /Site: beacon\.test/.test(d1) && d1.includes('?d=ROWS'), `phone data taint: a link shows the full address, host and query first (${d1})`)
    check((await opened(pg)).length === 0, 'phone data taint: and has opened nothing yet')
    await pg.locator('.dialog').getByRole('button', { name: 'Cancel' }).click()
    await sleep(300)
    check((await opened(pg)).length === 0, 'phone data taint: Cancel opens nothing')
    await pg.locator('.msg.assistant a', { hasText: 'see more' }).click()
    await pg.locator('.dialog').getByRole('button', { name: 'Open' }).click()
    await sleep(300)
    check((await opened(pg)).length === 1 && (await opened(pg))[0] === 'http://beacon.test/page?d=ROWS', 'phone data taint: Open on the dialog opens it')
    await pg.locator('.hm-openui').last().getByRole('button', { name: 'Visit site' }).click({ timeout: 15000 })
    const d2 = await dialogText(pg)
    check(d2 && d2.includes('https://beacon.test/card?d=ROWS') && (await opened(pg)).length === 1, `phone data taint: a card open_url shows the address first and opens nothing yet (${d2})`)
    await pg.locator('.dialog').getByRole('button', { name: 'Cancel' }).click()
    await sleep(300)

    // a new load: derived from the items, so it comes back
    hits.length = 0
    await pg.reload()
    await pg.locator('.msg.assistant').first().waitFor({ timeout: 15000 })
    await sleep(900)
    m = await media(pg)
    check(m.imgs === 0 && m.holds.length === 1 && hits.length === 0, `phone data taint: survives a page reload (${JSON.stringify(m)}, ${hits.length} fetches)`)

    // Full access (the app's /yolo) does not lift it
    await pg.getByPlaceholder('Message Hermux').fill('/yolo on')
    await pg.locator('.composer').getByRole('button', { name: 'Send' }).click()
    await sleep(900)
    m = await media(pg)
    check(m.imgs === 0 && m.holds.length === 1 && hits.length === 0, `phone data taint: Full access still holds the image (${JSON.stringify(m)}, ${hits.length} fetches)`)
    await pg.close()
  }
}
