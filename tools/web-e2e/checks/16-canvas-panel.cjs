// The canvas panel: swipes, Back, wide screens.
const path = require('path')
const { WEB, sleep, check, fail, nativeShell } = require('../lib.cjs')

module.exports = async t => {
  const { browser, page } = t
  // ── the canvas is a panel from the right: swipe left on the chat opens it, swipe right on its header / Back closes it ──
  const cvp = await browser.newPage({ viewport: { width: 375, height: 812 } })
  cvp.on('pageerror', e => { console.log('PAGEERROR', e.message); fail() })
  await cvp.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-panel', profile: 'default' })))
  await cvp.goto(WEB + '/')
  await cvp.locator('.msg.assistant .hm-openui', { hasText: 'Swipe card' }).waitFor({ timeout: 15000 })
  await cvp.locator('.msg.assistant pre').first().waitFor({ timeout: 5000 })
  await cvp.locator('.msg.assistant table').first().waitFor({ timeout: 5000 })
  // A synthetic touch swipe from (x, y at the element's middle) by dx/dy; the target is what is under the finger.
  // x null = just inside the element's left edge.
  const cswipe = (sel, x, dx, dy = 0) => cvp.evaluate(([sel, x, dx, dy]) => {
    const r = document.querySelector(sel).getBoundingClientRect()
    const y = r.top + Math.min(r.height / 2, 30)
    if (x === null) x = r.left + 10
    const el = document.elementFromPoint(x, y)
    const mk = (type, px, py) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: el, clientX: px, clientY: py })], changedTouches: [new Touch({ identifier: 1, target: el, clientX: px, clientY: py })] })
    el.dispatchEvent(mk('touchstart', x, y))
    el.dispatchEvent(mk('touchmove', x + dx / 2, y + dy / 2))
    el.dispatchEvent(mk('touchmove', x + dx, y + dy))
    el.dispatchEvent(mk('touchend', x + dx, y + dy))
    return el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : '')
  }, [sel, x, dx, dy])
  const panelOpen = async () => (await cvp.locator('.canvas-panel').count()) === 1
  for (const [sel, what] of [['.msg.assistant pre', 'a code block'], ['.msg.assistant table td', 'a table'], ['.msg.assistant .hm-openui', 'a card']]) {
    await cvp.locator(sel).first().scrollIntoViewIfNeeded()
    const on = await cswipe(sel, null, -100)
    await sleep(300)
    check(!(await panelOpen()), `a swipe left that starts on ${what} does not open the canvas (${on})`)
  }
  await cvp.locator('.msg.assistant p', { hasText: 'Plain words to swipe' }).scrollIntoViewIfNeeded()
  await cswipe('.msg.assistant p', 300, -40)
  await sleep(300)
  check(!(await panelOpen()), 'a short swipe left does not open the canvas')
  await cswipe('.msg.assistant p', 300, -220)
  await cvp.locator('.canvas-panel').waitFor({ timeout: 2000 }).then(() => check(true, 'swipe left on a chat opens the canvas'), () => check(false, 'swipe left on a chat opens the canvas'))
  if (await panelOpen()) {
    await cvp.locator('.canvas-tab-title', { hasText: 'Side' }).waitFor({ timeout: 3000 }).catch(() => {})
    check((await cvp.locator('.canvas-tab-title', { hasText: 'Side' }).count()) === 1, 'it is the chat\'s own canvas')
    const look = await cvp.locator('.canvas-panel').evaluate(el => ({ cls: el.className, anim: getComputedStyle(el).animationName }))
    check(/\bsize-side\b/.test(look.cls) && look.anim === 'canvas-in', `the panel slides in from the right (${look.cls}, ${look.anim})`)
    await sleep(400) // let the slide-in end
    const box = await cvp.locator('.canvas-panel').boundingBox()
    check(box && Math.abs(box.x) <= 1 && Math.abs(box.x + box.width - 375) <= 1, `the panel covers the chat full width (${JSON.stringify(box)})`)
    check((await cvp.locator('.canvas-grip').count()) === 0, 'no bottom-sheet grip any more')
    // Editing keeps the panel as it is (no forced size change).
    await cvp.locator('.canvas-toolbar .seg button', { hasText: 'Edit' }).click()
    check(/\bsize-side\b/.test(await cvp.locator('.canvas-panel').getAttribute('class')), 'editing keeps the side panel')
    await cvp.locator('.canvas-toolbar .seg button', { hasText: 'View' }).click()
    // A short swipe right on the header snaps back; a long one closes the panel.
    await cswipe('.canvas-head', 60, 50)
    await sleep(450)
    check(await panelOpen(), 'a short swipe right on the panel header leaves it open')
    check(await cvp.locator('.canvas-panel').evaluate(el => !el.style.transform || el.style.transform === 'translateX(0px)'), 'and it snaps back')
    await cswipe('.canvas-head', 60, 200)
    await cvp.locator('.canvas-panel').waitFor({ state: 'detached', timeout: 2000 }).then(() => check(true, 'swipe right on the panel header closes it'), () => check(false, 'swipe right on the panel header closes it'))
  }
  // Back closes it; from fill-the-screen Back goes back to the panel first.
  await cswipe('.msg.assistant p', 300, -220)
  if (!(await cvp.locator('.canvas-panel').waitFor({ timeout: 2000 }).then(() => true, () => false))) await cvp.locator('.canvas-btn').click()
  await cvp.getByRole('button', { name: 'Fill the whole screen' }).click()
  check((await cvp.locator('.canvas-panel.size-max').count()) === 1, 'fill the whole screen still works')
  await cvp.evaluate(() => window.hermesBack())
  await sleep(200)
  check((await cvp.locator('.canvas-panel.size-side').count()) === 1, 'Back from the whole screen returns to the panel')
  await cvp.evaluate(() => window.hermesBack())
  await cvp.locator('.canvas-panel').waitFor({ state: 'detached', timeout: 2000 }).then(() => check(true, 'Back closes the canvas panel'), () => check(false, 'Back closes the canvas panel'))
  // With the canvas closed, swipe right still opens the drawer.
  await cswipe('.msg.assistant p', 60, 200)
  await cvp.locator('.drawer.open').waitFor({ timeout: 2000 }).then(() => check(true, 'swipe right still opens the drawer with the canvas closed'), () => check(false, 'swipe right still opens the drawer with the canvas closed'))
  await cvp.close()
  // A REAL finger: CDP touch events (browser-generated, with the scroller's own touch handling), not dispatched ones.
  for (const [sid, what] of [['s-panel', 'chat with a canvas'], ['s-5', 'chat without one']]) {
    const rctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })
    const rp = await rctx.newPage()
    await rp.addInitScript(id => localStorage.setItem('hm.lastSession', JSON.stringify({ id, profile: 'default' })), sid)
    await rp.goto(WEB + '/')
    await rp.locator('.msg.assistant').first().waitFor({ timeout: 15000 })
    await sleep(500)
    const cdp = await rctx.newCDPSession(rp)
    const finger = async (x0, y0, dx, dy, steps = 12) => {
      const pt = (x, y) => [{ x, y, id: 1 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0, y0) })
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + (dx * i) / steps, y0 + (dy * i) / steps + (i % 3)) })
        await sleep(16)
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    // Start the finger on plain text of a message when there is some (like reading), else on the chat itself.
    const at = await rp.evaluate(() => {
      const p = [...document.querySelectorAll('.msg.assistant p, .msg.user p, .msg .bubble')].find(e => e.textContent.trim().length > 5)
      if (p) p.scrollIntoView({ block: 'center' })
      const r = (p || document.querySelector('.chat')).getBoundingClientRect()
      const x = Math.min(340, r.right - 10), y = r.top + Math.min(r.height / 2, 20)
      const e = document.elementFromPoint(x, y)
      return { x, y, on: e ? e.tagName + '.' + e.className : 'none', ws: (() => { const o = []; for (let n = e; n && n !== document.body; n = n.parentElement) if (n.scrollWidth > n.clientWidth + 2) o.push(n.tagName + '.' + n.className + ':' + getComputedStyle(n).overflowX); return o })() }
    })
    console.log(`  (real swipe starts on ${JSON.stringify(at)} in the ${what})`)
    await finger(at.x, at.y, -240, 6)
    await sleep(500)
    check((await rp.locator('.canvas-panel').count()) === 1, `a real finger swiping left on a ${what} opens the canvas`)
    await rctx.close()
  }
  // A chat whose text has long unbroken words (a URL, a path): the swipes must still work on plain text.
  {
    const rctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })
    const rp = await rctx.newPage()
    await rp.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-wide', profile: 'default' })))
    await rp.goto(WEB + '/')
    await rp.locator('.msg.assistant').first().waitFor({ timeout: 15000 })
    await sleep(500)
    const cdp = await rctx.newCDPSession(rp)
    const finger = async (x0, y0, dx, dy, steps = 12) => {
      const pt = (x, y) => [{ x, y, id: 1 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0, y0) })
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + (dx * i) / steps, y0 + (dy * i) / steps + (i % 3)) })
        await sleep(16)
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    const at = await rp.evaluate(() => {
      const p = [...document.querySelectorAll('.msg.assistant p')][0]
      p.scrollIntoView({ block: 'center' })
      const r = p.getBoundingClientRect()
      const x = 200, y = r.top + 8
      const e = document.elementFromPoint(x, y)
      const ws = []
      for (let n = e; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n)
        if (n.scrollWidth > n.clientWidth + 2) ws.push(`${n.tagName}.${n.className} ${n.scrollWidth}>${n.clientWidth} x=${cs.overflowX} y=${cs.overflowY}`)
      }
      return { x, y, on: e.tagName + '.' + e.className, ws }
    })
    console.log(`  (wide chat: swipe starts on ${JSON.stringify(at)})`)
    await finger(at.x, at.y, -240, 6)
    await sleep(500)
    check((await rp.locator('.canvas-panel').count()) === 1, 'a real finger swiping left on plain text opens the canvas in a chat with long unbroken words')
    if (await rp.locator('.canvas-panel').count()) { await rp.evaluate(() => window.hermesBack()); await sleep(500) }
    await finger(at.x - 100, at.y, 240, 6)
    await sleep(500)
    check((await rp.locator('.drawer.open').count()) === 1, 'a real finger swiping right on plain text opens the drawer in a chat with long unbroken words')
    await rctx.close()
  }
  // Wide screens keep the canvas as a column beside the chat.
  const cvw = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  await cvw.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-panel', profile: 'default' })))
  // The native shell (Settings → Uninstall Hermes needs it), with setup complete so no setup flow takes over.
  await cvw.addInitScript(s => { window.__setup = s }, { termux: true, runCommand: true, notifications: true, batteryApp: true, batteryTermux: true, startError: '', termuxApi: true, termuxBoot: true, shizuku: true })
  await cvw.addInitScript(nativeShell)
  await cvw.goto(WEB + '/')
  await cvw.locator('.msg.assistant').first().waitFor({ timeout: 15000 })
  await cvw.locator('.canvas-btn').click()
  await cvw.locator('.canvas-panel').waitFor({ timeout: 3000 })
  await sleep(400)
  {
    const b = await cvw.locator('.canvas-panel').boundingBox()
    const mr = await cvw.locator('.app').evaluate(el => parseFloat(getComputedStyle(el).marginRight))
    check(b && b.x > 400 && Math.abs(b.x + b.width - 1100) <= 1 && mr > 0 && Math.abs(mr - b.width) <= 2, `wide screen: the canvas is a column beside the chat (${JSON.stringify(b)}, chat margin ${mr})`)
  }
  await cvw.evaluate(() => window.hermesBack())
  await cvw.locator('.canvas-panel').waitFor({ state: 'detached', timeout: 2000 }).catch(() => {})
  // Wide screens: a sheet opened on a page (Settings → Uninstall Hermes) covers the docked chat list, not under it.
  {
    const listX = async () => (await cvw.locator('.drawer').boundingBox())?.x ?? -9999
    check((await listX()) >= 0, 'wide screen: the chat list is docked by default')
    await cvw.locator('.nav-tile', { hasText: 'Settings' }).click()
    await cvw.locator('.set-row', { hasText: 'Uninstall Hermes' }).click()
    const sh = cvw.locator('.sheet', { hasText: 'Uninstall Hermes' }).last()
    await sh.waitFor({ timeout: 3000 })
    await sleep(300)
    const top = await cvw.evaluate(() => {
      const s = [...document.querySelectorAll('.sheet')].pop()
      const r = s.getBoundingClientRect()
      const el = document.elementFromPoint(r.left + 40, r.top + r.height / 2)
      return { inSheet: Boolean(el && el.closest('.sheet')), left: r.left, width: r.width }
    })
    check(top.inSheet && top.left < 50, `wide screen: a page's sheet is on top of the docked chat list (${JSON.stringify(top)})`)
    for (let i = 0; i < 4 && (await cvw.locator('.screen, .sheet').count()); i++) {
      await cvw.evaluate(() => window.hermesBack())
      await sleep(250)
    }
    // ☰ hides the list (the chat gets the whole width), the choice survives a reload, ☰ docks it again.
    const menu = cvw.getByRole('button', { name: 'Hide chat list' })
    await menu.waitFor({ timeout: 3000 }).then(() => check(true, 'wide screen: ☰ offers Hide chat list'), () => check(false, 'wide screen: ☰ offers Hide chat list'))
    await menu.click()
    await sleep(400)
    const ml = await cvw.locator('.app').evaluate(el => parseFloat(getComputedStyle(el).marginLeft))
    check((await listX()) < 0 && ml === 0, `wide screen: ☰ hides the chat list and the chat takes the width (list x ${await listX()}, margin ${ml})`)
    await cvw.reload()
    await cvw.locator('.msg.assistant').first().waitFor({ timeout: 15000 })
    await sleep(300)
    check((await listX()) < 0, 'wide screen: the hidden chat list stays hidden after a restart')
    await cvw.getByRole('button', { name: 'Show chat list' }).click()
    await sleep(400)
    check((await listX()) >= 0, 'wide screen: ☰ docks the chat list again')
    // « at the top of the docked list hides it too.
    await cvw.getByRole('button', { name: 'Hide the chat list' }).click()
    await sleep(400)
    check((await listX()) < 0 && (await cvw.locator('.drawer-backdrop.show').count()) === 0, 'wide screen: « hides the docked list, no backdrop left')
    await cvw.evaluate(() => localStorage.removeItem('hm.sideHidden.v1'))
  }
  await cvw.close()
}
