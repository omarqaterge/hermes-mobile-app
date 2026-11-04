// Confirm approvals with fingerprint: the first Allow in a chat session asks the shell for the biometric or screen
// lock (faked here: window.__al is the shell's answer), later approvals in that chat don't; Deny never asks.
const { WEB, calls, check, sleep, nativeShell, mock, png } = require('../lib.cjs')

module.exports = async t => {
  const { browser } = t
  const open = async (al, pd) => {
    const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await pg.addInitScript(nativeShell)
    if (pd) {
      // The phone-data side of the shell, faked: window.__pd logs every grant and Full access call; window.__out has what the
      // page sent over the WebSocket (so a grant can be told from an answer, and which came first).
      await pg.addInitScript(pd => {
        window.__out = []
        window.__socks = []
        window.__pd = []
        if (pd.full) localStorage.setItem('hm.defaultAccess.v1', 'full')
        const Orig = window.WebSocket
        window.WebSocket = class extends Orig {
          constructor(...a) {
            super(...a)
            window.__socks.push(this)
          }
          send(d) {
            try {
              window.__out.push(JSON.parse(d))
            } catch {
              /* not JSON */
            }
            return super.send(d)
          }
        }
        // The shell's phone-data methods on the bridge the page ends up with (no key: this check does not depend on the list in
        // secure-bridge.ts that makes the wrapper add it).
        const stubs = {
          phoneDataGrant: d => (window.__pd.push({ grant: d, answeredYet: window.__out.some(m => m.id === window.__pdId && 'result' in m) }), true),
          phoneDataFullAccess: (s, on) => window.__pd.push({ full: s, on })
        }
        let bridge = window.HermesAndroid
        Object.defineProperty(window, 'HermesAndroid', {
          configurable: true,
          get: () => bridge,
          set: v => {
            bridge = v
            if (v) Object.assign(v, stubs)
          }
        })
      }, pd)
    }
    await pg.addInitScript(al => {
      window.__al = al
      window.__alCalls = []
      Object.assign(window.HermesAndroid, {
        confirmApproval: (key, id, session, what) => {
          window.__alCalls.push({ key, session, what })
          setTimeout(() => window.hermesApprovalConfirm(id, window.__al.result), 30)
        },
        confirmIdentity: (key, id, what) => {
          window.__alCalls.push({ key, what, always: true })
          setTimeout(() => window.hermesApprovalConfirm(id, window.__al.result), 30)
        },
        approvalLockState: () => JSON.stringify({ on: window.__al.on, secure: window.__al.secure }),
        setApprovalLock: (key, on) => {
          window.__al.on = on
          window.__alCalls.push({ key, set: on })
        },
        forgetApproval: (key, session) => window.__alCalls.push({ key, forget: session })
      })
    }, al)
    await pg.goto(WEB + '/')
    await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    return pg
  }
  const ask = async (pg, text) => {
    await pg.getByPlaceholder('Message Hermux').fill(text)
    await pg.locator('.composer').getByRole('button', { name: 'Send' }).click()
    await pg.locator('.sheet .sheet-title', { hasText: 'Approve' }).waitFor({ timeout: 5000 })
  }
  const answers = id => calls().filter(c => c.answer === id)
  const confirms = pg => pg.evaluate(() => window.__alCalls.filter(c => 'what' in c))

  {
    const pg = await open({ on: true, secure: true, result: 'cancel' })
    const before = answers('srv-approval-1').length
    await ask(pg, 'run the thing')
    await pg.locator('.sheet').getByRole('button', { name: 'Allow once' }).click()
    await sleep(300)
    let c = await confirms(pg)
    check(c.length === 1 && c[0].key === 'K' && c[0].session && /rm -rf/.test(c[0].what), `approval lock: the first Allow asks the shell, with the per-page key and the command (${JSON.stringify(c)})`)
    check(answers('srv-approval-1').length === before, 'approval lock: a cancelled confirmation answers nothing')
    check((await pg.locator('.sheet .sheet-title', { hasText: 'Approve' }).count()) === 1, 'approval lock: the sheet stays open after a cancel')
    await pg.evaluate(() => (window.__al.result = 'ok'))
    await pg.locator('.sheet').getByRole('button', { name: 'Allow once' }).click()
    await sleep(400)
    const a = answers('srv-approval-1').slice(before)
    check(a.length === 1 && a[0].result?.choice === 'once', `approval lock: confirmed, the Allow goes through (${JSON.stringify(a)})`)
    // the next approval in the same chat session doesn't ask again
    const beforeLong = answers('srv-approval-long').length
    await ask(pg, 'run the long thing')
    await pg.locator('.sheet').getByRole('button', { name: 'Allow once' }).click()
    await sleep(400)
    c = await confirms(pg)
    check(c.length === 2 && answers('srv-approval-long').length === beforeLong + 1, `approval lock: later approvals in the chat don't ask again (${c.length} prompts)`)

    // Settings → Permissions: the switch, and turning it off asks first
    await pg.getByRole('button', { name: /^Sessions/ }).click()
    await pg.locator('.nav-tile', { hasText: 'Settings' }).click()
    const row = pg.locator('.set-row', { hasText: 'Confirm approvals with fingerprint' })
    await row.waitFor({ timeout: 5000 })
    check((await row.getByRole('switch').getAttribute('aria-checked')) === 'true', 'approval lock: the Settings switch is on by default')
    await pg.evaluate(() => (window.__al.result = 'cancel'))
    await row.click()
    await sleep(300)
    check(await pg.evaluate(() => window.__al.on === true), 'approval lock: turning it off without confirming keeps it on')
    await pg.evaluate(() => (window.__al.result = 'ok'))
    await row.click()
    await sleep(300)
    c = await confirms(pg)
    check(await pg.evaluate(() => window.__al.on === false && window.__alCalls.some(x => x.set === false)), 'approval lock: turning it off after confirming saves it in the shell')
    check(c.slice(-1)[0]?.session === '', 'approval lock: turning it off asks for the screen lock (no chat)')
    await pg.close()
  }
  {
    // Settings → Background apps: every change to banking, payment, password and 2FA apps asks, even with approvals' switch off
    await mock({ bgapps: { allow_sensitive: false, available: true } })
    const pg = await open({ on: false, secure: true, result: 'cancel' })
    await pg.getByRole('button', { name: /^Sessions/ }).click()
    await pg.locator('.nav-tile', { hasText: 'Settings' }).click()
    const row = pg.locator('.set-row', { hasText: 'Allow banking, payment, password and 2FA apps' })
    await row.waitFor({ timeout: 5000 })
    const puts = () => calls().filter(c => c.http === 'PUT' && c.path === '/api/plugins/hermes-mobile/bgapps')
    const before = puts().length
    check((await row.getByRole('switch').getAttribute('aria-checked')) === 'false', 'sensitive apps: off by default')
    await row.click()
    await sleep(300)
    let c = await confirms(pg)
    check(c.length === 1 && c[0].always && c[0].key === 'K' && /^Allow banking/.test(c[0].what), `sensitive apps: turning on asks for the fingerprint (${JSON.stringify(c)})`)
    check(puts().length === before && (await row.getByRole('switch').getAttribute('aria-checked')) === 'false', 'sensitive apps: a cancelled confirmation keeps it off and saves nothing')
    await pg.evaluate(() => (window.__al.result = 'ok'))
    await row.click()
    await sleep(400)
    check(puts().length === before + 1 && puts().slice(-1)[0].body.allow_sensitive === true, 'sensitive apps: confirmed, it turns on')
    await pg.evaluate(() => (window.__al.result = 'cancel'))
    await row.click()
    await sleep(400)
    c = await confirms(pg)
    check(c.length === 3 && /^Stop allowing/.test(c[2].what), `sensitive apps: turning off asks too (${c.length} prompts)`)
    check(puts().length === before + 1 && (await row.getByRole('switch').getAttribute('aria-checked')) === 'true', 'sensitive apps: a cancelled confirmation keeps it on')
    await pg.evaluate(() => (window.__al.result = 'ok'))
    await row.click()
    await sleep(400)
    check((await confirms(pg)).length === 4 && puts().slice(-1)[0].body.allow_sensitive === false, 'sensitive apps: confirmed, it turns off')
    await row.click()
    await sleep(400)
    check((await confirms(pg)).length === 5 && puts().slice(-1)[0].body.allow_sensitive === true, 'sensitive apps: turning it on again asks again')
    await mock({ bgapps: { allow_sensitive: false } })
    await pg.close()
  }
  {
    // Deny never asks
    const pg = await open({ on: true, secure: true, result: 'ok' })
    const before = answers('srv-approval-1').length
    await ask(pg, 'run the thing')
    await pg.locator('.sheet').getByRole('button', { name: 'Deny' }).click()
    await sleep(400)
    const a = answers('srv-approval-1').slice(before)
    check(a.length === 1 && a[0].result?.choice === 'deny' && (await confirms(pg)).length === 0, 'approval lock: Deny goes through without asking')
    await pg.close()
  }
  {
    // no screen lock: approved as before, with a one-time hint
    const pg = await open({ on: true, secure: false, result: 'nolock' })
    const before = answers('srv-approval-1').length
    await ask(pg, 'run the thing')
    await pg.locator('.sheet').getByRole('button', { name: 'Allow once' }).click()
    await sleep(400)
    check(answers('srv-approval-1').length === before + 1, 'approval lock: with no screen lock the Allow goes through')
    check((await pg.getByText('This phone has no screen lock').count()) > 0, 'approval lock: no screen lock shows a hint')
    check(await pg.evaluate(() => localStorage.getItem('hm.approvalNoLockHint.v1') === '1'), 'approval lock: the hint is shown once')
    await pg.close()
  }

  // ── Phone data (docs/status/phone-data.md): a grant is made only after the fingerprint step and never over the lock screen ──
  {
    const desc = `phone_data:v1:calls:0123456789ab:${Buffer.from('{"limit":3}', 'utf8').toString('hex')}`
    const pg = await open({ on: true, secure: true, result: 'cancel' }, {})
    const send = id => pg.evaluate(([id, d]) => {
      window.__pdId = id
      const s = window.__socks.filter(x => x.readyState === 1).pop()
      s.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', id, method: 'approval', params: { session_id: 'rt-new', tool_name: 'phone_data', description: d, command: '<phone_data> (plugin approval rule)' } }) }))
    }, [id, desc])
    const out = id => pg.evaluate(id => window.__out.filter(m => m.id === id && 'result' in m), id)
    const grants = () => pg.evaluate(() => window.__pd.filter(x => 'grant' in x))
    const sheet = pg.locator('.sheet')

    await send('pdl-1')
    await sheet.getByText('Read up to 3 call log entries').waitFor({ timeout: 5000 })
    await sheet.getByRole('button', { name: 'Allow once' }).click()
    await sleep(300)
    let c = await confirms(pg)
    check(c.length === 1 && c[0].what === 'Read up to 3 call log entries from the last 7 days', `phone data: the fingerprint prompt says what will be read, in the app's words (${JSON.stringify(c)})`)
    check((await grants()).length === 0 && (await out('pdl-1')).length === 0, 'phone data: a cancelled fingerprint makes no grant and answers nothing')
    await pg.evaluate(() => (window.__al.result = 'ok'))
    await sheet.getByRole('button', { name: 'Allow once' }).click()
    await sleep(400)
    let g = await grants()
    check(g.length === 1 && g[0].grant === desc && g[0].answeredYet === false && (await out('pdl-1')).length === 1, `phone data: confirmed, the grant is made, then the answer goes (${JSON.stringify(g)})`)

    // Over the lock screen: Allow only asks for an unlock; nothing is granted or answered. Deny works.
    await pg.evaluate(() => window.__al.on = false) // no fingerprint step, so only the lock screen can stop it
    await send('pdl-2')
    await sheet.getByText('Read up to 3 call log entries').waitFor({ timeout: 5000 })
    await pg.evaluate(() => window.hermesLockView(true))
    await sheet.getByRole('button', { name: 'Allow once' }).click()
    await sleep(300)
    check((await grants()).length === 1 && (await out('pdl-2')).length === 0, 'phone data: over the lock screen an Allow makes no grant and answers nothing')
    await sheet.getByRole('button', { name: 'Deny' }).click()
    await sleep(300)
    check((await grants()).length === 1 && (await out('pdl-2')).length === 1 && (await out('pdl-2'))[0].result.choice === 'deny', 'phone data: over the lock screen a Deny still goes, with no grant')
    await pg.evaluate(() => window.hermesLockView(false))
    await pg.close()
  }
  {
    // Full access gives the chat the pass, and takes it away when it goes back to Off and when the chat closes.
    const pg = await open({ on: false, secure: true, result: 'ok' }, { full: true })
    await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await sleep(500)
    const full = () => pg.evaluate(() => window.__pd.filter(x => 'full' in x))
    check((await full()).some(x => x.full === '' && x.on === false), 'phone data: a page load starts with no chat in Full access')
    await pg.getByPlaceholder('Message Hermux').fill('/yolo off')
    await pg.locator('.composer').getByRole('button', { name: 'Send' }).click()
    await sleep(800)
    let f = await full()
    const chat = (f.find(x => x.on === true) || {}).full
    check(chat, `phone data: Full access (the chat's default) gives the chat the pass (${JSON.stringify(f)})`)
    check(f.slice(-1)[0] && f.slice(-1)[0].full === chat && f.slice(-1)[0].on === false, `phone data: going back to Off takes the pass away (${JSON.stringify(f.slice(-2))})`)
    await pg.getByPlaceholder('Message Hermux').fill('/yolo on')
    await pg.locator('.composer').getByRole('button', { name: 'Send' }).click()
    await sleep(800)
    f = await full()
    check(f.slice(-1)[0] && f.slice(-1)[0].full === chat && f.slice(-1)[0].on === true, `phone data: /yolo on gives it back (${JSON.stringify(f.slice(-2))})`)
    await pg.close()
  }
  {
    // Closing the chat's live session takes the pass away (an empty chat is replaced when a model is picked).
    const pg = await open({ on: false, secure: true, result: 'ok' }, { full: true })
    await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await sleep(800)
    const full = () => pg.evaluate(() => window.__pd.filter(x => 'full' in x))
    // a photo added and removed makes the (empty) chat; picking a model then replaces it and closes it
    await pg.getByRole('button', { name: 'Add', exact: true }).click()
    const [chooser] = await Promise.all([pg.waitForEvent('filechooser'), pg.locator('.picker-opt', { hasText: 'Photo' }).click()])
    await chooser.setFiles([{ name: 'x.png', mimeType: 'image/png', buffer: png }])
    await pg.locator('.attach-thumb img[alt="x.png"]').waitFor({ timeout: 5000 })
    await pg.getByRole('button', { name: 'Remove x.png' }).click()
    await sleep(500)
    const chat = ((await full()).find(x => x.on === true) || {}).full
    await pg.getByRole('button', { name: 'Add', exact: true }).click()
    await pg.locator('.picker-opt', { hasText: 'mock-model' }).click()
    await pg.locator('.row', { hasText: 'mock-sonnet' }).click()
    await sleep(1000)
    const f = await full()
    check(chat && f.some(x => x.full === chat && x.on === false && f.indexOf(x) > f.findIndex(y => y.full === chat && y.on === true)), `phone data: closing the chat takes the pass away (${JSON.stringify(f)})`)
    await pg.close()
  }
}
