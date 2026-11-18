// The pause on the request sheet (spec 3.6): a tap meant for one request never answers the next, which appears with its
// buttons in the same place. These checks wait out the pause many times, so they have a file of their own at the end: in
// 05 they kept the shared page idle past the 45 s after which the app re-syncs a running chat, which changed what 06 sees.
const { calls, rpcs, sleep, check, nativeShell, setMotion, WEB } = require('../lib.cjs')

module.exports = async t => {
  const page = await t.browser.newPage({ viewport: { width: 360, height: 740 } })
  await page.addInitScript(nativeShell)
  await page.addInitScript(() => {
    const orig = WebSocket.prototype.send
    WebSocket.prototype.send = function (d) {
      window.__ws = this
      return orig.call(this, d)
    }
  })
  await page.goto(WEB + '/')
  await page.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
  await page.getByPlaceholder('Message Hermux').fill('hello there')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await sleep(300)
  const live = rpcs('prompt.submit').pop().params.session_id
  const sheet = page.getByRole('dialog')
  const frame = f => page.evaluate(f => window.__ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', ...f }) })), f)

  // A tap meant for one request never answers the next, which appears with its buttons in the same place.
  const answers = id => calls().filter(c => c.answer === id)
  const asksToRun = (id, command) => ({ id, method: 'approval', params: { session_id: live, command, description: '', choices: ['once', 'deny'] } })
  const allowOnce = sheet.getByRole('button', { name: 'Allow once' })
  const settle = () => sleep(800) // longer than the pause, and than any sheet's arrival
  // In the page, so the time between the taps is the time asked for even on a busy machine: taps Allow once, waits,
  // taps what is then at the same spot, and says how long after the first tap the second came.
  const doubleTap = gap => page.evaluate(async gap => {
    const allow = [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Allow once')
    const r = allow.getBoundingClientRect()
    const x = r.left + r.width / 2, y = r.top + r.height / 2
    const t0 = performance.now()
    allow.click()
    await new Promise(done => setTimeout(done, gap))
    document.elementFromPoint(x, y).click()
    return performance.now() - t0
  }, gap)
  for (const level of ['off', 'reduced', 'full']) {
    await setMotion(page, level)
    for (const gap of [60, 300, 600]) {
      const [first, second] = [`srv-tap-${level}-${gap}-1`, `srv-tap-${level}-${gap}-2`]
      await settle()
      await frame(asksToRun(first, 'first command'))
      await frame(asksToRun(second, 'second command'))
      await sheet.getByText('first command').waitFor({ timeout: 3000 })
      await settle()
      const took = await doubleTap(gap)
      await sheet.getByText('second command').waitFor({ timeout: 3000 })
      await sleep(100)
      check(answers(first).length === 1 && answers(first)[0].result.choice === 'once', `sheet pause: the first tap answers the first request (${level}, ${gap} ms)`)
      check(took >= 690 || answers(second).length === 0, `sheet pause: a second tap ${gap} ms later does not allow the next request (${level}, it came after ${Math.round(took)} ms)`)
      await settle()
      await allowOnce.click()
      await sheet.waitFor({ state: 'detached', timeout: 3000 })
      await sleep(100)
      check(answers(second).length === 1 && answers(second)[0].result.choice === 'once', `sheet pause: a tap after the pause allows it (${level}, ${gap} ms)`)
    }
  }
  await setMotion(page, 'off')
  // A real double tap, through the pointer.
  await settle()
  await frame(asksToRun('srv-tap-real-1', 'first command'))
  await frame(asksToRun('srv-tap-real-2', 'second command'))
  await sheet.getByText('first command').waitFor({ timeout: 3000 })
  await settle()
  const spot = await allowOnce.boundingBox()
  await page.mouse.dblclick(spot.x + spot.width / 2, spot.y + spot.height / 2)
  await sheet.getByText('second command').waitFor({ timeout: 3000 })
  await sleep(100)
  check(answers('srv-tap-real-1').length === 1 && answers('srv-tap-real-2').length === 0, 'sheet pause: a real double tap answers only the first request')
  await sheet.getByRole('button', { name: 'Deny' }).click() // Deny works during the pause
  await sheet.waitFor({ state: 'detached', timeout: 3000 })
  await sleep(100)
  check(answers('srv-tap-real-2').length === 1 && answers('srv-tap-real-2')[0].result.choice === 'deny', 'sheet pause: Deny works at once')
  // The first sheet after none is not delayed.
  await settle()
  await frame(asksToRun('srv-tap-first', 'only command'))
  await sheet.getByText('only command').waitFor({ timeout: 3000 })
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Allow once').click())
  await sheet.waitFor({ state: 'detached', timeout: 3000 })
  await sleep(100)
  check(answers('srv-tap-first').length === 1, 'sheet pause: the first sheet after none answers at once')
  // The other kinds: every answer waits, only a refusal goes through.
  const afterAllow = (labels, fill) => page.evaluate(async ({ labels, fill }) => {
    const button = t => [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === t)
    button('Allow once').click()
    await new Promise(requestAnimationFrame)
    if (fill) {
      const input = document.querySelector('[role="dialog"] input, [role="dialog"] textarea')
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, fill)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(requestAnimationFrame)
    }
    const t0 = performance.now()
    for (const l of labels) button(l)?.click()
    return performance.now() - t0
  }, { labels, fill })
  await settle()
  await frame(asksToRun('srv-kind-1', 'first command'))
  await frame({ id: 'srv-kind-q', method: 'clarify', params: { session_id: live, question: 'Pick one?' } })
  await sheet.getByText('first command').waitFor({ timeout: 3000 })
  await settle()
  await afterAllow(['Skip'])
  await sheet.getByText('Pick one?').waitFor({ timeout: 3000 })
  await sleep(100)
  check(answers('srv-kind-q').length === 0, 'sheet pause: Skip waits on a question that took over')
  await settle()
  await sheet.getByRole('button', { name: 'Skip' }).click()
  await sheet.waitFor({ state: 'detached', timeout: 3000 })
  await sleep(100)
  check(answers('srv-kind-q').length === 1, 'sheet pause: Skip works after the pause')
  await settle()
  await frame(asksToRun('srv-kind-2', 'first command'))
  await frame({ id: 'srv-kind-p', method: 'sudo', params: { session_id: live, command: 'x' } })
  await sheet.getByText('first command').waitFor({ timeout: 3000 })
  await settle()
  await afterAllow(['Send'], 'secret')
  await sheet.getByRole('button', { name: 'Send' }).waitFor({ timeout: 3000 })
  await sleep(100)
  check(answers('srv-kind-p').length === 0, 'sheet pause: Send waits on a password request that took over')
  await sheet.getByRole('button', { name: 'Cancel' }).click() // refusing is never held back
  await sheet.waitFor({ state: 'detached', timeout: 3000 })
  await sleep(100)
  check(answers('srv-kind-p').length === 1 && !!answers('srv-kind-p')[0].error, 'sheet pause: Cancel works during the pause')
  await settle()
  await frame(asksToRun('srv-kind-3', 'first command'))
  await frame({ id: 'srv-kind-a', method: 'clarify', params: { session_id: live, question: 'Say something?' } })
  await sheet.getByText('first command').waitFor({ timeout: 3000 })
  await settle()
  await afterAllow(['Answer'], 'typed at once')
  await sheet.getByText('Say something?').waitFor({ timeout: 3000 })
  await sleep(100)
  check(answers('srv-kind-a').length === 0, 'sheet pause: Answer waits on a question that took over')
  await settle()
  await sheet.getByRole('button', { name: 'Answer' }).click()
  await sheet.waitFor({ state: 'detached', timeout: 3000 })
  await sleep(100)
  check(answers('srv-kind-a').length === 1 && answers('srv-kind-a')[0].result.answer === 'typed at once', 'sheet pause: Answer works after the pause')
  // A phone data request: its Allow once would ask the shell for a grant, so nothing may even start.
  await settle()
  await frame(asksToRun('srv-kind-4', 'first command'))
  const readArgs = Buffer.from(JSON.stringify({ query: 'Ann', limit: 5 })).toString('hex')
  await frame({ id: 'srv-kind-d', method: 'approval', params: { session_id: live, command: '<phone_data> (plugin approval rule)', description: `phone_data:v1:contacts:0123456789ab:${readArgs}`, choices: ['once', 'deny'] } })
  await sheet.getByText('first command').waitFor({ timeout: 3000 })
  await settle()
  await afterAllow(['Allow once'])
  await sheet.getByText('Let Hermux read your phone?').waitFor({ timeout: 3000 })
  await sleep(100)
  check((await page.getByText('Can’t allow phone data here').count()) === 0 && answers('srv-kind-d').length === 0, 'sheet pause: a phone data Allow waits too')
  await sheet.getByRole('button', { name: 'Deny' }).click()
  await sheet.waitFor({ state: 'detached', timeout: 3000 })
  await settle()

  // The pause must not run out while nobody can see the sheet: it starts again when the app comes back.
  const tapAllowOnReturn = how => page.evaluate(how => {
    if (how === 'page') {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    } else window.hermesResume()
    ;[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Allow once').click()
  }, how)
  for (const how of ['page', 'shell']) {
    const [one, two] = [`srv-back-${how}-1`, `srv-back-${how}-2`]
    await frame(asksToRun(one, 'first command'))
    await frame(asksToRun(two, 'second command'))
    await sheet.getByText('first command').waitFor({ timeout: 3000 })
    await settle()
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      window.hermesPause()
      ;[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Allow once').click()
    })
    await sheet.getByText('second command').waitFor({ timeout: 3000 })
    await settle() // the pause has run out, unseen
    if (how === 'shell') await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }))
    await tapAllowOnReturn(how)
    await sleep(100)
    check(answers(one).length === 1 && answers(two).length === 0, `sheet pause: a tap right after coming back does not allow the request that took over while away (${how})`)
    await settle()
    await allowOnce.click()
    await sheet.waitFor({ state: 'detached', timeout: 3000 })
    await sleep(100)
    check(answers(two).length === 1, `sheet pause: a tap a moment after coming back works (${how})`)
    await settle()
  }
  await page.close()
}
