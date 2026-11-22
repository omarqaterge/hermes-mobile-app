// Long chats drawn from the end, opening chats from the cache, two chats opened in a row.
const { calls, sleep, check, mock } = require('../lib.cjs')

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
  await page.getByPlaceholder('Message Hermux').waitFor({ timeout: 5000 })
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

  // while another chat opens (no cached copy: the skeleton), the header and the Auto button are that chat's, not the
  // one being left: its title is gone, and the chat menu and the Auto button wait until the chat is really open
  const leftTitle = ((await page.locator('.topbar .title').textContent()) || '').trim()
  const options = page.locator('header.topbar').getByRole('button', { name: 'Chat options' })
  const auto = page.locator('.model-row .auto-btn')
  check(leftTitle !== '' && (await options.isEnabled()) && (await auto.isEnabled()), `an open chat has its title, its menu and its Auto button (${leftTitle})`)
  await mock({ holdSlowResume: true })
  await page.evaluate(() => window.hermesOpenSession('s-slowstart'))
  await page.locator('.chat-skeleton').waitFor({ timeout: 3000 }).then(() => check(true, 'a chat with no cached copy opens as the skeleton'), () => check(false, 'a chat with no cached copy opens as the skeleton'))
  const midTitle = ((await page.locator('.topbar .title').textContent()) || '').trim()
  check(midTitle !== leftTitle, `the header no longer shows the chat being left while another opens (${midTitle})`)
  check(await options.isDisabled(), 'Chat options waits while another chat opens')
  check((await auto.isDisabled()) && (await page.locator('.model-row .auto-btn.off').count()) === 1, 'the Auto button waits, and shows Off, while another chat opens')
  await mock({ releaseSlowResume: true })
  await page.getByPlaceholder('Message Hermux').waitFor({ timeout: 5000 })
  check((await options.isEnabled()) && (await auto.isEnabled()), 'once the chat is open its menu and Auto button work again')

  // ── Scroll to the newest message: shows once the chat is scrolled up, and brings the end back ──
  {
    const { WEB } = require('../lib.cjs')
    const jp = await t.browser.newPage({ viewport: { width: 375, height: 812 } })
    await jp.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-scrub', profile: 'default' })))
    await jp.goto(WEB + '/')
    await jp.getByText('answer 30', { exact: true }).waitFor({ timeout: 8000 })
    await jp.waitForTimeout(500)
    await jp.mouse.move(187, 400)
    for (let i = 0; i < 12; i++) await jp.mouse.wheel(0, -1500)
    const jump = jp.getByRole('button', { name: 'Scroll to the newest message' })
    const shown = await jump.waitFor({ timeout: 3000 }).then(() => true, () => false)
    if (shown) await jump.click()
    const atEnd = await jp.waitForFunction(() => {
      // the scrolling box that holds the replies, found from a reply, not by a class name
      let el = [...document.querySelectorAll('p')].find(e => e.textContent === 'answer 30')
      while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement
      return !!el && el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }, null, { timeout: 4000 }).then(() => true, () => false)
    await jump.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    check(shown && atEnd && (await jump.count()) === 0, `chat: Scroll to the newest message shows when scrolled up and brings the end back (${shown}, ${atEnd})`)
    await jp.close()
  }

  // ── a calmer chat (task 11): a long chat of finished work opens folded; find, a search hit and the scrubber still land ──
  {
    const { WEB } = require('../lib.cjs')
    const wp = await t.browser.newPage({ viewport: { width: 360, height: 740 } })
    await wp.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-work', profile: 'default' })))
    await wp.goto(WEB + '/')
    await wp.getByText('worked answer 59', { exact: true }).waitFor({ timeout: 8000 })
    const lines = wp.getByRole('button', { name: /^Worked / })
    await lines.first().waitFor({ timeout: 3000 }).catch(() => {})
    const n = await lines.count()
    const answers = await wp.locator('.msg.assistant strong', { hasText: /^worked answer \d+$/ }).count()
    // The drawn window can start inside a turn, whose line is then above it.
    check(n >= 5 && (n === answers || n === answers - 1), `turn fold: every finished turn drawn opens as one line (${n} lines, ${answers} answers)`)
    check((await wp.getByRole('button', { name: /^Ran / }).count()) === 0 && (await wp.getByText('Plan the steps for task 59.').count()) === 0, 'turn fold: their tool runs and thoughts are hidden')
    check(/^Worked 1m 20s · 3 steps$/.test(((await lines.last().textContent()) || '').trim()), `turn fold: the line says how long the turn took and its steps (${await lines.last().textContent()})`)
    // Find in chat opens the fold that holds the match (and the run inside it).
    await wp.locator('header.topbar').getByRole('button', { name: 'Chat options' }).click()
    await wp.getByRole('dialog').getByRole('button', { name: 'Search in chat' }).click()
    await wp.locator('.findbar input').fill('needle 57')
    const hit = wp.getByRole('button', { name: /^Searched needle 57/ })
    const seen = await hit.waitFor({ timeout: 4000 }).then(() => hit.evaluate(el => {
      let sc = el
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
      const r = el.getBoundingClientRect(), v = sc.getBoundingClientRect()
      return r.bottom > v.top && r.top < v.bottom
    }), () => false)
    check(seen, 'turn fold: find in chat opens the fold that holds the match and shows it')
    await wp.getByRole('button', { name: 'Close search' }).click()
    // The open or closed choice lasts while the chat is open: leave and come back, and every finished turn is closed again.
    check((await wp.getByRole('button', { name: /^Worked /, expanded: true }).count()) === 1, 'turn fold: the turn find opened stays open while the chat is open')
    await wp.evaluate(() => window.hermesOpenSession('s-8'))
    await wp.getByText('answer s-8').waitFor({ timeout: 5000 })
    await wp.evaluate(() => window.hermesOpenSession('s-work'))
    await wp.getByText('worked answer 59', { exact: true }).waitFor({ timeout: 5000 })
    await lines.first().waitFor({ timeout: 3000 }).catch(() => {})
    check((await wp.getByRole('button', { name: /^Worked /, expanded: true }).count()) === 0 && (await lines.count()) >= 5, 'turn fold: opened again, every finished turn is closed')
    // The scrubber still lands on the message picked.
    const rail = wp.getByRole('slider', { name: 'Jump to a message' })
    if (await rail.count()) {
      const rb = await rail.boundingBox()
      await wp.mouse.click(rb.x + rb.width / 2, rb.y + 2)
      const first = wp.locator('.msg.user').filter({ has: wp.locator('.bubble', { hasText: /^task \d$/ }) }).first()
      const cb = await wp.locator('.chat').boundingBox()
      // Wait for the jump to land (earlier turns are drawn first), then measure.
      await wp.waitForFunction(top => [...document.querySelectorAll('.msg.user .bubble')].some(b => /^task \d$/.test(b.textContent.trim()) && Math.abs(b.getBoundingClientRect().top - top) < 160), cb.y, { timeout: 4000 }).catch(() => {})
      const qb = await first.boundingBox().catch(() => null)
      check(!!qb && qb.y >= cb.y - 2 && qb.y <= cb.y + 140, `turn fold: the scrubber lands on an early message (${qb && Math.round(qb.y - cb.y)} px below the top)`)
    } else check(false, 'turn fold: the scrubber shows on a long chat of work')
    await wp.close()
  }
  // A search hit inside a folded turn: the chat opens there with the fold open.
  {
    const { WEB } = require('../lib.cjs')
    const sp = await t.browser.newPage({ viewport: { width: 360, height: 740 } })
    await sp.goto(WEB + '/')
    await sp.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await sp.getByRole('button', { name: /^Sessions/ }).click()
    await sp.getByPlaceholder('Search chats').fill('needle')
    await sp.locator('.hit-row', { hasText: 'Chat of work' }).click({ timeout: 5000 })
    const hit = sp.getByRole('button', { name: /^Searched needle 41/ })
    const shown = await hit.waitFor({ timeout: 6000 }).then(() => hit.evaluate(el => {
      let sc = el
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
      const r = el.getBoundingClientRect(), v = sc.getBoundingClientRect()
      return r.bottom > v.top && r.top < v.bottom
    }), () => false)
    check(shown, 'turn fold: a message search hit inside a folded turn opens it and scrolls to the hit')
    await sp.close()
  }
}
