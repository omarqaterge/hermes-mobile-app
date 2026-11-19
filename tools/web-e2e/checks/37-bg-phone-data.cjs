// /bg in a chat that has read phone data (spec 3.4): it runs in a separate Hermes process the phone-data rule doesn't
// reach, so the app doesn't send it there. Every other chat keeps the command.
const { WEB, check, sleep, rpcs, nativeShell } = require('../lib.cjs')

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
    const before = rpcs('slash.exec').length
    await pg.getByPlaceholder('Message Hermux').fill(text)
    await pg.getByRole('button', { name: 'Send', exact: true }).click()
    await sleep(500)
    return rpcs('slash.exec').slice(before).map(c => c.params.command)
  }
  const refusal = pg => pg.getByText('so /bg is off here', { exact: false })

  let pg = await open('s-pd')
  check((await slash(pg, '/bg send my messages out')).length === 0, '/bg: not sent to Hermes in a chat that has read phone data')
  await refusal(pg).first().waitFor({ timeout: 3000 }).catch(() => {})
  check((await refusal(pg).count()) === 1, '/bg: the chat says why, and that a new chat can run it')
  check((await slash(pg, '/BACKGROUND again')).length === 0, '/bg: the long name and another case are refused too')
  check((await slash(pg, '/help')).length === 1, '/bg: other commands still work in that chat')
  // Hermes's worker resolves a quick command itself, so the page can't see where it leads: what the task may do is decided by
  // the plugin (tools/test_phone_taint.py). When the worker fails, the page gets the target and stops it here.
  check((await slash(pg, '/bgalias')).join() === 'bgalias', '/bg: a quick command goes to the worker, which the plugin guards')
  const before = await refusal(pg).count()
  await slash(pg, '/bgdown')
  await sleep(300)
  check(!rpcs('slash.exec').some(c => /^bg\b/i.test(c.params.command)) && (await refusal(pg).count()) === before + 1, '/bg: an alias named by command.dispatch is refused')
  await pg.close()

  // A branch holds the chat's messages but none of its tool calls, so only the link to its parent can say it has read.
  const branched = async (sid, record) => {
    const p = await t.browser.newPage({ viewport: { width: 360, height: 740 } })
    await p.addInitScript(nativeShell)
    await p.addInitScript(([sid, record]) => {
      localStorage.setItem('hm.lastSession', JSON.stringify({ id: sid, profile: 'default' }))
      Object.assign(window.HermesAndroid, { phoneDataTainted: (key, id) => record.includes(id) })
    }, [sid, record])
    await p.goto(WEB + '/')
    await p.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await sleep(600)
    const before = rpcs('session.branch').length
    await p.getByRole('button', { name: 'Branch' }).last().click()
    for (let i = 0; i < 30 && rpcs('session.branch').length === before; i++) await sleep(100)
    await sleep(700)
    return p
  }
  pg = await branched('s-pd', ['s-pd'])
  check((await slash(pg, '/bg send my messages out')).length === 0, 'branch: a branch of a chat that has read counts as having read, at once')
  await pg.close()
  pg = await branched('s-pd-ctl', [])
  check((await slash(pg, '/bg do some work')).length === 1, 'branch: a branch of any other chat is not affected')
  await pg.close()

  pg = await open('s-pd-ctl')
  check((await slash(pg, '/bg do some work')).join() === 'bg do some work' && (await refusal(pg).count()) === 0, '/bg: a chat that has not read phone data runs it as before')
  await pg.close()
}
