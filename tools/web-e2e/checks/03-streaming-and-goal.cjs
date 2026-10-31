// Streaming a long reply, opening a chat mid-reply, the goal line, editing a message Hermes no longer holds.
const fs = require('fs')
const path = require('path')
const { LOG, SHOTS, calls, rpcs, sleep, check, mock } = require('../lib.cjs')

module.exports = async t => {
  const { page } = t
  // ── #3 streaming a long code reply ───────────────────
  await page.getByPlaceholder('Message Hermes').fill('long code please')
  await page.getByRole('button', { name: 'Send' }).click()
  const more = page.locator('.codeblock-more')
  await more.waitFor({ timeout: 10000 })
  await page.locator('.codeblock-bar button', { hasText: 'Wrap' }).click()
  await more.click() // "Show all N lines" while still streaming
  await sleep(600)
  const midWrap = await page.locator('.codeblock.wrap').count()
  const midOpen = await page.locator('.codeblock:not(.collapsed)').count()
  check(midWrap === 1 && midOpen === 1, `Wrap + Show all survive further streamed updates (wrap=${midWrap}, open=${midOpen})`)
  await page.locator('.msg.assistant', { hasText: 'Done.' }).waitFor({ timeout: 15000 })
  await sleep(300)
  const txt = await page.locator('.msg.assistant').last().innerText()
  check(/line_39 = compute\(39\)/.test(txt) && (txt.match(/Here is the code/g) || []).length === 1, 'full reply rendered once, nothing lost')
  check((await page.locator('.codeblock.wrap').count()) === 1, 'Wrap still on after the reply finished')
  check((await page.locator('.codeblock .hljs-keyword, .codeblock .hljs-title, .codeblock .hljs-number').count()) > 0, 'code is highlighted')

  // ── #2 opening a chat mid-reply ──────────────────────
  await page.getByRole('button', { name: 'Sessions' }).click()
  await page.locator('.session-row', { hasText: 'Running chat' }).click()
  // The mock sends the first new delta 700 ms after the resume: the reply so far must be there before it.
  await page.locator('.msg.assistant', { hasText: 'First answer' }).waitFor({ timeout: 5000 })
  await sleep(250)
  check((await page.locator('.msg.assistant', { hasText: 'Streams are a sequence of' }).count()) === 1, 'reply so far is shown right away (before new deltas)')
  check((await page.locator('.msg.user .bubble', { hasText: 'Explain streams' }).count()) === 1, 'the running question shows once')
  check((await page.locator('.todos-head').innerText()).includes('1/2'), 'task list restored from todo_state')
  check(/1:1[5-9]/.test(await page.locator('.status-line').innerText()), `status line shows the turn's elapsed time (${JSON.stringify(await page.locator('.status-line').innerText())})`)
  check((await page.locator('.goal-line').count()) === 0, 'a chat without a goal shows no goal line')
  await sleep(1500)
  const replies = await page.locator('.msg.assistant').allInnerTexts()
  const last = replies[replies.length - 1]
  check(/^Streams are a sequence of values over time\./.test(last.trim()), `reply continues from the snapshot (${JSON.stringify(last.slice(0, 60))})`)
  check(replies.filter(r => r.includes('Streams are')).length === 1, 'no duplicate reply bubble')
  await page.screenshot({ path: path.join(SHOTS, 'hm-shot-inflight.png') })

  // ── goal line: a chat with a goal shows it under the chat; the sheet pauses it ──
  {
    await page.evaluate(() => window.hermesOpenSession('s-goal'))
    await page.locator('.goal-line').waitFor({ timeout: 5000 })
    const line = await page.locator('.goal-line').innerText()
    check(line.includes('Ship it') && line.includes('turn 3 of 20'), `goal line shows the goal and its turns (${JSON.stringify(line)})`)
    await page.locator('.goal-line').click()
    await page.locator('.sheet-title', { hasText: 'Goal' }).waitFor({ timeout: 3000 })
    check(((await page.locator('.sheet').innerText()) || '').includes('Login works'), 'the goal sheet shows the contract outcome')
    check((await page.locator('.sheet .kv').innerText()).includes('tests') || (await page.locator('.sheet').innerText()).includes('tests'), 'the goal sheet lists the subgoals')
    await page.locator('.sheet').getByRole('button', { name: 'Pause', exact: true }).click()
    await page.locator('.goal-line', { hasText: 'paused: by user' }).waitFor({ timeout: 3000 }).then(() => check(true, 'after Pause the goal line says paused: by user'), () => check(false, 'after Pause the goal line says paused: by user'))
    check(rpcs('session.control').some(c => c.params.action === 'goal.pause'), 'Pause calls session.control with goal.pause')
    check((await page.locator('.sheet').getByRole('button', { name: 'Resume', exact: true }).count()) === 1, 'a paused goal offers Resume')
    await page.keyboard.press('Escape').catch(() => {})
    await page.locator('.sheet-backdrop').click({ position: { x: 5, y: 5 } })
    await page.locator('.sheet').waitFor({ state: 'detached', timeout: 3000 }).then(() => check(true, 'tapping outside closes the goal sheet'), () => check(false, 'tapping outside closes the goal sheet'))
  }

  // ── editing a message Hermes no longer holds, with later turns: never appended at the end ──
  fs.writeFileSync(LOG, '')
  await page.getByRole('button', { name: 'Sessions' }).click()
  await page.locator('.session-row', { hasText: 'Stale edit chat' }).click()
  await page.locator('.msg.user .bubble', { hasText: 'stale first question' }).waitFor({ timeout: 5000 })
  await page.locator('.msg.user', { hasText: 'stale first question' }).getByRole('button', { name: 'Edit' }).click()
  await page.locator('.edit-box').fill('stale edited question')
  await page.locator('.edit-send').click()
  await sleep(1200)
  {
    const subs = rpcs('prompt.submit')
    check(subs.length === 1 && subs[0].params.truncate_before_row_id === 999, `only the truncating submit was sent, no plain append (${JSON.stringify(subs.map(c => c.params))})`)
    check((await page.locator('.toast', { hasText: "isn't in this chat's history" }).count()) === 1, 'the user is told why')
    const users = await page.locator('.msg.user .bubble').allInnerTexts()
    check(users.join('|') === 'stale first question|stale second question', `chat reloaded as Hermes holds it (${JSON.stringify(users)})`)
  }
}
