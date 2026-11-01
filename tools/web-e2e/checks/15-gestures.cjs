// Swipe to open the drawer, the chat scrubber.
const { WEB, sleep, check } = require('../lib.cjs')

module.exports = async t => {
  const { browser } = t
  // ── swipe right on a chat opens the sessions drawer ──
  const swp = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await swp.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-5', profile: 'default' })))
  await swp.goto(WEB + '/')
  await swp.locator('.msg.assistant').first().waitFor({ timeout: 8000 })
  const swipe = (sel, dx, dy) => swp.evaluate(([sel, dx, dy]) => {
    const el = document.querySelector(sel)
    const r = el.getBoundingClientRect()
    const x = r.left + 40, y = r.top + Math.min(r.height / 2, 30)
    const mk = (type, px, py) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: el, clientX: px, clientY: py })] })
    el.dispatchEvent(mk('touchstart', x, y))
    el.dispatchEvent(mk('touchmove', x + dx / 2, y + dy / 2))
    el.dispatchEvent(mk('touchmove', x + dx, y + dy))
    el.dispatchEvent(mk('touchend', x + dx, y + dy))
  }, [sel, dx, dy])
  await swipe('.msg.assistant', 40, 0)
  await sleep(300)
  check((await swp.locator('.drawer.open').count()) === 0, 'a short swipe does not open the drawer')
  await swipe('.msg.assistant', 20, 120)
  await sleep(300)
  check((await swp.locator('.drawer.open').count()) === 0, 'a mostly vertical swipe (scrolling) does not open the drawer')
  await swipe('textarea', 160, 0)
  await sleep(300)
  check((await swp.locator('.drawer.open').count()) === 0, 'a swipe starting in the composer does not open the drawer')
  // The drawer follows the finger, then on release finishes opening or closing (never stays half open).
  const drawerX = () => swp.evaluate(() => Math.round(document.querySelector('.drawer').getBoundingClientRect().right))
  const hold = (sel, xs, wait) => swp.evaluate(async ([sel, xs, wait]) => {
    const el = document.querySelector(sel)
    const r = el.getBoundingClientRect()
    const x = sel === '.drawer-backdrop' ? r.right - 20 : r.left + 40, y = r.top + Math.min(r.height / 2, 30)
    const mk = (type, px) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 2, target: el, clientX: px, clientY: y })] })
    el.dispatchEvent(mk('touchstart', x))
    for (const dx of xs) {
      el.dispatchEvent(mk('touchmove', x + dx))
      if (wait) await new Promise(r => setTimeout(r, wait))
    }
    window.__end = () => el.dispatchEvent(mk('touchend', x + xs[xs.length - 1]))
  }, [sel, xs, wait])
  const release = () => swp.evaluate(() => window.__end())
  await hold('.msg.assistant', [30, 60, 100], 0)
  check(Math.abs((await drawerX()) - 100) <= 2, `drawer: mid-swipe its edge is under the finger (${await drawerX()})`)
  await release()
  await sleep(400)
  check((await swp.locator('.drawer.open').count()) === 0 && (await drawerX()) <= 0, 'drawer: let go before half way (no flick) and it closes again')
  await swipe('.msg.assistant', 200, 10)
  await swp.locator('.drawer.open').waitFor({ timeout: 2000 }).then(() => check(true, 'swipe right past half way opens the drawer'), () => check(false, 'swipe right past half way opens the drawer'))
  await sleep(400)
  check((await swp.evaluate(() => document.querySelector('.drawer').style.transform)) === '', 'drawer: no inline position left after it settles')
  // swipe left on the backdrop pushes it back, following the finger
  await hold('.drawer-backdrop', [-30, -80], 0)
  const w = await swp.evaluate(() => document.querySelector('.drawer').offsetWidth)
  check(Math.abs((await drawerX()) - (w - 80)) <= 2, `drawer: a swipe left on the backdrop moves it with the finger (${await drawerX()} of ${w})`)
  await release()
  await sleep(400)
  check((await swp.locator('.drawer.open').count()) === 1, 'drawer: a short slow swipe left lets it spring back open')
  await hold('.drawer-backdrop', [-40, -80, -120, -200], 0)
  await release()
  await sleep(400)
  check((await swp.locator('.drawer.open').count()) === 0 && (await drawerX()) <= 0, 'drawer: a swipe left past half way closes it')
  // a quick flick opens it even when short
  await hold('.msg.assistant', [20, 40, 60, 80], 16)
  await release()
  await swp.locator('.drawer.open').waitFor({ timeout: 2000 }).then(() => check(true, 'drawer: a quick short flick right opens it'), () => check(false, 'drawer: a quick short flick right opens it'))
  await swp.close()

  // ── chat scrubber: a rail of ticks, one per message you sent; drag to pick, let go to jump ──
  {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await page.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-scrub', profile: 'default' })))
  await page.goto(WEB + '/')
  await page.locator('.msg.assistant', { hasText: 'answer 30' }).waitFor({ timeout: 5000 })
  await page.locator('.scrubber').waitFor({ timeout: 3000 })
  check((await page.locator('.scrubber .scrub-tick').count()) === 30, 'scrubber: one tick per message you sent')
  check((await page.locator('.scrubber').getAttribute('aria-label')) === 'Jump to a message' && (await page.locator('.scrubber').getAttribute('role')) === 'slider', 'scrubber: slider role and label')
  { const v = Number(await page.locator('.scrubber').getAttribute('aria-valuenow')); check(v >= 29, `scrubber: at the bottom the current tick is one of the last messages (${v})`) }
  check((await page.locator('.scrubber .scrub-tick.on').count()) === 1, 'scrubber: exactly one tick is highlighted')
  {
    const rb = await page.locator('.scrubber').boundingBox()
    const x = rb.x + rb.width / 2
    await page.mouse.move(x, rb.y + rb.height - 1)
    await page.mouse.down()
    await page.mouse.move(x, rb.y + rb.height / 2, { steps: 4 })
    await page.mouse.move(x, rb.y + 1, { steps: 4 })
    const bub = (await page.locator('.scrub-bubble').textContent()) || ''
    check(bub.includes('question 1') && bub.includes('1 / 30'), `scrubber: the bubble shows the picked message (${bub})`)
    await page.mouse.up()
    await sleep(500)
    check((await page.locator('.scrub-bubble').count()) === 0, 'scrubber: the bubble goes when you let go')
    const q1 = page.locator('.msg.user', { hasText: /^question 1$/ })
    await q1.waitFor({ timeout: 3000 })
    const qb = await q1.boundingBox()
    const cb = await page.locator('.chat').boundingBox()
    check(qb && qb.y >= cb.y && qb.y <= cb.y + 100, `scrubber: letting go scrolls to the picked message (${qb && Math.round(qb.y - cb.y)} px below the top)`)
    check((await page.locator('.scrubber').getAttribute('aria-valuenow')) === '1', 'scrubber: the first tick is current after the jump')
    // a tap jumps to the nearest tick, and the rail stays put while the list scrolls
    const rb2 = await page.locator('.scrubber').boundingBox()
    check(Math.abs(rb2.y - rb.y) < 1, 'scrubber: the rail does not scroll with the content')
    await page.mouse.click(x, rb2.y + rb2.height / 2)
    await sleep(500)
    const now = Number(await page.locator('.scrubber').getAttribute('aria-valuenow'))
    check(now >= 14 && now <= 17, `scrubber: a tap on the middle jumps to a middle message (${now})`)
    await page.locator('.scrubber').focus()
    await page.keyboard.press('ArrowDown')
    await sleep(500)
    check((await page.locator('.scrubber').getAttribute('aria-valuenow')) === String(now + 1), 'scrubber: ArrowDown moves to the next message')
  }
  {
    // a horizontal move that starts on the rail does not open the drawer
    const dx = await page.evaluate(() => {
      const el = document.querySelector('.scrubber')
      const r = el.getBoundingClientRect()
      const x = r.left + 14, y = r.top + r.height / 2
      const mk = (type, px) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 7, target: el, clientX: px, clientY: y })] })
      el.dispatchEvent(mk('touchstart', x)); el.dispatchEvent(mk('touchmove', x + 60)); el.dispatchEvent(mk('touchmove', x + 160)); el.dispatchEvent(mk('touchend', x + 160))
      return 1
    })
    await sleep(300)
    check(dx === 1 && (await page.locator('.drawer.open').count()) === 0, 'scrubber: a horizontal move starting on the rail does not open the drawer')
  }
  await page.evaluate(() => window.hermesOpenSession('s-5'))
  await page.locator('.msg.assistant', { hasText: 'answer s-5' }).waitFor({ timeout: 5000 })
  check((await page.locator('.scrubber').count()) === 0, 'scrubber: a short chat shows no rail')
  await page.close()

  }
}
