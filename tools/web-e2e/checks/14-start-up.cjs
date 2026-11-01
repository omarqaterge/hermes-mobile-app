// Start-up order: profiles and the other start-up requests after the chat, a new chat kept, the canvas button while resuming.
const { MOCK, WEB, calls, sleep, check, mock } = require('../lib.cjs')

module.exports = async t => {
  const { browser } = t
  // ── start-up: the slow profiles.list waits until the chat is open (it competes with session.resume in Hermes) ──
  const spf = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await spf.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-slowstart', profile: 'default' })))
  const nBoot = calls().length
  await spf.goto(WEB + '/')
  await sleep(1200) // connected, the slow resume (2.5 s) is in flight
  const early = calls().slice(nBoot).map(c => c.rpc)
  check(early.includes('session.resume') && early.includes('session.list') && !early.includes('profiles.list'), `profiles.list not sent while the chat opens (${early.filter(Boolean).join(',')})`)
  // The rest of the start-up burst waits too: on a phone it made session.list / session.resume ~20× slower.
  const BURST = ['/api/status', '/api/skills', '/api/model/info', '/api/config', '/api/plugins/hermes-mobile/activity']
  const earlyHttp = calls().slice(nBoot).map(c => c.path).filter(Boolean)
  check(!early.includes('commands.catalog') && !BURST.some(p => earlyHttp.includes(p)), `status, commands, skills, model, config and activity not sent while the chat opens (${[...new Set(earlyHttp)].join(',')})`)
  await spf.locator('.msg', { hasText: 'old answer' }).waitFor({ timeout: 6000 })
  await sleep(300)
  check(calls().slice(nBoot).some(c => c.rpc === 'profiles.list'), 'profiles.list sent once the chat is open')
  await sleep(700)
  const after = calls().slice(nBoot)
  const afterHttp = after.map(c => c.path).filter(Boolean)
  check(after.some(c => c.rpc === 'commands.catalog') && BURST.every(p => afterHttp.includes(p)), `the rest of the start-up requests are sent once the chat is open (${[...new Set(afterHttp)].join(',')})`)
  check(afterHttp.filter(p => p === '/api/status').length === 1, `the full status is asked for once at start-up (${afterHttp.filter(p => p === '/api/status').length})`)
  await spf.close()

  // ── start-up resume must not pull you out of a new chat you started while it was loading ──
  const slp = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await slp.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-slowstart', profile: 'default' })))
  await slp.goto(WEB + '/')
  await sleep(900) // connected, the slow resume is in flight
  await slp.evaluate(() => window.hermesShortcut('new'))
  await slp.locator('.empty .suggestion').first().waitFor({ timeout: 5000 })
  await sleep(2800) // the slow resume answers now
  check(await slp.locator('.empty .suggestion').count() > 0 && (await slp.locator('.msg').count()) === 0, 'late start-up resume does not replace the new chat you started')
  await slp.close()

  // ── the canvas button while the start-up resume loads: that chat's canvas (loading first), never a new chat ──
  const scv = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await scv.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-slowstart', profile: 'default' })))
  await scv.goto(WEB + '/')
  await sleep(600) // connected, the slow resume is in flight
  check(await scv.evaluate(() => !document.querySelector('.msg.user')), 'slow start-up chat still loading when the canvas is tapped')
  await scv.locator('.canvas-btn').click()
  await scv.locator('.canvas-panel').waitFor({ timeout: 3000 })
  check((await scv.locator('.canvas-panel [aria-busy="true"]').count()) === 1 && (await scv.locator('.canvas-empty-title').count()) === 0, 'canvas opened on a loading chat shows a loading state, not "empty"')
  // The mock holds this chat's document list until now (no timer to race on a slow machine).
  await fetch(MOCK + '/__mock', { method: 'POST', body: JSON.stringify({ releaseCanvas: true }) })
  await scv.locator('.canvas-tab-title', { hasText: 'Life' }).waitFor({ timeout: 3000 })
  check(true, 'canvas opened on a loading chat shows that chat\'s documents')
  await sleep(2800) // the slow resume answers now
  check((await scv.locator('.msg', { hasText: 'old answer' }).count()) === 1, 'the chat that was loading still opens after tapping the canvas (no new empty chat)')
  check((await scv.locator('.canvas-panel').count()) === 1 && (await scv.locator('.canvas-tab-title', { hasText: 'Life' }).count()) === 1, 'canvas stays open on the chat once it has loaded')
  await scv.close()
}
