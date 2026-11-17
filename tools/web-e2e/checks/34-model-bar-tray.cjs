// The composer's tray (docs/decisions/chat-height-belongs-to-content.md; spec 3.4 "Tray"): the live status line and the
// model row sit in a tray above the text box. A new chat shows it open and its first message closes it; a chat from the
// list starts closed; the handle opens and closes it by a tap, a drag or the keyboard, and shows the chat's state; the
// hint shows once; Settings → Appearance → Model bar "Always open" gives the layout from before; closed, the composer
// is shorter and nothing in the tray is drawn. Every page here starts with Model bar at its default, "Tucked away"
// (lib.cjs `trayTucked`), and finds things by role, name and words.
// HM_E2E_RECORD=1 prints the measured heights in the shape of RECORDED_TRAY.
const { WEB, nativeShell, check, sleep, setMotion, expectIdle, trayTucked } = require('../lib.cjs')

const OPEN = 'Model and status, open. Close'
const CLOSED = 'Model and status, closed. Open'

// The chat screen at 360 x 740 before the tray (31-fixed-points.cjs and 33-glass-and-motion.cjs): the space below the
// messages and the messages' visible height, idle, with the keyboard open and while a reply runs.
const BEFORE = {
  idle: { bottom: 102, messages: 581 },
  keyboard: { bottom: 102, messages: 281 },
  working: { bottom: 130, messages: 553 }
}
// With the tray (2026-11-17), closed and open. Closed may not grow (nor the messages shrink) by more than 2 px.
const RECORDED_TRAY = {
  closed: { idle: { bottom: 69, messages: 614 }, keyboard: { bottom: 69, messages: 314 }, working: { bottom: 69, messages: 614 } },
  open: { idle: { bottom: 101, messages: 582 }, working: { bottom: 122, messages: 561 } }
}
const record = process.env.HM_E2E_RECORD === '1'

module.exports = async t => {
  const { browser } = t
  // A page of the fake shell (with voice, so Live and Dictate show) on chat `chat`, Model bar at its default, glass on
  // unless `store` says otherwise, stored settings `store` (null removes a key) set before the app starts.
  const open = async (size, chat, store = {}, ctx = {}) => {
    store = { 'hm.glass': '1', ...store }
    const context = await browser.newContext({ viewport: size, ...ctx })
    const p = await context.newPage()
    await p.addInitScript(nativeShell)
    await p.addInitScript(() => {
      window.HermesAndroid.startListening = () => {}
      window.HermesAndroid.stopListening = () => {}
      window.HermesAndroid.copyText = () => true
    })
    await p.addInitScript(trayTucked)
    await p.addInitScript(([id, store]) => {
      if (!sessionStorage.getItem('opened')) {
        sessionStorage.setItem('opened', '1')
        if (id) localStorage.setItem('hm.lastSession', JSON.stringify({ id, profile: 'default' }))
        for (const [k, v] of Object.entries(store)) v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)
      }
      localStorage.setItem('hm.connectedOnce', '1')
    }, [chat, store])
    p.on('pageerror', e => {
      console.log('PAGEERROR (tray)', e.message)
      check(false, `tray: no page error (${e.message})`)
    })
    await p.goto(WEB + '/')
    await p.getByRole('textbox').first().waitFor({ timeout: 15000 })
    p.on('close', () => context.close().catch(() => {}))
    return p
  }
  const handle = p => p.getByRole('button', { name: /^Model and status, (open|closed)\./ })
  const modelChip = p => p.getByRole('button', { name: /^Model: .*Change model$/ })
  const autoBtn = p => p.getByRole('button', { name: /Change how much Hermux may do without asking$/ })
  const ring = p => p.getByRole('button', { name: /^Context .*Show details$/ })
  const box = p => p.getByRole('textbox', { name: /^(Message Hermux|Queue or steer a follow-up…)$/ })
  const expanded = async p => ((await handle(p).count()) ? await handle(p).getAttribute('aria-expanded') : 'none')
  const send = async (p, text) => {
    await box(p).fill(text)
    await p.getByRole('button', { name: 'Send', exact: true }).click()
  }
  // The handle's bar (its only child) and what it shows: colour, opacity, and whether a repeating animation runs in it.
  const look = p => p.evaluate(name => {
    const b = [...document.querySelectorAll('button')].find(x => /^Model and status, /.test(x.getAttribute('aria-label') || ''))
    if (!b) return null
    const pill = b.firstElementChild
    const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim()
    const rgb = c => {
      const d = document.createElement('i')
      d.style.color = c
      document.body.append(d)
      const out = getComputedStyle(d).color
      d.remove()
      return out
    }
    const s = getComputedStyle(pill)
    return {
      colour: s.backgroundColor, opacity: Number(s.opacity),
      dim: rgb(css('--dim')), accent: rgb(css('--accent')), warn: rgb(css('--warn')), err: rgb(css('--err')),
      moving: b.getAnimations({ subtree: true }).some(a => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity)
    }
  }, null)
  // Geometry of the chat screen: the top of what sits below the messages (the largest box around the text box that does
  // not hold the messages) and the messages' visible height between the header and it (as 31-fixed-points.cjs).
  const measure = (p, word) => p.evaluate(word => {
    const anchor = [...document.querySelectorAll('p, strong, button')].find(e => e.textContent === word) || document.querySelector('textarea')
    let sc = anchor
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
    const tb = document.querySelector('textarea')
    let comp = tb
    while (comp.parentElement && !comp.parentElement.contains(sc) && comp.parentElement !== document.body) comp = comp.parentElement
    const head = document.querySelector('header, [role="banner"]').getBoundingClientRect()
    const s = sc ? sc.getBoundingClientRect() : { top: 0, bottom: 0 }
    const c = comp.getBoundingClientRect()
    const bottom = Math.min(c.top, s.bottom)
    return { bottom: Math.round(innerHeight - bottom), messages: Math.round(bottom - Math.max(head.bottom, s.top)), found: !!sc }
  }, word)
  const settled = async p => {
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    await p.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity), null, { timeout: 3000 }).catch(() => {})
  }

  // ── a new chat shows the tray open; its first message closes it; the hint shows once, and never again ──
  {
    const p = await open({ width: 375, height: 812 }, null)
    await handle(p).waitFor({ timeout: 5000 })
    check((await expanded(p)) === 'true' && (await modelChip(p).count()) === 1 && (await autoBtn(p).count()) === 1 && (await ring(p).count()) === 1,
      `tray: a new chat shows it open, with the model chip, the Auto button and the context ring (${await expanded(p)})`)
    check((await handle(p).getAttribute('aria-label')) === OPEN, `tray: the open handle is named "${OPEN}"`)
    await send(p, 'hello there')
    await p.getByText('OK', { exact: true }).waitFor({ timeout: 8000 })
    check((await expanded(p)) === 'false' && (await modelChip(p).count()) === 0 && (await ring(p).count()) === 0, `tray: sending the first message closes it (${await expanded(p)})`)
    check((await handle(p).getAttribute('aria-label')) === CLOSED, `tray: the closed handle is named "${CLOSED}"`)
    const hint = p.getByRole('status').filter({ hasText: 'Model and context are here' })
    check((await hint.count()) === 1, 'tray: the first time it closes by itself, the hint "Model and context are here" shows')
    check(await p.evaluate(() => localStorage.getItem('hm.trayHint.v1') === '1'), 'tray: the hint is remembered as shown (hm.trayHint.v1)')
    await p.mouse.click(30, 200) // a touch anywhere
    await hint.waitFor({ state: 'detached', timeout: 2000 }).catch(() => {})
    check((await hint.count()) === 0, 'tray: a touch takes the hint away')
    // A second new chat: open again, closed by its first message, and no hint this time.
    await p.evaluate(() => window.hermesShortcut('new')) // the launcher's New chat
    await p.getByText('Your agent, on your phone.').waitFor({ timeout: 5000 }).catch(() => {})
    check((await expanded(p)) === 'true', `tray: another new chat starts open again (${await expanded(p)})`)
    await send(p, 'hello again')
    await p.getByText('OK', { exact: true }).last().waitFor({ timeout: 8000 })
    await sleep(200)
    check((await expanded(p)) === 'false' && (await hint.count()) === 0, 'tray: its first message closes it, and the hint never shows again')
    // After a restart too.
    await p.reload()
    await box(p).waitFor({ timeout: 15000 })
    check((await hint.count()) === 0, 'tray: no hint after a restart')
    await p.close()
  }

  // ── a chat opened from the list starts closed; a tap, the keyboard and a drag open and close it ──
  {
    const p = await open({ width: 375, height: 812 }, 's-48')
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    check((await expanded(p)) === 'false' && (await modelChip(p).count()) === 0, `tray: a chat opened at start starts closed (${await expanded(p)})`)
    await p.getByRole('button', { name: /^Sessions/ }).click()
    await p.getByText('Chat 46', { exact: true }).click()
    await p.getByText('answer s-46', { exact: true }).waitFor({ timeout: 8000 })
    check((await expanded(p)) === 'false' && (await modelChip(p).count()) === 0, `tray: a chat opened from the list starts closed (${await expanded(p)})`)
    await handle(p).click()
    check((await expanded(p)) === 'true' && (await modelChip(p).isVisible()) && (await autoBtn(p).isVisible()) && (await ring(p).isVisible()), 'tray: a tap on the handle opens it, showing the model chip, the Auto button and the context ring')
    check(/high/.test((await modelChip(p).innerText())) && /reasoning high/.test(await modelChip(p).getAttribute('aria-label')), `tray: the model chip shows its reasoning level (${(await modelChip(p).innerText()).replace(/\s+/g, ' ')})`)
    await handle(p).click()
    check((await expanded(p)) === 'false' && (await modelChip(p).count()) === 0, 'tray: a second tap closes it')
    // The keyboard and a screen reader open and close it by activation alone.
    await handle(p).focus()
    await p.keyboard.press('Enter')
    check((await expanded(p)) === 'true', 'tray: Enter on the focused handle opens it')
    await p.keyboard.press('Space')
    check((await expanded(p)) === 'false', 'tray: Space on the focused handle closes it')
    // A drag up opens it, a drag down closes it: with animations Off (the release decides) and Full (it follows).
    const drag = async dy => {
      const r = await handle(p).boundingBox()
      const x = r.x + r.width / 2, y = r.y + r.height - 6
      await p.mouse.move(x, y)
      await p.mouse.down()
      for (let i = 1; i <= 6; i++) await p.mouse.move(x, y + (dy * i) / 6)
      await p.mouse.up()
    }
    const scroller = () => p.evaluate(() => {
      let sc = [...document.querySelectorAll('p')].find(e => e.textContent === 'answer s-46')
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
      return sc ? sc.scrollTop : -1
    })
    const before = await scroller()
    await drag(-60)
    check((await expanded(p)) === 'true', 'tray: a drag up on the handle opens it (animations Off)')
    await drag(60)
    check((await expanded(p)) === 'false', 'tray: a drag down on the handle closes it (animations Off)')
    check((await scroller()) === before, 'tray: a drag on the handle does not scroll the chat')
    await setMotion(p, 'full')
    await drag(-80)
    await settled(p)
    await sleep(500) // the settle's end (motion.css --motion-settle, 400 ms), also when the finger left it in place
    check((await expanded(p)) === 'true' && (await modelChip(p).isVisible()), 'tray: a drag up opens it (animations Full, it follows the finger)')
    const placed = await p.evaluate(() => [...document.querySelectorAll('[style]')].filter(e => /translate/.test(e.getAttribute('style'))).length)
    check(placed === 0, `tray: once settled, nothing keeps a translate (${placed})`)
    await drag(80)
    await settled(p)
    await sleep(500)
    check((await expanded(p)) === 'false' && (await modelChip(p).count()) === 0, 'tray: a drag down closes it (animations Full)')
    // A short flick is enough.
    {
      const r = await handle(p).boundingBox()
      const x = r.x + r.width / 2, y = r.y + r.height - 6
      await p.mouse.move(x, y)
      await p.mouse.down()
      await p.mouse.move(x, y - 10)
      await p.mouse.move(x, y - 18)
      await p.mouse.up()
      await settled(p)
      check((await expanded(p)) === 'true', 'tray: a short quick flick up opens it')
    }
    // A drag the wrong way does nothing; a drag that turns back settles where it was.
    await drag(40)
    await settled(p)
    await sleep(500)
    check((await expanded(p)) === 'false', 'tray: (closed by a drag down for the next step)')
    await drag(40)
    await settled(p)
    await sleep(500)
    check((await expanded(p)) === 'false', 'tray: a drag down on a closed tray leaves it closed')
    await expectIdle(p, 'tray closed, animations Full')
    await handle(p).click()
    await settled(p)
    await expectIdle(p, 'tray open, animations Full')
    await setMotion(p, 'off')
    await p.close()
  }

  // ── the open tray holds the status bar, the model chip with its level, the Auto button and the context ring, each
  //    working as before; the last reply's speed shows beside the ring while no reply runs ──
  {
    const p = await open({ width: 375, height: 812 }, 's-48')
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await handle(p).click()
    await modelChip(p).click()
    const modelSheet = await p.getByRole('dialog').first().waitFor({ timeout: 3000 }).then(() => true, () => false)
    check(modelSheet, 'tray: the model chip in the tray opens the Model sheet')
    await p.evaluate(() => window.hermesBack()) // Android Back
    await p.getByRole('dialog').first().waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    await autoBtn(p).click()
    const autoPicker = await p.getByText('Auto: run without asking').first().waitFor({ timeout: 3000 }).then(() => true, () => false)
    check(autoPicker, 'tray: the Auto button in the tray opens the Auto picker')
    await p.getByRole('dialog').getByRole('button', { name: /^Auto access/ }).first().click()
    await p.getByRole('button', { name: /^Auto access is on/ }).waitFor({ timeout: 5000 }).catch(() => {})
    check((await autoBtn(p).getAttribute('aria-label')).startsWith('Auto access is on'), `tray: choosing Auto access from the tray switches the chat (${await autoBtn(p).getAttribute('aria-label')})`)
    await ring(p).click()
    const ctxSheet = await p.getByRole('dialog').getByText(/Context window/).first().waitFor({ timeout: 3000 }).then(() => true, () => false)
    check(ctxSheet, 'tray: the context ring in the tray opens the Context window sheet')
    await p.evaluate(() => window.hermesBack())
    await p.getByRole('dialog').first().waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    check((await expanded(p)) === 'true', 'tray: it stays open after its sheets close')
    // While a reply runs the open tray shows the status line with the elapsed time and speed; the reply's speed then
    // stays beside the ring.
    await send(p, 'long slow reply')
    await p.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 3000 })
    const status = await p.getByText('Reading the notes').or(p.getByText('Working…')).first().waitFor({ timeout: 3000 }).then(() => true, () => false)
    await p.waitForFunction(() => /0:0[3-9]/.test(document.body.innerText), null, { timeout: 5000 }).catch(() => {})
    const line = await p.getByText('Reading the notes').or(p.getByText('Thinking it over')).or(p.getByText('Writing')).first().evaluate(e => e.parentElement.innerText).catch(() => '')
    check(status && /0:0\d/.test(line), `tray: while a reply runs, the open tray shows the status and the elapsed time (${JSON.stringify(line)})`)
    check((await expanded(p)) === 'true', 'tray: opened by hand, it stays open across a send')
    await p.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'detached', timeout: 8000 })
    const row = modelChip(p).locator('xpath=..')
    await row.getByText(/tok\/s/).waitFor({ timeout: 3000 }).catch(() => {})
    check(/20 tok\/s/.test(await row.innerText()), `tray: with no reply running, the last reply's speed shows beside the context ring (${JSON.stringify((await row.innerText()).replace(/\s+/g, ' '))})`)
    // Closed by hand, it stays closed across a send.
    await handle(p).click()
    await send(p, 'slow reply')
    await p.getByText('Slow done.').waitFor({ timeout: 5000 })
    check((await expanded(p)) === 'false', 'tray: closed by hand, it stays closed across a send')
    await p.close()
  }

  // ── the handle's states: dim at rest, gold with a shimmer while a reply runs, amber and still while Hermux waits for
  //    you; the ring's colour when the context is nearly full ──
  {
    const p = await open({ width: 375, height: 812 }, 's-48', { 'hm.motion': 'full' })
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    const rest = await look(p)
    check(rest && rest.colour === rest.dim && rest.opacity < 1 && !rest.moving, `tray handle: dim and still at rest (${JSON.stringify(rest)})`)
    await send(p, 'long slow reply')
    await p.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 3000 })
    await sleep(150)
    const work = await look(p)
    check(work && work.colour === work.accent && work.opacity === 1 && work.moving, `tray handle: gold with a running shimmer while a reply runs (${JSON.stringify(work)})`)
    check((await box(p).getAttribute('placeholder')) === 'Queue or steer a follow-up…' && (await p.getByRole('button', { name: 'Stop', exact: true }).count()) === 1, 'tray handle: the placeholder and the Stop button still say a reply runs')
    // Away: the shimmer stands still.
    await p.evaluate(() => window.hermesPause && window.hermesPause())
    const away = await look(p)
    check(away && !away.moving, `tray handle: the shimmer stands still while the app is away (${JSON.stringify(away)})`)
    await p.evaluate(() => window.hermesResume && window.hermesResume())
    await p.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'detached', timeout: 8000 })
    await sleep(150)
    const after = await look(p)
    check(after && after.colour === after.dim && !after.moving, `tray handle: the shimmer ends with the reply (${JSON.stringify(after)})`)
    // Waiting for you: a question from Hermux.
    await send(p, 'ask me three')
    await p.getByRole('dialog').first().waitFor({ timeout: 5000 })
    await sleep(150)
    const wait = await look(p)
    check(wait && wait.colour === wait.warn && wait.opacity === 1 && !wait.moving, `tray handle: amber and still while Hermux waits for you (${JSON.stringify(wait)})`)
    await p.close()
    const q = await open({ width: 375, height: 812 }, 's-full')
    await q.getByRole('button', { name: /^Model and status/ }).waitFor({ timeout: 8000 })
    await q.waitForFunction(() => [...document.querySelectorAll('button')].some(b => /^Model and status, /.test(b.getAttribute('aria-label') || '') && /\b(warn|full)\b/.test(b.className)), null, { timeout: 8000 }).catch(() => {})
    const full = await look(q)
    await handle(q).click()
    const ringColour = await ring(q).evaluate(b => getComputedStyle(b.querySelectorAll('circle')[1]).stroke)
    check(full && full.colour === full.warn && ringColour === full.warn, `tray handle: with the context nearly full (85%) it shows the ring's colour (${JSON.stringify(full)}, ring ${ringColour})`)
    await q.close()
  }

  // ── heights at 360 x 740: closed is shorter (idle, keyboard, working), open is no taller than before; glass on and
  //    off; a wider font changes nothing ──
  {
    const got = {}
    for (const glass of ['1', '0']) {
      const p = await open({ width: 360, height: 740 }, 's-48', { 'hm.glass': glass })
      await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
      await settled(p)
      const s = { closed: {}, open: {} }
      s.closed.idle = await measure(p, 'answer s-48')
      await box(p).focus()
      await p.setViewportSize({ width: 360, height: 440 }) // the shell shrinks the page by the keyboard (31-fixed-points)
      await settled(p)
      s.closed.keyboard = await measure(p, 'answer s-48')
      await p.setViewportSize({ width: 360, height: 740 })
      await settled(p)
      await send(p, 'long slow reply')
      await p.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 3000 })
      await settled(p)
      s.closed.working = await measure(p, 'answer s-48')
      await handle(p).click()
      await settled(p)
      s.open.working = await measure(p, 'answer s-48')
      await p.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'detached', timeout: 8000 })
      await settled(p)
      s.open.idle = await measure(p, 'answer s-48')
      // A wider font (wide letter-spacing everywhere): open and closed keep their heights.
      await p.addStyleTag({ content: '* { letter-spacing: 0.3em !important; }' })
      await settled(p)
      const wideOpen = await measure(p, 'answer s-48')
      await handle(p).click()
      await settled(p)
      const wideClosed = await measure(p, 'answer s-48')
      check(Math.abs(wideOpen.bottom - s.open.idle.bottom) <= 1 && Math.abs(wideClosed.bottom - s.closed.idle.bottom) <= 1, `tray, glass ${glass === '1' ? 'on' : 'off'}: a wider font does not grow the composer (open ${wideOpen.bottom} / ${s.open.idle.bottom}, closed ${wideClosed.bottom} / ${s.closed.idle.bottom})`)
      got[glass] = s
      await p.close()
    }
    if (record) console.log('RECORDED_TRAY', JSON.stringify(got['1']))
    for (const [glass, s] of Object.entries(got)) {
      const look = glass === '1' ? 'on' : 'off'
      for (const k of ['idle', 'keyboard', 'working']) {
        const now = s.closed[k], was = RECORDED_TRAY.closed[k]
        check(now.found && now.bottom <= was.bottom + 2 && now.messages >= was.messages - 2, `tray closed, glass ${look}, ${k}: the composer area (${now.bottom} px, recorded ${was.bottom}) did not grow and the messages (${now.messages}, recorded ${was.messages}) did not shrink`)
      }
      const gain = k => s.closed[k].messages - BEFORE[k].messages
      check(gain('idle') >= 24 && gain('keyboard') >= 24, `tray closed, glass ${look}: the messages gain at least 24 px idle (${gain('idle')}) and with the keyboard open (${gain('keyboard')})`)
      check(gain('working') >= 50, `tray closed, glass ${look}: the messages gain at least 50 px while a reply runs (${gain('working')})`)
      for (const k of ['idle', 'working']) {
        const now = s.open[k]
        check(now.bottom <= BEFORE[k].bottom + 2 && now.messages >= BEFORE[k].messages - 2 && now.bottom <= RECORDED_TRAY.open[k].bottom + 2, `tray open, glass ${look}, ${k}: no taller than before the tray (${now.bottom} px, before ${BEFORE[k].bottom}; messages ${now.messages}, before ${BEFORE[k].messages})`)
      }
    }
  }

  // ── opening and closing keeps the reader's place: at the end the last message stays in view above the composer;
  //    scrolled up, the text does not move ──
  {
    const p = await open({ width: 360, height: 740 }, 's-visit')
    await p.getByText('visit answer 2').waitFor({ timeout: 8000 })
    await settled(p)
    const at = () => p.evaluate(() => {
      let sc = [...document.querySelectorAll('p')].find(e => e.textContent === 'visit answer 2')
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
      const tb = document.querySelector('textarea')
      let comp = tb
      while (comp.parentElement && !comp.parentElement.contains(sc)) comp = comp.parentElement
      const ps = [...sc.querySelectorAll('p')]
      const mid = ps.find(e => e.getBoundingClientRect().top > 200)
      return { left: Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight), top: sc.scrollTop, midTop: mid ? mid.getBoundingClientRect().top : null, compTop: comp.getBoundingClientRect().top, lastBottom: ps[ps.length - 1].getBoundingClientRect().bottom }
    })
    await p.evaluate(() => {
      let sc = [...document.querySelectorAll('p')].find(e => e.textContent === 'visit answer 2')
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
      sc.scrollTop = sc.scrollHeight
    })
    await settled(p)
    await handle(p).click()
    await settled(p)
    const end = await at()
    check(end.left <= 2 && end.lastBottom <= end.compTop, `tray: opened at the end of the chat, the last message stays in view above the composer (${JSON.stringify(end)})`)
    await handle(p).click()
    await settled(p)
    await p.evaluate(() => {
      let sc = [...document.querySelectorAll('p')].find(e => e.textContent === 'visit answer 2')
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
      sc.scrollTop = sc.scrollHeight / 2
    })
    await settled(p)
    const a = await at()
    await handle(p).click()
    await settled(p)
    const b = await at()
    await handle(p).click()
    await settled(p)
    const c = await at()
    check(a.midTop != null && a.midTop === b.midTop && b.midTop === c.midTop && a.top === c.top, `tray: scrolled up, opening and closing it does not move the text (${a.midTop}, ${b.midTop}, ${c.midTop})`)
    await p.close()
  }

  // ── the handle's target reaches over the chat, not over the last reply's buttons ──
  {
    const p = await open({ width: 360, height: 740 }, 's-48')
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await settled(p)
    const r = await handle(p).boundingBox()
    check(r.height >= 44 && r.width >= 96, `tray: the handle's target is at least 44 x 96 px (${Math.round(r.width)} x ${Math.round(r.height)})`)
    // Every action of the last reply, hit at its centre with the mouse, reaches that button.
    const reply = p.getByText('answer s-48', { exact: true }).locator('xpath=ancestor::*[.//button][1]')
    const names = await reply.getByRole('button').evaluateAll(bs => bs.map(b => b.getAttribute('aria-label')).filter(Boolean))
    await p.evaluate(() => {
      window.__hits = []
      document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); if (b) window.__hits.push(b.getAttribute('aria-label')) }, true)
    })
    const missed = []
    for (const n of names) {
      if (/^(Read aloud|Retry|Branch)$/.test(n)) continue // these start something; Copy and Edit say enough about the place
      const b = await reply.getByRole('button', { name: n, exact: true }).first().boundingBox()
      await p.evaluate(() => (window.__hits = []))
      await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
      await sleep(100)
      const hits = await p.evaluate(() => window.__hits)
      if (!hits.includes(n)) missed.push(`${n}: ${JSON.stringify(hits)}`)
    }
    // A click on the target where it reaches over the last reply's row, on a button there, goes to that button.
    const overlap = await p.evaluate(() => {
      const h = [...document.querySelectorAll('button')].find(x => /^Model and status, /.test(x.getAttribute('aria-label') || ''))
      const hr = h.getBoundingClientRect()
      for (let x = hr.left + 2; x < hr.right - 2; x += 4) {
        for (let y = hr.top + 2; y < hr.bottom - 12; y += 4) {
          const under = document.elementsFromPoint(x, y).find(e => !h.contains(e) && e.closest('button') && e.closest('button') !== h)
          if (under) return { x, y, name: under.closest('button').getAttribute('aria-label') }
        }
      }
      return null
    })
    if (overlap) {
      await p.evaluate(() => (window.__hits = []))
      await p.mouse.click(overlap.x, overlap.y)
      await sleep(100)
      const hits = await p.evaluate(() => window.__hits)
      if (!hits.includes(overlap.name)) missed.push(`under the target, ${overlap.name}: ${JSON.stringify(hits)}`)
    }
    check(names.length > 0 && missed.length === 0, `tray: the last reply's buttons are still hit where they are (${JSON.stringify(names)}${overlap ? `; one under the handle's reach: ${overlap.name}` : ''}; missed ${JSON.stringify(missed)})`)
    check((await expanded(p)) === 'false', 'tray: those taps did not open the tray')
    await p.close()
  }

  // ── "Always open": the layout from before, with no handle ──
  {
    const p = await open({ width: 360, height: 740 }, 's-48')
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await p.getByRole('button', { name: /^Sessions/ }).click()
    await p.getByRole('button', { name: 'Settings' }).click()
    // Settings search finds it and leads to it.
    const search = p.getByRole('textbox', { name: 'Search settings' })
    await search.fill('model bar')
    const hit = p.getByRole('button', { name: /Model bar/ }).first()
    const found = await hit.waitFor({ timeout: 3000 }).then(() => true, () => false)
    if (found) await hit.click()
    else {
      await p.getByRole('button', { name: 'Clear search' }).click()
      await p.getByRole('button', { name: /^Appearance/ }).click()
    }
    const onPage = await p.getByText('Model bar', { exact: true }).waitFor({ timeout: 5000 }).then(() => true, () => false)
    check(found && onPage, 'Model bar: Settings search finds it and leads to it in Appearance')
    const tucked = p.getByRole('button', { name: 'Tucked away', exact: true })
    const always = p.getByRole('button', { name: 'Always open', exact: true })
    check((await tucked.getAttribute('aria-pressed')) === 'true' && (await always.getAttribute('aria-pressed')) === 'false', 'Model bar: Appearance offers it, "Tucked away" chosen by default')
    await always.click()
    check((await always.getAttribute('aria-pressed')) === 'true' && (await p.evaluate(() => localStorage.getItem('hm.modelBar'))) === 'open', 'Model bar: "Always open" is chosen and kept (hm.modelBar)')
    await p.evaluate(() => window.hermesBack())
    await p.evaluate(() => window.hermesBack())
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 5000 })
    await settled(p)
    check((await handle(p).count()) === 0 && (await modelChip(p).isVisible()) && (await ring(p).isVisible()), 'Model bar "Always open": no handle, the model row shows on a chat from the list')
    const idle = await measure(p, 'answer s-48')
    check(Math.abs(idle.bottom - BEFORE.idle.bottom) <= 2 && Math.abs(idle.messages - BEFORE.idle.messages) <= 2, `Model bar "Always open": the layout from before (composer ${idle.bottom} px, before ${BEFORE.idle.bottom}; messages ${idle.messages}, before ${BEFORE.idle.messages})`)
    await p.reload()
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    check((await handle(p).count()) === 0 && (await modelChip(p).count()) === 1, 'Model bar "Always open": kept after a restart')
    await p.close()
  }

  // ── Live mode replaces the composer and gives the tray back as it was ──
  {
    const p = await open({ width: 375, height: 812 }, 's-48')
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    for (const state of ['false', 'true']) {
      if ((await expanded(p)) !== state) await handle(p).click()
      await p.getByRole('button', { name: 'Live conversation' }).click()
      const liveOn = await p.getByText(/Live · /).first().waitFor({ timeout: 3000 }).then(() => true, () => false)
      check(liveOn && (await handle(p).count()) === 0 && (await modelChip(p).count()) === 0 && (await box(p).count()) === 0, `tray: Live mode replaces the tray and the text box (tray was ${state === 'true' ? 'open' : 'closed'})`)
      await p.getByRole('button', { name: 'End', exact: true }).click()
      await p.getByText(/Live · /).first().waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
      check((await expanded(p)) === state, `tray: after Live mode the tray is ${state === 'true' ? 'open' : 'closed'} again, as before (${await expanded(p)})`)
    }
    await p.close()
  }

  // ── the pull-up for the side chat keeps its full distance; a drag from the handle never starts it ──
  {
    const p = await open({ width: 375, height: 812 }, 's-5')
    await p.getByText('answer s-5', { exact: true }).waitFor({ timeout: 8000 })
    await settled(p)
    const pull = (dy, fromHandle) => p.evaluate(async ([dy, fromHandle]) => {
      const chat = [...document.querySelectorAll('p')].find(e => e.textContent === 'answer s-5')
      let el = chat
      while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement
      const h = [...document.querySelectorAll('button')].find(x => /^Model and status, /.test(x.getAttribute('aria-label') || ''))
      const target = fromHandle ? h : el
      const r = target.getBoundingClientRect()
      const x = fromHandle ? r.left + r.width / 2 : r.left + 60
      const y = fromHandle ? r.bottom - 6 : el.getBoundingClientRect().top + 300
      const mk = (type, py) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target, clientX: x, clientY: py })] })
      const wait = () => new Promise(res => setTimeout(res, 30))
      target.dispatchEvent(mk('touchstart', y))
      for (let i = 1; i <= 6; i++) {
        target.dispatchEvent(mk('touchmove', y - (dy * i) / 6))
        await wait()
      }
      target.dispatchEvent(mk('touchend', y - dy))
    }, [dy, fromHandle])
    const sideChat = () => p.getByRole('dialog').count()
    await pull(200, false)
    await sleep(400)
    check((await sideChat()) === 0, 'tray: with the handle there, a pull of 200 px still does not open the side chat')
    await pull(270, true)
    await sleep(400)
    check((await sideChat()) === 0, 'tray: a long drag that starts on the handle never opens the side chat')
    await pull(270, false)
    const opened = await p.getByRole('dialog').first().waitFor({ timeout: 3000 }).then(() => true, () => false)
    check(opened, 'tray: a firm pull (270 px) on the messages still opens the side chat')
    await p.close()
  }

  // ── animations Off: the tray opens and closes at once ──
  {
    const p = await open({ width: 375, height: 812 }, 's-48', { 'hm.motion': 'off' })
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    // A tap, then the next frame: the tray is there (or gone) and nothing moves.
    const now = await p.evaluate(async () => {
      const h = [...document.querySelectorAll('button')].find(x => /^Model and status, /.test(x.getAttribute('aria-label') || ''))
      const chip = () => [...document.querySelectorAll('button')].some(b => /^Model: /.test(b.getAttribute('aria-label') || ''))
      const frame = () => new Promise(r => requestAnimationFrame(r))
      h.click()
      await frame()
      const opened = chip() && document.getAnimations().filter(a => a.playState === 'running').length === 0
      h.click()
      await frame()
      const closed = !chip() && document.getAnimations().filter(a => a.playState === 'running').length === 0
      return { opened, closed }
    })
    check(now.opened && now.closed, `tray, animations Off: it opens and closes at once (${JSON.stringify(now)})`)
    await p.close()
  }

  // ── while it is closed and a reply runs, nothing in the tray is drawn: the composer does not change at all ──
  {
    const p = await open({ width: 375, height: 812 }, 's-48')
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    const watch = () => p.evaluate(() => {
      const tb = document.querySelector('textarea')
      let bar = tb
      while (bar.parentElement && !bar.parentElement.querySelector('[role="log"], .chat') && bar.parentElement !== document.body) bar = bar.parentElement
      window.__muts = 0
      window.__mo?.disconnect()
      window.__mo = new MutationObserver(list => {
        for (const m of list) if (!(m.target === tb || tb.contains(m.target))) window.__muts++
      })
      window.__mo.observe(bar, { subtree: true, childList: true, characterData: true, attributes: true })
    })
    await send(p, 'long slow reply')
    await p.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 3000 })
    await sleep(300)
    await watch()
    await sleep(2400) // status changes, words arrive, the elapsed time passes 0:03
    const closedMuts = await p.evaluate(() => window.__muts)
    await p.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'detached', timeout: 8000 })
    // The same with the tray open (the check can see changes): the status line redraws.
    await handle(p).click()
    await send(p, 'long slow reply')
    await p.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 3000 })
    await sleep(300)
    await watch()
    await sleep(2400)
    const openMuts = await p.evaluate(() => window.__muts)
    check(closedMuts === 0 && openMuts > 0, `tray: while closed and a reply runs nothing in it is drawn (${closedMuts} changes below the chat; open: ${openMuts})`)
    await p.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'detached', timeout: 8000 })
    await p.close()
  }
}
