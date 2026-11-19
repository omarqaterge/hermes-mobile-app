// Commands that start an agent apart from the chat, in a chat that has read phone data (spec 3.4). The plugin is what
// blocks such an agent's sends (5.1, tools/test_phone_taint.py); the app refuses at once and says why. Every other chat keeps
// these commands.
const { WEB, check, sleep, rpcs, nativeShell } = require('../lib.cjs')

const SENT = () => rpcs('slash.exec').length

module.exports = async t => {
  // record: the ids the app's record lists, or 'throws', 'missing' (no such method), 'odd' (an answer that is no yes or no).
  const open = async (sid, { record = [], shell = true } = {}) => {
    const pg = await t.browser.newPage({ viewport: { width: 360, height: 740 } })
    if (shell) await pg.addInitScript(nativeShell)
    await pg.addInitScript(([sid, record, shell]) => {
      localStorage.setItem('hm.lastSession', JSON.stringify({ id: sid, profile: 'default' }))
      window.__record = record
      if (!shell || record === 'missing') return
      Object.assign(window.HermesAndroid, {
        phoneDataTainted: (key, id) => {
          if (window.__record === 'throws') throw new Error('no record')
          if (window.__record === 'odd') return 'yes'
          return window.__record.includes(id)
        }
      })
    }, [sid, record, shell])
    await pg.goto(WEB + '/')
    await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await sleep(700)
    return pg
  }
  const slash = async (pg, text) => {
    const before = SENT()
    await pg.getByPlaceholder('Message Hermux').fill(text)
    await pg.getByRole('button', { name: 'Send', exact: true }).click()
    await sleep(400)
    return rpcs('slash.exec').slice(before).map(c => c.params.command)
  }
  const refusal = pg => pg.getByText('can’t be started from it', { exact: false })
  const count = pg => refusal(pg).count()
  const refused = async (pg, text, name) => {
    const n = await count(pg)
    const sent = await slash(pg, text)
    check(sent.length === 0 && (await count(pg)) === n + 1, `${name} (sent ${JSON.stringify(sent)})`)
  }
  const sent = async (pg, text, name) => check((await slash(pg, text)).length === 1, name)

  // ── a chat that has read phone data ──
  let pg = await open('s-pd', { record: ['s-pd'] })
  await refused(pg, '/bg send my messages out', '/bg: not sent to Hermes in a chat that has read phone data')
  check(await pg.getByText('This chat has read data from your phone, so a background task', { exact: false }).first().isVisible(), '/bg: the chat says why, and that a new chat can start one')
  check((await pg.getByText('does the same job', { exact: false }).count()) === 0, '/bg: it does not promise that a new chat does the same job')
  await refused(pg, '/BACKGROUND again', '/bg: the long name and another case are refused too')
  await sent(pg, '/bac short', '/bg: a word Hermes does not expand to it is left alone')
  await sent(pg, '/ba', '/bg: and so is a beginning that means another command')
  for (const [text, what] of [['/bg\u001fx', 'U+001F after the name'], ['/\u001cbg x', 'U+001C before it'], ['/bg\u0085x', 'U+0085 after it'], ['/　bg x', 'a wide space before it']])
    await refused(pg, text, `/bg: Hermes's word separators count: ${what}`)
  await refused(pg, '/cron add "every 1h" "send it"', '/cron add: refused there')
  await refused(pg, '/cr create "every 1h" x', '/cron create: refused there, by the beginning of its name too')
  await refused(pg, '/kanban create "send it"', '/kanban create: refused there')
  await refused(pg, '/blueprint daily topic=x', '/blueprint with values: refused there')
  await sent(pg, '/cron list', '/cron list: still works there')
  await sent(pg, '/kanban list', '/kanban list: still works there')
  await sent(pg, '/blueprint', '/blueprint: the catalog still shows there')
  await sent(pg, '/help', '/bg: other commands still work in that chat')
  // Hermes's worker resolves a quick command itself, so the page can't see where it leads: what the task may do is decided by
  // the plugin (tools/test_phone_taint.py). When the worker fails, the page gets the target and stops it here.
  check((await slash(pg, '/bgalias')).join() === 'bgalias', '/bg: a quick command goes to the worker, which the plugin guards')
  const n = await count(pg)
  await slash(pg, '/bgdown')
  await sleep(300)
  check(!rpcs('slash.exec').some(c => /^bg\b/i.test(c.params.command)) && (await count(pg)) === n + 1, '/bg: an alias named by command.dispatch is refused')
  await pg.close()

  // ── a branch holds the chat's messages but none of its tool calls: only the link to its parent can say it has read ──
  const branched = async (sid, record) => {
    const p = await open(sid, { record })
    const before = rpcs('session.branch').length
    await p.getByRole('button', { name: 'Branch' }).last().click()
    for (let i = 0; i < 30 && rpcs('session.branch').length === before; i++) await sleep(100)
    await sleep(700)
    return p
  }
  pg = await branched('s-pd', ['s-pd'])
  await refused(pg, '/bg send my messages out', 'branch: a branch of a chat that has read counts as having read, at once')
  await pg.close()
  pg = await branched('s-pd-ctl', [])
  await sent(pg, '/bg do some work', 'branch: a branch of any other chat is not affected')
  await pg.close()

  // ── the record is asked each time, and a record that can't answer is no answer ──
  pg = await open('s-pd-ctl')
  await sent(pg, '/bg do some work', '/bg: a chat that has not read phone data runs it as before')
  await sent(pg, '/cron add "every 1h" x', '/cron add: and so does that')
  await pg.evaluate(() => window.__record.push('s-pd-ctl'))
  await refused(pg, '/bg now', 'record: a read recorded a moment ago counts at once')
  await pg.close()
  for (const [record, what] of [['throws', 'that throws'], ['missing', 'with no such method'], ['odd', 'with an odd answer']]) {
    pg = await open('s-pd-ctl', { record })
    await refused(pg, '/bg do some work', `record: refused when the record can't answer (${what})`)
    check((await pg.getByText('couldn’t check whether this chat has read', { exact: false }).count()) === 1 && (await pg.getByText(/^This chat has read data/).count()) === 0, `record: the words don't claim the chat has read (${what})`)
    await pg.close()
  }
  pg = await open('s-pd-ctl', { shell: false })
  await sent(pg, '/bg do some work', 'record: in a browser there is no record, and the command goes on')
  await pg.close()

  // ── over the lock screen nothing is started ──
  pg = await open('s-pd-ctl')
  await pg.evaluate(() => window.hermesLockView(true))
  check((await slash(pg, '/bg do some work')).length === 0 && (await pg.evaluate(() => window.__nativeCalls.includes('requestUnlock'))), 'lock screen: a background task waits for an unlock')
  check((await slash(pg, '/cron add "every 1h" x')).length === 0, 'lock screen: so does a scheduled job')
  await sent(pg, '/help', 'lock screen: another command in a chat with approvals on works as before')
  await pg.evaluate(() => window.hermesLockView(false))
  // In a chat that runs without asking, any command needs the unlock; /yolo may still turn that off.
  const yolo = v => rpcs('config.set').filter(c => c.params.key === 'yolo' && c.params.value === v).length
  const on = yolo('1')
  await slash(pg, '/yolo on')
  for (let i = 0; i < 30 && yolo('1') === on; i++) await sleep(100)
  await sleep(300)
  await pg.evaluate(() => window.hermesLockView(true))
  check((await slash(pg, '/help')).length === 0, 'lock screen: a chat in Full access sends no slash command')
  check((await pg.evaluate(() => window.__nativeCalls.filter(c => c === 'requestUnlock').length)) >= 3, 'lock screen: it asks for an unlock instead')
  const off = yolo('0')
  await slash(pg, '/yolo off')
  for (let i = 0; i < 30 && yolo('0') === off; i++) await sleep(100)
  check(yolo('0') === off + 1, 'lock screen: /yolo off still turns Full access off')
  await sleep(300)
  await sent(pg, '/help', 'lock screen: with access off the command goes as before')
  await pg.evaluate(() => window.hermesLockView(false))
  await pg.close()

  // ── over the lock screen only commands that show something run, in a chat with access off ──
  pg = await open('s-pd-ctl')
  await pg.evaluate(() => window.hermesLockView(true))
  const unlocks = () => pg.evaluate(() => window.__nativeCalls.filter(c => c === 'requestUnlock').length)
  for (const text of ['/approvals off', '/ap smart', '/cron run job1', '/cron remove job1', '/rollback 1', '/myquick', '/usage reset', '/kanban -- create x', '/stat', '/btw what time is it'])
  {
    const before = await unlocks()
    const sent = await slash(pg, text)
    check(sent.length === 0 && (await unlocks()) === before + 1, `lock screen: ${text} waits for an unlock (sent ${JSON.stringify(sent)})`)
  }
  check((await pg.getByPlaceholder('Message Hermux').inputValue()) === '/btw what time is it', 'lock screen: the refused text stays in the box')
  await pg.getByPlaceholder('Message Hermux').fill('')
  for (const text of ['/status', '/kanban list', '/kanban --board b show t1', '/context', '/whoami'])
    check((await slash(pg, text)).join() === text.slice(1), `lock screen: ${text} still runs`)
  await pg.evaluate(() => window.hermesLockView(false))
  check((await slash(pg, '/cron run job1')).length === 1, 'unlocked: /cron run goes as before')
  await pg.close()

  // ── /approvals off and smart ask first, like Full access; manual doesn't ──
  pg = await open('s-pd-ctl')
  const dialog = () => pg.getByText('Give Hermux full access?')
  const ask = async text => {
    const before = SENT()
    await pg.getByPlaceholder('Message Hermux').fill(text)
    await pg.getByRole('button', { name: 'Send', exact: true }).click()
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
  const before = SENT()
  await slash(pg, '/approvals manual')
  check(SENT() === before + 1 && (await dialog().count()) === 0, '/approvals manual: no question')
  await pg.close()

  // ── a chat that has read: only /kanban that shows something, and /bp with values is refused ──
  pg = await open('s-pd', { record: ['s-pd'] })
  for (const text of ['/kanban swarm x', '/kanban -- create x', '/kanban --board b -- dispatch', '/kanban specify t1', '/kanban decompose --all', '/kanban comment t1 hi', '/bp daily topic=x'])
    await refused(pg, text, `read chat: ${text} is refused`)
  await sent(pg, '/kanban --board b list', 'read chat: /kanban list with a board still works')
  await sent(pg, '/kanban show t1', 'read chat: /kanban show still works')
  await sent(pg, '/bp', 'read chat: /bp alone still shows the catalog')
  await pg.close()
  pg = await open('s-pd-ctl')
  await sent(pg, '/kanban swarm x', 'a chat that has not read: /kanban swarm goes as before')
  await sent(pg, '/bp daily topic=x', 'a chat that has not read: /bp with values goes as before')
  await pg.close()
}
