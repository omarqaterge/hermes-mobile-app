// Battery-friendly polling, the message queue, the model chip, canvas states, media URLs, unread dots.
const { MOCK, calls, rpcs, sleep, check, mock } = require('../lib.cjs')

module.exports = async t => {
  const { page } = t
  // ── battery: while the open chat's turn waits on a command, the app doesn't poll the canvas (closed) and
  //    polls the activity feed at the idle pace, not every 3 s; one poll right after the turn ends ──
  const waitMark = calls().length
  await page.getByPlaceholder('Message Hermes').fill('wait a while')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  await sleep(6500)
  const during = calls().slice(waitMark)
  const canvasPolls = during.filter(c => c.http === 'GET' && c.path === '/api/plugins/hermes-mobile/canvas').length
  const activityPolls = during.filter(c => c.path === '/api/plugins/hermes-mobile/activity').length
  check(canvasPolls === 0, `no canvas polling during a turn with the panel closed (${canvasPolls})`)
  check(activityPolls <= 1, `activity polled at the idle pace during the open chat's own turn (${activityPolls} in 6.5 s)`)
  await page.locator('.msg.assistant', { hasText: 'Waited.' }).waitFor({ timeout: 5000 })
  const endMark = calls().length
  await sleep(3500)
  check(calls().slice(endMark).some(c => c.path === '/api/plugins/hermes-mobile/activity'), 'activity polled once right after the turn (the review starts then)')

  // ── queue: a follow-up typed while Hermes works waits as a dashed bubble and is sent when the reply ends ──
  {
    const box = page.locator('.composer textarea')
    const sends = text => rpcs('prompt.submit').filter(c => c.params.text === text).length
    const steers = text => rpcs('session.steer').filter(c => c.params.text === text).length
    const doneCount = async t => page.locator('.msg.assistant', { hasText: t }).count()
    const startSlow = async () => {
      await box.fill('slow reply')
      await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
      await page.locator('.composer .send.queue, .composer .send.stop').first().waitFor({ timeout: 3000 })
    }
    const queueText = async t => {
      await box.fill(t)
      await page.locator('.composer').getByRole('button', { name: 'Queue', exact: true }).click()
    }
    // 1 + 2: queue one, it waits, then it is sent when the reply ends
    const slow0 = await doneCount('Slow done.')
    await startSlow()
    await box.fill('next one')
    check((await page.locator('.composer').getByRole('button', { name: 'Steer', exact: true }).count()) === 1 && (await page.locator('.composer').getByRole('button', { name: 'Queue', exact: true }).count()) === 1, 'running with text: Queue and Steer buttons')
    check(((await box.getAttribute('placeholder')) || '') === 'Queue or steer a follow-up…', 'running: the placeholder offers Queue or steer')
    await page.locator('.composer').getByRole('button', { name: 'Queue', exact: true }).click()
    await page.locator('.queued-msg', { hasText: 'next one' }).waitFor({ timeout: 3000 }).then(() => check(true, 'queued message shows as a dashed bubble'), () => check(false, 'queued message shows as a dashed bubble'))
    check(((await page.locator('.queued-head').first().textContent()) || '').includes('Queued · 1 of 1'), 'the bubble says Queued · 1 of 1')
    check((await box.inputValue()) === '', 'queueing clears the box')
    check(sends('next one') === 0 && steers('next one') === 0, 'nothing is sent while the reply runs')
    await page.locator('.msg.assistant', { hasText: 'Queued next one done.' }).waitFor({ timeout: 6000 }).then(() => check(true, 'the queued message is sent by itself when the reply ends'), () => check(false, 'the queued message is sent by itself when the reply ends'))
    check(sends('next one') === 1 && steers('next one') === 0, `exactly one prompt.submit with the queued text (${sends('next one')})`)
    check((await page.locator('.queued-msg').count()) === 0, 'the bubble is gone after sending')
    check((await doneCount('Slow done.')) === slow0 + 1, 'the slow reply finished first')
    {
      const meta = await page.locator('.msg.assistant', { hasText: 'Slow done.' }).first().locator('.msg-meta').innerText().catch(() => '')
      check(/ \d\.\ds/.test(' ' + meta) || /\b1s\b/.test(meta), `the reply's meta carries the turn's duration (${JSON.stringify(meta)})`)
    }

    // 3: remove one, edit another; only the edited one is sent
    await startSlow()
    await queueText('a')
    await queueText('b')
    check(((await page.locator('.queued-head').last().textContent()) || '').includes('2 of 2'), 'two queued bubbles: 1 of 2, 2 of 2')
    await page.locator('.queued-msg', { hasText: 'Queued · 1 of 2' }).getByRole('button', { name: 'Remove queued message' }).click()
    await page.locator('.queued-msg', { hasText: 'Queued · 1 of 1' }).getByRole('button', { name: 'Edit queued message' }).click()
    await page.locator('.queued-msg .edit-box').fill('c')
    await page.locator('.queued-msg').getByRole('button', { name: 'Save' }).click()
    check((await page.locator('.queued-msg .bubble', { hasText: /^c$/ }).count()) === 1, 'Edit and Save change the queued text')
    await page.locator('.msg.assistant', { hasText: 'Queued c done.' }).waitFor({ timeout: 6000 }).then(() => check(true, 'the edited message is sent'), () => check(false, 'the edited message is sent'))
    check(sends('c') === 1 && sends('a') === 0 && sends('b') === 0, `only the edited message was sent (c=${sends('c')} a=${sends('a')} b=${sends('b')})`)

    // 4: Stop pauses the queue; Resume sends it
    await startSlow()
    await queueText('d')
    await page.locator('.composer').getByRole('button', { name: 'Stop', exact: true }).click()
    await page.getByText('Queue paused').waitFor({ timeout: 4000 }).then(() => check(true, 'Stop pauses the queue (Queue paused)'), () => check(false, 'Stop pauses the queue (Queue paused)'))
    await sleep(600)
    check(sends('d') === 0 && (await page.locator('.queued-msg', { hasText: 'd' }).count()) === 1, 'a paused queue sends nothing and keeps the bubble')
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await page.locator('.msg.assistant', { hasText: 'Queued d done.' }).waitFor({ timeout: 4000 }).then(() => check(true, 'Resume sends the queued message'), () => check(false, 'Resume sends the queued message'))
    check(sends('d') === 1 && (await page.locator('.queued-msg').count()) === 0, 'Resume: one prompt.submit, bubble gone')

    // 5: Steer still works, and Send now steers the queued message
    await startSlow()
    await box.fill('steer me')
    await page.locator('.composer').getByRole('button', { name: 'Steer', exact: true }).click()
    await sleep(300)
    check(steers('steer me') === 1, 'Steer calls session.steer')
    await queueText('later')
    await page.locator('.queued-msg', { hasText: 'later' }).getByRole('button', { name: 'Send queued message now' }).click()
    await sleep(300)
    check(steers('later') === 1 && (await page.locator('.queued-msg').count()) === 0, 'Send now steers the queued message and removes it')
    await page.locator('.msg.assistant', { hasText: 'Slow done.' }).nth(slow0 + 2).waitFor({ timeout: 6000 }).catch(() => {})
    await page.locator('.composer').getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'detached', timeout: 4000 }).catch(() => {})

    // 6: a queue survives a reload and opens paused
    await startSlow()
    await queueText('e')
    await page.reload()
    await page.locator('.queued-msg', { hasText: 'e' }).waitFor({ timeout: 8000 }).then(() => check(true, 'the queue survives a reload'), () => check(false, 'the queue survives a reload'))
    check((await page.getByText('Queue paused').count()) === 1, 'after a reload the queue is paused')
    await sleep(500)
    check(sends('e') === 0, 'nothing is sent by surprise when the chat opens')
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await page.locator('.msg.assistant', { hasText: 'Queued e done.' }).waitFor({ timeout: 6000 }).then(() => check(true, 'Resume after a reload sends it'), () => check(false, 'Resume after a reload sends it'))
  }

  // ── the model Hermes reports sits above the composer; tap opens the picker ──
  const chip = page.locator('.model-chip')
  check(((await chip.textContent()) || '').includes('mock-model'), `model chip shows the chat's model (${await chip.textContent()})`)
  await chip.click()
  await page.locator('.sheet', { hasText: 'mock-sonnet' }).first().waitFor({ timeout: 3000 }).then(() => check(true, 'chip opens the model picker'), () => check(false, 'chip opens the model picker'))
  await page.evaluate(() => window.hermesBack())
  {
    const lbl = (await chip.getAttribute('aria-label')) || ''
    const m = /^Model: .*, reasoning (\w+)\. Change model$/.exec(lbl)
    check(!!m, `the chip's label names the reasoning level (${lbl})`)
    const short = { medium: 'med', minimal: 'min' }[m ? m[1] : ''] || (m ? m[1] : '')
    check(((await chip.locator('.model-chip-effort').textContent()) || '') === short, `the chip shows the reasoning level as text (${short})`)
  }

  // ── canvas: a long canvas call opens the panel on a "writing" state, then shows the document ──
  await page.getByPlaceholder('Message Hermes').fill('write canvas')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  await sleep(400)
  check((await page.locator('.canvas-panel').count()) === 0, 'a short tool call does not open the canvas')
  await page.locator('.canvas-writing .canvas-skeleton').waitFor({ timeout: 4000 }).then(() => check(true, 'still writing after a moment: panel opens with the writing state'), () => check(false, 'still writing after a moment: panel opens with the writing state'))
  check((await page.locator('.canvas-btn.writing').count()) === 1, 'the header canvas button pulses')
  await page.locator('.canvas-writing-preview', { hasText: 'Step one' }).waitFor({ timeout: 4000 }).then(() => check(true, 'the text shows once the call starts'), () => check(false, 'the text shows once the call starts'))
  await page.locator('.canvas-tab', { hasText: 'Plan' }).waitFor({ timeout: 5000 }).then(() => check(true, 'then the saved document replaces it'), () => check(false, 'then the saved document replaces it'))
  check((await page.locator('.canvas-writing').count()) === 0 && (await page.locator('.canvas-btn.writing').count()) === 0, 'writing state gone')
  // ── canvas: "Saved ✓" goes back to "<when> · <who>" (it used to stay forever) ──
  await sleep(300)
  check(/just now · Hermes/.test(await page.locator('.save-state').innerText()), `idle label says who wrote it (${await page.locator('.save-state').innerText()})`)
  await page.locator('.canvas-toolbar .seg button', { hasText: 'Edit' }).click()
  await page.locator('textarea.editor-text').fill('# Plan\n\nStep one x')
  await page.locator('.save-state', { hasText: 'Saved ✓' }).waitFor({ timeout: 3000 }).then(() => check(true, 'canvas edit shows Saved ✓'), () => check(false, 'canvas edit shows Saved ✓'))
  await sleep(2600)
  {
    const s = await page.locator('.save-state').innerText()
    check(/just now · You/.test(s), `"Saved ✓" returns to "just now · You" (${s})`)
  }
  await page.locator('.canvas-x').click()

  // ── #12 media streams through the shell's URL (no base64 through /api/files/read) ──
  await page.evaluate(() => (window.HermesAndroid = { mediaBase: () => window.__hmMockBase + '/m?k=K&p=' }))
  await page.getByPlaceholder('Message Hermes').fill('show media')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  const img = page.locator('img.media').last()
  await img.waitFor({ state: 'attached', timeout: 5000 })
  await img.evaluate(i => i.scrollIntoView())
  await page.waitForFunction(() => { const i = [...document.querySelectorAll('img.media')].pop(); return i && i.complete && i.naturalWidth > 0 }, null, { timeout: 5000 }).catch(() => {})
  const src = await img.getAttribute('src')
  check(src === MOCK + '/m?k=K&p=' + encodeURIComponent('/root/pics/my pic.png'), `image uses the streamed URL (${src})`)
  check(await img.evaluate(i => i.naturalWidth > 0), 'streamed image loads')
  check(!calls().some(c => c.path === '/api/files/read'), 'nothing read as base64')
  await page.evaluate(() => delete window.HermesAndroid)

  // ── #13 unread dot + time ago: a reply finishes in another chat while the app is open ──
  check((await page.locator('.unread-dot').count()) === 0, 'nothing unread at first, nor after "Show older chats"')
  await mock({ activity: [{ session: 's-9', text: 'Thinking…', short: 'Thinking', profile: 'default', review: false, ts: Date.now() / 1000 }] })
  // The feed is polled every 9 s while empty (#34), then every 3 s while something runs.
  await page.locator('.activity-banner').first().waitFor({ timeout: 12000 }).then(() => check(true, 'activity banner within one idle poll'), () => check(false, 'activity banner within one idle poll'))
  await sleep(500)
  await mock({ activity: [], bump: 's-9', newChat: 's-fresh' }) // a reply lands in s-9 and a new chat appears
  await page.locator('.unread-dot.on-menu').waitFor({ timeout: 8000 }).then(() => check(true, 'menu button shows an unread dot'), () => check(false, 'menu button shows an unread dot'))
  await page.getByRole('button', { name: /^Sessions/ }).click()
  const row9 = page.locator('.session-row').filter({ has: page.locator('.session-title', { hasText: /^Chat 9$/ }) })
  check((await row9.locator('.unread-dot').count()) === 1, 'the chat with the new reply has a dot')
  check(/^now · 4 msgs/.test((await row9.locator('.dim.small').textContent()) || ''), `row shows when it changed (${await row9.locator('.dim.small').textContent()})`)
  check(/^\d+ h · /.test((await page.locator('.session-row').filter({ has: page.locator('.session-title', { hasText: /^Chat 12$/ }) }).locator('.dim.small').textContent()) || ''), 'older chats show hours ago')
  // A chat that got a reply (or a message) keeps its place: Hermes lists it first, the drawer must not.
  const titles = async () => page.locator('.drawer .session-row .session-title').allInnerTexts()
  let tl = await titles()
  const i9 = tl.indexOf('Chat 9')
  check(i9 > 0 && tl[i9 - 1] === 'Chat 8' && tl[i9 + 1] === 'Chat 10', `a chat with new activity keeps its place (${tl.slice(0, 4)}…)`)
  check(tl[0] === 'Brand new chat' && tl.indexOf('Chat 9') === tl.indexOf('Chat 8') + 1, `a new chat appears on top, the others stay (${tl.slice(0, 4)}…)`)
  await row9.click()
  await page.locator('.msg.assistant', { hasText: 'answer s-9' }).waitFor({ timeout: 5000 })
  check((await page.locator('.unread-dot').count()) === 0, 'opening the chat clears the dot')
}
