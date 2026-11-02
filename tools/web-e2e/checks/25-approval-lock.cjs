// Confirm approvals with fingerprint: the first Allow in a chat session asks the shell for the biometric or screen
// lock (faked here: window.__al is the shell's answer), later approvals in that chat don't; Deny never asks.
const { WEB, calls, check, sleep, nativeShell } = require('../lib.cjs')

module.exports = async t => {
  const { browser } = t
  const open = async al => {
    const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await pg.addInitScript(nativeShell)
    await pg.addInitScript(al => {
      window.__al = al
      window.__alCalls = []
      Object.assign(window.HermesAndroid, {
        confirmApproval: (key, id, session, what) => {
          window.__alCalls.push({ key, session, what })
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
    await pg.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    return pg
  }
  const ask = async (pg, text) => {
    await pg.getByPlaceholder('Message Hermes').fill(text)
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
}
