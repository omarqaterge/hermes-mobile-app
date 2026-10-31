// Mermaid, quoting, OpenUI cards, HTML preview, tool calls, motion, turn file changes, web addresses.
const path = require('path')
const { calls, rpcs, sleep, check } = require('../lib.cjs')

module.exports = async t => {
  const { browser, page } = t
  // ── #25 Mermaid ships as inert text in the built page and runs on the first diagram ──
  check(await page.evaluate(() => document.getElementById('hm-mermaid')?.type === 'text/hm-lazy' && !window.__hmMermaid), 'Mermaid not run at start')
  await page.getByPlaceholder('Message Hermes').fill('show diagram')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  await page.locator('.msg.assistant svg', { hasText: 'Start' }).first().waitFor({ timeout: 15000 }).then(() => check(true, 'diagram renders from the lazy Mermaid'), () => check(false, 'diagram renders from the lazy Mermaid'))

  // ── Quote part of a reply into the composer ──
  {
    const selectIn = (sel, starts = '') => page.evaluate(([q, st]) => {
      const el = [...document.querySelectorAll(q)].filter(e => e.firstChild?.nodeType === 3 && e.textContent.startsWith(st)).pop()
      const t = el.firstChild
      const r = document.createRange()
      r.setStart(t, 0); r.setEnd(t, Math.min(4, t.length))
      const s = getSelection(); s.removeAllRanges(); s.addRange(r)
    }, [sel, starts])
    await selectIn('.msg.user .bubble')
    await sleep(300)
    check((await page.locator('.quote-bar').count()) === 0, 'quote: no bar for a selection in your own bubble')
    await selectIn('.msg.assistant .md > p')
    await page.locator('.quote-bar').waitFor({ timeout: 3000 }).catch(() => {})
    check((await page.locator('.quote-bar').count()) === 1, 'quote: the bar shows for a selection in a reply')
    await page.getByRole('button', { name: 'Quote', exact: true }).click()
    check((await page.locator('.quote-chip').count()) === 1, 'quote: Quote adds a chip above the composer')
    check((await page.locator('.quote-bar').count()) === 0, 'quote: the bar hides after Quote')
    await page.getByRole('button', { name: 'Remove quote' }).click()
    check((await page.locator('.quote-chip').count()) === 0, 'quote: ✕ removes the chip')
    await selectIn('.msg.assistant .md > p')
    await page.getByRole('button', { name: 'Quote', exact: true }).click()
    await page.getByPlaceholder('Ask about the quote…').fill('why?')
    await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
    await page.locator('.msg.user .msg-quote').last().waitFor({ timeout: 5000 }).catch(() => {})
    const qs = rpcs('prompt.submit').pop()?.params.text
    check(qs === '> Flow\n\nwhy?', `quote: the sent text is a blockquote then the message (${JSON.stringify(qs)})`)
    check((await page.locator('.msg.user .msg-quote').count()) >= 1, 'quote: the user bubble shows a .msg-quote')
    check((await page.locator('.quote-chip').count()) === 0, 'quote: the chip is gone after sending')
    await page.locator('.composer').getByRole('button', { name: 'Send' }).waitFor({ timeout: 8000 }).catch(() => {})
    await selectIn('.msg.assistant .md > p', 'Flow')
    const n = rpcs('prompt.submit').length
    await page.getByRole('button', { name: 'Explain', exact: true }).click()
    for (let i = 0; i < 30 && rpcs('prompt.submit').length === n; i++) await sleep(100)
    const ex = rpcs('prompt.submit').pop()?.params.text
    check(/^> \S.*\n\nExplain this\.$/.test(ex || ''), `quote: Explain sends the quote then "Explain this." (${JSON.stringify(ex)})`)
    await page.locator('.composer').getByRole('button', { name: 'Send' }).waitFor({ timeout: 8000 }).catch(() => {})
  }

  // ── OpenUI: ```openui-lang blocks render as cards from the lazy bundle; buttons and forms answer ──
  check(await page.evaluate(() => document.getElementById('hm-openui')?.type === 'text/hm-lazy' && !window.__hmOpenUI), 'OpenUI not run at start')
  {
    const idle = () => page.locator('.composer').getByRole('button', { name: 'Send' }).waitFor({ timeout: 8000 }).catch(() => {})
    const lastSubmit = () => rpcs('prompt.submit').pop()?.params.text
    await page.getByPlaceholder('Message Hermes').fill('show ui')
    await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
    const card = page.locator('.msg.assistant .hm-openui').last()
    await card.getByText('Pick a plan').waitFor({ timeout: 15000 }).then(() => check(true, 'openui card renders'), () => check(false, 'openui card renders'))
    check((await page.locator('.msg.assistant .codeblock', { hasText: 'Pick a plan' }).count()) === 0, 'the card replaces the code')
    await idle()
    let n = rpcs('prompt.submit').length
    await card.getByRole('button', { name: 'Option A' }).click({ timeout: 5000 }).catch(() => {})
    for (let i = 0; i < 30 && rpcs('prompt.submit').length === n; i++) await sleep(100)
    check(lastSubmit() === 'Pick A', `a card button sends its words (${lastSubmit()})`)
    await idle()
    n = rpcs('prompt.submit').length
    await card.locator('input[name="name"]').fill('Sam', { timeout: 5000 }).catch(() => {})
    await card.getByRole('button', { name: 'Send' }).click({ timeout: 5000 }).catch(() => {})
    for (let i = 0; i < 30 && rpcs('prompt.submit').length === n; i++) await sleep(100)
    check(lastSubmit() === 'Here are my details\n\n- name: Sam', `a form sends its values (${JSON.stringify(lastSubmit())})`)
    await idle()
    n = rpcs('prompt.submit').length
    await card.getByText('Compare both').click({ timeout: 5000 }).catch(() => {})
    for (let i = 0; i < 30 && rpcs('prompt.submit').length === n; i++) await sleep(100)
    check(lastSubmit() === 'Compare both', `a follow-up sends its words, without the form's values (${JSON.stringify(lastSubmit())})`)
    await idle()
    await page.getByPlaceholder('Message Hermes').fill('show ui streaming')
    await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
    const card2 = page.locator('.msg.assistant .hm-openui').last()
    await card2.getByText('Pick a plan').waitFor({ timeout: 15000 }).then(() => check(true, 'a streamed card renders'), () => check(false, 'a streamed card renders'))
    await idle()
    check((await page.locator('.msg.assistant', { hasText: 'Streaming plans' }).locator('.codeblock').count()) === 0, 'no "not shown" fallback after a streamed card')
    await page.getByPlaceholder('Message Hermes').fill('show broken ui')
    await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
    await page.locator('.msg.assistant .codeblock', { hasText: 'openui-lang (not shown)' }).waitFor({ timeout: 15000 }).then(() => check(true, 'broken openui-lang falls back to the code'), () => check(false, 'broken openui-lang falls back to the code'))
    await idle()
    // live data: a Query() card asks the plugin once (POST /openui/call) and draws the answer
    const qcalls = () => calls().filter(c => c.http === 'POST' && c.path === '/api/plugins/hermes-mobile/openui/call')
    await page.getByPlaceholder('Message Hermes').fill('show live ui')
    await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
    const liveCard = page.locator('.msg.assistant .hm-openui').last()
    await liveCard.getByText('Mock result one').waitFor({ timeout: 15000 }).then(() => check(true, 'a Query card draws the tool answer'), () => check(false, 'a Query card draws the tool answer'))
    check(qcalls().length === 1 && qcalls()[0].body.name === 'web_search' && qcalls()[0].body.args.query === 'openui', `one call to /openui/call with the card's args (${JSON.stringify(qcalls().map(c => c.body))})`)
    await idle()
    // a card form with a required list picker and a required date: pick like a finger (mouse click, then touch tap), send
    const bookFlow = async (p, press, label) => {
      const idleP = () => p.locator('.composer').getByRole('button', { name: 'Send' }).waitFor({ timeout: 8000 }).catch(() => {})
      await p.getByPlaceholder('Message Hermes').fill('show form ui')
      await p.locator('.composer').getByRole('button', { name: 'Send' }).click()
      const c = p.locator('.msg.assistant .hm-openui').last()
      await c.getByText('Book a table').waitFor({ timeout: 15000 }).then(() => check(true, `${label}: the form card renders`), () => check(false, `${label}: the form card renders`))
      await idleP()
      const inside = () => c.evaluate(el => el.shadowRoot.textContent)
      await c.locator('input[name="name"]').fill('Sam')
      await press(c.getByRole('combobox'))
      await press(p.getByRole('option', { name: 'Four people' }))
      await sleep(300)
      check(((await c.getByRole('combobox').textContent()) || '').includes('Four people'), `${label}: the picker shows the pick`)
      let n = rpcs('prompt.submit').length
      await press(c.getByRole('button', { name: 'Book' }))
      await sleep(600)
      const empty = (await inside()).match(/This field is required/g) || []
      check(rpcs('prompt.submit').length === n && empty.length === 1, `${label}: only the empty date is refused (${empty.length} required notes, ${rpcs('prompt.submit').length - n} sent)`)
      await press(c.locator('.openui-date-picker-renderer-floating-input-container'))
      await press(p.locator('.openui-date-picker-renderer-floating-content button', { hasText: /^15$/ }).first())
      await sleep(300)
      await press(c.getByRole('button', { name: 'Book' }))
      for (let i = 0; i < 30 && rpcs('prompt.submit').length === n; i++) await sleep(100)
      const sent = rpcs('prompt.submit').pop()?.params.text
      check(/^Book it\n\n- name: Sam\n- size: 4\n- day: \d{4}-\d{2}-15$/.test(sent || ''), `${label}: the form sends the picked list item and day (${JSON.stringify(sent)})`)
      check(!(await inside()).includes('This field is required'), `${label}: no required note left`)
      await idleP()
    }
    await bookFlow(page, loc => loc.click({ timeout: 5000 }), 'card form (mouse)')
    const tp = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true })
    await tp.goto('http://127.0.0.1:5180/')
    await tp.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    await bookFlow(tp, loc => loc.tap({ timeout: 5000 }), 'card form (touch)')
    await tp.close()
    await idle()
  }

  // ── HTML preview inside replies ──
  {
    const idle = () => page.locator('.composer').getByRole('button', { name: 'Send' }).waitFor({ timeout: 8000 }).catch(() => {})
    await page.getByPlaceholder('Message Hermes').fill('show html streaming')
    await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
    const pb = page.locator('.msg.assistant .codeblock').last().getByRole('button', { name: 'Preview', exact: true })
    await pb.waitFor({ timeout: 10000 }).catch(() => {})
    check((await pb.count()) === 1 && (await pb.isDisabled()), 'html preview: Preview is disabled while the reply streams')
    await idle()
    await page.getByPlaceholder('Message Hermes').fill('show html')
    await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
    const blk = page.locator('.msg.assistant .codeblock').last()
    await blk.getByRole('button', { name: 'Preview', exact: true }).waitFor({ timeout: 10000 })
    await idle()
    check(await blk.getByRole('button', { name: 'Preview', exact: true }).isEnabled(), 'html preview: Preview is enabled once the reply is complete')
    await blk.getByRole('button', { name: 'Preview', exact: true }).click()
    const fr = blk.locator('iframe.inline-frame')
    await fr.waitFor({ timeout: 5000 })
    check(!((await fr.getAttribute('sandbox')) || '').includes('allow-same-origin') && !((await fr.getAttribute('sandbox')) || '').includes('allow-top-navigation'), 'html preview: the sandbox has no allow-same-origin or allow-top-navigation')
    const inner = page.frameLocator('iframe.inline-frame').last()
    await inner.locator('#t').getByText('Hello frame ok').waitFor({ timeout: 5000 }).then(() => check(true, 'html preview: the page ran its script'), () => check(false, 'html preview: the page ran its script'))
    let hh = 0
    for (let i = 0; i < 30; i++) {
      hh = (await fr.boundingBox())?.height || 0
      if (hh > 200) break
      await sleep(100)
    }
    const vh = await page.evaluate(() => innerHeight)
    check(hh > 160 && hh <= vh * 0.6 + 1, `html preview: the frame grew to its page, capped at 60% of the window (${hh} of ${vh})`)
    // this iframe's own frame: finding it by the URL about:srcdoc missed it with desktop Chrome 154
    const rootFrame = await (await fr.elementHandle())?.contentFrame()
    check(!!rootFrame && (await rootFrame.evaluate(() => typeof window.HermesAndroid)) === 'undefined', 'html preview: window.HermesAndroid is undefined inside the frame')
    check(!!rootFrame && (await rootFrame.evaluate(() => fetch('http://127.0.0.1:9119/api/status').then(() => 'ok', () => 'blocked'))) === 'blocked', 'html preview: fetch() from the inline frame is blocked (offline CSP)')
    await blk.getByRole('button', { name: 'Open preview full screen' }).click()
    await page.locator('.html-viewer iframe').waitFor({ timeout: 3000 })
    check((await page.locator('.html-viewer[role=dialog]').count()) === 1, 'html preview: Full screen opens the viewer')
    await page.locator('.html-viewer').getByRole('button', { name: 'Close preview' }).click()
    check((await page.locator('.html-viewer').count()) === 0, 'html preview: ✕ closes the viewer')
    await blk.getByRole('button', { name: 'Open preview full screen' }).click()
    await page.locator('.html-viewer').waitFor({ timeout: 3000 })
    await page.evaluate(() => window.hermesBack())
    await sleep(200)
    check((await page.locator('.html-viewer').count()) === 0, 'html preview: Android Back closes the viewer')
    await blk.getByRole('button', { name: 'Code', exact: true }).click()
    check((await blk.locator('iframe').count()) === 0 && (await blk.locator('pre').count()) === 1, 'html preview: Code switches back to the source')
  }

  // ── tool calls fold into one "Ran N tools" line; tap opens them ──
  await page.getByPlaceholder('Message Hermes').fill('use tools')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  await page.locator('.msg.assistant', { hasText: 'All four done.' }).waitFor({ timeout: 5000 })
  const run = page.locator('.tool-run').last()
  check(((await run.textContent()) || '').includes('Ran 4 tools · 6s'), `one folded line for the run (${await run.textContent()})`)
  const visibleCards = () => page.locator('.tool:visible', { hasText: /step [0-3]/ }).count()
  check((await visibleCards()) === 0, 'its cards are hidden')
  await run.click()
  check((await visibleCards()) === 4, `tap shows all four (${await visibleCards()})`)
  await run.click()
  check((await visibleCards()) === 0, 'tap again folds them')

  // ── motion: tool card bodies slide open and closed; the phone's reduced-motion setting skips it ──
  await run.click()
  const card0 = page.locator('.tool:visible', { hasText: /step 0/ }).first()
  await card0.locator('.tool-head').click()
  await card0.locator('.tool-body').waitFor({ timeout: 3000 }).then(() => check(true, 'motion: the tool body appears'), () => check(false, 'motion: the tool body appears'))
  await sleep(350)
  check((await card0.locator('.tool-head').getAttribute('aria-expanded')) === 'true' && (await card0.locator('.collapse').evaluate(e => e.style.overflow)) === '', 'motion: at rest the open body is not clipped')
  await card0.locator('.tool-head').click()
  check((await card0.locator('.tool-body').count()) === 1, 'motion: the body is still there right after closing')
  await sleep(400)
  check((await card0.locator('.tool-body').count()) === 0, 'motion: the body is gone after the close animation')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await card0.locator('.tool-head').click()
  await card0.locator('.tool-body').waitFor({ timeout: 3000 })
  await card0.locator('.tool-head').click()
  await sleep(50)
  check((await card0.locator('.tool-body').count()) === 0, 'motion: reduced motion closes the body at once')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await run.click()

  check((await page.locator('.turn-changes').count()) === 0, 'a turn with only terminal tools has no changes card')

  // ── a turn that wrote files ends with a card listing them; tap a file for its diff ──
  await page.getByPlaceholder('Message Hermes').fill('edit files')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  await page.locator('.msg.assistant', { hasText: 'Edited.' }).waitFor({ timeout: 5000 })
  const tc = page.locator('.turn-changes')
  await tc.waitFor({ timeout: 5000 })
  check(((await tc.textContent()) || '').includes('2 files changed') && ((await tc.textContent()) || '').includes('+3 −1'), `changes card totals (${await tc.textContent()})`)
  check(await page.evaluate(() => { const w = document.querySelector('.turn-changes').closest('.chat > *'); return !!w && !!w.querySelector('.msg.assistant') && w.textContent.includes('Edited.') }), 'the card sits in the same child element as the last item')
  await tc.locator('.turn-changes-head').click()
  const rows = tc.locator('.turn-changes-row')
  check((await rows.count()) === 2, 'two file rows')
  const rowText = async i => ((await rows.nth(i).textContent()) || '').replace(/\s+/g, ' ')
  check((await rowText(0)).includes('a.txt') && (await rowText(0)).includes('+2 −0'), `row a.txt (${await rowText(0)})`)
  check((await rowText(1)).includes('b.txt') && (await rowText(1)).includes('+1 −1'), `row b.txt (${await rowText(1)})`)
  await rows.nth(1).click()
  await page.locator('.sheet-title', { hasText: '/root/projects/site/b.txt' }).waitFor({ timeout: 3000 }).then(() => check(true, 'file sheet titled with the path'), () => check(false, 'file sheet titled with the path'))
  check((await page.locator('.sheet .diff-view .dl', { hasText: 'new' }).count()) >= 1, 'file sheet shows the diff')
  await page.evaluate(() => window.hermesBack())
  await page.waitForFunction(() => !document.querySelector('.sheet'), null, { timeout: 3000 }).then(() => check(true, 'Back closes the file sheet'), () => check(false, 'Back closes the file sheet'))
  await tc.getByRole('button', { name: 'Checkpoints' }).click()
  await page.locator('.sheet-title', { hasText: 'File checkpoints' }).waitFor({ timeout: 3000 }).then(() => check(true, 'Checkpoints opens the file checkpoints sheet'), () => check(false, 'Checkpoints opens the file checkpoints sheet'))
  await page.evaluate(() => window.hermesBack())
  // Search still lands on the message that carries the card (scroll away first).
  await page.evaluate(() => { document.querySelector('.chat').scrollTop = 0 })
  await page.locator('header.topbar').getByRole('button', { name: 'Chat options' }).click()
  await page.locator('.menu-item', { hasText: 'Search in chat' }).click()
  await page.locator('.findbar input').fill('Edited.')
  await page.waitForFunction(() => {
    const el = document.querySelector('.chat'), m = [...document.querySelectorAll('.chat .msg.assistant')].find(x => x.textContent.includes('Edited.'))
    if (!el || !m) return false
    const r = m.getBoundingClientRect(), v = el.getBoundingClientRect()
    return r.bottom > v.top && r.top < v.bottom
  }, null, { timeout: 4000 }).then(() => check(true, 'search finds a reply that has a changes card'), () => check(false, 'search finds a reply that has a changes card'))
  await page.getByRole('button', { name: 'Close search' }).click()

  // ── web addresses in plain text open with the phone's default handler (window.open in a browser) ──
  await page.getByPlaceholder('Message Hermes').fill('see https://example.com/b')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  await page.locator('.msg.assistant', { hasText: 'Read' }).last().waitFor({ timeout: 5000 })
  {
    // openExternal's browser path is window.open; record the calls instead of opening real tabs.
    await page.evaluate(() => { window.__opened = []; window.__realOpen = window.open; window.open = u => { window.__opened.push(String(u)); return null } })
    const own = page.locator('.msg.user .bubble a.auto-link', { hasText: 'https://example.com/b' })
    check((await own.count()) === 1, 'a web address in my own message is a link')
    if (await own.count()) await own.click()
    const head = page.locator('.tool-head', { hasText: 'web_extract' }).last()
    if (await head.count()) await head.click()
    else await page.locator('.tool-run').last().click().then(() => page.locator('.tool-head', { hasText: 'web_extract' }).last().click())
    const out = page.locator('.tool-pre a.auto-link', { hasText: 'https://example.com/a' })
    check((await out.count()) >= 1 && (await out.last().textContent()) === 'https://example.com/a', 'a web address in a tool output is a link (trailing dot left out)')
    if (await out.count()) await out.last().click()
    const code = page.locator('.msg.assistant a.code-link code', { hasText: 'https://example.com/c' })
    check((await code.count()) === 1, 'a web address in inline code is a link')
    if (await code.count()) await code.click()
    check((await page.locator('.msg.assistant pre a', { hasText: 'example.com/d' }).count()) === 0, 'a code block stays plain')
    await sleep(300)
    const opened = await page.evaluate(() => window.__opened)
    check(['https://example.com/b', 'https://example.com/a', 'https://example.com/c'].every(u => opened.includes(u)), `tapping each opens it (${JSON.stringify(opened)})`)
    check((await page.locator('.msg.user .msg-time').count()) === 0, 'a link tap does not toggle the message time')
    await page.evaluate(() => { window.open = window.__realOpen })
  }
}
