// Older chats, deleting a chat, the working shimmer, canvas saving, canvas HTML, the canvas gallery.
const path = require('path')
const { SHOTS, calls, rpcs, sleep, check, mock, setMotion, openLibraryPart } = require('../lib.cjs')

module.exports = async t => {
  const { page } = t
  // ── #7 show older chats ──────────────────────────────
  await page.getByRole('button', { name: 'Sessions' }).click()
  const olderBtn = page.getByRole('button', { name: 'Show older chats' })
  await olderBtn.waitFor({ timeout: 5000 })
  const before = await page.locator('.drawer .session-row').count()
  await olderBtn.click()
  await page.waitForFunction(() => document.querySelectorAll('.drawer .session-row').length > 100, null, { timeout: 5000 })
  const after = await page.locator('.drawer .session-row').count()
  const lim = rpcs('session.list').map(c => c.params.limit)
  check(before === 80 && after === 154 && lim.includes(180), `older chats load (${before} → ${after}, limits ${[...new Set(lim)]})`)
  check((await olderBtn.count()) === 0, 'button hides when everything is loaded')

  // ── deleting a chat also clears its leftover photos/files/canvas on the phone ──
  const lastRow = page.locator('.drawer .session-row').last()
  const delId = await lastRow.evaluate(el => el.textContent)
  await lastRow.getByRole('button', { name: 'Chat options' }).click()
  await page.getByRole('dialog', { name: 'Chat options' }).getByRole('button', { name: 'Delete', exact: true }).click()
  await page.locator('.dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await sleep(600)
  const delRpcs = rpcs("session.delete")
  const cleanups = calls().filter(c => c.http === 'POST' && c.path === '/api/plugins/hermes-mobile/cleanup')
  check(delRpcs.length === 1 && cleanups.length === 1 && Array.isArray(cleanups[0].body?.keep), `deleting a chat asks the plugin to clean up (${delRpcs.length} delete, ${cleanups.length} cleanup, row ${JSON.stringify(delId.slice(0, 30))})`)
  // ── a working chat's title shimmers in the list (no dot), and only while the list can be seen ──
  await setMotion(page, 'full') // about motion: the run's pages start with animations off (lib.cjs)
  await mock({ activity: [{ session: 's-9', text: 'Thinking…', short: 'Thinking', profile: 'default', review: false, ts: Date.now() / 1000 }] })
  const workingRow = page.locator('.drawer .session-row').filter({ has: page.locator('.session-title', { hasText: /^Chat 9$/ }) })
  const shimmer = workingRow.locator('.session-title.working')
  await shimmer.waitFor({ timeout: 12000 }).then(() => check(true, 'working chat: its title shimmers'), () => check(false, 'working chat: its title shimmers'))
  await shimmer.scrollIntoViewIfNeeded()
  const shimmerState = () => shimmer.evaluate(el => { const c = getComputedStyle(el); return { name: c.animationName, play: c.animationPlayState, pos: c.maskPosition || c.webkitMaskPosition } })
  const s1 = await shimmerState()
  await sleep(300)
  const s2 = await shimmerState()
  check(s1.name === 'working-shimmer' && s1.play === 'running' && s1.pos !== s2.pos, `working chat: the band moves (${s1.pos} → ${s2.pos})`)
  check((await workingRow.locator('.working-dot').count()) === 0, 'working chat: no blinking dot')
  check((await workingRow.locator('.visually-hidden', { hasText: 'Working' }).count()) === 1, 'working chat: screen readers hear Working')
  await page.screenshot({ path: path.join(SHOTS, 'working-title-shimmer.png') })
  await page.mouse.click(360, 400)
  await sleep(400)
  check((await shimmerState()).play === 'paused', 'working chat: the shimmer stops while the list is closed')
  await page.getByRole('button', { name: 'Sessions' }).click()
  await sleep(400)
  check((await shimmerState()).play === 'running', 'working chat: the shimmer starts again with the list open')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  check((await shimmerState()).name === 'none', 'working chat: no shimmer with reduced motion')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await mock({ activity: [] })
  await shimmer.waitFor({ state: 'detached', timeout: 8000 }).then(() => check(true, 'working chat: the shimmer ends with the turn'), () => check(false, 'working chat: the shimmer ends with the turn'))
  await setMotion(page, 'off')
  await page.mouse.click(360, 400) // close drawer (backdrop)
  await sleep(400)

  // ── #8 canvas: an edit made right before switching chats is saved ──
  await page.getByRole('button', { name: 'Canvas' }).first().click()
  await page.locator('.canvas-panel').waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'New document' }).first().click()
  await page.locator('.picker-opt, .set-row', { hasText: 'Notes / document' }).click()
  await page.locator('.dialog input').fill('Plan')
  await page.locator('.dialog button', { hasText: 'Create' }).click()
  const editor = page.locator('textarea.editor-text')
  await editor.waitFor({ timeout: 5000 })
  const storedBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('hm.lastSession') || '{}').id)
  await editor.fill('typed just before switching')
  await page.evaluate(() => window.hermesOpenSession('s-5')) // e.g. a notification tapped right away
  await sleep(800)
  const puts = calls().filter(c => c.http === 'PUT' && c.path === '/api/plugins/hermes-mobile/canvas/doc')
  check(puts.length === 1 && puts[0].body.content === 'typed just before switching' && puts[0].body.session === storedBefore, `pending canvas edit saved to its own chat (${JSON.stringify(puts.map(p => [p.body.session, p.body.content]))}, chat ${storedBefore})`)

  // ── #9 canvas html: offline CSP blocks forms; alert() → app toast ──
  await page.locator('.msg.assistant', { hasText: 'answer s-5' }).waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'Canvas' }).first().click()
  await page.getByRole('button', { name: 'New document' }).first().click()
  await page.locator('.picker-opt, .set-row', { hasText: 'Web page' }).click()
  await page.locator('.dialog input').fill('Page')
  await page.locator('.dialog button', { hasText: 'Create' }).click()
  await editor.waitFor({ timeout: 5000 })
  await editor.fill('<p>hi</p><script>alert("hello from the page")</script>')
  await page.locator('.canvas-toolbar .seg button', { hasText: 'Run' }).click()
  await page.locator('.toast', { hasText: 'hello from the page' }).waitFor({ timeout: 5000 }).then(
    () => check(true, 'alert() shows as an app toast'),
    () => check(false, 'alert() shows as an app toast')
  )
  const srcdoc = await page.locator('iframe.html-frame').getAttribute('srcdoc')
  check(srcdoc.includes("form-action 'none'"), 'offline CSP includes form-action none')
  // A tapped link in the page opens outside (the default browser) instead of loading inside the frame.
  await page.evaluate(() => { window.__opened = []; window.__realOpen = window.open; window.open = u => { window.__opened.push(String(u)); return null } })
  await page.locator('.canvas-toolbar .seg button', { hasText: 'Edit' }).click()
  await editor.fill('<a id="l" href="https://example.com/x">go</a> <a id="m" href="mailto:a@example.com">mail</a> <a id="j" href="javascript:void(0)">js</a> <button id="w" onclick="window.open(\'https://example.com/w\')">open</button>')
  await page.locator('.canvas-toolbar .seg button', { hasText: 'Run' }).click()
  // Tap once the page has loaded (a click racing the srcdoc load was sometimes lost in headless Chromium).
  const inFrame = page.frameLocator('iframe.html-frame')
  await inFrame.locator('#l').waitFor()
  await sleep(300)
  await inFrame.locator('#l').click()
  await sleep(250)
  check((await page.locator('.dialog').count()) === 0 && (await page.evaluate(() => window.__opened)).includes('https://example.com/x'), 'canvas: a tapped link opens outside, no question')
  // One tap opens one link directly: another within 5 s asks (the page could open many from one tap).
  await inFrame.locator('#m').click()
  const mailDlg = page.locator('.dialog', { hasText: 'mailto:a@example.com' })
  await mailDlg.waitFor({ timeout: 3000 }).then(() => check(true, 'canvas: a second link within 5 s asks first'), () => check(false, 'canvas: a second link within 5 s asks first'))
  await mailDlg.locator('button', { hasText: 'Open' }).click()
  await sleep(5200)
  await inFrame.locator('#w').click()
  await sleep(250)
  await inFrame.locator('#j').click()
  await sleep(250)
  const openedCanvas = await page.evaluate(() => window.__opened)
  // (A javascript: link is not the app's to open; Chromium doesn't run one in a sandboxed frame either.)
  check(JSON.stringify(openedCanvas) === JSON.stringify(['https://example.com/x', 'mailto:a@example.com', 'https://example.com/w']), `canvas: a mail link and window.open open outside too; a javascript: link is not handed over (${JSON.stringify(openedCanvas)})`)
  check((await page.locator('.dialog').count()) === 0, 'canvas: window.open after a tap asks nothing')
  const frameUrl = await inFrame.locator('body').evaluate(() => location.href)
  check(frameUrl === 'about:srcdoc', `frame stayed on the document (${frameUrl})`)
  // A page that sends a link without a tap (here on load) asks first; schemes other than web and mail are dropped.
  await page.locator('.canvas-toolbar .seg button', { hasText: 'Edit' }).click()
  await editor.fill('<p>x</p><script>parent.postMessage({hmCanvasLink:"intent://evil"},"*");setTimeout(function(){window.open("https://example.com/auto")},200)</script>')
  await page.locator('.canvas-toolbar .seg button', { hasText: 'Run' }).click()
  const linkDlg = page.locator('.dialog', { hasText: 'https://example.com/auto' })
  await linkDlg.waitFor({ timeout: 5000 }).then(() => check(true, 'canvas: a link the page sends on its own asks to open outside'), () => check(false, 'canvas: a link the page sends on its own asks to open outside'))
  check((await page.locator('.dialog').count()) === 1 && !(await page.evaluate(() => window.__opened)).some(u => u.startsWith('intent:')), 'canvas: a non-web link from the page is dropped')
  await linkDlg.locator('button', { hasText: 'Cancel' }).click()
  // Back to a page that sends nothing on its own (the gallery below previews it).
  await page.locator('.canvas-toolbar .seg button', { hasText: 'Edit' }).click()
  await editor.fill('<a id="l" href="https://example.com/x">go</a>')
  await page.locator('.canvas-toolbar .seg button', { hasText: 'Run' }).click()
  await page.evaluate(() => { window.open = window.__realOpen })
  await page.screenshot({ path: path.join(SHOTS, 'hm-shot-canvas.png') })

  // ── Canvas gallery: every chat's canvas documents by type, searchable, opened on their own chat's canvas ──
  await page.getByRole('button', { name: 'New document' }).first().click()
  await page.locator('.picker-opt, .set-row', { hasText: 'Notes / document' }).click()
  await page.locator('.dialog input').fill('Soup')
  await page.locator('.dialog button', { hasText: 'Create' }).click()
  await editor.waitFor({ timeout: 5000 })
  await editor.fill('# Soup\n\nTomato and basil')
  await sleep(1200) // autosave
  await page.getByRole('button', { name: 'More' }).click()
  check((await page.locator('.set-row', { hasText: /Save to library|Gallery category/ }).count()) === 0, 'gallery: nothing to save or file from the canvas menu')
  await page.evaluate(() => window.hermesBack())
  await page.getByRole('button', { name: 'Close canvas' }).click()
  await openLibraryPart(page, 'Canvases')
  await page.locator('.lib-cats button', { hasText: 'HTML 1' }).waitFor({ timeout: 5000 }).then(() => check(true, 'gallery: categories are the types, with counts'), () => check(false, 'gallery: categories are the types, with counts'))
  check((await page.locator('.lib-cats button', { hasText: /^Markdown \d/ }).count()) === 1, 'gallery: a Markdown category')
  check((await page.locator('.gallery-card', { hasText: 'Plan' }).count()) === 1 && (await page.locator('.gallery-card', { hasText: 'Page' }).count()) === 1, 'gallery: documents from every chat, nothing saved by hand')
  check((await page.locator('.gallery-card', { hasText: 'Soup' }).locator('.gallery-from', { hasText: 'Chat 5' }).count()) === 1, 'gallery: each card names its chat')
  await page.screenshot({ path: path.join(SHOTS, 'hm-shot-gallery.png') })
  await page.locator('.lib-cats button', { hasText: 'HTML 1' }).click()
  check((await page.locator('.gallery-card').count()) === 1 && (await page.locator('.gallery-card', { hasText: 'Page' }).count()) === 1, 'gallery: a type chip filters the list')
  await page.locator('.lib-cats button', { hasText: /^All/ }).click()
  // Search: by content (Soup's text), then by title, then no match.
  await page.getByPlaceholder('Search titles and text…').fill('basil')
  await page.waitForFunction(() => document.querySelectorAll('.gallery-card').length === 1, null, { timeout: 5000 }).then(() => check(true, 'gallery: search finds a document by its text'), () => check(false, 'gallery: search finds a document by its text'))
  check((await page.locator('.gallery-card', { hasText: 'Soup' }).count()) === 1, 'gallery: the right one')
  {
    const s = calls().filter(c => c.http === 'GET' && c.path === '/api/plugins/hermes-mobile/gallery' && /q=/.test(c.query))
    check(s.length >= 1 && new URLSearchParams(s[s.length - 1].query).get('q') === 'basil', `gallery: Hermes is asked to search (${s.map(c => c.query).join(' ')})`)
    check(s.length <= 2, `gallery: typing doesn't send a search per key (${s.length})`)
  }
  await page.getByPlaceholder('Search titles and text…').fill('plan')
  await page.waitForFunction(() => [...document.querySelectorAll('.gallery-card .gallery-title')].map(e => e.textContent).join() === 'Plan', null, { timeout: 5000 }).then(() => check(true, 'gallery: search by title'), () => check(false, 'gallery: search by title'))
  await page.getByPlaceholder('Search titles and text…').fill('zzz-nothing')
  await page.getByText('Nothing matches “zzz-nothing”').waitFor({ timeout: 5000 }).then(() => check(true, 'gallery: no match says so'), () => check(false, 'gallery: no match says so'))
  // Leaving and coming back starts with an empty search box and the whole gallery.
  await page.evaluate(() => window.hermesBack())
  await openLibraryPart(page, 'Canvases')
  check((await page.getByPlaceholder('Search titles and text…').inputValue()) === '', 'gallery: the last search is not kept')
  await page.waitForFunction(() => document.querySelectorAll('.gallery-card').length >= 3, null, { timeout: 5000 }).then(() => check(true, 'gallery: back to the whole list'), () => check(false, 'gallery: back to the whole list'))
  check((await page.getByText(/Nothing matches/).count()) === 0, 'gallery: no stale "Nothing matches"')
  // An old Library copy saved without a chat: "Saved copy", not "Chat deleted"; its ⋮ shares the label's row.
  check((await page.locator('.gallery-card', { hasText: 'Old notes' }).locator('.gallery-from', { hasText: 'Saved copy' }).count()) === 1, 'gallery: a copy saved without a chat says Saved copy')
  check((await page.locator('.gallery-card', { hasText: 'Old notes' }).locator('.gallery-from', { hasText: 'Chat deleted' }).count()) === 0, 'gallery: no "Chat deleted" for it')
  await page.locator('.gallery-card', { hasText: 'Old notes' }).click()
  await page.locator('.lib-viewer .canvas-md', { hasText: 'Kept from before' }).waitFor({ timeout: 5000 }).then(() => check(true, 'gallery: saved copy preview'), () => check(false, 'gallery: saved copy preview'))
  {
    const bar = page.locator('.lib-viewer-bar')
    check((await bar.getByRole('button', { name: /Open canvas|Go to chat/ }).count()) === 0, 'gallery: a saved copy has no chat buttons')
    check((await bar.locator('span', { hasText: 'saved copy' }).count()) === 1, 'gallery: the preview says saved copy')
    const label = await bar.locator('> span').boundingBox()
    const dots = await bar.getByRole('button', { name: 'Item options' }).boundingBox()
    check(!!label && !!dots && dots.y < label.y + label.height && dots.x > label.x, `gallery: the ⋮ sits on the label's row, not alone (${JSON.stringify({ label, dots })})`)
  }
  await page.evaluate(() => window.hermesBack())
  await page.locator('.lib-viewer').waitFor({ state: 'detached', timeout: 3000 })
  await page.waitForFunction(() => document.querySelectorAll('.gallery-card').length >= 3, null, { timeout: 5000 })
  await page.locator('.gallery-card', { hasText: 'Page' }).click()
  await page.locator('.lib-viewer iframe.html-frame').waitFor({ timeout: 5000 }).then(() => check(true, 'gallery: a web page runs in the preview (offline sandbox)'), () => check(false, 'gallery: a web page runs in the preview (offline sandbox)'))
  await page.evaluate(() => window.hermesBack())
  await page.locator('.gallery-card', { hasText: 'Soup' }).click()
  await page.locator('.lib-viewer .canvas-md', { hasText: 'Tomato and basil' }).waitFor({ timeout: 5000 }).then(() => check(true, 'gallery: markdown preview'), () => check(false, 'gallery: markdown preview'))
  check((await page.locator('.lib-viewer-bar', { hasText: 'from “Chat 5”' }).count()) === 1, 'gallery: the preview says which chat it is from')
  await page.getByRole('button', { name: 'Item options' }).click()
  check((await page.locator('.set-row', { hasText: 'Move to category' }).count()) === 0, 'gallery: no hand-made categories')
  await page.evaluate(() => window.hermesBack())
  await sleep(300)
  await page.evaluate(() => window.hermesBack())
  await page.locator('.lib-viewer').waitFor({ state: 'detached', timeout: 3000 })
  // Open canvas: goes to the chat the document was made in (not the one on screen) with its canvas on it.
  await page.locator('.gallery-card', { hasText: 'Plan' }).click()
  await page.getByRole('button', { name: 'Open canvas' }).click()
  await page.locator('.canvas-panel').waitFor({ timeout: 5000 })
  await sleep(800)
  {
    const now = await page.evaluate(() => JSON.parse(localStorage.getItem('hm.lastSession') || '{}').id)
    check(now === storedBefore, `gallery: Open canvas went to the document's own chat (${now}, want ${storedBefore})`)
    check((await page.locator('.screen').count()) === 0, 'gallery: the screen closes for the canvas')
    check((await page.locator('.canvas-tab.on', { hasText: 'Plan' }).count()) === 1, 'gallery: the canvas shows that document')
  }
  await page.getByRole('button', { name: 'Close canvas' }).click()
  // Go to chat: back to Chat 5 without the canvas.
  await openLibraryPart(page, 'Canvases')
  await page.locator('.gallery-card', { hasText: 'Soup' }).click()
  await page.getByRole('button', { name: 'Go to chat' }).click()
  await page.locator('.msg.assistant', { hasText: 'answer s-5' }).waitFor({ timeout: 5000 }).then(() => check(true, 'gallery: Go to chat opens the chat it was made in'), () => check(false, 'gallery: Go to chat opens the chat it was made in'))
  check((await page.locator('.canvas-panel').count()) === 0 && (await page.locator('.screen').count()) === 0, 'gallery: Go to chat leaves the canvas closed')
  // Delete removes it from its chat's canvas.
  await openLibraryPart(page, 'Canvases')
  await page.locator('.gallery-card', { hasText: 'Plan' }).click()
  await page.getByRole('button', { name: 'Item options' }).click()
  await page.locator('.set-row', { hasText: 'Delete' }).click()
  await page.locator('.dialog button', { hasText: 'Delete' }).click()
  await page.locator('.gallery-card', { hasText: 'Plan' }).waitFor({ state: 'detached', timeout: 5000 }).then(() => check(true, 'gallery: delete'), () => check(false, 'gallery: delete'))
  {
    const del = calls().filter(c => c.http === 'DELETE' && c.path === '/api/plugins/hermes-mobile/canvas/doc')
    check(del.length === 1 && new URLSearchParams(del[0].query).get('session') === storedBefore, `gallery: delete removes it from its own chat's canvas (${JSON.stringify(del.map(d => d.query))})`)
  }
  await page.evaluate(() => window.hermesBack())
  await page.evaluate(() => window.hermesBack())
  await sleep(300)
  check((await page.locator('.screen').count()) === 0, 'gallery: Back returns to the hub, then the chat')
  await page.getByRole('button', { name: 'Canvas' }).first().click()
  await page.locator('.canvas-panel').waitFor({ timeout: 5000 })

  // ── the chat list, by role and name: search, and a row's menu (rename, pin and unpin, archive) ──
  {
    const { WEB } = require('../lib.cjs')
    const dl = await t.browser.newPage({ viewport: { width: 375, height: 812 } })
    await dl.goto(WEB + '/')
    await dl.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await dl.getByRole('button', { name: /^Sessions/ }).click()
    const search = dl.getByPlaceholder('Search chats')
    await search.waitFor({ timeout: 3000 })
    await search.fill('Chat 43')
    const title = dl.getByText('Chat 43', { exact: true })
    await title.waitFor({ timeout: 3000 })
    check((await dl.getByText('Chat 44', { exact: true }).count()) === 0, 'chat list: searching shows the matching chat and hides the others')
    // The row's own menu button: the search leaves this one chat in the list.
    const rowMenu = async () => {
      await dl.getByRole('complementary').getByRole('button', { name: 'Chat options' }).click()
      await dl.getByRole('dialog').filter({ hasText: 'Archive' }).waitFor({ timeout: 3000 })
      return dl.getByRole('dialog').filter({ hasText: 'Archive' })
    }
    const since = Date.now()
    const later = list => list.filter(c => c.t >= since)
    // Rename from the list.
    await (await rowMenu()).getByRole('button', { name: 'Rename' }).click()
    await dl.getByRole('dialog').getByPlaceholder('Chat title').fill('Chat 43 renamed')
    await dl.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
    await dl.waitForTimeout(300)
    const ren = later(calls()).filter(c => c.http === 'PATCH' && c.path === '/api/sessions/s-43')
    check(ren.length === 1 && ren[0].body.title === 'Chat 43 renamed', `chat list: Rename in a row's menu stores the title (${JSON.stringify(ren.map(c => c.body.title))})`)
    await title.waitFor({ timeout: 5000 }).catch(() => {}) // the mock's list still has the old title
    // Pin to top, then Unpin: kept on the phone at once and sent to the plugin (a second later, newest wins). The mock is
    // shared by every page of the run, so only writes of a change made since this check began count (`at`, the change's
    // time, not the time it reached the mock): another page's older write arriving late is not this page's pin.
    const writes = () => later(calls()).filter(c => c.http === 'PUT' && c.path === '/api/plugins/hermes-mobile/prefs')
    const prefs = () => writes().filter(c => (c.body.at || 0) >= since).map(c => c.body.pinned)
    const seen = () => JSON.stringify(writes().map(c => [c.body.pinned, (c.body.at || 0) - since]))
    const stored = () => dl.evaluate(() => JSON.parse(localStorage.getItem('hm.order.v1.default') || 'null')?.pinned || [])
    const sent = async n => { for (let i = 0; i < 30 && prefs().length < n; i++) await dl.waitForTimeout(100); return prefs() }
    await (await rowMenu()).getByRole('button', { name: 'Pin to top' }).click()
    const pinnedGroup = await dl.getByText(/Pinned/).first().waitFor({ timeout: 3000 }).then(() => true, () => false)
    const pinStored = await stored()
    const pinSent = await sent(1)
    check(pinnedGroup && pinStored[0] === 's-43' && pinSent.length === 1 && pinSent[0][0] === 's-43', `chat list: Pin to top pins the chat (${JSON.stringify(pinStored)}, sent ${JSON.stringify(pinSent)}, every write with its time ${seen()})`)
    await (await rowMenu()).getByRole('button', { name: 'Unpin' }).click()
    const unpinStored = await stored()
    const unpinSent = await sent(2)
    check(!unpinStored.includes('s-43') && unpinSent.length === 2 && !unpinSent[1].includes('s-43'), `chat list: Unpin takes it out again (${JSON.stringify(unpinStored)}, sent ${JSON.stringify(unpinSent)}, every write with its time ${seen()})`)
    // Archive: Hermes is asked to hide the chat.
    await (await rowMenu()).getByRole('button', { name: 'Archive' }).click()
    await dl.waitForTimeout(300)
    const hid = later(rpcs('session.set_hidden'))
    check(hid.length === 1 && hid[0].params.session_id === 's-43' && hid[0].params.hidden === true, `chat list: Archive hides the chat (${JSON.stringify(hid.map(c => c.params))})`)
    await dl.close()
  }

  // ── the chat list's order: last activity, read from a snapshot when the panel opens; the state words (spec 3.13) ──
  // Every mock change below is undone at the end (unbump, dropChats, prefsOrder), and `complete` reaches only the newest page,
  // so the checks after this file see the mock and the run's main page as before.
  {
    const { WEB, MOCK } = require('../lib.cjs')
    const page0 = async (store = {}) => {
      const p = await t.browser.newPage({ viewport: { width: 375, height: 812 } })
      await p.addInitScript(s => {
        try {
          if (!sessionStorage.getItem('opened')) {
            sessionStorage.setItem('opened', '1')
            for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v)
          }
        } catch { /* */ }
      }, { 'hm.glass': '1', 'hm.motion': 'off', ...store })
      await p.goto(WEB + '/')
      await p.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
      return p
    }
    const tools = p => {
      const panel = p.getByRole('complementary', { name: 'Chats' })
      const shown = async () => ((await panel.boundingBox())?.x ?? -1) >= 0
      const until = async (fn, ms = 4000) => { for (let i = 0; i < ms / 50; i++) { if (await fn()) return true; await p.waitForTimeout(50) } return false }
      const title = name => panel.getByText(name, { exact: true })
      // The row: the innermost box holding both the title and a "Chat options" button.
      const row = name => panel.locator('div').filter({ has: p.getByText(name, { exact: true }) }).filter({ has: p.getByRole('button', { name: 'Chat options' }) }).last()
      const y = async name => (await title(name).boundingBox())?.y ?? NaN
      const group = async name => {
        const ry = await y(name)
        let label = ''
        for (const h of await panel.getByRole('heading').all()) {
          const b = await h.boundingBox()
          if (b && b.y < ry) label = (await h.textContent()).trim()
        }
        return label
      }
      const line = name => row(name).evaluate(el => el.innerText.split('\n').map(x => x.trim()).filter(Boolean).pop())
      const spoken = name => row(name).ariaSnapshot()
      return {
        panel, shown, until, title, row, y, group, line, spoken,
        open: async () => { await p.getByRole('button', { name: /^Sessions/ }).click(); await until(shown) },
        close: async () => { await p.mouse.click(360, 400); await until(async () => !(await shown())) }
      }
    }
    const savedPrefs = await fetch(MOCK + '/api/plugins/hermes-mobile/prefs').then(r => r.json()).then(r => r.order ?? null, () => null)
    const cl = await page0()
    const c = tools(cl)
    await c.open()

    // "Working" while a chat runs: the visible word, heard once (the hidden "Working" before the title is what is read).
    await mock({ activity: [{ session: 's-71', text: 'Thinking…', short: 'Thinking', profile: 'default', review: false, ts: Date.now() / 1000 }] })
    const working = await c.until(async () => /Working/.test((await c.line('Chat 71')) || ''), 12000)
    const wLine = await c.line('Chat 71')
    const wSpoken = await c.spoken('Chat 71')
    check(working && /^\d+ (h|d) · Working$/.test(wLine), `state words: a running chat says Working after the time (${JSON.stringify(wLine)})`)
    check((wSpoken.match(/Working/g) || []).length === 1, `state words: screen readers hear Working once (${JSON.stringify(wSpoken)})`)
    await mock({ activity: [] })
    await c.until(async () => !/Working/.test((await c.line('Chat 71')) || ''), 12000)
    const plain = await c.line('Chat 72')
    check(/^\d+ (h|d)$/.test(plain), `state words: a chat that is neither running nor unread shows only its time (${JSON.stringify(plain)})`)

    // A chat created 70 h ago gets a message: it stays where it is while the panel is open, and is first, under Today,
    // after the panel opens again.
    check((await c.group('Chat 70')) === 'This week' && (await c.y('Chat 69')) < (await c.y('Chat 70')), `chat order: before its message, Chat 70 sits by its age (${await c.group('Chat 70')})`)
    await mock({ bump: 's-70', complete: 's-70' })
    const arrived = await c.until(async () => /Finished/.test((await c.line('Chat 70')) || ''), 6000)
    const [y69, y70, y71] = [await c.y('Chat 69'), await c.y('Chat 70'), await c.y('Chat 71')]
    check(arrived && y69 < y70 && y70 < y71 && (await c.group('Chat 70')) === 'This week', `chat order: a new message moves no row while the panel stays open (${arrived}, ${y69} < ${y70} < ${y71}, ${await c.group('Chat 70')})`)
    const fLine = await c.line('Chat 70')
    const fSpoken = await c.spoken('Chat 70')
    check(/^(now|\d+ min) · Finished$/.test(fLine), `state words: an unread chat says Finished after the time, no message count (${JSON.stringify(fLine)})`)
    check((fSpoken.match(/Finished/g) || []).length === 1 && fSpoken.includes('Finished, not opened yet'), `state words: screen readers hear Finished once, from the dot (${JSON.stringify(fSpoken)})`)
    await c.close()
    await c.open()
    const firstY = Math.min(...(await Promise.all(['Chat 0', 'Running chat', 'Card chat', 'Stale edit chat', 'Chat 69'].map(c.y))))
    check((await c.y('Chat 70')) < firstY && (await c.group('Chat 70')) === 'Today', `chat order: after the panel opens again the chat with the new message is first, under Today (${await c.group('Chat 70')})`)

    // A snapshot asked for while a finger (here the mouse button) is down on the panel waits until it lifts.
    const field = await c.panel.getByPlaceholder('Search chats').boundingBox()
    await cl.mouse.move(field.x + 20, field.y + field.height / 2)
    await cl.mouse.down()
    await mock({ bump: 's-60', newChat: 's-held', complete: 's-60' })
    const listed = await c.until(async () => (await c.title('Brand new chat').count()) === 1, 6000)
    const held = [await c.y('Chat 59'), await c.y('Chat 60'), await c.y('Chat 61')]
    check(listed && held[0] < held[1] && held[1] < held[2], `chat order: while a finger is on the panel a new chat does not re-sort the rows (${listed}, ${held})`)
    await cl.mouse.up()
    const after = await c.until(async () => (await c.y('Chat 60')) < (await c.y('Chat 70')), 2000)
    check(after && (await c.y('Brand new chat')) < (await c.y('Chat 60')), 'chat order: the snapshot follows when the finger lifts (the new chat first, then the chat with the new message)')

    // A scheduled job's run: the job's name with a clock, not the source word.
    await mock({ cronRuns: true, complete: 's-0' })
    const runs = await c.until(async () => (await c.title('Old brief name · Nov 17 09:00').count()) === 1, 6000)
    const rLine = await c.line('Old brief name · Nov 17 09:00')
    const rSpoken = await c.spoken('Old brief name · Nov 17 09:00')
    const clock = await c.row('Old brief name · Nov 17 09:00').evaluate(el => [...el.querySelectorAll('svg')].some(s => s.parentElement && /Morning brief/.test(s.parentElement.textContent)))
    check(runs && /· Morning brief$/.test(rLine) && !/cron/.test(rLine) && clock, `scheduled run: its row names the job (from the jobs list) with a clock, not "cron" (${JSON.stringify(rLine)}, clock ${clock})`)
    check(/img "Scheduled"[\s\S]*Morning brief/.test(rSpoken), `scheduled run: screen readers hear the clock as "Scheduled", then the job (${JSON.stringify(rSpoken)})`)
    const lLine = await c.line('Weekly report · Nov 16 08:00')
    check(/· Weekly report$/.test(lLine) && !/cron/.test(lLine), `scheduled run: a run whose id names no job takes the name from its title (${JSON.stringify(lLine)})`)
    // The line stays one line under a much wider font (CI's fonts are wider than a Mac's).
    const rowH = () => c.row('Old brief name · Nov 17 09:00').evaluate(el => el.getBoundingClientRect().height)
    const h0 = await rowH()
    await cl.evaluate(() => { document.querySelector('[aria-label="Chats"]').style.letterSpacing = '0.3em' })
    const h1 = await rowH()
    await cl.evaluate(() => { document.querySelector('[aria-label="Chats"]').style.letterSpacing = '' })
    check(Math.abs(h1 - h0) < 0.5, `chat row: the line under the title never wraps, even with wide letter-spacing (${h0} → ${h1} px)`)
    // The sent counts are not asked for any more (the plugin keeps the route for older apps).
    check(!calls().some(x => x.path === '/api/plugins/hermes-mobile/sent-counts'), 'chat list: the app no longer asks for sent counts (POST /sent-counts)')
    await cl.close()

    // A custom order (after a drag, here stored before start) keeps its places when a message arrives, and after reopening.
    const co = await page0({ 'hm.order.v1.default': JSON.stringify({ pinned: [], manual: ['s-3', 's-1', 's-2'], at: Date.now() + 60000 }) })
    const d = tools(co)
    await d.open()
    const sortBtn = await d.panel.getByRole('button', { name: 'Sort by recent' }).count()
    const order0 = [await d.y('Chat 3'), await d.y('Chat 1'), await d.y('Chat 2')]
    check(sortBtn === 1 && order0[0] < order0[1] && order0[1] < order0[2], `custom order: shown as saved, with Sort by recent (${order0})`)
    await mock({ bump: 's-1', complete: 's-1' })
    const got = await d.until(async () => /Finished/.test((await d.line('Chat 1')) || ''), 6000)
    await d.close()
    await d.open()
    const order1 = [await d.y('Chat 3'), await d.y('Chat 1'), await d.y('Chat 2')]
    check(got && order1[0] < order1[1] && order1[1] < order1[2] && (await d.panel.getByRole('heading', { name: 'Today' }).count()) === 0, `custom order: a new message and reopening the panel leave it as it is (${got}, ${order1})`)
    await co.close()
    await mock({ unbump: true, dropChats: ['s-held', 'cron_j1_20261117_090000', 'local-0a1b2c'], prefsOrder: savedPrefs })
  }

  // ── a row's menu (spec 3.13): the chat menu's header and look, one group, a solid sheet over the glass panel, closed by
  // Back with the panel left open; at 320 px in Default, Light and OLED, glass on and off ──
  {
    const { WEB, menuFits, contrast } = require('../lib.cjs')
    const at = async (store = {}, w = 375, h = 812) => {
      const p = await t.browser.newPage({ viewport: { width: w, height: h } })
      await p.addInitScript(s => {
        try {
          if (sessionStorage.getItem('opened')) return
          sessionStorage.setItem('opened', '1')
          for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v)
        } catch { /* */ }
      }, store)
      await p.goto(WEB + '/')
      await p.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
      await p.getByRole('button', { name: /^Sessions/ }).click()
      return p
    }
    const rowMenu = async p => {
      const panel = p.getByRole('complementary', { name: 'Chats' })
      const row = panel.locator('div').filter({ has: p.getByText('Chat 3', { exact: true }) }).filter({ has: p.getByRole('button', { name: 'Chat options' }) }).last()
      await row.getByRole('button', { name: 'Chat options' }).click()
      const d = p.getByRole('dialog', { name: 'Chat options' })
      await d.waitFor({ timeout: 3000 })
      return d
    }
    const rp = await at({ 'hm.glass': '1' })
    const d = await rowMenu(rp)
    const names = await d.evaluate(el => [...el.querySelectorAll('button')].map(b => b.getAttribute('aria-label') || b.textContent.trim()))
    const head = (await d.innerText()).split('\n')[0].trim()
    check(head === 'Chat 3' && JSON.stringify(names) === JSON.stringify(['Rename', 'Pin to top', 'Archive', 'Delete']), `row menu: the chat's title with Rename, then Pin to top, Archive and Delete, nothing that needs the chat open (${head}, ${JSON.stringify(names)})`)
    // Glass never lies on glass: the panel stays glass and open behind, the menu is solid.
    const blurOf = loc => loc.evaluate(el => {
      const f = pseudo => getComputedStyle(el, pseudo).backdropFilter || getComputedStyle(el, pseudo).webkitBackdropFilter || 'none'
      return { self: f(), layer: f('::before'), x: el.getBoundingClientRect().left }
    })
    const m = await blurOf(d)
    const pn = await blurOf(rp.getByRole('complementary', { name: 'Chats' }))
    const looks = { menu: m.layer, menuSelf: m.self, panel: pn.layer, panelX: pn.x }
    check(!/blur/.test(looks.menu) && !/blur/.test(looks.menuSelf) && /blur/.test(looks.panel) && looks.panelX >= 0, `row menu: a solid sheet over the open glass panel, never glass on glass (menu ${looks.menu}, panel ${looks.panel}, panel at ${looks.panelX})`)
    // Back closes the menu and leaves the panel open where it was.
    await rp.evaluate(() => window.hermesBack())
    const gone = await d.waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false)
    const panelStill = await rp.getByRole('complementary', { name: 'Chats' }).evaluate(el => el.getBoundingClientRect().left >= 0)
    check(gone && panelStill, `row menu: Back closes it and the chat list stays open (closed ${gone}, panel open ${panelStill})`)
    await rp.close()
    for (const [theme, glass] of [['default', '1'], ['light', '1'], ['light', '0'], ['oled', '0']]) {
      const lp = await at({ 'hm.theme': theme, 'hm.glass': glass }, 320, 640)
      const md = await rowMenu(lp)
      const fit = await menuFits(lp, md, true) // the row menu is solid in every form, so its words are measured always
      const short = fit.names.map((n, i) => [n, fit.hs[i]]).filter(([n, h]) => n !== 'Rename' && h < 52)
      const low = fit.colours.map(([n, fg, bg]) => [n, contrast(fg, bg)]).filter(([, c]) => c < 4.5)
      check(!fit.over && fit.grew.length === 0 && short.length === 0 && low.length === 0, `row menu at 320 px (${theme}, glass ${glass === '1' ? 'on' : 'off'}): no label wraps under a wider font, nothing overflows, rows 52 px or more, words 4.5:1 (grew ${JSON.stringify(fit.grew)}, short ${JSON.stringify(short)}, low ${JSON.stringify(low.map(([n, c]) => `${n} ${c.toFixed(2)}`))}, over ${fit.over})`)
      await lp.close()
    }
  }
}
