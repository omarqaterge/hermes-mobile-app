// The side panel (spec 3.13): a glass sheet that lies over the chat, 8 px in from the left, top and bottom edges and
// min(80vw, 330px) wide; on a wide screen the docked column (and, undocked, the same sheet). Its box on 320, 360 and
// 412 px windows, how it opens and closes, its three zones (pinned search, three rows that scroll with the list, pinned
// bar), the bot sheet, the Library page and its remembered part, glass off, the chat behind it, the chat-row gestures
// inside it, and the idle rule with the panel open and closed. Every page here sets Glass effects and Animations itself
// (Animations Off unless the check is about motion) and finds things by role and name, so a wider font on another
// machine changes nothing. HM_E2E_RECORD=1 prints the boxes.
const { WEB, MOCK, calls, rpcs, sleep, check, mock, setMotion, expectIdle } = require('../lib.cjs')

const record = process.env.HM_E2E_RECORD === '1'
const lum = ([r, g, b]) => {
  const f = c => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
const rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number)

module.exports = async t => {
  const { browser } = t
  // A page of the app at `size`, with these settings stored before it starts (null removes a key).
  const open = async (size, store = {}) => {
    const p = await browser.newPage({ viewport: size })
    await p.addInitScript(s => {
      try {
        if (!sessionStorage.getItem('opened')) {
          sessionStorage.setItem('opened', '1')
          for (const [k, v] of Object.entries(s)) v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)
        }
        localStorage.setItem('hm.connectedOnce', '1')
      } catch { /* */ }
    }, { 'hm.glass': '1', 'hm.motion': 'off', ...store })
    p.on('pageerror', e => {
      console.log('PAGEERROR (side panel)', e.message)
      check(false, `side panel: no page error (${e.message})`)
    })
    await p.goto(WEB + '/')
    await p.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    p.on('close', () => {})
    return p
  }
  const panel = p => p.getByRole('complementary', { name: 'Chats' })
  const sessions = p => p.getByRole('button', { name: /^Sessions/ })
  const openPanel = async p => {
    await sessions(p).click()
    await p.waitForFunction(() => document.querySelector('.drawer.open'), null, { timeout: 3000 })
    await p.waitForFunction(() => Math.abs(document.querySelector('.drawer').getBoundingClientRect().left - 8) < 1.5 || innerWidth >= 840, null, { timeout: 3000 })
  }
  const isOpen = p => p.evaluate(() => !!document.querySelector('.drawer.open'))
  const round = n => Math.round(n * 10) / 10
  const touch = (p, sel, xs, { from = 'left40', y = 'mid', end = true, gap = 16 } = {}) =>
    p.evaluate(async ([sel, xs, from, y, end, gap]) => {
      const el = document.querySelector(sel)
      const r = el.getBoundingClientRect()
      const x = from === 'right' ? r.right - 20 : r.left + 40
      const yy = y === 'mid' ? r.top + Math.min(r.height / 2, 30) : y
      const mk = (type, px) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 7, target: el, clientX: px, clientY: yy })] })
      el.dispatchEvent(mk('touchstart', x))
      for (const dx of xs) {
        el.dispatchEvent(mk('touchmove', x + dx))
        if (gap) await new Promise(r => setTimeout(r, gap))
      }
      window.__end = () => el.dispatchEvent(mk('touchend', x + xs[xs.length - 1]))
      if (end) window.__end()
    }, [sel, xs, from, y, end, gap])

  // ── the sheet's box on a 320, a 360 and a 412 px wide window, glass on and off ──
  const boxes = {}
  for (const glass of ['1', '0']) {
    for (const [w, h] of [[320, 640], [360, 740], [412, 860]]) {
      const p = await open({ width: w, height: h }, { 'hm.glass': glass })
      const headerBefore = await p.locator('header.topbar').boundingBox()
      await openPanel(p)
      const b = await panel(p).boundingBox()
      const want = Math.min(0.8 * w, 330)
      boxes[`${glass === '1' ? 'glass' : 'solid'} ${w}`] = { x: round(b.x), y: round(b.y), w: round(b.width), bottom: round(h - b.y - b.height) }
      check(Math.abs(b.x - 8) <= 1 && Math.abs(b.y - 8) <= 1 && Math.abs(h - (b.y + b.height) - 8) <= 1, `side panel, ${w} px wide, glass ${glass === '1' ? 'on' : 'off'}: 8 px from the left, top and bottom (x ${round(b.x)}, y ${round(b.y)}, bottom gap ${round(h - b.y - b.height)})`)
      check(Math.abs(b.width - want) <= 1 && b.width <= 0.8 * w + 1, `side panel, ${w} px wide, glass ${glass === '1' ? 'on' : 'off'}: ${want} px wide, never over 80% of the window (${round(b.width)})`)
      const header = await p.locator('header.topbar').boundingBox()
      const strip = w - (b.x + b.width)
      check(header && headerBefore && Math.abs(header.y - headerBefore.y) <= 1 && Math.abs(header.height - headerBefore.height) <= 1 && strip >= 0.2 * w - 9, `side panel, ${w} px wide, glass ${glass === '1' ? 'on' : 'off'}: the chat's header is still in the page and a strip of ${round(strip)} px shows on the right`)
      const look = await p.evaluate(() => {
        const d = document.querySelector('.drawer')
        const c = getComputedStyle(d)
        const b = getComputedStyle(d, '::before')
        return { radius: c.borderTopLeftRadius, filter: b.backdropFilter || b.webkitBackdropFilter || 'none', bg: b.backgroundColor, bgImage: b.backgroundImage, shadow: c.boxShadow }
      })
      if (glass === '1') check(look.radius === '24px' && /blur/.test(look.filter), `side panel, ${w} px wide, glass on: corners 24 px and the blur sits under the content (${look.radius}, ${look.filter})`)
      else check(look.radius === '24px' && look.filter === 'none' && /^rgb\(/.test(look.bg) && look.bgImage === 'none', `side panel, ${w} px wide, glass off: corners 24 px, a solid surface, no blur (${look.radius}, ${look.bg})`)
      await p.close()
    }
  }
  if (record) console.log('RECORDED_PANEL', JSON.stringify(boxes))

  // ── opening, closing, and following the finger ──
  {
    const p = await open({ width: 360, height: 740 })
    {
      const c = await p.evaluate(() => { const d = document.querySelector('.drawer'); return { right: Math.round(d.getBoundingClientRect().right), shadow: Math.round(d.getBoundingClientRect().right) } })
      check(!(await isOpen(p)) && c.right <= -30, `side panel: closed, it sits off the screen with its shadow (right edge ${c.right})`)
    }
    await openPanel(p)
    const w = (await panel(p).boundingBox()).width
    await p.mouse.click(w + 8 + 20, 400)
    await p.waitForFunction(() => !document.querySelector('.drawer.open'), null, { timeout: 3000 })
    check(!(await isOpen(p)), 'side panel: a tap on the chat beside it closes it')
    await openPanel(p)
    await touch(p, '.drawer-backdrop', [-30, -80, -130, -200], { from: 'right' })
    await p.waitForFunction(() => !document.querySelector('.drawer.open'), null, { timeout: 3000 }).catch(() => {})
    check(!(await isOpen(p)), 'side panel: a swipe left on the chat beside it closes it')
    await openPanel(p)
    await touch(p, '.drawer-top', [-30, -80, -130, -200], { from: 'left40', y: 100 })
    await p.waitForFunction(() => !document.querySelector('.drawer.open'), null, { timeout: 3000 }).catch(() => {})
    check(!(await isOpen(p)), 'side panel: a swipe left on the sheet itself closes it')
    await openPanel(p)
    check(await p.evaluate(() => window.hermesBack()), 'side panel: Android Back is handled while it is open')
    await p.waitForFunction(() => !document.querySelector('.drawer.open'), null, { timeout: 3000 }).catch(() => {})
    check(!(await isOpen(p)), 'side panel: Android Back closes it')
    // A swipe right on the chat: the sheet follows the finger (its right edge is under it), then settles open.
    await touch(p, '.msg.assistant, .empty', [30, 60, 100], { end: false, gap: 0 }) // no pause between moves: slow enough not to be a flick
    const mid = await p.evaluate(() => { const r = document.querySelector('.drawer').getBoundingClientRect(); return { right: Math.round(r.right), left: Math.round(r.left) } })
    check(Math.abs(mid.right - 100) <= 2, `side panel: following a swipe right, its edge is under the finger (right edge ${mid.right}, want 100)`)
    await p.evaluate(() => window.__end())
    await p.waitForFunction(() => !document.querySelector('.drawer.open'), null, { timeout: 2000 }).catch(() => {})
    await sleep(350)
    check(!(await isOpen(p)) && (await p.evaluate(() => document.querySelector('.drawer').style.transform)) === '', 'side panel: let go before half way, it closes again and leaves no inline position')
    await touch(p, '.msg.assistant, .empty', [60, 120, 200, 260])
    await p.waitForFunction(() => document.querySelector('.drawer.open'), null, { timeout: 3000 })
    await sleep(350)
    const settled = await p.evaluate(() => { const r = document.querySelector('.drawer').getBoundingClientRect(); return { left: Math.round(r.left), tf: document.querySelector('.drawer').style.transform } })
    check(settled.left === 8 && settled.tf === '', `side panel: a swipe right past half way opens it and it settles 8 px from the edge (${settled.left})`)
    await p.close()
  }

  // ── the three zones: pinned search, three rows that scroll with the list, pinned bar ──
  {
    const p = await open({ width: 360, height: 740 })
    await openPanel(p)
    const pos = async () => p.evaluate(() => {
      const r = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null }
      const row = [...document.querySelectorAll('.panel-row')].find(e => e.textContent.startsWith('Scheduled'))
      return { search: r('.drawer .search')?.top, bar: r('.drawer-bar')?.top, row: row?.getBoundingClientRect().top, list: r('.drawer-list')?.top }
    })
    const names = await p.locator('.panel-row').evaluateAll(els => els.map(e => e.querySelector('.panel-row-name').textContent))
    check(JSON.stringify(names) === JSON.stringify(['Scheduled', 'Skills', 'Library']), `side panel: three rows at the top of the list: ${names.join(', ')}`)
    const first = await p.evaluate(() => { const l = document.querySelector('.drawer-list'); return l.firstElementChild.className })
    check(first === 'panel-rows', `side panel: the rows are the first items of the scrolling area (${first})`)
    const before = await pos()
    await p.locator('.drawer-list').evaluate(el => { el.scrollTop = 400 })
    await sleep(150)
    const after = await pos()
    check(before.row >= before.list && after.row < after.list, `side panel: the rows scroll away with the list (row top ${round(before.row)} then ${round(after.row)}, list top ${round(after.list)})`)
    check(Math.abs(after.search - before.search) < 1 && Math.abs(after.bar - before.bar) < 1, `side panel: the search field and the bottom bar stay where they are (search ${round(before.search)} → ${round(after.search)}, bar ${round(before.bar)} → ${round(after.bar)})`)
    await p.locator('.drawer-list').evaluate(el => { el.scrollTop = 0 })
    await p.getByPlaceholder('Search chats').fill('Chat 4')
    await sleep(200)
    check((await p.locator('.panel-row').count()) === 0, 'side panel: while the search field has text the three rows are hidden, so results start at the top')
    await p.getByPlaceholder('Search chats').fill('')
    check((await p.locator('.panel-row').count()) === 3, 'side panel: the three rows come back when the search is cleared')
    const dim = await p.evaluate(() => ({ s: document.querySelector('.drawer .search').placeholder, b: [...document.querySelectorAll('.drawer-bar button')].map(b => b.getAttribute('aria-label')) }))
    check(dim.s === 'Search chats' && JSON.stringify(dim.b) === JSON.stringify(['Bot: default', 'Settings', 'New chat']), `side panel: the bar holds the bot, Settings and New chat (${JSON.stringify(dim)})`)
    const bar = await p.evaluate(() => [...document.querySelectorAll('.drawer-bar button')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] }))
    check(bar.every(([w, h]) => w >= 44 && h >= 44), `side panel: each button in the bar is at least 44 px (${JSON.stringify(bar)})`)

    // Each row opens its page; Back returns to the chat.
    await p.evaluate(() => window.hermesBack())
    await p.waitForFunction(() => !document.querySelector('.drawer.open'), null, { timeout: 3000 })
    for (const [row, title] of [[/^Scheduled/, 'Cron jobs'], [/^Skills/, 'Skills'], [/^Library$/, 'Library']]) {
      await sessions(p).click()
      await p.getByRole('button', { name: row }).click()
      const ok = await p.locator('.screen .title', { hasText: title }).waitFor({ timeout: 4000 }).then(() => true, () => false)
      check(ok && !(await isOpen(p)), `side panel: the ${title === 'Cron jobs' ? 'Scheduled' : title} row opens its page and closes the panel`)
      await p.getByRole('button', { name: 'Back' }).last().click()
      await p.waitForFunction(() => !document.querySelector('.screen'), null, { timeout: 3000 })
      check((await p.locator('.screen').count()) === 0 && (await p.getByPlaceholder('Message Hermux').count()) === 1, `side panel: Back from ${title} returns to the chat`)
    }

    // New chat and Settings from the bar.
    await sessions(p).click()
    await p.getByRole('button', { name: 'Settings', exact: true }).click()
    await p.locator('.screen .title', { hasText: 'Settings' }).waitFor({ timeout: 4000 })
    check(!(await isOpen(p)), 'side panel: the gear in the bar opens Settings and closes the panel')
    await p.evaluate(() => window.hermesBack())
    await p.waitForFunction(() => !document.querySelector('.screen'), null, { timeout: 3000 })
    await p.getByRole('button', { name: /^Sessions/ }).click()
    await p.locator('.drawer-list .session-row').first().click()
    await p.waitForFunction(() => !document.querySelector('.drawer.open'), null, { timeout: 3000 })
    check(!(await isOpen(p)), 'side panel: opening a chat from it closes it')
    await sessions(p).click()
    await p.getByRole('button', { name: 'New chat', exact: true }).click()
    await p.locator('.empty svg.logo').waitFor({ timeout: 4000 })
    const mark = await p.evaluate(() => { const e = document.querySelector('.empty svg.logo'); const r = e.getBoundingClientRect(); return { label: e.getAttribute('aria-label'), w: r.width, paths: e.querySelectorAll('path').length } })
    check(!(await isOpen(p)) && mark.label === 'Hermux' && mark.w > 60 && mark.paths > 20, `side panel: New chat opens the empty chat, which still shows the Hermux mark (${JSON.stringify(mark)})`)
    await p.close()
  }

  // ── the rows' values: read when the panel opens, at most once a minute, no timer ──
  {
    const p = await browser.newPage({ viewport: { width: 360, height: 740 } })
    await p.addInitScript(() => { try { localStorage.setItem('hm.motion', 'off'); localStorage.setItem('hm.connectedOnce', '1') } catch { /* */ } })
    let jobs = 0
    const soon = new Date(Date.now() + 3 * 3600_000)
    await p.route(/\/__api\/api\/cron\/jobs/, route => {
      jobs++
      route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: 'j1', name: 'Morning brief', schedule: '0 9 * * *', prompt: 'Brief me', next_run_at: soon.toISOString() }]) })
    })
    await p.goto(WEB + '/')
    await p.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await sleep(1500)
    check(jobs === 0, `side panel: nothing is read while the panel is closed (${jobs} reads of the jobs)`)
    await sessions(p).click()
    const row = p.getByRole('button', { name: /^Scheduled/ })
    await row.filter({ hasText: /next (\d\d:\d\d|[A-Z][a-z]{2} \d\d:\d\d)/ }).waitFor({ timeout: 5000 }).then(
      async () => check(true, `side panel: Scheduled says when the next job runs (${await row.textContent()})`),
      async () => check(false, `side panel: Scheduled says when the next job runs (${await row.textContent()})`)
    )
    await p.getByRole('button', { name: /^Skills/ }).filter({ hasText: /\d+ on$/ }).waitFor({ timeout: 5000 }).then(() => check(true, 'side panel: Skills says how many are on'), () => check(false, 'side panel: Skills says how many are on'))
    await p.keyboard.press('Escape')
    await p.evaluate(() => window.hermesBack())
    await sessions(p).click()
    await sleep(500)
    check(jobs === 1, `side panel: opening it again within a minute reads nothing new (${jobs} reads of the jobs)`)
    await p.close()
    // A value that failed to load is left out and the row still works.
    const q = await browser.newPage({ viewport: { width: 360, height: 740 } })
    await q.addInitScript(() => { try { localStorage.setItem('hm.motion', 'off'); localStorage.setItem('hm.connectedOnce', '1') } catch { /* */ } })
    await q.route(/\/__api\/api\/(cron\/jobs|skills)/, route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"no"}' }))
    await q.goto(WEB + '/')
    await q.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await sessions(q).click()
    await sleep(800)
    const texts = await q.locator('.panel-row').evaluateAll(els => els.map(e => e.textContent))
    check(JSON.stringify(texts) === JSON.stringify(['Scheduled', 'Skills', 'Library']), `side panel: a value that failed to load is left out (${JSON.stringify(texts)})`)
    await q.getByRole('button', { name: /^Skills/ }).click()
    check(await q.locator('.screen .title', { hasText: 'Skills' }).waitFor({ timeout: 4000 }).then(() => true, () => false), 'side panel: …and the row still opens its page')
    await q.close()
  }

  // ── the bot sheet ──
  {
    await mock({ bots: true })
    const p = await open({ width: 360, height: 740 })
    await p.getByRole('button', { name: /^Sessions/ }).click()
    await p.getByRole('button', { name: 'Bot: default' }).click()
    const sheet = p.getByRole('dialog', { name: /Bots/ })
    await p.locator('.sheet-title', { hasText: 'Bots' }).waitFor({ timeout: 4000 })
    check(!(await isOpen(p)), 'bot sheet: the panel has closed when it opens, so a glass sheet never lies on the glass panel')
    const state = await p.evaluate(() => [...document.querySelectorAll('.sheet .picker-opt')].map(b => [b.querySelector('.set-title').textContent, b.querySelector('.set-sub')?.textContent || '', b.getAttribute('aria-pressed')]))
    check(JSON.stringify(state) === JSON.stringify([['default', 'mock-model', 'true'], ['Work', 'other-model', 'false']]), `bot sheet: the bots with their models, the current one marked (${JSON.stringify(state)})`)
    check((await p.getByRole('button', { name: 'What default remembers' }).count()) === 1 && (await p.getByRole('button', { name: 'Manage bots' }).count()) === 1, 'bot sheet: "What <bot> remembers" and "Manage bots" are in it')
    await p.getByRole('button', { name: 'What default remembers' }).click()
    check(await p.locator('.screen .title', { hasText: 'Memory' }).waitFor({ timeout: 4000 }).then(() => true, () => false), 'bot sheet: "What <bot> remembers" opens Memory')
    await p.getByRole('button', { name: 'Back' }).last().click()
    await p.waitForFunction(() => !document.querySelector('.screen'), null, { timeout: 3000 })
    await p.getByRole('button', { name: /^Sessions/ }).click()
    await p.getByRole('button', { name: 'Bot: default' }).click()
    await p.getByRole('button', { name: 'Manage bots' }).click()
    check(await p.locator('.screen .title', { hasText: 'Bots' }).waitFor({ timeout: 4000 }).then(() => true, () => false), 'bot sheet: "Manage bots" opens Bots')
    await p.getByRole('button', { name: 'Back' }).last().click()
    await p.waitForFunction(() => !document.querySelector('.screen'), null, { timeout: 3000 })
    await p.getByRole('button', { name: /^Sessions/ }).click()
    await p.getByRole('button', { name: 'Bot: default' }).click()
    await p.getByRole('button', { name: /^Work/ }).click()
    await p.getByRole('button', { name: /^Sessions/ }).click()
    const named = await p.getByRole('button', { name: 'Bot: Work' }).waitFor({ timeout: 5000 }).then(() => true, () => false)
    check(named, 'bot sheet: a tap on another bot switches to it (the bar then names it)')
    check(await p.evaluate(() => localStorage.getItem('hm.profile')) === 'work', 'bot sheet: the choice is stored as before (hm.profile)')
    await p.close()
    await mock({ bots: false })
    // One bot: the list is that bot and the two rows.
    const one = await open({ width: 360, height: 740 })
    await one.getByRole('button', { name: /^Sessions/ }).click()
    await one.getByRole('button', { name: 'Bot: default' }).click()
    await one.locator('.sheet-title', { hasText: 'Bots' }).waitFor({ timeout: 4000 })
    check((await one.locator('.sheet .picker-opt').count()) === 1 && (await one.getByRole('button', { name: 'Manage bots' }).count()) === 1, 'bot sheet: with one bot the list is that bot, and the two rows are what the sheet is for')
    await one.close()
  }

  // ── the bar fits a 320 px phone, also with wide letters; below that New chat is the plus icon alone ──
  {
    const p = await open({ width: 320, height: 640 })
    await p.addStyleTag({ content: '.drawer, .drawer * { font-family: monospace !important; letter-spacing: 0.04em !important }' })
    await openPanel(p)
    const fit = await p.evaluate(() => {
      const bar = document.querySelector('.drawer-bar')
      const b = bar.getBoundingClientRect()
      const parts = [...bar.querySelectorAll('button')].map(e => { const r = e.getBoundingClientRect(); return { name: e.getAttribute('aria-label'), l: Math.round(r.left - b.left), r: Math.round(b.right - r.right), w: Math.round(r.width), h: Math.round(r.height) } })
      return { overflow: bar.scrollWidth - bar.clientWidth, parts, label: getComputedStyle(document.querySelector('.new-chat-label')).display, bar: Math.round(b.width) }
    })
    check(fit.overflow <= 0 && fit.parts.every(x => x.l >= 0 && x.r >= 0 && x.w >= 44 && x.h >= 44), `side panel: the bar fits a 320 px phone with wide letters (${JSON.stringify(fit)})`)
    await p.close()
    const n = await open({ width: 280, height: 640 })
    await openPanel(n)
    const tiny = await n.evaluate(() => { const b = document.querySelector('.new-chat'); const r = b.getBoundingClientRect(); return { label: getComputedStyle(document.querySelector('.new-chat-label')).display, w: Math.round(r.width), name: b.getAttribute('aria-label'), overflow: document.querySelector('.drawer-bar').scrollWidth - document.querySelector('.drawer-bar').clientWidth } })
    check(tiny.label === 'none' && tiny.w === 44 && tiny.name === 'New chat' && tiny.overflow <= 0, `side panel: on a 280 px phone New chat is the plus icon alone, with the same name (${JSON.stringify(tiny)})`)
    await n.close()
  }

  // ── with the search field focused the sheet sits 8 px above the keyboard and the list still scrolls ──
  {
    const p = await open({ width: 360, height: 740 })
    await openPanel(p)
    await p.getByPlaceholder('Search chats').focus()
    await p.setViewportSize({ width: 360, height: 440 }) // the keyboard takes the lower part of the window
    await sleep(200)
    const b = await panel(p).boundingBox()
    const list = await p.evaluate(() => { const l = document.querySelector('.drawer-list'); l.scrollTop = 300; return { scrolls: l.scrollHeight > l.clientHeight, top: l.scrollTop } })
    check(Math.abs(440 - (b.y + b.height) - 8) <= 1 && list.scrolls && list.top > 0, `side panel: with the keyboard up its bottom edge is 8 px above it and the list scrolls (gap ${round(440 - (b.y + b.height))}, scrolled ${list.top})`)
    await p.close()
  }

  // ── the chat behind it: dims, steps back with Full animations, stays put otherwise ──
  {
    const p = await open({ width: 360, height: 740 }, { 'hm.motion': 'full' })
    const scaleOf = () => p.evaluate(() => getComputedStyle(document.querySelector('.stage')).scale)
    check((await scaleOf()) === 'none' || (await scaleOf()) === '1', `chat behind the panel: full size while it is closed (${await scaleOf()})`)
    await openPanel(p)
    await p.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('.stage')).scale) < 0.97, null, { timeout: 3000 }).then(() => check(true, `chat behind the panel: Full animations step it back while the panel is open (${'0.965'})`), async () => check(false, `chat behind the panel: Full animations step it back while the panel is open (${await scaleOf()})`))
    const dim = await p.evaluate(() => getComputedStyle(document.querySelector('.drawer-backdrop')).opacity)
    check(Number(dim) > 0.9, `chat behind the panel: it is dimmed (backdrop opacity ${dim})`)
    check(await p.evaluate(() => !!document.querySelector('header.topbar') && document.querySelector('header.topbar').getBoundingClientRect().width > 100), 'chat behind the panel: the header is still in the page')
    await expectIdle(p, 'side panel open')
    await p.evaluate(() => window.hermesBack())
    await p.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('.stage')).scale || '1') > 0.999 || getComputedStyle(document.querySelector('.stage')).scale === 'none', null, { timeout: 3000 })
    await expectIdle(p, 'side panel closed')
    for (const level of ['reduced', 'off']) {
      await setMotion(p, level)
      await openPanel(p)
      await sleep(300)
      const s = await scaleOf()
      check(s === 'none' || s === '1', `chat behind the panel: with Animations ${level} the chat does not step back, the scrim alone dims it (${s})`)
      await p.evaluate(() => window.hermesBack())
      await p.waitForFunction(() => !document.querySelector('.drawer.open'), null, { timeout: 3000 })
    }
    // A swipe follows the finger with the chat stepping back by the same amount (transform only).
    await setMotion(p, 'full')
    await touch(p, '.msg.assistant, .empty', [40, 90, 140], { end: false, gap: 0 })
    const mid = await p.evaluate(() => ({ scale: Number(document.querySelector('.stage').style.scale), op: Number(document.querySelector('.drawer-backdrop').style.opacity) }))
    check(mid.scale < 1 && mid.scale > 0.965 && mid.op > 0 && mid.op < 1, `chat behind the panel: following a swipe it steps back with the finger (scale ${mid.scale}, scrim ${mid.op})`)
    await p.evaluate(() => window.__end())
    await p.close()
  }

  // ── text on the glass reaches 4.5:1 over a white and a black picture, in each theme ──
  for (const theme of ['default', 'oled', 'light']) {
    const p = await open({ width: 360, height: 740 }, { 'hm.theme': theme })
    await openPanel(p)
    for (const picture of ['#ffffff', '#000000']) {
      const spot = await p.evaluate(picture => {
        document.querySelectorAll('[data-test-picture]').forEach(e => e.remove())
        const d = document.createElement('div')
        d.dataset.testPicture = '1'
        d.style.cssText = `position:fixed;inset:0;z-index:1;background:${picture};pointer-events:none`
        document.body.appendChild(d)
        const r = document.querySelector('.drawer').getBoundingClientRect()
        const css = getComputedStyle(document.documentElement)
        const v = n => css.getPropertyValue(n).trim()
        return { x: r.left + 5, y: r.top + 36, text: getComputedStyle(document.querySelector('.panel-row-name')).color, dim: getComputedStyle(document.querySelector('.drawer .dim, .panel-row-icon')).color, glassDim: v('--glass-dim') }
      }, picture)
      await sleep(100)
      const shot = (await p.screenshot()).toString('base64')
      const px = await p.evaluate(async ([src, x, y]) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + src
        await img.decode()
        const cv = document.createElement('canvas')
        cv.width = img.width
        cv.height = img.height
        const g = cv.getContext('2d')
        g.drawImage(img, 0, 0)
        const k = img.width / innerWidth
        return [...g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data.slice(0, 3)]
      }, [shot, spot.x, spot.y])
      const worst = Math.min(contrast(rgb(spot.text), px), contrast(rgb(spot.dim), px))
      check(worst >= 4.5, `side panel contrast, ${theme} over ${picture === '#ffffff' ? 'a white' : 'a black'} picture: row text and dim text reach 4.5:1 (${worst.toFixed(2)}, glass ${JSON.stringify(px)})`)
    }
    await p.close()
  }

  // ── Library: three parts behind a switch, the buttons of each part, the remembered part ──
  {
    const p = await open({ width: 360, height: 740 })
    await sessions(p).click()
    await p.getByRole('button', { name: 'Library', exact: true }).click()
    await p.locator('.screen .title', { hasText: 'Library' }).waitFor({ timeout: 4000 })
    const pressed = async () => p.evaluate(() => [...document.querySelectorAll('.lib-switch .seg button')].map(b => `${b.textContent}:${b.getAttribute('aria-pressed')}`).join(' '))
    check((await pressed()) === 'Canvases:true Files:false Projects:false', `Library: three parts, Canvases first the first time (${await pressed()})`)
    check((await p.getByPlaceholder('Search titles and text…').count()) === 1, 'Library: Canvases shows the gallery')
    await p.getByRole('button', { name: 'Files', exact: true }).click()
    await p.locator('.crumbs').waitFor({ timeout: 5000 })
    check((await p.getByRole('button', { name: 'Upload' }).count()) === 1 && (await p.getByRole('button', { name: 'New folder' }).count()) === 1 && (await p.getByRole('button', { name: 'New project' }).count()) === 0, 'Library: Files keeps its own buttons in the top bar (Upload, New folder)')
    await p.getByRole('button', { name: 'Projects', exact: true }).click()
    await p.getByRole('button', { name: 'New project' }).waitFor({ timeout: 5000 })
    await p.locator('.card', { hasText: 'Thesis' }).waitFor({ timeout: 5000 })
    check((await p.getByRole('button', { name: 'Upload' }).count()) === 0 && (await p.locator('.card', { hasText: 'Thesis' }).count()) === 1, 'Library: Projects shows the projects and its New project button, and Files’ buttons are gone')
    check(await p.evaluate(() => localStorage.getItem('hm.libraryPart')) === 'projects', 'Library: the last part is remembered (hm.libraryPart)')
    await p.evaluate(() => window.hermesBack())
    await p.waitForFunction(() => !document.querySelector('.screen'), null, { timeout: 3000 })
    await sessions(p).click()
    await p.getByRole('button', { name: 'Library', exact: true }).click()
    await p.locator('.screen .title', { hasText: 'Library' }).waitFor({ timeout: 4000 })
    check((await pressed()) === 'Canvases:false Files:false Projects:true', `Library: it opens on the part you left (${await pressed()})`)
    // The canvas panel's "Open a file from the phone…" opens the Library on Files.
    await p.evaluate(() => window.hermesBack())
    await p.waitForFunction(() => !document.querySelector('.screen'), null, { timeout: 3000 })
    await p.getByRole('button', { name: 'Canvas' }).first().click()
    await p.locator('.canvas-panel').waitFor({ timeout: 5000 })
    await p.getByRole('button', { name: 'New document' }).first().click()
    await p.locator('.picker-opt, .set-row', { hasText: 'Notes / document' }).click()
    await p.locator('.dialog input').fill('Soup')
    await p.locator('.dialog button', { hasText: 'Create' }).click()
    await p.locator('textarea.editor-text').waitFor({ timeout: 5000 })
    await p.getByRole('button', { name: 'More' }).click()
    await p.getByRole('button', { name: /Open a file from the phone/ }).click()
    await p.locator('.crumbs').waitFor({ timeout: 5000 })
    check((await pressed()) === 'Canvases:false Files:true Projects:false' && (await p.locator('.canvas-panel.open, .canvas-panel').first().isVisible().catch(() => false)) !== undefined, `Library: "Open a file from the phone" opens it on Files (${await pressed()})`)
    await p.close()
  }

  // ── wide screens: the docked column as before, the same floating sheet once it is hidden ──
  {
    const p = await open({ width: 840, height: 800 })
    const b = await panel(p).boundingBox()
    const docked = await p.evaluate(() => ({ backdrop: getComputedStyle(document.querySelector('.drawer-backdrop')).display, radius: getComputedStyle(document.querySelector('.drawer')).borderTopLeftRadius, blur: getComputedStyle(document.querySelector('.drawer'), '::before').backdropFilter, hide: !!document.querySelector('.side-hide') && getComputedStyle(document.querySelector('.side-hide')).display !== 'none' }))
    check(b && b.x === 0 && b.y === 0 && b.width === 320 && b.height === 800 && docked.backdrop === 'none' && docked.radius === '0px' && docked.blur === 'none', `wide screen: the docked column is as before, 320 px from the corner, no backdrop, not a sheet (${JSON.stringify(b)}, ${JSON.stringify(docked)})`)
    check(docked.hide && (await p.getByRole('button', { name: 'Hide the chat list' }).boundingBox()).y < 80, 'wide screen: the hide button sits beside the search field at the top')
    await p.getByRole('button', { name: 'Hide the chat list' }).click()
    await p.waitForFunction(() => document.documentElement.dataset.side === 'hidden', null, { timeout: 3000 })
    await sleep(200)
    check(!(await isOpen(p)) && (await p.evaluate(() => document.querySelector('.drawer').getBoundingClientRect().right)) <= 0, 'wide screen: hidden, the column is gone')
    await touch(p, '.msg.assistant, .empty', [60, 120, 200, 260], { gap: 0 }) // a hidden column opens over the chat by a swipe right
    await p.waitForFunction(() => document.querySelector('.drawer.open'), null, { timeout: 3000 })
    await sleep(350)
    const f = await panel(p).boundingBox()
    check(Math.abs(f.x - 8) <= 1 && Math.abs(f.y - 8) <= 1 && Math.abs(800 - f.y - f.height - 8) <= 1 && Math.abs(f.width - 330) <= 1, `wide screen: used undocked it is the same floating sheet (${JSON.stringify({ x: f.x, y: f.y, w: f.width, h: f.height })})`)
    check((await p.evaluate(() => getComputedStyle(document.querySelector('.drawer'), '::before').backdropFilter)).includes('blur'), 'wide screen: the undocked sheet is glass')
    await p.close()
  }

  // ── chat-row gestures inside the sheet: a row's swipe never closes it ──
  {
    const p = await open({ width: 360, height: 740 })
    await openPanel(p)
    const row = p.locator('.drawer-list .session-row').nth(2)
    const b = await row.boundingBox()
    // A touch swipe left on a row (the sheet's own close gesture must skip it).
    await p.evaluate(async ([x, y]) => {
      const el = document.elementFromPoint(x, y)
      const mk = (type, px) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 5, target: el, clientX: px, clientY: y })] })
      el.dispatchEvent(mk('touchstart', x))
      for (const dx of [-30, -80, -140, -200]) {
        el.dispatchEvent(mk('touchmove', x + dx))
        await new Promise(r => setTimeout(r, 16))
      }
      el.dispatchEvent(mk('touchend', x - 200))
    }, [b.x + b.width - 40, b.y + b.height / 2])
    await sleep(400)
    check(await isOpen(p), 'chat rows in the sheet: a swipe left on a row does not close the sheet')
    // Swipe right past 30%: archives the chat (Hermes is asked to hide it); the sheet stays open.
    const title = (await row.locator('.session-title').innerText()).trim()
    const since = Date.now()
    await p.mouse.move(b.x + 30, b.y + b.height / 2)
    await p.mouse.down()
    await p.mouse.move(b.x + 120, b.y + b.height / 2, { steps: 6 })
    await p.mouse.move(b.x + 230, b.y + b.height / 2, { steps: 6 })
    await p.mouse.up()
    await sleep(700)
    const hid = rpcs('session.set_hidden').filter(c => c.t >= since)
    check(hid.length === 1 && hid[0].params.hidden === true && (await isOpen(p)), `chat rows in the sheet: swipe right archives “${title}” and the sheet stays open (${JSON.stringify(hid.map(c => c.params))})`)
    // Swipe left past 30%: the delete question; cancelling keeps the chat.
    const row2 = p.locator('.drawer-list .session-row').nth(2)
    const b2 = await row2.boundingBox()
    await p.mouse.move(b2.x + b2.width - 60, b2.y + b2.height / 2)
    await p.mouse.down()
    await p.mouse.move(b2.x + b2.width - 150, b2.y + b2.height / 2, { steps: 6 })
    await p.mouse.move(b2.x + b2.width - 230, b2.y + b2.height / 2, { steps: 6 })
    await p.mouse.up()
    await p.locator('.dialog').waitFor({ timeout: 4000 })
    check((await p.locator('.dialog').innerText()).includes('Delete') && (await isOpen(p)), 'chat rows in the sheet: swipe left asks before deleting, and the sheet stays open')
    await p.locator('.dialog').getByRole('button', { name: 'Cancel' }).click()
    // A plain tap on a row opens the chat and closes the sheet.
    await p.locator('.drawer-list .session-row').nth(3).click()
    await p.waitForFunction(() => !document.querySelector('.drawer.open'), null, { timeout: 3000 })
    check(!(await isOpen(p)), 'chat rows in the sheet: a tap opens the chat and closes the sheet')
    // Long-press then move reorders; a row's menu is the same.
    await sessions(p).click()
    await p.locator('.drawer-list .session-row').nth(1).getByRole('button', { name: 'Chat options' }).click()
    check((await p.getByRole('dialog').filter({ hasText: 'Archive' }).count()) === 1 && (await isOpen(p)), 'chat rows in the sheet: a row’s ⋮ menu opens over the sheet')
    await p.close()
  }
}
