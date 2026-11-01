// Answers from a notification, several questions at once, a huge approval warning.
const { calls, rpcs, sleep, check } = require('../lib.cjs')

module.exports = async t => {
  const { page } = t
  // ── #6 answers typed into a notification (RemoteInput → HermesService → window.hermesAnswer) ──
  await page.getByRole('button', { name: 'Close canvas' }).click()
  await page.getByPlaceholder('Message Hermes').fill('ask me')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  // The question is on the sheet (the clarify tool's card in the chat shows it too, from tool.start, a moment earlier, as with Hermes).
  await page.locator('.sheet').getByText('Which colour?').waitFor({ timeout: 5000 })
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hm.lastSession') || '{}').id)
  check((await page.evaluate(s => window.hermesAnswer('ask', s, 'Blue'), stored)) === 'y', 'notification answer taken by the page')
  await sleep(400)
  const ans = calls().filter(c => c.answer === 'srv-clarify-1')
  check(ans.length === 1 && ans[0].result && ans[0].result.answer === 'Blue', `clarify answered with the typed text (${JSON.stringify(ans)})`)
  check((await page.locator('.sheet').getByText('Which colour?').count()) === 0, 'question sheet closes')
  check((await page.evaluate(s => window.hermesAnswer('ask', s, 'again'), stored)) === 'n', 'no open question → not taken (service offers to open the app)')
  check((await page.evaluate(() => window.hermesAnswer('reply', 's-7', 'sent from the notification'))) === 'y', 'notification reply taken')
  await page.locator('.msg.user .bubble', { hasText: 'sent from the notification' }).waitFor({ timeout: 5000 })
  const rs = rpcs('prompt.submit').pop()
  check(rs && rs.params.text === 'sent from the notification' && rs.params.session_id === 'rt-s-7', `reply goes to its own chat (${JSON.stringify(rs && rs.params)})`)

  // ── Several questions at once: one at a time, a single-choice pick moves on by itself ──
  await page.getByPlaceholder('Message Hermes').fill('ask me three')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  await page.getByText('Question 1 of 3').waitFor({ timeout: 5000 })
  check((await page.getByText('Colour?').count()) === 1 && (await page.getByText('Size?').count()) === 0, 'several questions: only the first is shown')
  await page.locator('.sheet .choice', { hasText: 'Blue' }).click()
  await page.getByText('Question 2 of 3').waitFor({ timeout: 1000 })
  check((await page.getByText('Size?').count()) === 1, 'several questions: picking a choice moves to the next question by itself')
  await page.locator('.sheet .choice', { hasText: 'M' }).click()
  await page.getByText('Question 3 of 3').waitFor({ timeout: 1000 })
  check(await page.locator('.sheet').getByRole('button', { name: 'Answer' }).isDisabled(), 'several questions: Answer waits for every question')
  await page.locator('.sheet').getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByText('Question 2 of 3').waitFor({ timeout: 1000 })
  check((await page.locator('.sheet .choice.on').innerText()).includes('M'), 'several questions: Back keeps the earlier choice')
  await page.getByRole('button', { name: 'Go to question 3' }).click()
  await page.getByPlaceholder('Your answer…').fill('none')
  await page.evaluate(() => window.hermesBack())
  await page.getByText('Question 2 of 3').waitFor({ timeout: 1000 })
  check(true, 'several questions: Android Back steps to the previous question')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.locator('.sheet').getByRole('button', { name: 'Answer' }).click()
  await sleep(400)
  const ans3 = calls().filter(c => c.answer === 'srv-clarify-3')
  check(ans3.length === 1 && JSON.stringify(ans3[0].result) === JSON.stringify({ answers: { a: 'Blue', b: 'M', c: 'none' } }), `several questions answered together (${JSON.stringify(ans3)})`)
  await page.getByPlaceholder('Message Hermes').waitFor({ timeout: 5000 })

  // ── A huge approval warning: buttons stay on screen, a repeated finding shows once with its count ──
  await page.getByPlaceholder('Message Hermes').fill('run the long thing')
  await page.locator('.composer').getByRole('button', { name: 'Send' }).click()
  await page.locator('.sheet .sheet-title', { hasText: 'Approve' }).waitFor({ timeout: 5000 })
  const vh = page.viewportSize().height
  // measure where the sheet comes to rest, not mid-way through its 0.18 s slide-up (that made this check flaky)
  await page.locator('.sheet').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)))
  for (const label of ['Allow once', 'Deny']) {
    const box = await page.locator('.sheet').getByRole('button', { name: label }).boundingBox()
    check(box && box.y >= 0 && box.y + box.height <= vh, `long approval: "${label}" button on screen (${JSON.stringify(box)})`)
  }
  const descText = (await page.locator('.sheet .sheet-desc').textContent()) || ''
  check(/\(×20\)/.test(descText) && descText.split('[HIGH]').length === 2, `repeated finding shown once with ×20 (${descText.slice(0, 160)})`)
  await page.locator('.sheet').getByRole('button', { name: 'Allow once' }).click()
  await sleep(400)
  const la = calls().filter(c => c.answer === 'srv-approval-long')
  check(la.length === 1 && la[0].result && la[0].result.choice === 'once', `long approval answered from its button (${JSON.stringify(la)})`)
}
