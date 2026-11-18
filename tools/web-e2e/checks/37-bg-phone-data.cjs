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
  check((await slash(pg, '/bgalias')).every(c => !/^bg\b/i.test(c)), '/bg: a command alias can\'t reach it in that chat')
  await pg.close()

  pg = await open('s-pd-ctl')
  check((await slash(pg, '/bg do some work')).join() === 'bg do some work' && (await refusal(pg).count()) === 0, '/bg: a chat that has not read phone data runs it as before')
  await pg.close()
}
