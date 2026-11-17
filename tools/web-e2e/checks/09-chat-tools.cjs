// Drafts per chat, share as Markdown, compress hint, message search, file checkpoints.
const { calls, rpcs, sleep, check } = require('../lib.cjs')

module.exports = async t => {
  const { browser, page } = t
  // ── #14 drafts are kept per chat ──
  const box = page.getByPlaceholder('Message Hermux')
  await box.fill('draft for nine')
  await page.evaluate(() => window.hermesOpenSession('s-8'))
  await page.locator('.msg.assistant', { hasText: 'answer s-8' }).waitFor({ timeout: 5000 })
  check((await box.inputValue()) === '', 'another chat starts with an empty box')
  await box.fill('eight')
  await page.evaluate(() => window.hermesOpenSession('s-9'))
  await page.locator('.msg.assistant', { hasText: 'answer s-9' }).waitFor({ timeout: 5000 })
  check((await box.inputValue()) === 'draft for nine', `back in the first chat its draft is there (${await box.inputValue()})`)
  await page.evaluate(() => window.hermesOpenSession('s-8'))
  await page.locator('.msg.assistant', { hasText: 'answer s-8' }).waitFor({ timeout: 5000 })
  check((await box.inputValue()) === 'eight', 'and the other one keeps its own')

  // ── #16 share a chat as Markdown (browser: copied) ──
  await page.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve() } })
  await page.locator('header.topbar').getByRole('button', { name: 'Chat options' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Share chat' }).click()
  await page.locator('.toast', { hasText: 'Copied as Markdown' }).waitFor({ timeout: 3000 }).catch(() => {})
  const md = await page.evaluate(() => window.__copied)
  check(md && md.startsWith('# Chat 8\n') && md.includes('**You:**\n\nhello s-8') && md.includes('**Hermux:**\n\nanswer s-8'), `chat exported as Markdown (${JSON.stringify(md && md.slice(0, 90))})`)

  // ── #17 compress suggestion near a full context ──
  await page.evaluate(() => window.hermesOpenSession('s-full'))
  const hint = page.locator('.compress-hint')
  await hint.waitFor({ timeout: 5000 }).then(() => check(true, 'hint shows at 85% context'), () => check(false, 'hint shows at 85% context'))
  await hint.getByRole('button', { name: 'Compress' }).click()
  await page.locator('.notice', { hasText: 'Context compressed: 40 → 6 messages' }).waitFor({ timeout: 5000 }).then(() => check(true, 'compress runs and leaves a notice'), () => check(false, 'compress runs and leaves a notice'))
  check(rpcs('session.compress').some(r => r.params.session_id === 'rt-s-full'), 'session.compress sent for the open chat')
  await sleep(300)
  check((await hint.count()) === 0, 'hint gone afterwards')
  // the ring for the 20% left after compressing; then force 85% again via the other route: reopen the chat
  await page.evaluate(() => window.hermesOpenSession('s-8'))
  await page.evaluate(() => window.hermesOpenSession('s-full'))
  await page.locator('.ctx-ring.warn').waitFor({ timeout: 5000 }).then(() => check(true, 'ring turns amber at 85%'), () => check(false, 'ring turns amber at 85%'))
  // a reopened chat Hermes has no figures for yet: the ring shows the last saved fill, or the one in old reply stats
  {
    const label = () => page.locator('.ctx-ring').getAttribute('aria-label').catch(() => null)
    await page.evaluate(() => window.hermesOpenSession('s-cold'))
    await page.locator('.msg.assistant', { hasText: 'answer s-cold' }).waitFor({ timeout: 5000 })
    await sleep(300)
    check((await label()) === 'Context not known yet. Show details', `no figures yet: an empty ring (${await label()})`)
    await page.evaluate(() => localStorage.setItem('hm.stats.v1', JSON.stringify({ 's-cold:1': '58 tok/s · ctx 37% · 370/1k' })))
    await page.evaluate(() => window.hermesOpenSession('s-8'))
    await page.evaluate(() => window.hermesOpenSession('s-cold'))
    await page.locator('.ctx-ring[aria-label="Context 37% used. Show details"]').waitFor({ timeout: 5000 }).then(() => check(true, 'ring filled from old reply stats'), () => check(false, 'ring filled from old reply stats'))
    const meta = await page.locator('.msg.assistant', { hasText: 'answer s-cold' }).innerText()
    check(meta.includes('58 tok/s') && !meta.includes('ctx 37%'), `old reply stats shown without the context part (${JSON.stringify(meta)})`)
    await page.evaluate(() => localStorage.setItem('hm.ctx.v1', JSON.stringify({ 's-cold': { used: 420, max: 1000, percent: 42 } })))
    await page.evaluate(() => window.hermesOpenSession('s-8'))
    await page.evaluate(() => window.hermesOpenSession('s-cold'))
    await page.locator('.ctx-ring[aria-label="Context 42% used. Show details"]').waitFor({ timeout: 5000 }).then(() => check(true, 'ring filled from the saved fill'), () => check(false, 'ring filled from the saved fill'))
    await page.evaluate(() => window.hermesOpenSession('s-full'))
    await page.locator('.ctx-ring.warn').waitFor({ timeout: 5000 }).catch(() => {})
    check(JSON.parse(await page.evaluate(() => localStorage.getItem('hm.ctx.v1')))['s-full']?.percent === 85, 'a live figure is saved for next time')
  }
  {
    const before = rpcs('session.compress').length
    await page.locator('.ctx-ring').click()
    await page.locator('.sheet', { hasText: 'Context window' }).getByRole('button', { name: 'Compress older turns' }).click()
    await page.locator('.toast', { hasText: 'Context compressed' }).waitFor({ timeout: 5000 }).then(() => check(true, 'sheet Compress toasts the result'), () => check(false, 'sheet Compress toasts the result'))
    check(rpcs('session.compress').length === before + 1, 'sheet Compress sends session.compress')
    await page.evaluate(() => window.hermesBack())
    await sleep(300)
  }
  await page.evaluate(() => window.hermesOpenSession('s-8'))
  await page.locator('.msg.assistant', { hasText: 'answer s-8' }).waitFor({ timeout: 5000 })
  check((await hint.count()) === 0, 'no hint at 10%')

  // ── #18 message search opens the chat at the hit ──
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.getByPlaceholder('Search chats').fill('question 17')
  await page.locator('.hit-row', { hasText: 'Long chat' }).click({ timeout: 5000 })
  const hitMsg = page.locator('.msg.user').filter({ has: page.locator('.bubble', { hasText: /^question 17$/ }) })
  await hitMsg.waitFor({ timeout: 5000 }).catch(() => {})
  await sleep(400)
  const inView = await hitMsg.evaluate(el => { const r = el.getBoundingClientRect(), c = el.closest('.chat').getBoundingClientRect(); return r.top >= c.top && r.bottom <= c.bottom }).catch(() => false)
  check(inView, 'the hit (far above the drawn window) is scrolled into view')
  check(await hitMsg.evaluate(el => el.classList.contains('hit-flash')).catch(() => false), 'and flashes')
  check(await page.evaluate(() => CSS.highlights && CSS.highlights.has('hm-hit')), 'its words are highlighted')
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.getByPlaceholder('Search chats').fill('')
  await page.evaluate(() => window.hermesBack())

  // ── #20 file checkpoints: every folder the chat edited, diff, restore (folder or one file) ──
  await page.locator('header.topbar').getByRole('button', { name: 'Chat options' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'File checkpoints' }).click()
  await page.locator('.cp-folder', { hasText: '~/projects/site' }).waitFor({ timeout: 5000 }).then(() => check(true, 'checkpoints grouped by folder'), () => check(false, 'checkpoints grouped by folder'))
  check((await page.locator('.cp-folder').allTextContents()).includes('~/…/cache/scratch'), 'second folder listed (not the chat cwd)')
  check(await page.getByText('1 older snapshot pruned').isVisible().catch(() => false), 'pruned snapshots counted')
  await page.locator('.menu-item', { hasText: 'app.py, notes.md' }).click({ timeout: 5000 })
  await page.locator('.diff-view .dl', { hasText: '+new line' }).waitFor({ timeout: 5000 }).then(() => check(true, 'checkpoint diff shown'), () => check(false, 'checkpoint diff shown'))
  const diffCall = calls().filter(c => c.path === '/api/plugins/hermes-mobile/checkpoints/diff').pop()
  check(diffCall && /workdir=%2Froot%2Fprojects%2Fsite/.test(diffCall.query) && /snap=t1%40/.test(diffCall.query), 'diff asks for that folder + snapshot')
  check((await page.locator('.cp-file-head .btn').count()) === 1, 'per-file restore only for files that existed (not the new one)')
  await page.getByRole('button', { name: 'Restore these 2 files' }).click()
  const listed = await page.locator('.dialog-list li').allTextContents()
  check(listed.length === 2 && listed[0] === 'app.py: back to how it was' && /notes\.md: deleted/.test(listed[1]), `confirmation lists what changes (${JSON.stringify(listed)})`)
  await page.locator('.dialog button', { hasText: 'Restore 2 files' }).click()
  await page.locator('.toast', { hasText: 'Restored 2 files' }).waitFor({ timeout: 5000 }).then(() => check(true, 'restore reports the files'), () => check(false, 'restore reports the files'))
  const rr = calls().filter(c => c.path === '/api/plugins/hermes-mobile/checkpoints/restore').pop()
  check(rr && rr.body.workdir === '/root/projects/site' && rr.body.snap.startsWith('t1@') && rr.body.file === '', 'restore sent for the folder and snapshot')
  check(rpcs('rollback.restore').length === 0, 'no chat-history rewind (rollback.restore not used)')
  await page.locator('.menu-item', { hasText: 'app.py, notes.md' }).click({ timeout: 5000 })
  await page.locator('.cp-file-head .btn').click({ timeout: 5000 })
  await page.locator('.dialog button', { hasText: 'Restore 1 file' }).click()
  await page.locator('.toast', { hasText: 'Restored app.py' }).waitFor({ timeout: 5000 }).then(() => check(true, 'single-file restore'), () => check(false, 'single-file restore'))
  check(calls().filter(c => c.path === '/api/plugins/hermes-mobile/checkpoints/restore').pop()?.body.file === 'app.py', 'single-file restore sends the file')
  await page.evaluate(() => window.hermesBack())

  // ── the chat menu and find in chat, by role and name (each control used, its effect checked) ──
  {
    const { WEB } = require('../lib.cjs')
    const mp = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await mp.addInitScript(() => localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-scrub', profile: 'default' })))
    await mp.goto(WEB + '/')
    await mp.getByText('answer 30', { exact: true }).waitFor({ timeout: 8000 })
    const header = mp.getByRole('banner')
    const menu = async () => {
      await header.getByRole('button', { name: 'Chat options' }).click()
      await mp.getByRole('dialog').waitFor({ timeout: 3000 })
    }
    const since = Date.now()
    const after = list => list.filter(c => c.t >= since)
    // Find in chat: "question 2" is in questions 2 and 20 to 29 (11 matches); the arrows step through them.
    await menu()
    await mp.getByRole('dialog').getByRole('button', { name: 'Search in chat' }).click()
    const find = mp.getByRole('search')
    await find.getByRole('textbox').fill('question 2')
    const count = () => find.getByText(/^\d+ \/ \d+$/).textContent().catch(() => '')
    const first = await count()
    await find.getByRole('button', { name: 'Previous match' }).click()
    const prev = await count()
    await find.getByRole('button', { name: 'Next match' }).click()
    const back = await count()
    check(first === '11 / 11' && prev === '10 / 11' && back === '11 / 11', `chat menu: Search in chat counts the matches and Previous / Next match step through them (${first}, ${prev}, ${back})`)
    await find.getByRole('button', { name: 'Close search' }).click()
    check((await mp.getByRole('search').count()) === 0, 'chat menu: Close search closes the search bar')
    // Rename: the dashboard is asked to store the new title.
    await menu()
    await mp.getByRole('dialog').getByRole('button', { name: 'Rename' }).click()
    await mp.getByRole('dialog').getByPlaceholder('Chat title').fill('Scrub renamed')
    await mp.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
    await mp.getByText('Renamed', { exact: true }).waitFor({ timeout: 3000 }).catch(() => {})
    const ren = after(calls()).filter(c => c.http === 'PATCH' && c.path === '/api/sessions/s-scrub')
    check(ren.length === 1 && ren[0].body.title === 'Scrub renamed', `chat menu: Rename stores the new title (${JSON.stringify(ren.map(c => c.body))})`)
    // Read every reply aloud (the switch "Read replies aloud"): on for this chat only, then off again. It flips in place:
    // the menu stays open, and the line under it says whose setting it is.
    await menu()
    const readSwitch = mp.getByRole('dialog').getByRole('switch', { name: 'Read replies aloud' })
    const state = async () => `${await readSwitch.getAttribute('aria-checked')} · ${await readSwitch.evaluate(b => document.getElementById(b.getAttribute('aria-describedby') || '')?.textContent || '')}`
    await readSwitch.click()
    const chats = () => mp.evaluate(() => JSON.parse(localStorage.getItem('hm.autoread.chats') || 'null'))
    await mp.waitForTimeout(200)
    const on = await state()
    check(on === 'true · Only this chat' && (await chats())?.['s-scrub'] === true, `chat menu: Read every reply aloud turns on for this chat (${on})`)
    check((await mp.getByRole('dialog').count()) === 1, 'chat menu: the read-aloud switch flips in place and keeps the menu open')
    await readSwitch.click()
    await mp.waitForTimeout(200)
    const off = await state()
    check(off === 'false · Follows the setting for all chats' && !('s-scrub' in ((await chats()) || {})), `chat menu: tapping it again turns it off (${off}, ${JSON.stringify(await chats())})`)
    await mp.evaluate(() => window.hermesBack())
    await mp.getByRole('dialog').waitFor({ state: 'detached', timeout: 3000 })
    await menu()
    // Undo last turn: Hermes is asked to undo, and the chat is loaded again.
    await mp.getByRole('dialog').getByRole('button', { name: 'Undo last turn' }).click()
    await mp.getByText('Last turn undone').waitFor({ timeout: 5000 }).catch(() => {})
    const undo = after(rpcs('session.undo'))
    check(undo.length === 1 && undo[0].params.session_id === 'rt-s-scrub' && after(rpcs('session.resume')).some(c => c.params.session_id === 's-scrub'), `chat menu: Undo last turn asks Hermes to undo and reloads the chat (${JSON.stringify(undo.map(c => c.params))})`)
    // Delete asks first; Cancel keeps the chat (deleting is checked in 04).
    await menu()
    await mp.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    const ask = mp.getByRole('alertdialog')
    const asked = await ask.waitFor({ timeout: 3000 }).then(() => true, () => false)
    if (asked) await ask.getByRole('button', { name: 'Cancel' }).click()
    await mp.waitForTimeout(300)
    check(asked && after(rpcs('session.delete')).length === 0 && (await mp.getByText('answer 30', { exact: true }).count()) === 1, 'chat menu: Delete asks first, and Cancel keeps the chat')
    // Share chat, File checkpoints and Chat details are checked by name above; Canvas from the menu in 16.
    await mp.close()
  }

  // ── the chat menu's own parts (spec 3.5): its header, every quick action, Undo while a reply runs, Archive and Delete
  // from it, the new-chat menu, Chat details' copy button, and the menus at 320 px, in Light and OLED, glass on and off.
  // Pins go to the mock's /prefs: what it held is put back at the end; the second bot is taken away again. ──
  {
    const { WEB, MOCK, mock, menuFits, contrast } = require('../lib.cjs')
    const savedPrefs = await fetch(MOCK + '/api/plugins/hermes-mobile/prefs').then(r => r.json()).then(r => r.order ?? null, () => null)
    const since = Date.now()
    const later = list => list.filter(c => c.t >= since)
    const at = async (chat, { w = 375, h = 812, store = {} } = {}) => {
      const p = await browser.newPage({ viewport: { width: w, height: h } })
      await p.addInitScript(([chat, store]) => {
        try {
          if (sessionStorage.getItem('opened')) return
          sessionStorage.setItem('opened', '1')
          if (chat) localStorage.setItem('hm.lastSession', JSON.stringify({ id: chat, profile: 'default' }))
          else localStorage.removeItem('hm.lastSession')
          for (const [k, v] of Object.entries(store)) localStorage.setItem(k, v)
        } catch { /* */ }
      }, [chat, store])
      await p.goto(WEB + '/')
      await p.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
      if (chat) await p.getByText(`answer ${chat}`, { exact: true }).waitFor({ timeout: 8000 })
      return p
    }
    const menuOf = async p => {
      await p.getByRole('banner').getByRole('button', { name: 'Chat options' }).click()
      const d = p.getByRole('dialog', { name: 'Chat options' })
      await d.waitFor({ timeout: 3000 })
      return d
    }
    const toastSays = (p, text) => p.getByText(text, { exact: true }).first().waitFor({ timeout: 3000 }).then(() => true, () => false)

    // The header: the title, the model, and the bot when there are several; the strip of four quick actions.
    await mock({ bots: true })
    const hb = await at('s-46')
    let d = await menuOf(hb)
    const head = await d.evaluate(el => el.innerText.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 2))
    const tiles = await Promise.all(['Search in chat', 'Canvas', 'Share chat', 'Pin to top'].map(n => d.getByRole('button', { name: n, exact: true }).count()))
    check(head[0] === 'Chat 46' && head[1] === 'mock-model · default' && tiles.every(n => n === 1), `chat menu: the header names the chat, its model and, with several bots, its bot; Search, Canvas, Share and Pin are its quick actions (${JSON.stringify(head)}, ${tiles})`)
    await hb.close()
    await mock({ bots: false })
    const hp = await at('s-46')
    d = await menuOf(hp)
    const head1 = await d.evaluate(el => el.innerText.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 2))
    check(head1[1] === 'mock-model', `chat menu: with one bot the line under the title is the model alone (${JSON.stringify(head1)})`)

    // Pin from the header shows the chat in the list's Pinned group; Unpin takes it out again, with the list's toasts.
    await d.getByRole('button', { name: 'Pin to top', exact: true }).click()
    const pinToast = await toastSays(hp, 'Pinned')
    await hp.getByRole('button', { name: /^Sessions/ }).click()
    const panel = hp.getByRole('complementary', { name: 'Chats' })
    await panel.getByText('Chat 46', { exact: true }).first().waitFor({ timeout: 3000 })
    const pinnedFirst = await panel.evaluate(el => {
      const heads = [...el.querySelectorAll('div')].filter(e => e.textContent.trim() === 'Pinned')
      const row = [...el.querySelectorAll('[data-id]')][0]
      return heads.length > 0 && row?.dataset.id === 's-46'
    })
    check(pinToast && pinnedFirst, `chat menu: Pin shows the chat first under Pinned in the chat list (toast ${pinToast}, first pinned ${pinnedFirst})`)
    await hp.evaluate(() => window.hermesBack())
    d = await menuOf(hp)
    await d.getByRole('button', { name: 'Unpin', exact: true }).click()
    const unpinToast = await toastSays(hp, 'Unpinned')
    const pins = await hp.evaluate(() => JSON.parse(localStorage.getItem('hm.order.v1.default') || 'null')?.pinned || [])
    check(unpinToast && !pins.includes('s-46'), `chat menu: Unpin takes it out of Pinned (${JSON.stringify(pins)})`)

    // Canvas opens the canvas beside the chat.
    d = await menuOf(hp)
    await d.getByRole('button', { name: /^Canvas/ }).click()
    const canvasOpen = await hp.getByRole('dialog', { name: 'Canvas' }).waitFor({ timeout: 3000 }).then(() => true, () => false)
    check(canvasOpen && (await hp.getByRole('dialog', { name: 'Chat options' }).count()) === 0, 'chat menu: Canvas closes the menu and opens the canvas')
    await hp.evaluate(() => window.hermesBack())
    await hp.getByRole('dialog', { name: 'Canvas' }).waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})

    // Chat details: grouped, in plain words, and its copy button copies the chat's id.
    await hp.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve() } })
    d = await menuOf(hp)
    await d.getByRole('button', { name: 'Chat details' }).click()
    const details = hp.getByRole('dialog').filter({ hasText: 'Chat details' })
    await details.waitFor({ timeout: 3000 })
    const words = await details.innerText()
    const plain = ['Bot', 'Working folder', 'Chat ID', 'Model', 'Provider'].every(w => words.includes(w)) && !/Profile|Working dir|Session id/.test(words)
    await details.getByRole('button', { name: 'Copy chat ID' }).click()
    const copiedToast = await toastSays(hp, 'Copied')
    const copied = await hp.evaluate(() => window.__copied)
    check(plain && copiedToast && copied === 's-46', `chat details: Bot, Working folder and Chat ID in plain words, and Copy chat ID copies the id (${copied}, toast ${copiedToast}, words ok ${plain})`)
    await hp.evaluate(() => window.hermesBack())
    await details.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})

    // Archive from the header: Hermes hides the chat, and a new draft takes its place, as from the list.
    d = await menuOf(hp)
    await d.getByRole('button', { name: 'Archive', exact: true }).click()
    const archToast = await toastSays(hp, 'Archived')
    const hidden = later(rpcs('session.set_hidden')).filter(c => c.params.session_id === 's-46')
    await hp.getByRole('banner').getByText('Hermux', { exact: true }).waitFor({ timeout: 3000 }).catch(() => {})
    const draft = (await hp.getByText('answer s-46', { exact: true }).count()) === 0 && (await hp.getByRole('banner').getByText('Hermux', { exact: true }).count()) === 1
    check(archToast && hidden.length === 1 && hidden[0].params.hidden === true && draft, `chat menu: Archive hides the chat and starts a new draft (${JSON.stringify(hidden.map(c => c.params))}, draft ${draft})`)

    // The new-chat menu: the header, the read-aloud switch with its line, the note, and no Change model.
    d = await menuOf(hp)
    const dsw = d.getByRole('switch', { name: 'Read replies aloud' })
    const line = await dsw.evaluate(b => document.getElementById(b.getAttribute('aria-describedby') || '')?.textContent || '')
    const note = (await d.getByText('Rename, pin, archive and delete are available once you have sent a message.').count()) === 1
    const noModel = (await d.getByRole('button', { name: 'Change model' }).count()) === 0
    await dsw.click()
    await d.getByRole('switch', { name: 'Read replies aloud', checked: true }).waitFor({ timeout: 3000 }).catch(() => {})
    const flipped = (await dsw.getAttribute('aria-checked')) === 'true' && (await hp.getByRole('dialog', { name: 'Chat options' }).count()) === 1
    const draftHead = (await d.innerText()).split('\n')[0].trim()
    check(draftHead === 'New chat' && line === 'Applies once the chat starts' && note && noModel && flipped, `draft menu: "New chat", Read replies aloud as a switch that flips in place ("${line}"), the note, and no Change model (head ${draftHead}, note ${note}, no model ${noModel}, flipped ${flipped})`)
    await dsw.click() // off again: the next chat made in this page starts as before
    await hp.evaluate(() => window.hermesBack())
    await hp.close()

    // Undo last turn waits while a reply runs, and says why.
    const ur = await at('s-47')
    await ur.getByPlaceholder('Message Hermux').fill('bench stream 6000 60')
    await ur.getByRole('button', { name: 'Send', exact: true }).click()
    await ur.getByText('Step 1: checking the result').waitFor({ timeout: 8000 })
    d = await menuOf(ur)
    const undoBtn = d.getByRole('button', { name: 'Undo last turn' })
    const why = await undoBtn.evaluate(b => document.getElementById(b.getAttribute('aria-describedby') || '')?.textContent || '')
    check((await undoBtn.isDisabled()) && why === 'Wait for the reply to finish', `chat menu: Undo last turn is disabled while a reply runs, with the reason under it ("${why}")`)
    await ur.evaluate(() => window.hermesBack())
    await ur.getByRole('button', { name: 'Stop', exact: true }).click().catch(() => {})
    await ur.close()

    // Delete from the header, confirmed: the chat's sessions close first, Hermes deletes it, a new draft follows.
    const dp = await at('s-45')
    d = await menuOf(dp)
    await d.getByRole('button', { name: 'Delete', exact: true }).click()
    const ask = dp.getByRole('alertdialog')
    await ask.waitFor({ timeout: 3000 })
    const asked = (await ask.innerText()).includes('Delete “Chat 45”?')
    await ask.getByRole('button', { name: 'Delete', exact: true }).click()
    const delToast = await toastSays(dp, 'Deleted')
    const del = later(rpcs('session.delete')).filter(c => c.params.session_id === 's-45')
    const closedFirst = later(rpcs('session.close')).some(c => c.params.session_id === 'rt-s-45')
    check(asked && delToast && del.length === 1 && closedFirst && (await dp.getByText('answer s-45', { exact: true }).count()) === 0, `chat menu: Delete, confirmed, closes the chat's session, deletes it and leaves a new draft (asked ${asked}, toast ${delToast}, ${del.length} delete, closed first ${closedFirst})`)
    await dp.close()

    // The menus at 320 px wide, in Default, Light and OLED, glass on and off: every control keeps its height under a
    // wider font, nothing is wider than the screen, rows are at least 52 px and the quick actions 64 px; with glass off
    // the words on the rows reach 4.5:1 against their card.
    for (const [theme, glass] of [['default', '1'], ['light', '1'], ['light', '0'], ['oled', '0']]) {
      const lp = await at('s-44', { w: 320, h: 640, store: { 'hm.theme': theme, 'hm.glass': glass } })
      for (const which of ['chat', 'draft']) {
        if (which === 'draft') {
          await lp.evaluate(() => window.hermesBack())
          await lp.getByRole('button', { name: /^Sessions/ }).click()
          await lp.getByRole('button', { name: 'New chat' }).click()
          await lp.locator('.drawer.open').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
          await lp.getByRole('banner').getByText('Hermux', { exact: true }).waitFor({ timeout: 3000 }).catch(() => {})
        }
        const md = await menuOf(lp)
        const fit = await menuFits(lp, md, glass === '0')
        const rows = fit.names.map((n, i) => [n, fit.hs[i]]).filter(([n]) => n !== 'Rename')
        const tilesH = rows.filter(([n]) => /^(Search in chat|Canvas|Share chat|Pin to top|Unpin)/.test(n)).map(([, h]) => h)
        const short = rows.filter(([n, h]) => h < (tilesH.length && /^(Search in chat|Canvas|Share chat|Pin to top|Unpin)/.test(n) ? 64 : 52))
        const low = fit.colours.map(([n, fg, bg]) => [n, contrast(fg, bg)]).filter(([, c]) => c < 4.5)
        check(!fit.over && fit.grew.length === 0 && short.length === 0 && low.length === 0 && (which === 'draft' || tilesH.length === 4), `chat menu at 320 px (${theme}, glass ${glass === '1' ? 'on' : 'off'}, the ${which} menu): no label wraps under a wider font, nothing overflows, rows 52 px and quick actions 64 px or more${glass === '0' ? ', words 4.5:1' : ''} (grew ${JSON.stringify(fit.grew)}, short ${JSON.stringify(short)}, low ${JSON.stringify(low.map(([n, c]) => `${n} ${c.toFixed(2)}`))}, over ${fit.over})`)
      }
      await lp.close()
    }
    await mock({ prefsOrder: savedPrefs })
  }
}
