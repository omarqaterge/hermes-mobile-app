// The canvas panel: swipes, Back, wide screens.
const path = require('path')
const { WEB, sleep, check, fail, nativeShell, settingsPage } = require('../lib.cjs')

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
    // Negative check: confirm swiping left on a horizontally scrollable block does not open the canvas.
    await sleep(300)
    check(!(await panelOpen()), `a swipe left that starts on ${what} does not open the canvas (${on})`)
  }
  await cvp.locator('.msg.assistant p', { hasText: 'Plain words to swipe' }).scrollIntoViewIfNeeded()
  await cswipe('.msg.assistant p', 300, -40)
  // Negative check: confirm a short swipe left does not open the canvas.
  await sleep(300)
  check(!(await panelOpen()), 'a short swipe left does not open the canvas')
  await cswipe('.msg.assistant p', 300, -220)
  await cvp.locator('.canvas-panel').waitFor({ timeout: 2000 }).then(() => check(true, 'swipe left on a chat opens the canvas'), () => check(false, 'swipe left on a chat opens the canvas'))
  if (await panelOpen()) {
    await cvp.locator('.canvas-tab-title', { hasText: 'Side' }).waitFor({ timeout: 3000 }).catch(() => {})
    check((await cvp.locator('.canvas-tab-title', { hasText: 'Side' }).count()) === 1, 'it is the chat\'s own canvas')
    const look = await cvp.locator('.canvas-panel').evaluate(el => ({ cls: el.className, anim: getComputedStyle(el).animationName }))
    check(/\bsize-side\b/.test(look.cls) && look.anim === 'canvas-in', `the panel slides in from the right (${look.cls}, ${look.anim})`)
    await cvp.waitForFunction(() => { const b = document.querySelector('.canvas-panel')?.getBoundingClientRect(); return !!b && Math.abs(b.x) <= 1 && Math.abs(b.x + b.width - 375) <= 1 }, null, { timeout: 3000 }).catch(() => {})
    const box = await cvp.locator('.canvas-panel').boundingBox()
    check(box && Math.abs(box.x) <= 1 && Math.abs(box.x + box.width - 375) <= 1, `the panel covers the chat full width (${JSON.stringify(box)})`)
    check((await cvp.locator('.canvas-grip').count()) === 0, 'no bottom-sheet grip any more')
    // Editing keeps the panel as it is (no forced size change).
    await cvp.locator('.canvas-toolbar .seg button', { hasText: 'Edit' }).click()
    check(/\bsize-side\b/.test(await cvp.locator('.canvas-panel').getAttribute('class')), 'editing keeps the side panel')
    await cvp.locator('.canvas-toolbar .seg button', { hasText: 'View' }).click()
    // A short swipe right on the header snaps back; a long one closes the panel.
    await cswipe('.canvas-head', 60, 50)
    // Negative check: wait past the 200 ms close timeout to confirm a short swipe snapped back instead of closing.
    await sleep(300)
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
  await cvp.locator('.canvas-panel.size-side').waitFor({ timeout: 2000 }).catch(() => {})
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
    await rp.getByPlaceholder('Message Hermux').waitFor({ timeout: 5000 })
    const cdp = await rctx.newCDPSession(rp)
    const finger = async (x0, y0, dx, dy, steps = 12) => {
      const pt = (x, y) => [{ x, y, id: 1 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0, y0) })
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + (dx * i) / steps, y0 + (dy * i) / steps + (i % 3)) })
        await sleep(16) // frame-paced step interval to produce realistic swipe velocity
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
    await rp.locator('.canvas-panel').waitFor({ timeout: 3000 }).catch(() => {})
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
    await rp.getByPlaceholder('Message Hermux').waitFor({ timeout: 5000 })
    const cdp = await rctx.newCDPSession(rp)
    const finger = async (x0, y0, dx, dy, steps = 12) => {
      const pt = (x, y) => [{ x, y, id: 1 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0, y0) })
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + (dx * i) / steps, y0 + (dy * i) / steps + (i % 3)) })
        await sleep(16) // frame-paced step interval to produce realistic swipe velocity
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
    await rp.locator('.canvas-panel').waitFor({ timeout: 3000 }).catch(() => {})
    check((await rp.locator('.canvas-panel').count()) === 1, 'a real finger swiping left on plain text opens the canvas in a chat with long unbroken words')
    if (await rp.locator('.canvas-panel').count()) {
      await rp.evaluate(() => window.hermesBack())
      await rp.locator('.canvas-panel').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    }
    await finger(at.x - 100, at.y, 240, 6)
    await rp.locator('.drawer.open').waitFor({ timeout: 3000 }).catch(() => {})
    check((await rp.locator('.drawer.open').count()) === 1, 'a real finger swiping right on plain text opens the drawer in a chat with long unbroken words')
    await rctx.close()
  }
  // Wide screens keep the canvas as a column beside the chat.
  const cvw = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  await cvw.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-panel', profile: 'default' })))
  // The native shell (Settings → Uninstall Hermux needs it), with setup complete so no setup flow takes over.
  await cvw.addInitScript(s => { window.__setup = s }, { termux: true, runCommand: true, notifications: true, batteryApp: true, batteryTermux: true, startError: '', termuxApi: true, termuxBoot: true, shizuku: true })
  await cvw.addInitScript(nativeShell)
  await cvw.goto(WEB + '/')
  await cvw.locator('.msg.assistant').first().waitFor({ timeout: 15000 })
  await cvw.locator('.canvas-btn').click()
  await cvw.locator('.canvas-panel').waitFor({ timeout: 3000 })
  await cvw.waitForFunction(() => { const b = document.querySelector('.canvas-panel')?.getBoundingClientRect(); const a = document.querySelector('.app'); return !!b && !!a && Math.abs(b.x + b.width - 1100) <= 1 && Math.abs(parseFloat(getComputedStyle(a).marginRight) - b.width) <= 2 }, null, { timeout: 3000 }).catch(() => {})
  {
    const b = await cvw.locator('.canvas-panel').boundingBox()
    const mr = await cvw.locator('.app').evaluate(el => parseFloat(getComputedStyle(el).marginRight))
    check(b && b.x > 400 && Math.abs(b.x + b.width - 1100) <= 1 && mr > 0 && Math.abs(mr - b.width) <= 2, `wide screen: the canvas is a column beside the chat (${JSON.stringify(b)}, chat margin ${mr})`)
  }
  await cvw.evaluate(() => window.hermesBack())
  await cvw.locator('.canvas-panel').waitFor({ state: 'detached', timeout: 2000 }).catch(() => {})
  // Wide screens: a sheet opened on a page (Settings → About & help → Uninstall Hermux) covers the docked chat list, not under it.
  {
    const listX = async () => (await cvw.locator('.drawer').boundingBox())?.x ?? -9999
    check((await listX()) >= 0, 'wide screen: the chat list is docked by default')
    await cvw.getByRole('button', { name: 'Settings', exact: true }).click()
    await settingsPage(cvw, 'About & help')
    await cvw.locator('.set-row', { hasText: 'Uninstall Hermux' }).click()
    const sh = cvw.locator('.sheet', { hasText: 'Uninstall Hermux' }).last()
    await sh.waitFor({ timeout: 3000 })
    await cvw.waitForFunction(() => { const s = [...document.querySelectorAll('.sheet')].pop(); return !!s && s.getBoundingClientRect().width > 0 && s.getAnimations().every(a => a.playState !== 'running') }, null, { timeout: 3000 }).catch(() => {})
    // The sheet is centred on a wide screen (spec 3.20): probe a point that lies over both the sheet and the docked list.
    const top = await cvw.evaluate(() => {
      const s = [...document.querySelectorAll('.sheet')].pop()
      const r = s.getBoundingClientRect()
      const d = document.querySelector('.drawer').getBoundingClientRect()
      const x = r.left + 20
      const el = document.elementFromPoint(x, r.top + r.height / 2)
      return { inSheet: Boolean(el && el.closest('.sheet')), overList: x > d.left && x < d.right, left: r.left, width: r.width, list: d.right }
    })
    check(top.inSheet && top.overList, `wide screen: a page's sheet is on top of the docked chat list (${JSON.stringify(top)})`)
    for (let i = 0; i < 4; i++) {
      const openCount = await cvw.locator('.screen, .sheet').count()
      if (!openCount) break
      await cvw.evaluate(() => window.hermesBack())
      await cvw.waitForFunction(n => document.querySelectorAll('.screen, .sheet').length < n, openCount, { timeout: 3000 }).catch(() => {})
    }
    // ☰ hides the list (the chat gets the whole width), the choice survives a reload, ☰ docks it again.
    const menu = cvw.getByRole('button', { name: 'Hide chat list' })
    await menu.waitFor({ timeout: 3000 }).then(() => check(true, 'wide screen: ☰ offers Hide chat list'), () => check(false, 'wide screen: ☰ offers Hide chat list'))
    await menu.click()
    await cvw.waitForFunction(() => (document.querySelector('.drawer')?.getBoundingClientRect().x ?? 0) < 0 && parseFloat(getComputedStyle(document.querySelector('.app')).marginLeft) === 0, null, { timeout: 3000 }).catch(() => {})
    const ml = await cvw.locator('.app').evaluate(el => parseFloat(getComputedStyle(el).marginLeft))
    check((await listX()) < 0 && ml === 0, `wide screen: ☰ hides the chat list and the chat takes the width (list x ${await listX()}, margin ${ml})`)
    await cvw.reload()
    await cvw.locator('.msg.assistant').first().waitFor({ timeout: 15000 })
    await cvw.waitForFunction(() => (document.querySelector('.drawer')?.getBoundingClientRect().x ?? 0) < 0, null, { timeout: 3000 }).catch(() => {})
    check((await listX()) < 0, 'wide screen: the hidden chat list stays hidden after a restart')
    await cvw.getByRole('button', { name: 'Show chat list' }).click()
    await cvw.waitForFunction(() => (document.querySelector('.drawer')?.getBoundingClientRect().x ?? -1) >= 0, null, { timeout: 3000 }).catch(() => {})
    check((await listX()) >= 0, 'wide screen: ☰ docks the chat list again')
    // « at the top of the docked list hides it too.
    await cvw.getByRole('button', { name: 'Hide the chat list' }).click()
    await cvw.waitForFunction(() => (document.querySelector('.drawer')?.getBoundingClientRect().x ?? 0) < 0, null, { timeout: 3000 }).catch(() => {})
    check((await listX()) < 0 && (await cvw.locator('.drawer-backdrop.show').count()) === 0, 'wide screen: « hides the docked list, no backdrop left')
    await cvw.evaluate(() => localStorage.removeItem('hm.sideHidden.v1'))
  }
  await cvw.close()

  // Tablets: the canvas docks beside the chat from 700 px; the divider between them shares the width.
  const tab = await browser.newPage({ viewport: { width: 800, height: 1280 } })
  tab.on('pageerror', e => { console.log('PAGEERROR', e.message); fail() })
  await tab.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-panel', profile: 'default' })))
  await tab.addInitScript(s => { window.__setup = s }, { termux: true, runCommand: true, notifications: true, batteryApp: true, batteryTermux: true, startError: '', termuxApi: true, termuxBoot: true, shizuku: true })
  await tab.addInitScript(nativeShell)
  await tab.goto(WEB + '/')
  await tab.locator('.msg.assistant').first().waitFor({ timeout: 15000 })
  await tab.getByPlaceholder('Message Hermux').waitFor({ timeout: 5000 })
  await tab.waitForFunction(() => window.__edgeGrab === true, null, { timeout: 3000 }).catch(() => {})
  {
    const width = async () => (await tab.locator('.canvas-panel').boundingBox())?.width ?? 0
    const chatW = () => tab.locator('.chat-wrap').evaluate(el => el.getBoundingClientRect().width)
    check((await tab.locator('.canvas-pull').isVisible()) && (await tab.evaluate(() => window.__edgeGrab)) === true, 'tablet: the pull tab shows at the right edge and the shell keeps Back off it')
    {
      const r = await tab.evaluate(() => {
        const s = document.createElement('div')
        s.className = 'scrubber'
        document.querySelector('.chat-wrap').appendChild(s)
        const b = s.getBoundingClientRect()
        s.remove()
        return b.right
      })
      check(r <= 800 - 24, `tablet: the scrubber stays out of the edge strip (right ${r})`)
    }
    await tab.locator('.canvas-pull').click()
    await tab.locator('.canvas-panel').waitFor({ timeout: 3000 })
    await tab.waitForFunction(() => { const b = document.querySelector('.canvas-panel')?.getBoundingClientRect(); const a = document.querySelector('.app'); return !!b && !!a && Math.abs(b.x + b.width - 800) <= 1 && Math.abs(parseFloat(getComputedStyle(a).marginRight) - b.width) <= 2 }, null, { timeout: 3000 }).catch(() => {})
    const b = await tab.locator('.canvas-panel').boundingBox()
    const mr = await tab.locator('.app').evaluate(el => parseFloat(getComputedStyle(el).marginRight))
    check(b && b.x > 300 && Math.abs(b.x + b.width - 800) <= 1 && Math.abs(mr - b.width) <= 2, `tablet upright (800 px): tapping the pull tab opens the canvas as a column beside the chat (${JSON.stringify(b)})`)
    check(!(await tab.locator('.canvas-pull').isVisible()) && (await tab.evaluate(() => window.__edgeGrab)) === false, 'tablet: the pull tab and the edge claim go while the canvas is open')
    const grip = async () => {
      const h = await tab.locator('.canvas-split').boundingBox()
      return { x: h.x + h.width / 2, y: h.y + h.height / 2 }
    }
    const dragTo = async x => {
      const w0 = await width()
      const g = await grip()
      await tab.mouse.move(g.x, g.y)
      await tab.mouse.down()
      for (let i = 1; i <= 8; i++) await tab.mouse.move(g.x + ((x - g.x) * i) / 8, g.y)
      await tab.mouse.up()
      await tab.waitForFunction(prev => { const p = document.querySelector('.canvas-panel'); return !p || Math.abs(p.getBoundingClientRect().width - prev) > 1 }, w0, { timeout: 3000 }).catch(() => {})
    }
    await dragTo(500)
    check(Math.abs((await width()) - 300) <= 3, `tablet: dragging the divider resizes the canvas (${await width()})`)
    const saved = await tab.evaluate(() => Number(localStorage.getItem('hm.canvasSplit.v1')))
    check(Math.abs(saved - 0.375) < 0.02, `tablet: the width is kept as a share of the screen (${saved})`)
    await dragTo(200)
    check(Math.abs((await width()) - 460) <= 3 && (await chatW()) >= 339, `tablet: the chat keeps at least 340 px (canvas ${await width()}, chat ${await chatW()})`)
    await tab.locator('.canvas-split').focus()
    await tab.keyboard.press('ArrowRight')
    await tab.waitForFunction(() => (document.querySelector('.canvas-panel')?.getBoundingClientRect().width ?? 999) < 460, null, { timeout: 3000 }).catch(() => {})
    check((await width()) < 460, `tablet: ArrowRight on the divider narrows the canvas (${await width()})`)
    await tab.locator('.canvas-split').dblclick()
    await tab.waitForFunction(() => localStorage.getItem('hm.canvasSplit.v1') === null && Math.abs((document.querySelector('.canvas-panel')?.getBoundingClientRect().width ?? 0) - 368) <= 3, null, { timeout: 3000 }).catch(() => {})
    check((await tab.evaluate(() => localStorage.getItem('hm.canvasSplit.v1'))) === null && Math.abs((await width()) - 368) <= 3, `tablet: a double-tap on the divider resets the width (${await width()})`)
    // Past 85 % the canvas goes full screen; under 20 % it closes. While dragging, the divider says which.
    {
      const g = await grip()
      await tab.mouse.move(g.x, g.y)
      await tab.mouse.down()
      for (let i = 1; i <= 8; i++) await tab.mouse.move(g.x + ((40 - g.x) * i) / 8, g.y)
      check(await tab.locator('.hint-max').isVisible(), 'tablet: dragging the divider far left shows "Full screen"')
      await tab.mouse.up()
      await tab.locator('.canvas-panel.size-max').waitFor({ timeout: 3000 }).catch(() => {})
    }
    check((await tab.locator('.canvas-panel.size-max').count()) === 1, 'tablet: letting go past 85 % fills the screen')
    await tab.getByRole('button', { name: 'Exit full screen' }).click()
    await tab.locator('.canvas-panel.size-side').waitFor({ timeout: 3000 }).catch(() => {})
    await dragTo(780)
    check((await tab.locator('.canvas-panel').count()) === 0, 'tablet: letting go under 20 % closes the canvas')
    await tab.reload()
    await tab.locator('.msg.assistant').first().waitFor({ timeout: 15000 })
    await tab.getByRole('banner').getByRole('button', { name: 'Chat options' }).click()
    await tab.locator('.sheet').first().waitFor({ timeout: 3000 })
    check(!(await tab.locator('.canvas-pull').isVisible()), 'tablet: no pull tab while a sheet is open')
  }
  await tab.close()
  // A real finger pulls the canvas in from the right edge (wide screen): it follows the finger and opens where it lets
  // go; a quick flick opens it at the width it had last time.
  {
    const ectx = await browser.newContext({ viewport: { width: 1100, height: 800 }, hasTouch: true })
    const ep = await ectx.newPage()
    ep.on('pageerror', e => { console.log('PAGEERROR', e.message); fail() })
    await ep.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-panel', profile: 'default' })))
    await ep.goto(WEB + '/')
    await ep.locator('.msg.assistant').first().waitFor({ timeout: 15000 })
    await ep.getByPlaceholder('Message Hermux').waitFor({ timeout: 5000 })
    const cdp = await ectx.newCDPSession(ep)
    const finger = async (x0, y0, dx, steps, wait) => {
      const pt = x => [{ x, y: y0, id: 1 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0) })
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + (dx * i) / steps) })
        await sleep(wait) // step interval controls pull vs flick gesture velocity
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    const width = async () => (await ep.locator('.canvas-panel').boundingBox())?.width ?? 0
    await finger(1095, 300, -400, 40, 40)
    await ep.locator('.canvas-panel').waitFor({ timeout: 3000 }).catch(() => {})
    check((await ep.locator('.canvas-panel').count()) === 1 && Math.abs((await width()) - 405) <= 8, `wide screen: a slow pull from the right edge opens the canvas where the finger lets go (${await width()})`)
    const kept = await width()
    await ep.getByRole('button', { name: 'Close canvas' }).click()
    await ep.locator('.canvas-panel').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    await finger(1095, 300, -120, 4, 16)
    await ep.locator('.canvas-panel').waitFor({ timeout: 3000 }).catch(() => {})
    check((await ep.locator('.canvas-panel').count()) === 1 && Math.abs((await width()) - kept) <= 3, `wide screen: a flick from the right edge opens the canvas at its last width (${await width()} vs ${kept})`)
    await ep.getByRole('button', { name: 'Close canvas' }).click()
    await ep.locator('.canvas-panel').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    await finger(1095, 300, -60, 12, 40)
    // Negative check: confirm a short slow pull from the edge leaves the canvas closed.
    await sleep(300)
    check((await ep.locator('.canvas-panel').count()) === 0, 'wide screen: a short slow pull from the edge leaves the canvas closed')
    await ectx.close()
  }
  // Phones keep the full-width panel: no divider, no pull tab.
  {
    const pp = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await pp.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-panel', profile: 'default' })))
    await pp.goto(WEB + '/')
    await pp.locator('.msg.assistant').first().waitFor({ timeout: 15000 })
    check((await pp.locator('.canvas-pull').count()) === 0, 'phone: no pull tab')
    await pp.locator('.canvas-btn').click()
    await pp.locator('.canvas-panel').waitFor({ timeout: 3000 })
    await pp.waitForFunction(() => (document.querySelector('.canvas-panel')?.getBoundingClientRect().width ?? 0) >= 374, null, { timeout: 3000 }).catch(() => {})
    const b = await pp.locator('.canvas-panel').boundingBox()
    check(b && b.width >= 374 && (await pp.locator('.canvas-split').count()) === 0, `phone: the canvas still covers the chat, no divider (${JSON.stringify(b)})`)
    await pp.close()
  }

  // A swipe left on the empty new-chat screen does what the canvas button does there: starts the chat, opens its canvas.
  {
    const pe = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await pe.goto(WEB + '/')
    await pe.locator('.empty .suggestion').first().waitFor({ timeout: 8000 })
    // The suggestions show before the socket opens, and starting the chat needs the socket: wait for it, or a slow run swipes too early.
    await pe.locator('.conn-banner').waitFor({ state: 'detached', timeout: 15000 })
    await pe.evaluate(() => {
      const el = document.querySelector('.empty')
      const mk = (type, px) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: el, clientX: px, clientY: 300 })] })
      el.dispatchEvent(mk('touchstart', 300))
      el.dispatchEvent(mk('touchmove', 200))
      el.dispatchEvent(mk('touchmove', 80))
      el.dispatchEvent(mk('touchend', 80))
    })
    await pe.locator('.canvas-panel').waitFor({ timeout: 5000 }).then(() => check(true, 'swipe left on the empty new-chat screen opens a canvas'), () => check(false, 'swipe left on the empty new-chat screen opens a canvas'))
    await pe.close()
  }

  // Before the connection opens a new chat can't start: the swipe and the canvas button say so instead of doing nothing.
  {
    const pc = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await pc.addInitScript(() => {
      window.WebSocket = class {
        readyState = 0
        addEventListener() {}
        removeEventListener() {}
        send() {}
        close() {}
      }
    })
    await pc.goto(WEB + '/')
    await pc.locator('.empty .suggestion').first().waitFor({ timeout: 8000 })
    await pc.locator('.conn-banner').waitFor({ timeout: 5000 })
    const said = () => pc.locator('.toast', { hasText: 'Still connecting, try again in a moment' })
    await pc.evaluate(() => {
      const el = document.querySelector('.empty')
      const mk = (type, px) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: el, clientX: px, clientY: 300 })] })
      el.dispatchEvent(mk('touchstart', 300))
      el.dispatchEvent(mk('touchmove', 200))
      el.dispatchEvent(mk('touchmove', 80))
      el.dispatchEvent(mk('touchend', 80))
    })
    await said().waitFor({ timeout: 3000 }).then(() => check(true, 'still connecting: a swipe left says so'), () => check(false, 'still connecting: a swipe left says so'))
    check((await pc.locator('.canvas-panel').count()) === 0, 'still connecting: a swipe left opens no canvas')
    await said().waitFor({ state: 'detached', timeout: 6000 })
    await pc.locator('.canvas-btn').click()
    await said().waitFor({ timeout: 3000 }).then(() => check(true, 'still connecting: the canvas button says so'), () => check(false, 'still connecting: the canvas button says so'))
    await pc.close()
  }

  // ── the canvas panel's bar and its document menu, by role and name (each control used, its effect checked) ──
  {
    const { WEB, MOCK, calls } = require('../lib.cjs')
    const addDoc = (session, title) => fetch(MOCK + '/api/plugins/hermes-mobile/canvas/doc', { method: 'POST', body: JSON.stringify({ session, title, type: 'markdown', content: `# ${title}\n\nfirst words` }) })
    await addDoc('s-40', 'Plan')
    const cb = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await cb.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-40', profile: 'default' })))
    await cb.goto(WEB + '/')
    await cb.getByText('answer s-40', { exact: true }).waitFor({ timeout: 8000 })
    await cb.getByRole('banner').getByRole('button', { name: 'Canvas' }).click()
    const panel = cb.getByRole('dialog', { name: 'Canvas' })
    await panel.getByRole('button', { name: 'Plan', exact: true }).waitFor({ timeout: 5000 })
    const since = Date.now()
    const more = async () => {
      await panel.getByRole('button', { name: 'More' }).click()
      await cb.getByRole('dialog').filter({ hasText: 'Version history' }).waitFor({ timeout: 3000 })
      return cb.getByRole('dialog').filter({ hasText: 'Version history' })
    }
    // Rename: asks for the title and stores it.
    await (await more()).getByRole('button', { name: 'Rename', exact: true }).click()
    const ask = cb.getByRole('alertdialog')
    await ask.getByRole('textbox').fill('Plan B')
    await ask.getByRole('button', { name: 'Rename', exact: true }).click()
    const planBTab = panel.getByRole('button', { name: 'Plan B', exact: true })
    await planBTab.waitFor({ timeout: 3000 }).catch(() => {})
    const ren = calls().filter(c => c.t >= since && c.path === '/api/plugins/hermes-mobile/canvas/rename')
    check(ren.length === 1 && ren[0].body.title === 'Plan B' && (await planBTab.count()) === 1, `canvas menu: Rename stores the new title and the tab shows it (${JSON.stringify(ren.map(c => c.body.title))})`)
    // Version history lists the versions, the current one marked.
    await (await more()).getByRole('button', { name: /Version history/ }).click()
    const hist = cb.getByRole('dialog').filter({ hasText: 'Version history' })
    const listed = await hist.getByRole('button', { name: /Version 1 · current/ }).waitFor({ timeout: 3000 }).then(() => true, () => false)
    check(listed, 'canvas menu: Version history lists the document\'s versions, the current one marked')
    await cb.evaluate(() => window.hermesBack())
    await hist.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    // Close this document asks first, then removes it from the canvas.
    await (await more()).getByRole('button', { name: 'Close this document', exact: true }).click()
    await cb.getByRole('alertdialog').getByRole('button', { name: 'Close', exact: true }).click()
    await planBTab.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    const del = calls().filter(c => c.t >= since && c.http === 'DELETE' && c.path === '/api/plugins/hermes-mobile/canvas/doc')
    check(del.length === 1 && /session=s-40/.test(del[0].query) && (await planBTab.count()) === 0, `canvas menu: Close this document asks, then removes it (${JSON.stringify(del.map(c => c.query))})`)
    await cb.close()
    // Wide screens: Open the canvas (the tab at the right edge) brings it in; Resize the canvas moves with the arrow keys.
    await addDoc('s-41', 'Wide plan')
    const cw = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    await cw.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-41', profile: 'default' })))
    await cw.goto(WEB + '/')
    await cw.getByText('answer s-41', { exact: true }).waitFor({ timeout: 8000 })
    const pull = cw.getByRole('button', { name: 'Open the canvas' })
    const pulled = await pull.waitFor({ timeout: 3000 }).then(() => true, () => false)
    if (pulled) await pull.click()
    const wide = cw.getByRole('dialog', { name: 'Canvas' })
    const opened = await wide.getByRole('button', { name: 'Wide plan', exact: true }).waitFor({ timeout: 3000 }).then(() => true, () => false)
    check(pulled && opened, 'canvas: on a wide screen Open the canvas brings the chat\'s canvas in')
    const split = cw.getByRole('separator', { name: 'Resize the canvas' })
    const before = await split.getAttribute('aria-valuenow').catch(() => null)
    await split.focus().catch(() => {})
    await cw.keyboard.press('ArrowLeft')
    await cw.waitForFunction(b => document.querySelector('[role="separator"][aria-label="Resize the canvas"]')?.getAttribute('aria-valuenow') !== b, before, { timeout: 3000 }).catch(() => {})
    const after = await split.getAttribute('aria-valuenow').catch(() => null)
    check(after !== null && after !== before, `canvas: Resize the canvas moves the divider with the arrow keys (${before} → ${after})`)
    await cw.close()
  }

  // ── Canvas save-file guards: protected Hermes files cannot be overwritten; disk-changed files ask via in-app dialog ──
  {
    const { WEB, MOCK, calls } = require('../lib.cjs')
    const mock = b => fetch(MOCK + '/__mock', { method: 'POST', body: JSON.stringify(b) })
    const p = await browser.newPage({ viewport: { width: 375, height: 812 } })
    p.on('pageerror', e => { console.log('PAGEERROR', e.message); fail() })
    await p.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-42', profile: 'default' })))
    await p.goto(WEB + '/')
    await p.getByText('answer s-42', { exact: true }).waitFor({ timeout: 10000 })

    // Open Files → Hermux → config.yaml → Open in canvas: Save to the original file is disabled and explains Settings.
    const openFiles = async () => {
      await p.getByRole('button', { name: /^Sessions/ }).click()
      await p.getByRole('button', { name: /^Library/ }).click()
      await p.getByRole('button', { name: 'Files', exact: true }).click()
    }
    // Open Files → Hermux → .env: Open in canvas is disabled for always-refused secrets.
    await openFiles()
    await p.getByRole('button', { name: 'Hermux', exact: true }).click()
    await p.getByRole('button', { name: /^\.env\b/ }).click()
    const envOpenBtn = p.getByRole('button', { name: 'Open in canvas', exact: true })
    await envOpenBtn.waitFor({ timeout: 5000 })
    check(await envOpenBtn.isDisabled(), 'canvas open-file: Open in canvas is disabled for /root/.hermes/.env')
    await p.evaluate(() => window.hermesBack())
    await envOpenBtn.waitFor({ state: 'detached', timeout: 3000 })

    // If /canvas/open-file is refused by the server, Files stays open and the preview stays visible.
    await p.route('**/api/plugins/hermes-mobile/canvas/open-file', r => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ detail: 'refused: test refusal' }) }), { times: 1 })
    await p.getByRole('button', { name: /config\.yaml/ }).click()
    const openBtn = p.getByRole('button', { name: 'Open in canvas', exact: true })
    await openBtn.click()
    await p.getByText('refused: test refusal').waitFor({ timeout: 3000 })
    check(await openBtn.isVisible(), 'canvas open-file: server refusal leaves the user in Files with the preview open')
    await openBtn.click()
    const panel = p.getByRole('dialog', { name: 'Canvas' })
    await panel.getByRole('button', { name: 'config.yaml', exact: true }).waitFor({ timeout: 5000 })
    const savesBefore = calls().filter(c => c.path === '/api/plugins/hermes-mobile/canvas/save-file').length
    await panel.getByRole('button', { name: 'More' }).click()
    const docMenu = p.getByRole('dialog').filter({ hasText: 'Version history' })
    await docMenu.waitFor({ timeout: 3000 })
    const saveBtn = docMenu.getByRole('button', { name: /Save to the original file/ })
    check(await saveBtn.isDisabled(), 'canvas save-file: Save to the original file is disabled for /root/.hermes/config.yaml')
    check((await saveBtn.innerText()).includes('Settings'), 'canvas save-file: disabled row tells the user to change settings in Settings')
    check(calls().filter(c => c.path === '/api/plugins/hermes-mobile/canvas/save-file').length === savesBefore, 'canvas save-file: no save-file request sent for config.yaml')
    await p.evaluate(() => window.hermesBack())
    await docMenu.waitFor({ state: 'detached', timeout: 3000 })
    await panel.getByRole('button', { name: 'Close canvas' }).click()
    await panel.waitFor({ state: 'detached', timeout: 3000 })

    // Open Files → Phone → note.txt → Open in canvas; simulate disk change → 409 triggers in-app dialog; Cancel keeps disk, Overwrite sends force: true.
    await openFiles()
    await p.getByRole('button', { name: 'Phone', exact: true }).click()
    await p.getByRole('button', { name: /note\.txt/ }).click()
    await p.getByRole('button', { name: 'Open in canvas', exact: true }).click()
    await panel.getByRole('button', { name: 'note.txt', exact: true }).waitFor({ timeout: 5000 })
    await mock({ canvasFileChanged: '/sdcard/note.txt' })
    const since = Date.now()
    await panel.getByRole('button', { name: 'More' }).click()
    await docMenu.waitFor({ timeout: 3000 })
    await docMenu.getByRole('button', { name: /Save to the original file/ }).click()
    const warnDlg = p.getByRole('alertdialog')
    await warnDlg.getByText('Overwrite changed file?').waitFor({ timeout: 3000 })
    await warnDlg.getByRole('button', { name: 'Cancel', exact: true }).click()
    await warnDlg.waitFor({ state: 'detached', timeout: 3000 })
    const afterCancel = calls().filter(c => c.t >= since && c.path === '/api/plugins/hermes-mobile/canvas/save-file')
    check(afterCancel.length === 1 && !afterCancel[0].body?.force, `canvas save-file: Cancel on changed-file dialog sends no forced save (${JSON.stringify(afterCancel.map(c => c.body))})`)

    await panel.getByRole('button', { name: 'More' }).click()
    await docMenu.waitFor({ timeout: 3000 })
    await docMenu.getByRole('button', { name: /Save to the original file/ }).click()
    await warnDlg.getByText('Overwrite changed file?').waitFor({ timeout: 3000 })
    await warnDlg.getByRole('button', { name: 'Overwrite', exact: true }).click()
    await warnDlg.waitFor({ state: 'detached', timeout: 3000 })
    await p.getByText('Saved to /sdcard/note.txt').waitFor({ timeout: 3000 })
    const afterOverwrite = calls().filter(c => c.t >= since && c.path === '/api/plugins/hermes-mobile/canvas/save-file')
    check(afterOverwrite.length === 3 && afterOverwrite[2].body?.force === true, `canvas save-file: Overwrite sends force: true and saves (${JSON.stringify(afterOverwrite.map(c => c.body))})`)
    await mock({ canvasFileChanged: [] })
    await p.close()
  }

  // ── System font-size and dark-mode changes: handled in place without closing the open canvas ──
  {
    const cp = await browser.newPage({ viewport: { width: 375, height: 812 } })
    cp.on('pageerror', e => { console.log('PAGEERROR (canvas config change)', e.message); fail() })
    await cp.addInitScript(nativeShell)
    await cp.addInitScript(() => {
      window.__fs = 1.0
      window.__dark = true
      localStorage.setItem('hm.theme', 'system')
      localStorage.setItem('hm.motion', 'off')
      localStorage.removeItem('hm.textScale')
      localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-41', profile: 'default' }))
      Object.assign(window.HermesAndroid, {
        phoneTextScale: key => (key === 'K' ? window.__fs : 0),
        isSystemDark: key => (key === 'K' ? window.__dark : true)
      })
    })
    await cp.goto(WEB + '/')
    await cp.getByText('answer s-41', { exact: true }).waitFor({ timeout: 10000 })
    await cp.getByRole('banner').getByRole('button', { name: 'Canvas' }).click()
    const panel = cp.getByRole('dialog', { name: 'Canvas' })
    await panel.getByRole('button', { name: 'Wide plan', exact: true }).waitFor({ timeout: 5000 })
    await cp.evaluate(() => {
      window.__fs = 2.0
      window.__dark = false
      window.__hmPhoneTextScale && window.__hmPhoneTextScale()
      window.__hmSystemTheme && window.__hmSystemTheme()
    })
    await cp.waitForFunction(() => Math.abs(Number(getComputedStyle(document.documentElement).getPropertyValue('--scale')) - 1.35) < 0.001, null, { timeout: 3000 }).catch(() => {})
    const state = await cp.evaluate(() => ({
      scale: Number(getComputedStyle(document.documentElement).getPropertyValue('--scale')),
      theme: document.documentElement.dataset.theme
    }))
    const stillOpen = await panel.isVisible() && (await panel.getByRole('button', { name: 'Wide plan', exact: true }).count()) === 1
    check(stillOpen && Math.abs(state.scale - 1.35) < 0.001 && state.theme === 'light', `canvas: system font-size and dark-mode changes update in place and keep the canvas open (${JSON.stringify({ stillOpen, ...state })})`)
    await cp.close()
  }
}
