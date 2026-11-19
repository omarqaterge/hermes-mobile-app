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
  await refused(pg, '/bac short', '/bg: so is the beginning of the name that Hermes expands')
  await sent(pg, '/ba', '/bg: a beginning that means another command is left alone')
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
  await pg.close()
}
