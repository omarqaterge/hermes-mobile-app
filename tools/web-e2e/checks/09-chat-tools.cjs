// Drafts per chat, share as Markdown, compress hint, message search, file checkpoints.
const { calls, rpcs, sleep, check } = require('../lib.cjs')

module.exports = async t => {
  const { browser, page } = t
  // ── #14 drafts are kept per chat ──
  const box = page.getByPlaceholder('Message Hermes')
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
  await page.locator('.menu-item', { hasText: 'Share chat' }).click()
  await page.locator('.toast', { hasText: 'Copied as Markdown' }).waitFor({ timeout: 3000 }).catch(() => {})
  const md = await page.evaluate(() => window.__copied)
  check(md && md.startsWith('# s-8\n') && md.includes('**You:**\n\nhello s-8') && md.includes('**Hermes:**\n\nanswer s-8'), `chat exported as Markdown (${JSON.stringify(md && md.slice(0, 90))})`)

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
  await page.getByPlaceholder('Search sessions…').fill('question 17')
  await page.locator('.hit-row', { hasText: 'Long chat' }).click({ timeout: 5000 })
  const hitMsg = page.locator('.msg.user').filter({ has: page.locator('.bubble', { hasText: /^question 17$/ }) })
  await hitMsg.waitFor({ timeout: 5000 }).catch(() => {})
  await sleep(400)
  const inView = await hitMsg.evaluate(el => { const r = el.getBoundingClientRect(), c = el.closest('.chat').getBoundingClientRect(); return r.top >= c.top && r.bottom <= c.bottom }).catch(() => false)
  check(inView, 'the hit (far above the drawn window) is scrolled into view')
  check(await hitMsg.evaluate(el => el.classList.contains('hit-flash')).catch(() => false), 'and flashes')
  check(await page.evaluate(() => CSS.highlights && CSS.highlights.has('hm-hit')), 'its words are highlighted')
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.getByPlaceholder('Search sessions…').fill('')
  await page.evaluate(() => window.hermesBack())

  // ── #20 file checkpoints: every folder the chat edited, diff, restore (folder or one file) ──
  await page.locator('header.topbar').getByRole('button', { name: 'Chat options' }).click()
  await page.locator('.menu-item', { hasText: 'File checkpoints' }).click()
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
}
