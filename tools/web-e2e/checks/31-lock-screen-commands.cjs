// Slash commands over the lock screen (spec 3.4): the lock is checked before anything is sent, and only a short list of
// commands that only show something runs there, by their exact names, in a chat with access off. Everything else (an
// alias, a beginning Hermes would expand, a quick command, a command that changes a setting, /btw) waits for an unlock.
// Unlocked, /approvals off and smart ask with the Full access warning first.
const { WEB, check, sleep, rpcs, nativeShell, mock } = require('../lib.cjs')

const SENT = () => rpcs('slash.exec').length

module.exports = async t => {
  const open = async sid => {
    const pg = await t.browser.newPage({ viewport: { width: 360, height: 740 } })
    await pg.addInitScript(nativeShell)
    await pg.addInitScript(sid => localStorage.setItem('hm.lastSession', JSON.stringify({ id: sid, profile: 'default' })), sid)
    await pg.goto(WEB + '/')
    await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await sleep(700)
    return pg
  }
  const slash = async (pg, text) => {
    const before = SENT()
    await pg.getByPlaceholder('Message Hermux').fill(text)
    await pg.locator('.composer').getByRole('button', { name: 'Send' }).click()
    await sleep(400)
    return rpcs('slash.exec').slice(before).map(c => c.params.command)
  }
  const sent = async (pg, text, name) => check((await slash(pg, text)).length === 1, name)

  // ── a chat with approvals on: /help works over the lock screen; in Full access nothing runs but /yolo off ──
  let pg = await open('s-lock-ctl')
  await pg.evaluate(() => window.hermesLockView(true))
  await sent(pg, '/help', 'lock screen: /help in a chat with approvals on works as before')
  await pg.evaluate(() => window.hermesLockView(false))
  const yolo = v => rpcs('config.set').filter(c => c.params.key === 'yolo' && c.params.value === v).length
  const on = yolo('1')
  await slash(pg, '/yolo on')
  for (let i = 0; i < 30 && yolo('1') === on; i++) await sleep(100)
  await sleep(300)
  await pg.evaluate(() => window.hermesLockView(true))
  check((await slash(pg, '/help')).length === 0, 'lock screen: a chat in Full access sends no slash command')
  check((await pg.evaluate(() => window.__nativeCalls.filter(c => c === 'requestUnlock').length)) >= 1, 'lock screen: it asks for an unlock instead')
  const off = yolo('0')
  await slash(pg, '/yolo off')
  for (let i = 0; i < 30 && yolo('0') === off; i++) await sleep(100)
  check(yolo('0') === off + 1, 'lock screen: /yolo off still turns Full access off')
  await sleep(300)
  await sent(pg, '/help', 'lock screen: with access off the command goes as before')
  await pg.evaluate(() => window.hermesLockView(false))
  await pg.close()

  // ── over the lock screen only commands that show something run, in a chat with access off ──
  pg = await open('s-lock-ctl')
  await pg.evaluate(() => window.hermesLockView(true))
  const unlocks = () => pg.evaluate(() => window.__nativeCalls.filter(c => c === 'requestUnlock').length)
  for (const text of ['/approvals off', '/ap smart', '/cron run job1', '/cron remove job1', '/rollback 1', '/myquick', '/usage reset', '/kanban -- create x', '/stat', '/v', '/tasks', '/ctx', '/kanban swarm x', '/btw what time is it']) {
    const before = await unlocks()
    const s = await slash(pg, text)
    check(s.length === 0 && (await unlocks()) === before + 1, `lock screen: ${text} waits for an unlock (sent ${JSON.stringify(s)})`)
  }
  check((await pg.getByPlaceholder('Message Hermux').inputValue()) === '/btw what time is it', 'lock screen: the refused text stays in the box')
  await pg.getByPlaceholder('Message Hermux').fill('')
  for (const text of ['/status', '/kanban list', '/kanban --board b show t1', '/context', '/whoami'])
    check((await slash(pg, text)).join() === text.slice(1), `lock screen: ${text} still runs`)
  // A quick command (config.yaml) of the same name: Hermes may run it instead, so it waits; the catalog is asked each time.
  await mock({ quickCommands: ['version'] })
  {
    const before = await unlocks()
    check((await slash(pg, '/version')).length === 0 && (await unlocks()) === before + 1, 'lock screen: /version waits when a quick command has that name')
  }
  await mock({ quickCommands: [] })
  check((await slash(pg, '/version')).join() === 'version', 'lock screen: and runs again when none has')
  // A catalog with a warning (a loader failed, so a quick command of that name may be missing from it) can't vouch for one.
  await mock({ catalogWarning: 'quick_commands discovery unavailable: broken config.yaml' })
  {
    const before = await unlocks()
    check((await slash(pg, '/status')).length === 0 && (await unlocks()) === before + 1, 'lock screen: /status waits when the catalog has a warning')
  }
  await mock({ catalogWarning: '' })
  check((await slash(pg, '/status')).join() === 'status', 'lock screen: and runs again without one')
  // /yolo with anything but off waits, before a chat or a setting is touched.
  for (const text of ['/yolo', '/yolo on']) {
    const before = await unlocks()
    const sets = rpcs('config.set').length
    await slash(pg, text)
    check(rpcs('config.set').length === sets && (await unlocks()) === before + 1, `lock screen: ${text} waits for an unlock`)
  }
  // A worker that fails isn't followed by command.dispatch there (where a quick command runs first).
  {
    const dispatched = rpcs('command.dispatch').length
    const s = await slash(pg, '/help down')
    check(s.join() === 'help down' && rpcs('command.dispatch').length === dispatched, 'lock screen: a worker that fails is not followed by command.dispatch')
  }
  await pg.evaluate(() => window.hermesLockView(false))
  check((await slash(pg, '/cron run job1')).length === 1, 'unlocked: /cron run goes as before')
  await pg.close()

  // ── /approvals off and smart ask first, like Full access; manual doesn't ──
  pg = await open('s-lock-ctl')
  const dialog = () => pg.getByText('Give Hermux full access?')
  const ask = async text => {
    const before = SENT()
    await pg.getByPlaceholder('Message Hermux').fill(text)
    await pg.locator('.composer').getByRole('button', { name: 'Send' }).click()
    return dialog().waitFor({ timeout: 3000 }).then(() => true, () => false).then(shown => ({ shown, before }))
  }
  let r = await ask('/approvals off')
  check(r.shown && (await pg.getByText('in every chat of this bot', { exact: false }).count()) === 1, '/approvals off: the Full access warning first, saying it holds in every chat of the bot')
  await pg.getByRole('button', { name: 'Cancel' }).click()
  await sleep(400)
  check(SENT() === r.before && (await pg.getByText('Approvals not changed.').count()) === 1, '/approvals off: Cancel sends nothing')
  r = await ask('/APPR off')
  check(r.shown, '/approvals off: a beginning Hermes expands asks too')
  await pg.getByRole('button', { name: 'Allow full access' }).click()
  await sleep(400)
  check(rpcs('slash.exec').slice(r.before).map(c => c.params.command).join() === 'APPR off', '/approvals off: allowed, it goes to Hermes as typed')
  r = await ask('/approvals smart')
  check(r.shown, '/approvals smart: asks first too')
  await pg.getByRole('button', { name: 'Cancel' }).click()
  await sleep(300)
  r = await ask('/apdown')
  check(r.shown, '/approvals off reached through a quick command the page can see: asks first too')
  await pg.getByRole('button', { name: 'Cancel' }).click()
  await sleep(300)
  check(!rpcs('slash.exec').some(c => /^approvals/i.test(c.params.command)), '/approvals off reached through a quick command: Cancel sends nothing')
  // The phone locks while the question is up, and someone allows it over the lock screen: nothing is sent.
  r = await ask('/approvals off')
  await pg.evaluate(() => window.hermesLockView(true))
  await pg.getByRole('button', { name: 'Allow full access' }).click({ force: true }).catch(() => {})
  await sleep(400)
  check(SENT() === r.before && (await pg.getByText('Unlock the phone to run this command.').count()) >= 1, '/approvals off: allowed after the phone locked, nothing is sent')
  await pg.evaluate(() => window.hermesLockView(false))
  const before = SENT()
  await slash(pg, '/approvals manual')
  check(SENT() === before + 1 && (await dialog().count()) === 0, '/approvals manual: no question')
  await pg.close()

  // ── a side chat open before the phone locks closes over the lock screen ──
  pg = await open('s-lock-ctl')
  await slash(pg, '/btw')
  await pg.locator('.sheet.btw').waitFor({ timeout: 5000 })
  await pg.evaluate(() => window.hermesLockView(true))
  await sleep(200)
  check((await pg.locator('.sheet.btw').count()) === 0, 'lock screen: the side chat open before the lock closes')
  await pg.evaluate(() => window.hermesLockView(false))
  await slash(pg, '/btw')
  check((await pg.locator('.sheet.btw').count()) === 1, 'unlocked: the side chat opens again')
  await pg.close()
}
