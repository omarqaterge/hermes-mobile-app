// The glass material and the motion system (docs/decisions/glass-and-motion.md, chat-height-belongs-to-content.md,
// redesign-costs-no-speed-or-battery.md): the chat screen keeps its heights with the chat scrolling under glass bars,
// the first and last message stay clear of them, the composer stays above the keyboard, text on glass is readable over
// a white and a black picture in each theme, glass can be turned off, the three motion levels behave as described, an
// idle screen runs no animation, a hidden app pauses them, the chat still follows new text, and Appearance and Settings
// search offer both settings. Elements are found by role, name and words; the glass layer of a bar is its parent's
// ::before, found from the header (the banner) and the text box.
// HM_E2E_RECORD=1 prints the measured heights in the shape of RECORDED_STATES (run against the build before a change).
const { WEB, nativeShell, check, sleep, setMotion, expectIdle } = require('../lib.cjs')

// The chat screen at 360 x 740 on the build before glass (2026-11-17): the header's bottom, the space below the
// messages (the composer area, and the status bar while a reply runs) and the messages' visible height. Idle and with
// the keyboard open are 31-fixed-points.cjs's own numbers. A later change may improve them, never make them worse by
// more than 2 px.
const RECORDED_STATES = {
  idle: { header: 57, bottom: 102, messages: 581 },
  keyboard: { header: 57, bottom: 102, messages: 281 },
  working: { header: 57, bottom: 130, messages: 553 },
  attachment: { header: 57, bottom: 136, messages: 547 }
}
const record = process.env.HM_E2E_RECORD === '1'

// WCAG contrast of two [r, g, b] colours (0-255).
const lum = ([r, g, b]) => {
  const f = c => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// Two animation frames: what the page does after a change (a ResizeObserver, a scroll that follows) has happened.
const frames = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
// The page stands still: two frames on, no one-off animation runs (repeating ones are left out). Bounded: 3 s, then the
// check that follows reports what it finds.
const settled = async p => {
  await frames(p)
  await p.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity), null, { timeout: 3000 }).catch(() => {})
}

module.exports = async t => {
  const { browser } = t
  // A page of the fake shell on chat `chat`, with stored settings `store` (null removes a key) before the app starts.
  // Glass effects is on unless `store` says otherwise: never left to the machine.
  const open = async (size, chat, store = {}, ctx = {}) => {
    store = { 'hm.glass': '1', ...store }
    const context = await browser.newContext({ viewport: size, ...ctx })
    const p = await context.newPage()
    await p.addInitScript(nativeShell)
    await p.addInitScript(([id, store]) => {
      if (id && !sessionStorage.getItem('opened')) {
        sessionStorage.setItem('opened', '1')
        localStorage.setItem('hm.lastSession', JSON.stringify({ id, profile: 'default' }))
      }
      localStorage.setItem('hm.connectedOnce', '1')
      for (const [k, v] of Object.entries(store)) v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)
    }, [chat, store])
    await p.goto(WEB + '/')
    await p.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    p.on('close', () => context.close().catch(() => {}))
    return p
  }
  // Geometry of the chat screen: the header (banner) bottom, the top of what sits below the messages (the largest box
  // around the text box that does not hold the messages), the messages' visible height between the two, and the
  // scrolling list's own box. Same method as 31-fixed-points.cjs.
  const measure = (p, word) => p.evaluate(word => {
    const anchor = [...document.querySelectorAll('p, strong, button')].find(e => e.textContent === word) || document.querySelector('textarea')
    let sc = anchor
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
    const box = document.querySelector('textarea[placeholder="Message Hermux"], textarea[placeholder="Queue or steer a follow-up…"]') // its name while a reply runs
    let comp = box
    while (comp.parentElement && !comp.parentElement.contains(sc) && comp.parentElement !== document.body) comp = comp.parentElement
    const head = document.querySelector('header, [role="banner"]').getBoundingClientRect()
    const s = sc ? sc.getBoundingClientRect() : { top: 0, bottom: 0 }
    const c = comp.getBoundingClientRect()
    const bottom = Math.min(c.top, s.bottom)
    return { header: Math.round(head.bottom), bottom: Math.round(innerHeight - bottom), messages: Math.round(bottom - Math.max(head.bottom, s.top)), found: !!sc, box: Math.round(box.getBoundingClientRect().bottom), compBottom: Math.round(c.bottom), vh: innerHeight }
  }, word)
  const fits = (now, was) => now.found && now.header <= was.header + 2 && now.bottom <= was.bottom + 2 && now.messages >= was.messages - 2
  const say = (k, now, was) => `${k}: the header (${now.header} px, recorded ${was.header}) and the space below the messages (${now.bottom}, recorded ${was.bottom}) grew by no more than 2 px and the messages' visible height (${now.messages}, recorded ${was.messages}) shrank by no more than 2 px`
  // The glass layer behind a bar: the backdrop filter of the bar's ::before (the bar holds the header or the text box).
  const barGlass = (p, which) => p.evaluate(which => {
    const from = which === 'top' ? document.querySelector('header') : document.querySelector('textarea[placeholder="Message Hermux"]')
    let bar = from
    while (bar && bar.parentElement && getComputedStyle(bar, '::before').content === 'none') bar = bar.parentElement
    const b = getComputedStyle(bar, '::before')
    return { filter: b.backdropFilter || b.webkitBackdropFilter || 'none', bg: b.backgroundColor, holdsList: !!bar.querySelector('[role="log"]') }
  }, which)
  // Blurred surfaces on screen: elements and ::before layers with a backdrop filter, inside the window.
  const blurred = p => p.evaluate(() => {
    let n = 0
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight) continue
      for (const pseudo of [null, '::before']) {
        const c = getComputedStyle(el, pseudo)
        if (pseudo && c.content === 'none') continue
        const f = c.backdropFilter || c.webkitBackdropFilter
        if (f && f !== 'none' && c.visibility !== 'hidden') n++
      }
    }
    return n
  })

  // ── heights: idle, with the keyboard open, while a reply runs, with an attachment; with glass on and with glass off ──
  // Each look on its own page, Glass effects set explicitly (never the machine's default). Every state is checked
  // against the build before glass, and the two looks against each other: solid surfaces keep the glass heights.
  // What sits below the messages, row by row (words and height), so a failure says which row grew.
  const rowsBelow = p => p.evaluate(() => {
    const box = document.querySelector('textarea[placeholder="Message Hermux"], textarea[placeholder="Queue or steer a follow-up…"]')
    let list = [...document.querySelectorAll('p, strong')].find(e => e.textContent === 'answer s-48')
    while (list && !/(auto|scroll)/.test(getComputedStyle(list).overflowY)) list = list.parentElement
    let bar = box
    while (bar.parentElement && !bar.parentElement.contains(list) && bar.parentElement !== document.body) bar = bar.parentElement
    const say = c => `${(c.innerText || c.getAttribute('aria-label') || c.getAttribute('placeholder') || c.tagName).replace(/\s+/g, ' ').trim().slice(0, 40)}=${Math.round(c.getBoundingClientRect().height)}`
    // The rows of the block below the messages, then the rows of the composer itself and its text box, so a row that
    // grows names itself.
    let comp = box
    while (comp.parentElement && comp.parentElement !== bar) comp = comp.parentElement
    return [...bar.children].map(say).join(' | ') + ` [composer: ${[...comp.children].map(say).join(' | ')}; text box=${box.clientHeight}]`
  })
  const heights = async glass => {
    const states = {}
    const rows = {}
    const p = await open({ width: 360, height: 740 }, 's-48', { 'hm.glass': glass ? '1' : '0' })
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await settled(p)
    states.idle = await measure(p, 'answer s-48')
    await p.getByPlaceholder('Message Hermux').focus()
    await p.setViewportSize({ width: 360, height: 440 }) // the shell shrinks the page by the keyboard (31-fixed-points)
    await settled(p)
    states.keyboard = await measure(p, 'answer s-48')
    const kb = states.keyboard
    check(kb.box <= kb.vh && kb.compBottom === kb.vh, `keyboard, glass ${glass ? 'on' : 'off'}: the composer stays above the keyboard (text box bottom ${kb.box}, composer bottom ${kb.compBottom}, window ${kb.vh})`)
    await p.setViewportSize({ width: 360, height: 740 })
    await settled(p)
    // With an attachment chip in the composer.
    await p.getByRole('button', { name: 'Add', exact: true }).click()
    const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.getByRole('dialog').getByRole('button', { name: /^File/ }).first().click()])
    await chooser.setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await p.getByText('notes.txt').first().waitFor({ timeout: 5000 })
    await settled(p)
    states.attachment = await measure(p, 'answer s-48')
    rows.attachment = await rowsBelow(p)
    await p.getByRole('button', { name: /^Remove/ }).first().click()
    await p.getByText('notes.txt').first().waitFor({ state: 'detached', timeout: 5000 })
    // While a reply runs: the status bar shows under the messages.
    await p.getByPlaceholder('Message Hermux').fill('slow reply')
    await p.getByRole('button', { name: 'Send', exact: true }).click()
    await p.getByRole('button', { name: 'Stop', exact: true }).waitFor({ timeout: 3000 })
    await settled(p)
    states.working = await measure(p, 'answer s-48')
    rows.working = await rowsBelow(p)
    await p.getByText('Slow done.').waitFor({ timeout: 5000 })
    await p.close()
    return { states, rows }
  }
  {
    const on = await heights(true)
    const off = await heights(false)
    if (record) console.log('RECORDED_STATES', JSON.stringify(on.states))
    for (const [look, got] of [['on', on], ['off', off]]) {
      for (const k of Object.keys(RECORDED_STATES)) {
        const now = got.states[k] || {}
        check(got.states[k] && fits(now, RECORDED_STATES[k]), `glass ${look}, heights, ${say(k, now, RECORDED_STATES[k])}${got.rows[k] ? ` [below: ${got.rows[k]}]` : ''}`)
      }
    }
    for (const k of Object.keys(RECORDED_STATES)) {
      const a = on.states[k] || {}
      const b = off.states[k] || {}
      check(Math.abs(a.header - b.header) <= 2 && Math.abs(a.bottom - b.bottom) <= 2 && Math.abs(a.messages - b.messages) <= 2, `glass off keeps the glass heights, ${k}: header ${b.header} / ${a.header}, below the messages ${b.bottom} / ${a.bottom}, messages ${b.messages} / ${a.messages} (off / on)`)
    }
    const q = await open({ width: 360, height: 740 }, 's-48', { 'hm.glass': '0' })
    await q.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    const g = await barGlass(q, 'top')
    check(g.filter === 'none', `glass off: the header's bar is solid, no blur (${g.filter})`)
    await q.close()
  }

  // ── the chat scrolls under the bars; the first and the last message stay clear of them ──
  {
    const p = await open({ width: 360, height: 740 }, 's-visit')
    await p.getByText('visit question 1', { exact: true }).waitFor({ timeout: 8000 })
    await settled(p)
    const r = await p.evaluate(() => {
      const first = [...document.querySelectorAll('*')].find(e => !e.children.length && e.textContent === 'visit question 1')
      let sc = first
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
      const head = document.querySelector('header').getBoundingClientRect()
      let comp = document.querySelector('textarea[placeholder="Message Hermux"]')
      while (comp.parentElement && !comp.parentElement.contains(sc)) comp = comp.parentElement
      const out = { scTop: sc.getBoundingClientRect().top, scBottom: sc.getBoundingClientRect().bottom, headBottom: head.bottom, compTop: comp.getBoundingClientRect().top, vh: innerHeight }
      sc.scrollTop = 0
      out.firstTop = first.getBoundingClientRect().top
      sc.scrollTop = sc.scrollHeight
      out.compTop2 = comp.getBoundingClientRect().top
      return out
    })
    await frames(p)
    const last = await p.getByRole('button', { name: 'Copy', exact: true }).last().boundingBox()
    r.lastBottom = last ? last.y + last.height : Infinity
    check(r.scTop < r.headBottom - 10 && r.scBottom > r.compTop + 10, `under the bars: the list reaches under the header and the composer (list ${Math.round(r.scTop)}–${Math.round(r.scBottom)}, header bottom ${Math.round(r.headBottom)}, composer top ${Math.round(r.compTop)})`)
    check(r.firstTop >= r.headBottom, `under the bars: scrolled to the top, the first message starts below the header (${Math.round(r.firstTop)} ≥ ${Math.round(r.headBottom)})`)
    check(r.lastBottom <= r.compTop2, `under the bars: scrolled to the end, the last message's actions end above the composer (${Math.round(r.lastBottom)} ≤ ${Math.round(r.compTop2)})`)
    const top = await barGlass(p, 'top')
    const bottom = await barGlass(p, 'bottom')
    check(/blur/.test(top.filter) && /blur/.test(bottom.filter) && !top.holdsList && !bottom.holdsList, `glass: the header's and the composer's bars are glass (${top.filter}; ${bottom.filter})`)
    check((await blurred(p)) <= 3, `glass: at most three blurred surfaces on the chat screen (${await blurred(p)})`)
    await p.getByRole('banner').getByRole('button', { name: 'Chat options' }).click()
    await p.getByRole('dialog').waitFor()
    await settled(p)
    const withSheet = await blurred(p)
    check(withSheet <= 3, `glass: at most three blurred surfaces with a sheet open (${withSheet})`)
    await p.keyboard.press('Escape').catch(() => {})
    await p.close()
  }

  // ── text on glass reaches 4.5:1 over a white and a black picture, in each theme ──
  for (const theme of ['default', 'oled', 'light']) {
    const p = await open({ width: 360, height: 740 }, 's-48', { 'hm.theme': theme })
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await settled(p)
    for (const picture of ['#ffffff', '#000000']) {
      // A picture under both bars (inside the list, at the top and the bottom of what it shows), the bars' own content
      // hidden, then the colour of the bare glass is read from a screenshot.
      const spots = await p.evaluate(picture => {
        const reply = [...document.querySelectorAll('p')].find(e => e.textContent === 'answer s-48')
        let sc = reply
        while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
        document.querySelectorAll('[data-test-picture]').forEach(e => e.remove())
        for (const at of ['top', 'bottom']) {
          const d = document.createElement('div')
          d.dataset.testPicture = at
          d.style.cssText = `position:absolute;left:0;right:0;height:240px;background:${picture};pointer-events:none;top:${at === 'top' ? sc.scrollTop : sc.scrollTop + sc.clientHeight - 240}px`
          sc.appendChild(d)
        }
        const head = document.querySelector('header')
        let comp = document.querySelector('textarea[placeholder="Message Hermux"]')
        while (comp.parentElement && !comp.parentElement.contains(sc)) comp = comp.parentElement
        for (const bar of [head.parentElement, comp]) for (const c of bar.querySelectorAll('*')) c.style.visibility = 'hidden'
        const h = head.getBoundingClientRect()
        const c = comp.getBoundingClientRect()
        const css = getComputedStyle(document.documentElement)
        const v = n => css.getPropertyValue(n).trim()
        return { head: { x: 120, y: Math.round(h.top + h.height / 2) }, comp: { x: 180, y: Math.round(c.top + 12) }, colours: { text: v('--text'), dim: v('--glass-dim'), gold: v('--glass-accent'), red: v('--glass-err') } }
      }, picture)
      await frames(p)
      const shot = (await p.screenshot()).toString('base64')
      const px = await p.evaluate(async ([src, pts]) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + src
        await img.decode()
        const cv = document.createElement('canvas')
        cv.width = img.width
        cv.height = img.height
        const g = cv.getContext('2d')
        g.drawImage(img, 0, 0)
        const k = img.width / innerWidth
        return pts.map(([x, y]) => [...g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data.slice(0, 3)])
      }, [shot, [[spots.head.x, spots.head.y], [spots.comp.x, spots.comp.y]]])
      const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
      const each = Object.entries(spots.colours).map(([k, c]) => [k, Math.min(...px.map(bg => contrast(hex(c), bg)))])
      const worst = Math.min(...each.map(e => e[1]))
      check(worst >= 4.5, `glass contrast, ${theme} over ${picture === '#ffffff' ? 'a white' : 'a black'} picture: text, dim, gold and red text on both bars reach 4.5:1 (${each.map(([k, c]) => `${k} ${c.toFixed(2)}`).join(', ')}; glass ${JSON.stringify(px)})`)
      await p.evaluate(() => {
        document.querySelectorAll('[data-test-picture]').forEach(e => e.remove())
        document.querySelectorAll('[style*="visibility"]').forEach(e => (e.style.visibility = ''))
      })
    }
    await p.close()
  }

  // ── motion: Full springs, Reduced does not move, Off changes at once; an idle screen runs nothing ──
  {
    const p = await open({ width: 375, height: 812 }, 's-48', { 'hm.motion': 'full' })
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await settled(p)
    await expectIdle(p, 'motion full, the chat open')
    const sheetY = () => p.getByRole('dialog').evaluate(d => d.getBoundingClientRect().top)
    const headerW = () => p.getByRole('banner').evaluate(h => h.getBoundingClientRect().width)
    const w0 = await headerW()
    await p.getByRole('banner').getByRole('button', { name: 'Chat options' }).click()
    await p.getByRole('dialog').waitFor()
    const moving = await p.getByRole('dialog').evaluate(d => d.getAnimations().filter(a => a.playState === 'running').length)
    const y0 = await sheetY()
    await p.getByRole('dialog').evaluate(d => Promise.all(d.getAnimations().map(a => a.finished)))
    const y1 = await sheetY()
    check(moving > 0 && y0 > y1 + 4, `motion full: the sheet springs up (${moving} running, ${Math.round(y0)} → ${Math.round(y1)})`)
    check((await headerW()) < w0 - 4, `motion full: the chat behind steps back while the sheet is open (header ${w0} → ${Math.round(await headerW())} px wide)`)
    await expectIdle(p, 'motion full, a sheet open')
    await p.mouse.click(180, 40)
    await p.getByRole('dialog').waitFor({ state: 'detached', timeout: 3000 })
    await settled(p)
    check(Math.abs((await headerW()) - w0) < 1, 'motion full: the chat comes back to full size when the sheet closes')
    await expectIdle(p, 'motion full, the sheet closed')
    // A hidden app pauses what repeats: the streaming caret blinks while a reply runs, stands still while away.
    await p.getByPlaceholder('Message Hermux').fill('bench stream 2500 60')
    await p.getByRole('button', { name: 'Send', exact: true }).click()
    await p.getByText('Step 1: checking the result').waitFor({ timeout: 8000 })
    const runningNow = () => p.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length)
    const before = await runningNow()
    await p.evaluate(() => window.hermesPause())
    await frames(p)
    const away = await runningNow()
    await p.evaluate(() => window.hermesResume())
    await frames(p)
    const back = await runningNow()
    check(before > 0 && away === 0 && back > 0, `motion: repeating animations stop while the app is away and start again (${before} → ${away} → ${back})`)
    await p.getByRole('button', { name: 'Stop', exact: true }).click().catch(() => {})
    await p.close()
  }
  {
    const p = await open({ width: 375, height: 812 }, 's-48', { 'hm.motion': 'reduced' })
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await settled(p)
    const w0 = await p.getByRole('banner').evaluate(h => h.getBoundingClientRect().width)
    await p.getByRole('banner').getByRole('button', { name: 'Chat options' }).click()
    await p.getByRole('dialog').waitFor()
    const y0 = await p.getByRole('dialog').evaluate(d => d.getBoundingClientRect().top)
    await sleep(500) // a fixed wait on purpose: under Reduced nothing may move during it
    const y1 = await p.getByRole('dialog').evaluate(d => d.getBoundingClientRect().top)
    const w1 = await p.getByRole('banner').evaluate(h => h.getBoundingClientRect().width)
    check(Math.abs(y0 - y1) < 1 && Math.abs(w0 - w1) < 1, `motion reduced: the sheet appears where it ends and nothing behind moves (${Math.round(y0)} → ${Math.round(y1)}, header ${w0} → ${w1})`)
    await expectIdle(p, 'motion reduced, a sheet open')
    await p.close()
  }
  {
    const p = await open({ width: 375, height: 812 }, 's-48', { 'hm.motion': 'off' })
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await settled(p)
    const mid = async () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => r(document.getAnimations().filter(a => a.playState === 'running').length))))
    await p.getByRole('banner').getByRole('button', { name: 'Chat options' }).click()
    await p.getByRole('dialog').waitFor()
    const a = await mid()
    await p.getByRole('dialog').getByRole('switch', { name: 'Read replies aloud' }).click()
    const b = await mid()
    check(a === 0 && b === 0, `motion off: no element is mid-animation right after an action (opening a sheet ${a}, a tap in it ${b})`)
    await p.close()
  }

  // ── the chat follows new text while the reader is at the end, and not after they scroll up ──
  {
    const p = await open({ width: 360, height: 740 }, 's-48')
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await settled(p)
    await p.getByPlaceholder('Message Hermux').fill('bench stream 3000 25')
    await p.getByRole('button', { name: 'Send', exact: true }).click()
    await p.getByText('Step 3: checking the result').waitFor({ timeout: 15000 })
    const gap = () => p.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find(e => /^Step 1:/.test(e.textContent))
      let sc = h
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
      return { left: Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight), top: sc.scrollTop }
    })
    await frames(p)
    const g1 = await gap()
    check(g1.left < 4, `follows: at the end, the list follows the streamed text (${g1.left} px left below)`)
    await p.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find(e => /^Step 1:/.test(e.textContent))
      let sc = h
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
      sc.scrollTop = Math.max(0, sc.scrollTop - 400)
      sc.dispatchEvent(new Event('scroll'))
    })
    await frames(p)
    const g2 = await gap()
    await p.evaluate(() => { // more of the reply arrives (bounded: 5 s)
      const h = [...document.querySelectorAll('h2')].find(e => /^Step 1:/.test(e.textContent))
      let sc = h
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
      const h0 = sc.scrollHeight
      return new Promise(r => { const t0 = performance.now(); const f = () => (sc.scrollHeight > h0 + 40 || performance.now() - t0 > 5000 ? r() : requestAnimationFrame(f)); f() })
    })
    const g3 = await gap()
    check(g3.top === g2.top, `follows: scrolled up, the list stays where the reader is (${g2.top} → ${g3.top})`)
    await p.getByRole('button', { name: 'Stop', exact: true }).click().catch(() => {})
    await p.close()
  }

  // ── Appearance: Glass effects and Animations; the defaults follow the phone; Settings search finds both ──
  {
    const p = await open({ width: 375, height: 812 }, null, { 'hm.motion': null, 'hm.glass': null }, { reducedMotion: 'reduce' })
    await p.getByRole('button', { name: /^Sessions/ }).click()
    await p.getByRole('button', { name: 'Settings' }).click()
    await p.getByRole('button', { name: /^Appearance/ }).click()
    const sw = p.getByRole('switch', { name: 'Glass effects' })
    await sw.waitFor({ timeout: 5000 })
    check((await p.getByRole('button', { name: 'Off', exact: true }).getAttribute('aria-pressed')) === 'true', 'appearance: with the phone set to remove animations, Animations starts at Off')
    await p.getByRole('button', { name: 'Reduced', exact: true }).click()
    const st = await p.evaluate(() => [localStorage.getItem('hm.motion'), document.documentElement.dataset.motion])
    check(st[0] === 'reduced' && st[1] === 'reduced' && (await p.getByRole('button', { name: 'Reduced', exact: true }).getAttribute('aria-pressed')) === 'true', `appearance: choosing Reduced takes effect and is kept (${JSON.stringify(st)})`)
    const on = (await sw.getAttribute('aria-checked')) === 'true'
    await sw.click()
    const g = await p.evaluate(() => [localStorage.getItem('hm.glass'), document.documentElement.dataset.glass])
    check(on && g[0] === '0' && g[1] === 'off' && (await sw.getAttribute('aria-checked')) === 'false', `appearance: Glass effects starts on and turns off (${JSON.stringify(g)})`)
    await p.close()
    // With nothing chosen and no phone setting, glass is on and Animations Full, whatever memory and cores the phone
    // reports (2 GB and 4 cores here, like a small phone or the CI machine).
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'no-preference' })
    const s = await ctx.newPage()
    await s.addInitScript(nativeShell)
    await s.addInitScript(() => {
      localStorage.setItem('hm.connectedOnce', '1')
      localStorage.removeItem('hm.motion')
      localStorage.removeItem('hm.glass')
      Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 2, configurable: true })
      Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 4, configurable: true })
    })
    await s.goto(WEB + '/')
    await s.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    const d = await s.evaluate(() => [document.documentElement.dataset.motion, document.documentElement.dataset.glass, navigator.hardwareConcurrency, navigator.deviceMemory])
    check(d[0] === 'full' && d[1] === 'on', `defaults: with no choice and no phone setting, glass is on and Animations Full, on a phone of 2 GB and 4 cores too (${JSON.stringify(d)})`)
    await s.getByRole('button', { name: /^Sessions/ }).click()
    await s.getByRole('button', { name: 'Settings' }).click()
    const search = s.getByPlaceholder(/Search settings/i)
    await search.fill('glass')
    check((await s.getByText('Glass effects').count()) > 0, 'settings search: "glass" finds Glass effects')
    await search.fill('animations')
    check((await s.getByText('Animations', { exact: true }).count()) > 0, 'settings search: "animations" finds Animations')
    await ctx.close()
  }

  // While a finger is on the chat's rail its label is glass, so a toast goes solid: the page says so on <html>, and only
  // for as long as the finger stays.
  {
    const p = await open({ width: 375, height: 812 }, 's-scrub')
    await p.getByText('answer 30', { exact: true }).waitFor({ timeout: 5000 })
    const rail = p.getByRole('slider', { name: 'Jump to a message' })
    const rb = await rail.boundingBox()
    const scrubbing = () => p.evaluate(() => document.documentElement.hasAttribute('data-scrubbing'))
    const before = await scrubbing()
    await p.mouse.move(rb.x + rb.width / 2, rb.y + rb.height - 1)
    await p.mouse.down()
    await p.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2, { steps: 4 })
    const during = await scrubbing()
    await p.mouse.up()
    await p.waitForFunction(() => !document.documentElement.hasAttribute('data-scrubbing'), null, { timeout: 2000 }).catch(() => {})
    const after = await scrubbing()
    check(!before && during && !after, `scrubbing: the page marks the time a finger is on the rail, and only then (${[before, during, after]})`)
    await p.close()
  }
}
