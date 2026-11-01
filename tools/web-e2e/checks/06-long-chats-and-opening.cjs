// Long chats drawn from the end, opening chats from the cache, two chats opened in a row.
const { calls, sleep, check } = require('../lib.cjs')

module.exports = async t => {
  const { page } = t
  // ── #11 long chats: draw the end first, earlier turns on scroll, without moving what's on screen ──
  await page.evaluate(() => window.hermesOpenSession('s-long'))
  await page.locator('.msg.assistant', { hasText: 'answer 149' }).waitFor({ timeout: 5000 })
  const drawn = await page.locator('.chat .msg').count()
  check(drawn <= 120 && drawn >= 40, `only the end is drawn on open (${drawn} of 300)`)
  const atBottom = await page.locator('.chat').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  check(atBottom, 'opens at the bottom')
  const firstSeen = await page.locator('.chat .msg').first().textContent()
  await page.locator('.chat').evaluate(el => (el.scrollTop = 0))
  // Measure the message that WAS first (by its text): the earlier turns may already be in by now, and then
  // `.first()` would be one of them (seen as a flaky "-3935 → 125").
  const topBefore = await page.locator('.chat .msg', { hasText: firstSeen }).first().evaluate(el => el.getBoundingClientRect().top)
  await page.waitForFunction(n => document.querySelectorAll('.chat .msg').length > n, drawn, { timeout: 5000 }).catch(() => {})
  await sleep(300)
  const topAfter = await page.locator('.chat .msg', { hasText: firstSeen }).first().evaluate(el => el.getBoundingClientRect().top)
  check((await page.locator('.chat .msg').count()) > drawn, 'scrolling up draws earlier turns')
  check(Math.abs(topAfter - topBefore) < 4, `the message that was first stays where it was (${Math.round(topBefore)} → ${Math.round(topAfter)})`)
  for (let k = 0; k < 10 && (await page.locator('.msg.user', { hasText: 'question 0' }).count()) === 0; k++) {
    await page.locator('.chat').evaluate(el => (el.scrollTop = 0))
    await sleep(400)
  }
  check((await page.locator('.msg.user .bubble').filter({ hasText: /^question 0$/ }).count()) === 1, `scrolling to the very top reaches the first turn (${firstSeen.slice(0, 20)}…)`)
  check((await page.locator('.chat-earlier').count()) === 0, 'no "earlier" row once everything is drawn')

  // ── opening chats: the cached copy shows at once, the chat you left is not closed first ──
  const mark = calls().length
  const since = () => calls().slice(mark)
  const open = async id => {
    await page.evaluate(i => window.hermesOpenSession(i), id)
    await page.locator('.msg.assistant', { hasText: `answer ${id}` }).waitFor({ timeout: 5000 })
    await page.waitForFunction(() => !document.querySelector('.composer textarea')?.placeholder.startsWith('Opening'), null, { timeout: 5000 })
  }
  await open('s-slow')
  await open('s-3')
  const t0 = Date.now()
  await page.evaluate(() => window.hermesOpenSession('s-slow'))
  await page.locator('.msg.assistant', { hasText: 'answer s-slow' }).waitFor({ timeout: 1000 })
  const shownIn = Date.now() - t0
  check(shownIn < 600, `reopened chat drawn from the cache before Hermes answers (${shownIn} ms, resume takes 1500)`)
  check((await page.locator('.title', { hasText: 's-slow' }).count()) === 1, 'header shows the opening chat while it loads')
  check((await page.locator('.msg-actions button, .msg-act').count()) === 0, 'no message actions on the cached copy')
  check((await page.getByPlaceholder('Opening your chat…').count()) === 1, 'composer waits for the real chat')
  await page.getByPlaceholder('Message Hermes').waitFor({ timeout: 5000 })
  check((await page.locator('.msg.assistant', { hasText: 'answer s-slow' }).count()) === 1, 'real transcript replaces the cached one, no duplicates')
  await open('s-4')
  await open('s-6')
  const seq = since().filter(c => c.rpc === 'session.resume' || c.rpc === 'session.close').map(c => `${c.rpc === 'session.close' ? 'close' : 'resume'}:${c.params.session_id}`)
  check(!seq.some(x => x.startsWith('close')), `nothing closed on the way into a chat (${seq.join(' ')})`)
  await sleep(3500)
  const closed = since().filter(c => c.rpc === 'session.close').map(c => c.params.session_id)
  check(closed.includes('rt-s-3') && closed.includes('rt-s-long') && !['rt-s-4', 'rt-s-slow', 'rt-s-6'].some(x => closed.includes(x)), `older chats closed afterwards, the open one and the last 2 left stay live (${closed})`)

  // two chats opened in a row: the second wins even though the first one's answer arrives later
  await page.evaluate(() => { window.hermesOpenSession('s-slow'); window.hermesOpenSession('s-3') })
  await page.locator('.msg.assistant', { hasText: 'answer s-3' }).waitFor({ timeout: 5000 })
  await sleep(2200) // s-slow's resume (1500 ms) lands now and must not replace s-3
  check((await page.locator('.msg.assistant', { hasText: 'answer s-slow' }).count()) === 0 && (await page.locator('.msg.assistant', { hasText: 'answer s-3' }).count()) === 1, 'second chat opened wins over the slower first one')
}
