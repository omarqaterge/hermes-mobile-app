// Sub-agents (spec 3.3, 3.6, 3.13; docs/decisions/nested-chats.md): the one-line group in the chat, the sub-agent's sheet, the
// rows under a chat in the list, and what a sub-agent may say on the request sheet. Events are put on the page's socket, as
// Hermes sends them; everything is found by role, name and visible text.
const { WEB, MOCK, calls, rpcs, sleep, check, mock, nativeShell, setMotion, trayTucked } = require('../lib.cjs')

const CHAT = 's-48'
const LIVE = 'rt-s-48'
const GROUP = /^(Used )?\d+ sub-agents?( ·|$)/ // the group's one line
const stamp = n => Date.now() / 1000 - n

module.exports = async t => {
  const open = async (chat = CHAT, viewport = { width: 360, height: 740 }, init) => {
    const page = await t.browser.newPage({ viewport })
    await page.addInitScript(nativeShell)
    await page.addInitScript(() => Object.assign(window.HermesAndroid, { phoneDataTainted: () => false })) // the app's record: nothing read
    await page.addInitScript(trayTucked)
    await page.addInitScript(chat => {
      localStorage.setItem('hm.lastSession', JSON.stringify({ id: chat, profile: 'default' }))
      const orig = WebSocket.prototype.send
      WebSocket.prototype.send = function (d) {
        window.__ws = this
        return orig.call(this, d)
      }
    }, chat)
    if (init) await page.addInitScript(init)
    await page.goto(WEB + '/')
    await page.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await sleep(700)
    return page
  }
  const framer = page => f => page.evaluate(f => window.__ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', ...f }) })), f)
  const eventsOn = (page, chat = CHAT) => {
    const frame = framer(page)
    return async (type, payload) => frame({ method: 'event', params: { type, session_id: chat, payload } })
  }
  const sub = (id, goal, more = {}) => ({ goal, task_count: 3, task_index: 0, subagent_id: id, child_session_id: `kid-${id}`, delegation_id: 'd1', depth: 0, model: 'anthropic/haiku-4', tool_count: 0, ...more })
  const row = (id, goal, more = {}) => ({ id: `kid-${id}`, parent: CHAT, goal, model: 'anthropic/haiku-4', effort: 'high', started: stamp(60), ended: 0, reason: '', messages: 3, ...more })

  await mock({ nested: 'reset' })
  const roster = (id, goal, more = {}) => ({ subagent_id: id, parent_id: null, depth: 0, goal, delegation_id: 'd1', model: 'anthropic/haiku-4', started_at: stamp(30), status: 'running', tool_count: 1, last_tool: 'terminal', accepting_steer: true, ...more })
  await mock({ nested: { children: { [CHAT]: [row('a', 'Read the docs', { effort: 'low' }), row('b', 'Write the report'), row('c', 'Check one link', { parent: 'kid-a' })] }, roster: [roster('a', 'Read the docs'), roster('c', 'Check one link', { parent_id: 'a', depth: 1 })] } })

  // ── the group in the chat ──
  const page = await open()
  const ev = eventsOn(page)
  await ev('session.info', { reasoning_effort: 'low' })
  await ev('subagent.start', sub('a', 'Read the docs', { text: 'Read the docs' }))
  await ev('subagent.start', sub('b', 'Write the report'))
  await ev('subagent.start', sub('c', 'Check one link', { parent_id: 'a', depth: 1 }))
  await ev('subagent.tool', sub('a', 'Read the docs', { tool_name: 'terminal', tool_preview: 'cat README.md', text: 'cat README.md', tool_count: 1 }))
  await ev('subagent.complete', sub('b', 'Write the report', { status: 'completed', summary: 'Wrote it.', duration_seconds: 12, input_tokens: 1200, output_tokens: 300, api_calls: 3 }))
  const group = page.getByRole('button', { name: GROUP })
  await group.waitFor({ timeout: 3000 })
  check(/^3 sub-agents · 1 done/.test((await group.innerText()).trim()), `sub-agents: running, the group says how many and how many are done (${await group.innerText()})`)
  check((await group.boundingBox()).height <= 46, 'sub-agents: closed, the group is one line')
  check((await page.getByText('Read the docs').count()) === 0, 'sub-agents: closed, no goal shows')
  await group.click()
  const rowOf = name => page.getByRole('button', { name })
  await rowOf(/Read the docs/).waitFor({ timeout: 3000 })
  await sleep(300)
  check(/haiku-4 · low/.test(await rowOf(/Read the docs/).innerText()) && /Working/.test(await rowOf(/Read the docs/).innerText()), `sub-agents: opened, a row has the goal, the model's short name, the level and a plain state (${await rowOf(/Read the docs/).innerText()})`)
  check(/Done/.test(await rowOf(/Write the report/).innerText()) && !/completed/.test(await rowOf(/Write the report/).innerText()), 'sub-agents: the raw status word is gone')
  check(/cat README\.md/.test(await rowOf(/Read the docs/).innerText()) && !/\n.*Wrote/.test(await rowOf(/Write the report/).innerText()), 'sub-agents: the current step shows only for one that runs')
  const textLeft = async name => page.getByText(name, { exact: true }).evaluate(e => e.getBoundingClientRect().left)
  check((await textLeft('Check one link')) > (await textLeft('Read the docs')), 'sub-agents: one started by another is indented under it')
  const order = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent).filter(t => /Read the docs|Check one link|Write the report/.test(t)).map(t => t.match(/Read the docs|Check one link|Write the report/)[0]))
  check(order.join() === 'Read the docs,Check one link,Write the report', `sub-agents: a nested one stands right under its parent (${order})`)

  // ── a malformed event breaks nothing ──
  for (const bad of [null, 7, { subagent_id: {}, goal: 9 }, { subagent_id: 'x1', goal: { a: 1 }, depth: 'deep', tool_count: 'many', files_read: 2, model: [] }]) await ev('subagent.tool', bad)
  await sleep(200)
  check(await page.getByPlaceholder('Message Hermux').isVisible(), 'sub-agents: malformed events break nothing')
  await ev('subagent.start', sub('m', '<img src=x onerror=alert(1)> **bold** [a](http://x.test)'))
  await sleep(200)
  const markup = await page.evaluate(() => ({ imgs: document.querySelectorAll('button img').length, shown: [...document.querySelectorAll('button')].some(b => b.textContent.includes('<img src=x onerror=alert(1)> **bold**')) }))
  check(markup.imgs === 0 && markup.shown, 'sub-agents: a goal is plain text, never Markdown or HTML')
  await ev('subagent.complete', sub('m', '', { status: 'completed' }))
  await ev('subagent.complete', { subagent_id: 'x1', status: 'completed' })
  await ev('subagent.complete', { subagent_id: 't0', status: 'completed' })

  // ── the sheet ──
  const sheet = page.getByRole('dialog', { name: 'Sub-agent' })
  const tails = () => rpcs('subagent.tail').length
  await mock({ nested: { tail: 'first line of output' } })
  await rowOf(/Read the docs/).click()
  await sheet.waitFor({ timeout: 3000 })
  await sheet.getByText('first line of output').waitFor({ timeout: 3000 })
  const inView = async text => {
    const b = await sheet.getByText(text, { exact: true }).boundingBox()
    return b && b.y >= 0 && b.y + b.height <= 740
  }
  check((await inView('Model')) && (await inView('anthropic/haiku-4')) && (await inView('Reasoning')), 'sub-agent sheet: the model and the reasoning level show without scrolling at 360 x 740')
  await sheet.getByText('same as the chat', { exact: false }).waitFor({ timeout: 3000 })
  check(/Low/.test(await sheet.innerText()), 'sub-agent sheet: the level in words, "same as the chat" when it follows the chat')
  check(/Sub-agent of /.test(await sheet.innerText()) && /Working/.test(await sheet.innerText()), 'sub-agent sheet: under the goal, whose sub-agent it is and its state')
  check(!/goal: hidden/.test(await sheet.innerText()), 'sub-agent sheet: the live output leaves out the transcript\'s header')
  const top = async () => (await sheet.boundingBox()).y
  const half = await top()
  check(half > 740 * 0.38 && half < 740 * 0.56, `sub-agent sheet: it opens at about half the screen (top at ${Math.round(half)})`)
  const dragBy = async dy => {
    const y = (await top()) + 18
    await page.mouse.move(180, y)
    await page.mouse.down()
    await page.mouse.move(180, y + dy / 2, { steps: 3 })
    await page.mouse.move(180, y + dy, { steps: 3 })
    await page.mouse.up()
    await sleep(350)
  }
  await dragBy(-260)
  const high = await top()
  check(high >= 57 && high < 100, `sub-agent sheet: pulled up it leaves the chat's header showing, never the whole screen (top at ${Math.round(high)})`)
  await dragBy(-300)
  check((await top()) >= 57, 'sub-agent sheet: pulling further changes nothing')
  await dragBy(200)
  check(Math.abs((await top()) - half) < 12, 'sub-agent sheet: pulled down it goes back to half')

  // the output is read at most every 3 s, while the sheet is open and the app on screen
  const c0 = tails(), t0 = Date.now()
  await sleep(3500)
  const read = tails() - c0
  check(read >= 1 && read <= 2, `sub-agent sheet: the output is read about every 3 s (${read} reads in ${Date.now() - t0} ms)`)
  check(rpcs('subagent.tail').at(-1).params.session_id === LIVE && rpcs('subagent.tail').at(-1).params.subagent_id === 'a', 'sub-agent sheet: it asks for this sub-agent in this chat')
  const setHidden = hidden => page.evaluate(h => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
  await setHidden(true)
  await sleep(100)
  const c1 = tails()
  await sleep(3400)
  check(tails() === c1, 'sub-agent sheet: nothing is read while the app is away')
  await setHidden(false)
  await sleep(400)
  check(tails() > c1, 'sub-agent sheet: reading goes on when the app returns')

  // steer
  const field = sheet.getByRole('textbox', { name: 'Tell it something' })
  await field.fill('Look at the changelog too')
  await sheet.getByRole('button', { name: 'Send', exact: true }).click()
  await sleep(200)
  const steer = rpcs('subagent.steer').at(-1)
  check(steer?.params.subagent_id === 'a' && steer?.params.text === 'Look at the changelog too' && (await field.inputValue()) === '', 'sub-agent sheet: "Tell it something" sends subagent.steer')
  await mock({ nested: { steer: 'rejected' } })
  await field.fill('Too late')
  await sheet.getByRole('button', { name: 'Send', exact: true }).click()
  await sleep(250)
  check((await field.count()) === 0, 'sub-agent sheet: the field goes when it stops taking messages')
  await mock({ nested: { steer: 'queued' } })
  check((await sheet.getByRole('button', { name: /allow|approve/i }).count()) === 0, 'sub-agent sheet: nothing can be approved here')

  // its own sub-agents, and back
  await sheet.getByRole('button', { name: /Check one link/ }).click()
  await sheet.getByText(/Sub-agent of “Read the docs”/).waitFor({ timeout: 3000 })
  check(await sheet.getByRole('button', { name: 'Back' }).isVisible(), 'sub-agent sheet: a nested one replaces the content, with a back arrow')
  await sheet.getByRole('button', { name: 'Back' }).click()
  await sheet.getByText(/Sub-agent of (?!“)/).waitFor({ timeout: 3000 })
  check((await sheet.getByRole('button', { name: 'Back' }).count()) === 0, 'sub-agent sheet: back returns to the one before')

  // stop, after asking
  const stops = () => rpcs('subagent.interrupt').length
  const n = stops()
  await sheet.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByRole('button', { name: 'Keep it running' }).click()
  await sleep(150)
  check(stops() === n, 'sub-agent sheet: Stop asks first, and "Keep it running" stops nothing')
  await sheet.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByRole('button', { name: 'Keep it running' }).locator('xpath=..').getByRole('button', { name: 'Stop', exact: true }).click()
  await sheet.getByText('Stopped', { exact: true }).waitFor({ timeout: 3000 })
  check(stops() === n + 1 && rpcs('subagent.interrupt').at(-1).params.subagent_id === 'a', 'sub-agent sheet: confirmed, it sends subagent.interrupt and shows Stopped')
  check((await sheet.getByRole('button', { name: 'Stop', exact: true }).count()) === 0 && (await sheet.getByRole('textbox').count()) === 0, 'sub-agent sheet: an ended one has no Stop and no field')
  await page.evaluate(() => window.hermesBack())
  await sleep(200)
  const c2 = tails()
  await sleep(3300)
  check((await sheet.count()) === 0 && tails() === c2, 'sub-agent sheet: Back closes it, and nothing more is read')

  // finished: steps, summary, a new chat from it, the settings link
  await mock({ nested: { messages: { 'kid-b': [{ role: 'user', content: 'Write the report' }, { role: 'assistant', content: '', tool_calls: JSON.stringify([{ function: { name: 'write_file', arguments: '{"path":"report.md"}' } }]) }, { role: 'assistant', content: 'Wrote it.' }] } } })
  await rowOf(/Write the report/).click()
  await sheet.getByText('write_file: report.md').waitFor({ timeout: 3000 })
  const body = await sheet.innerText()
  check(/Wrote it\./.test(body) && /3 steps · 1\.2k in · 300 out/.test(body), `sub-agent sheet: finished, its steps, summary and numbers (${body.slice(0, 160)})`)
  check(await sheet.getByRole('button', { name: 'Continue in a new chat' }).isVisible(), 'sub-agent sheet: a finished one can go on in a new chat')
  await sheet.getByRole('button', { name: 'Sub-agent settings' }).click()
  await page.getByRole('heading', { name: 'Behaviour' }).or(page.getByText('Behaviour', { exact: true }).first()).waitFor({ timeout: 3000 })
  check((await sheet.count()) === 0, 'sub-agent sheet: "Sub-agent settings" leads to the settings')
  await page.evaluate(() => window.hermesBack())
  await sleep(300)
  await page.evaluate(() => window.hermesBack())
  await sleep(300)

  // a level set for all sub-agents isn't "same as the chat"
  await fetch(MOCK + '/api/config', { method: 'PUT', body: JSON.stringify({ config: { delegation: { reasoning_effort: 'low' } } }) })
  await rowOf(/Read the docs/).waitFor({ timeout: 3000 })
  await rowOf(/Read the docs/).click()
  await sheet.getByText('Low', { exact: false }).first().waitFor({ timeout: 3000 })
  await sleep(300)
  check(!/same as the chat/.test(await sheet.innerText()), 'sub-agent sheet: with a level set for sub-agents it doesn\'t say "same as the chat"')
  await fetch(MOCK + '/api/config', { method: 'PUT', body: JSON.stringify({ config: { delegation: { reasoning_effort: '' } } }) })
  await page.evaluate(() => window.hermesBack())
  await sleep(200)

  // the end of the group
  await ev('subagent.complete', sub('c', 'Check one link', { parent_id: 'a', depth: 1, status: 'failed', duration_seconds: 4 }))
  await sleep(200)
  const ended = (await group.innerText()).trim()
  check(/^Used \d+ sub-agents/.test(ended) && /1 failed/.test(ended), `sub-agents: finished, the group folds to "Used N sub-agents" and keeps the failure (${ended})`)
  await group.click()
  await sleep(100)
  check((await page.getByText('Check one link', { exact: true }).count()) === 0 && /1 failed/.test(await group.innerText()), 'sub-agents: closed again, the failure still shows')
  await page.close()

  // ── what a sub-agent may say on the request sheet ──
  {
    const p = await open()
    const e = eventsOn(p)
    const frame = framer(p)
    const req = p.getByRole('dialog')
    // `open` is high so that requests answered a moment ago (waiting.ts holds them back for a few seconds) don't use it up.
    const entry = who => ({ session: CHAT, kind: 'approval', who, profile: '', since: stamp(2), until: stamp(-200), open: 50, last: stamp(2) })
    let seq = 0
    // Puts the request up with this feed, and gives the feed its one read after a new request.
    const ask = async (command, feed) => {
      await mock({ waiting: feed })
      await frame({ id: `srv-q${++seq}`, method: 'approval', params: { session_id: LIVE, command, description: 'world writable', choices: ['once', 'deny'] } })
      await req.getByText(command).waitFor({ timeout: 3000 })
      await sleep(700)
      return req.innerText()
    }
    const deny = async () => {
      await req.getByRole('button', { name: 'Deny' }).click()
      await sleep(150)
      await mock({ waiting: [] })
    }
    const NAMED = /Asked by the sub-agent working on/
    const FIXED = /Asked by a sub-agent/
    // A sub-agent is named only when it is the one running: each case ends its own before the next.
    const end = (id, goal) => e('subagent.complete', sub(id, goal, { status: 'completed' }))
    await e('subagent.tool', sub('q', 'Tidy the folder', { tool_name: 'terminal', tool_preview: 'chmod 777 x', text: 'chmod 777 x' }))
    let text = await ask('chmod 777 x', [entry('A sub-agent')])
    check(/Asked by the sub-agent working on “Tidy the folder”/.test(text), `request sheet: the feed and the command agree, so it names the sub-agent (${text.slice(0, 120)})`)
    check(text.indexOf('chmod 777 x') < text.indexOf('Asked by'), 'request sheet: who asks comes after the command')
    const look = await req.getByText(NAMED).evaluate(el => ({ font: getComputedStyle(el).fontFamily, code: getComputedStyle([...document.querySelectorAll('[role=dialog] *')].find(x => x.children.length === 0 && x.textContent === 'chmod 777 x').closest('pre')).fontFamily, isolated: !!el.querySelector('bdi') }))
    check(look.font !== look.code && look.isolated, `request sheet: the goal is in ordinary type, isolated, not in the command's (${look.font})`)
    await deny()
    await e('subagent.tool', sub('q2', 'Second one', { tool_name: 'terminal', tool_preview: 'ls' }))
    text = await ask('chmod 777 x', [entry('A sub-agent')])
    check(!NAMED.test(text) && FIXED.test(text), 'request sheet: with another sub-agent running too, nobody is named, even one that ran another command')
    await deny()
    await end('q2', 'Second one')
    text = await ask('chmod 777 x', [{ ...entry('A sub-agent'), since: stamp(40), last: stamp(40) }])
    check(!NAMED.test(text) && !FIXED.test(text), 'request sheet: a feed entry about an earlier request names nobody (the chat itself may be asking)')
    await deny()
    await end('q', 'Tidy the folder')
    await e('subagent.tool', sub('w', 'Search the web', { tool_name: 'web_search', tool_preview: 'chmod 777 web', text: 'chmod 777 web' }))
    text = await ask('chmod 777 web', [entry('A sub-agent')])
    check(!NAMED.test(text) && FIXED.test(text), 'request sheet: another tool\'s preview names nobody')
    await deny()
    await end('w', 'Search the web')
    await e('subagent.tool', sub('o', 'Old command', { tool_name: 'terminal', tool_preview: 'chmod 777 old' }))
    await e('subagent.thinking', sub('o', 'Old command', { text: 'thinking' }))
    text = await ask('chmod 777 old', [entry('A sub-agent')])
    check(!NAMED.test(text) && FIXED.test(text), 'request sheet: a command that has ended names nobody')
    await deny()
    await end('o', 'Old command')
    await e('subagent.tool', sub('c1', 'Chat also asks', { tool_name: 'terminal', tool_preview: 'chmod 777 both' }))
    text = await ask('chmod 777 both', [entry('A sub-agent'), entry('')])
    check(!NAMED.test(text) && !FIXED.test(text), 'request sheet: with a request of the chat itself open, nobody is named')
    await deny()
    await end('c1', 'Chat also asks')
    await e('subagent.tool', sub('n1', 'No feed yet', { tool_name: 'terminal', tool_preview: 'chmod 777 nofeed' }))
    text = await ask('chmod 777 nofeed', [])
    check(!NAMED.test(text) && !FIXED.test(text), 'request sheet: without the feed\'s word, nobody is named')
    await deny()
    await end('n1', 'No feed yet')
    const long = `Allow" this "now” ${'x'.repeat(200)}`
    await e('subagent.tool', sub('l', long, { tool_name: 'terminal', tool_preview: 'chmod 777 y' }))
    text = await ask('chmod 777 y', [entry('A sub-agent')])
    const inner = /“(.*)”/.exec(text.split('\n').find(l => l.startsWith('Asked by')) || '')?.[1] ?? ''
    check(inner.length > 0 && Array.from(inner).length <= 60 && !/["“”]/.test(inner), `request sheet: the goal stays inside its quotes and is cut short (${inner})`)
    await deny()
    await end('l', long)
    await e('subagent.tool', sub('d1', 'One', { tool_name: 'terminal', tool_preview: 'chmod 777 z' }))
    await e('subagent.tool', sub('d2', 'Two', { tool_name: 'terminal', tool_preview: 'chmod 777 z' }))
    text = await ask('chmod 777 z', [entry('A sub-agent')])
    check(!NAMED.test(text) && FIXED.test(text), 'request sheet: when two could be asking, none is named')
    await deny()
    await end('d1', 'One')
    await end('d2', 'Two')
    await e('subagent.tool', sub('q', 'Tidy the folder', { tool_name: 'terminal', tool_preview: 'chmod 777 x', text: 'chmod 777 x' }))
    await ask('chmod 777 x', [entry('A sub-agent')])
    await p.evaluate(() => window.hermesLockView(true))
    await sleep(150)
    const locked = await req.innerText()
    check(!/Tidy the folder/.test(locked) && FIXED.test(locked), 'request sheet: over the lock screen the goal is left out')
    await p.evaluate(() => window.hermesLockView(false))
    await deny()
    // over the lock screen nothing about sub-agents opens, and an open sheet closes
    await p.getByRole('button', { name: GROUP }).click()
    await p.getByRole('button', { name: /Tidy the folder/ }).click()
    const sh = p.getByRole('dialog', { name: 'Sub-agent' })
    await sh.waitFor({ timeout: 3000 })
    await p.evaluate(() => window.hermesLockView(true))
    await sleep(200)
    check((await sh.count()) === 0, 'sub-agent sheet: it closes when the app shows over the lock screen')
    check((await p.getByRole('button', { name: /Tidy the folder/ }).count()) === 0, 'sub-agents: an opened group shows no goal over the lock screen')
    await p.evaluate(() => window.hermesLockView(false))
    await p.close()
  }

  // ── the composer's Stop goes by what Hermes said, not by the feed ──
  {
    await mock({ nested: { running: [{ session: CHAT, running: 5 }] } })
    const p = await open()
    const stop = p.getByRole('button', { name: 'Stop', exact: true })
    const e = eventsOn(p)
    await sleep(500)
    check((await stop.count()) === 0, 'Stop: a count in the feed alone does not bring it up')
    await mock({ nested: { running: [] } })
    await e('subagent.start', sub('s1', 'Runs on'))
    await stop.waitFor({ timeout: 3000 })
    await p.evaluate(() => window.hermesLockView(true))
    const stops = rpcs('session.interrupt').length
    await stop.click()
    await sleep(200)
    check(rpcs('session.interrupt').length === stops && (await p.evaluate(() => window.__nativeCalls.includes('requestUnlock'))), 'Stop: over the lock screen, with no reply running, it asks for an unlock')
    await p.evaluate(() => window.hermesLockView(false))
    await e('subagent.complete', sub('s1', 'Runs on', { status: 'completed' }))
    await sleep(200)
    check((await stop.count()) === 0, 'Stop: it goes when the sub-agent ends')
    await p.close()
  }

  // ── leaving a chat doesn't stop what it started ──
  {
    const leave = async (chat, run) => {
      const p = await open(chat)
      if (run) await eventsOn(p, chat)('subagent.start', sub('stay', 'Keeps running'))
      await sleep(150)
      for (const other of ['s-11', 's-12', 's-13']) {
        await p.evaluate(id => window.hermesOpenSession(id), other)
        await p.getByText(`answer ${other}`, { exact: true }).waitFor({ timeout: 5000 })
      }
      await sleep(3400) // a chat that left the warm ones is closed after 3 s
      await p.close()
      return rpcs('session.close').some(c => c.params.session_id === `rt-${chat}`)
    }
    check(!(await leave('s-21', true)), 'leaving: a chat with a sub-agent running is not closed')
    check(await leave('s-22', false), 'leaving: another chat is closed as before')
  }

  // ── a saved "running" state doesn't last ──
  {
    const p = await open()
    const e = eventsOn(p)
    await mock({ nested: { roster: [] } })
    await e('subagent.start', sub('gone', 'Ended while away'))
    const line = p.getByRole('button', { name: GROUP })
    await line.waitFor({ timeout: 3000 })
    await sleep(5300) // what was heard of just now isn't taken for ended
    await p.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await p.getByRole('button', { name: /^Used 1 sub-agent/ }).waitFor({ timeout: 3000 }).catch(() => {})
    check(/^Used 1 sub-agent/.test((await line.innerText()).trim()), `sub-agents: one Hermes no longer lists stops showing as running (${await line.innerText()})`)
    await p.close()
  }

  // ── the chat's height while they run ──
  {
    const p = await open()
    const e = eventsOn(p)
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    for (let i = 0; i < 4; i++) await e('subagent.start', sub(`h${i}`, `Height ${i}`))
    await sleep(300)
    const measure = () => p.evaluate(() => {
      const reply = [...document.querySelectorAll('p')].find(x => x.textContent === 'answer s-48')
      let sc = reply
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
      let comp = document.querySelector('textarea[placeholder="Message Hermux"]')
      while (comp.parentElement && !comp.parentElement.contains(sc) && comp.parentElement !== document.body) comp = comp.parentElement
      const head = document.querySelector('header, [role="banner"]').getBoundingClientRect()
      const s = sc.getBoundingClientRect()
      return Math.round(Math.min(comp.getBoundingClientRect().top, s.bottom) - Math.max(head.bottom, s.top))
    })
    const closed = await measure()
    check(closed >= 613, `sub-agents: the messages keep their height while sub-agents run, keyboard closed (${closed} px, 614 before)`)
    check(await p.getByRole('button', { name: 'Stop', exact: true }).isVisible(), 'sub-agents: the chat keeps its Stop while they run after the reply has ended')
    await p.getByPlaceholder('Message Hermux').focus()
    await p.setViewportSize({ width: 360, height: 440 })
    await sleep(400)
    const typing = await measure()
    check(typing >= 313, `sub-agents: and with the keyboard open (${typing} px, 314 before)`)
    await p.close()
  }

  // ── the chat list ──
  const CH = 's-2'
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: `n-${i}`, parent: i === 1 ? 'n-0' : CH, goal: `Nested goal ${i}`, model: 'x/sonnet-4', effort: i % 2 ? 'high' : 'low', started: stamp(100 - i), ended: i < 2 ? 0 : stamp(10), reason: i < 2 ? '' : 'agent_close', messages: 3 }))
  await mock({ nested: { children: { [CH]: rows }, counts: { [CH]: 8 }, running: [{ session: CH, running: 2 }], hits: [{ chat: CH, child: 'n-5', goal: 'Nested goal 5' }], rows: {}, messages: {} } })
  const panelFor = async () => {
    const p = await open()
    await p.getByRole('button', { name: /^(Chats|Sessions)/ }).first().click()
    await p.getByRole('complementary', { name: 'Chats' }).getByText('Chat 2', { exact: true }).waitFor({ timeout: 5000 })
    await sleep(900)
    return p
  }
  {
    const p = await panelFor()
    const panel = p.getByRole('complementary', { name: 'Chats' })
    const group = panel.getByRole('group', { name: 'Sub-agents of this chat' })
    await group.waitFor({ timeout: 4000 })
    const nestedRow = n => group.getByRole('button', { name: new RegExp(`Nested goal ${n}\\b`) })
    await nestedRow(0).waitFor({ timeout: 3000 })
    const parentText = await panel.getByText(/Working · 8 sub-agents/).first().innerText()
    check(/Working · 8 sub-agents/.test(parentText), `chat list: the parent's line says "Working · 8 sub-agents" (${parentText})`)
    check((await group.getByRole('button', { name: /^Sub-agent:/ }).count()) === 6, 'chat list: at most six rows under a chat')
    check(await group.getByRole('button', { name: 'Show all 8' }).isVisible(), 'chat list: then "Show all N"')
    check((await nestedRow(0).boundingBox()).height === 44, 'chat list: a nested row is 44 px high')
    check((await nestedRow(1).boundingBox()).x > (await nestedRow(0).boundingBox()).x, 'chat list: indented by depth')
    check(/sonnet-4 · high/.test(await nestedRow(1).innerText()), 'chat list: a running one shows its model and level')
    check((await panel.getByRole('heading', { name: /Nested goal/ }).count()) === 0, 'chat list: nested rows are in no group of their own')
    const within = await nestedRow(0).evaluate(e => !!e.closest('[data-id="s-2"]'))
    check(within, 'chat list: the rows are inside their chat\'s own row container, so they move with it')
    const box = await nestedRow(2).boundingBox()
    await p.mouse.move(box.x + box.width - 20, box.y + 22)
    await p.mouse.down()
    await p.mouse.move(box.x + 30, box.y + 22, { steps: 8 })
    await sleep(80)
    const swiping = await panel.getByText('Delete', { exact: true }).count() + await panel.getByText('Archive', { exact: true }).count()
    await p.mouse.up()
    check(swiping === 0, 'chat list: a nested row has no swipe actions')
    check((await group.getByRole('button', { name: 'Chat options' }).count()) === 0, 'chat list: a nested row has no menu of its own')
    await group.getByRole('button', { name: 'Show all 8' }).click()
    check((await group.getByRole('button', { name: /^Sub-agent:/ }).count()) === 8, 'chat list: "Show all N" shows them all')
    await setMotion(p, 'full')
    await sleep(200)
    const moving = await p.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity).length)
    check(moving <= 2, `chat list: at most two repeating animations with sub-agents running (${moving})`)
    await setMotion(p, 'off')
    const closeBtn = panel.getByRole('button', { name: 'Hide sub-agents' })
    await closeBtn.click()
    check((await group.count()) === 0 && (await panel.getByRole('button', { name: 'Show sub-agents' }).count()) === 1, 'chat list: the chevron closes them, and the choice holds while they run')
    await panel.getByRole('button', { name: 'Show sub-agents' }).click()
    const resumes = rpcs('session.resume').length
    await nestedRow(0).click()
    const sh = p.getByRole('dialog', { name: 'Sub-agent' })
    await sh.waitFor({ timeout: 5000 })
    check(rpcs('session.resume').slice(resumes).some(c => c.params.session_id === CH) && /Nested goal 0/.test(await sh.innerText()), 'chat list: a tap opens the parent chat, with the sub-agent\'s sheet over it')
    await sh.getByText('Low', { exact: false }).first().waitFor({ timeout: 3000 })
    check(!(await panel.evaluate(e => e.classList.contains('open'))), 'chat list: the panel closes')
    await p.close()
  }
  {
    const before = calls().length
    await mock({ nested: { running: [] } })
    const p = await panelFor()
    const panel = p.getByRole('complementary', { name: 'Chats' })
    const line = panel.getByText(/8 sub-agents/).first()
    await line.waitFor({ timeout: 4000 })
    check(!/Working/.test(await line.innerText()) && (await panel.getByRole('group', { name: 'Sub-agents of this chat' }).count()) === 0, 'chat list: when all have finished the chat is one row with "8 sub-agents"')
    check(!calls().slice(before).some(c => c.path && /\/nested\?session=s-2/.test(c.path)), 'chat list: nothing is read for a chat whose rows are closed')
    await panel.getByRole('button', { name: 'Show sub-agents' }).first().click()
    await panel.getByRole('group', { name: 'Sub-agents of this chat' }).getByRole('button', { name: /Nested goal 3/ }).waitFor({ timeout: 3000 })
    check(true, 'chat list: the chevron opens them, read at that moment')
    await p.getByRole('textbox', { name: 'Search chats' }).or(p.getByPlaceholder('Search chats')).first().fill('Nested goal 5')
    const found = panel.getByRole('group', { name: 'Sub-agents of this chat' }).getByRole('button', { name: /Nested goal 5/ })
    await found.waitFor({ timeout: 3000 })
    check((await panel.getByText('Chat 2', { exact: true }).count()) === 1 && (await panel.getByRole('group', { name: 'Sub-agents of this chat' }).getByRole('button', { name: /^Sub-agent:/ }).count()) === 1, 'chat list: search finds a sub-agent under its chat')
    await p.close()
  }
  {
    await mock({ waiting: [{ session: CH, kind: 'approval', who: 'A sub-agent', profile: '', since: stamp(5), until: stamp(-200), open: 1, last: stamp(5) }], nested: { running: [{ session: CH, running: 1 }] } })
    const p = await panelFor()
    const panel = p.getByRole('complementary', { name: 'Chats' })
    const needs = panel.getByRole('group', { name: 'Needs you' })
    await needs.waitFor({ timeout: 4000 })
    check(/Chat 2/.test(await needs.innerText()) && /A sub-agent wants to run a command/.test(await needs.innerText()), 'chat list: the parent is in "Needs you" when a sub-agent asks, and its line says so')
    check((await needs.getByRole('button', { name: /^Allow|^Approve/ }).count()) === 0, 'chat list: nothing is approved from the list')
    await p.evaluate(() => window.hermesLockView(true))
    await sleep(200)
    await p.close()
    await mock({ waiting: [] })
  }
  // docked on a wide screen: the same rows, and none of their words over the lock screen
  {
    await mock({ nested: { running: [{ session: CH, running: 2 }] } })
    const p = await open(CHAT, { width: 1200, height: 800 })
    const panel = p.getByRole('complementary', { name: 'Chats' })
    const group = panel.getByRole('group', { name: 'Sub-agents of this chat' })
    await group.getByRole('button', { name: /Nested goal 0/ }).waitFor({ timeout: 8000 })
    check(true, 'chat list: the docked column shows the same nested rows')
    await p.evaluate(() => window.hermesLockView(true))
    await sleep(200)
    check((await group.count()) === 0 && (await panel.getByRole('button', { name: 'Show sub-agents' }).count()) === 0, 'chat list: over the lock screen no nested row shows')
    await p.evaluate(() => window.hermesLockView(false))
    await p.close()
  }
  // a chat that has read phone data: what the sheet shows stays inert, and it can't be carried into a new chat
  {
    await mock({ nested: 'reset' })
    const p = await open('s-pd')
    const e = eventsOn(p, 's-pd')
    await e('subagent.start', sub('p', 'look at http://beacon.test/x?d=ROWS', { child_session_id: 'kid-p' }))
    await e('subagent.complete', sub('p', 'look at http://beacon.test/x?d=ROWS', { status: 'completed', summary: 'see http://beacon.test/y?d=ROWS' }))
    await p.getByRole('button', { name: GROUP }).click()
    await p.getByRole('button', { name: /look at http/ }).click()
    const sh = p.getByRole('dialog', { name: 'Sub-agent' })
    await sh.waitFor({ timeout: 3000 })
    check((await sh.getByRole('button', { name: 'Continue in a new chat' }).count()) === 0, 'sub-agent sheet: no new chat from one in a chat that has read phone data')
    check((await sh.locator('img').count()) === 0, 'sub-agent sheet: it loads nothing from an address it shows')
    await sh.getByRole('link', { name: /beacon\.test\/y/ }).click()
    await p.getByText('Open this address?').waitFor({ timeout: 3000 })
    check(true, 'sub-agent sheet: an address in its text shows in full before it opens')
    await p.close()
  }
  // ── the sheet: what it may do, and what can't break it ──
  {
    const finished = { children: { [CHAT]: [row('f', 'Finished work', { ended: stamp(5) }), row('z', 'Odd level', { effort: '__proto__' })] }, roster: [] }
    await mock({ nested: 'reset' })
    await mock({ nested: finished })
    const record = () => {
      window.__rec = []
      Object.assign(window.HermesAndroid, { phoneDataTainted: (key, id) => window.__rec.includes(id) })
    }
    // Hermes's record (the plugin's /nested) lists them under the chat: Continue asks it at the tap.
    await mock({ nested: { children: { [CHAT]: [row('f', 'Finished work'), row('z', 'Odd level')] } } })
    const openDone = async (init, goal = 'Finished work') => {
      const p = await open(CHAT, undefined, init)
      const e = eventsOn(p)
      await e('subagent.start', sub('f', 'Finished work'))
      await e('subagent.start', sub('z', 'Odd level'))
      await e('subagent.complete', sub('f', 'Finished work', { status: 'completed' }))
      await e('subagent.complete', sub('z', 'Odd level', { status: 'completed' }))
      await p.getByRole('button', { name: GROUP }).click()
      await p.getByRole('button', { name: new RegExp(goal) }).click()
      await p.getByRole('dialog', { name: 'Sub-agent' }).waitFor({ timeout: 3000 })
      return p
    }
    let p = await openDone(record, 'Odd level')
    await sleep(400)
    check(await p.getByRole('dialog', { name: 'Sub-agent' }).getByText('Model', { exact: true }).isVisible(), 'sub-agent sheet: a level named __proto__ breaks nothing')
    await p.close()

    // a new chat from it never has more access than the chat, and is refused once phone data is involved
    const tapContinue = (id) => p.evaluate(id => {
      window.__rec.push(id) // in the same moment as the tap: what the sheet drew before knows nothing of it
      ;[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent === 'Continue in a new chat').click()
    }, id)
    p = await openDone(() => {
      localStorage.setItem('hm.defaultAccess.v1', 'full')
      localStorage.setItem('hm.yolo.v1', JSON.stringify({ 's-48': false }))
    })
    const yolo = () => rpcs('config.set').filter(c => c.params.key === 'yolo' && c.params.value === '1').length
    let on = yolo()
    let branches = rpcs('session.branch').length
    await p.getByRole('button', { name: 'Continue in a new chat' }).click()
    for (let i = 0; i < 40 && rpcs('session.branch').length === branches; i++) await sleep(100)
    await sleep(800)
    let saved = await p.evaluate(() => JSON.parse(localStorage.getItem('hm.yolo.v1') || '{}'))
    let id = Object.keys(saved).find(k => k.startsWith('s-branch-'))
    check(id && saved[id] === false && yolo() === on, `continue: a chat that asks gives a new chat that asks, whatever the default (${JSON.stringify(saved)})`)
    await p.close()
    p = await openDone(record)
    branches = rpcs('session.branch').length
    await tapContinue('kid-f')
    await sleep(400)
    check(rpcs('session.branch').length === branches && (await p.getByText('phone data may be involved', { exact: false }).count()) === 1, 'continue: checked again at the tap: the sub-agent has read phone data')
    await p.close()
    p = await openDone(() => {
      window.__rec = []
      Object.assign(window.HermesAndroid, { phoneDataTainted: () => { if (window.__rec.length) throw new Error('no record'); return false } })
    })
    branches = rpcs('session.branch').length
    await tapContinue('x')
    await sleep(400)
    check(rpcs('session.branch').length === branches, 'continue: refused when the record can\'t answer')
    await p.close()

    // a draft belongs to one sub-agent
    await mock({ nested: { roster: [roster('a', 'Read the docs'), roster('c', 'Check one link', { parent_id: 'a', depth: 1 })] } })
    p = await open()
    const e = eventsOn(p)
    await e('subagent.start', sub('a', 'Read the docs'))
    await e('subagent.start', sub('c', 'Check one link', { parent_id: 'a', depth: 1 }))
    await p.getByRole('button', { name: GROUP }).click()
    await p.getByRole('button', { name: /Read the docs/ }).click()
    const sh = p.getByRole('dialog', { name: 'Sub-agent' })
    const field = sh.getByRole('textbox', { name: 'Tell it something' })
    await field.fill('Meant for the first one')
    await sh.getByRole('button', { name: /Check one link/ }).click()
    await sh.getByRole('button', { name: 'Back' }).waitFor({ timeout: 3000 })
    check((await field.inputValue()) === '', 'sub-agent sheet: a draft does not carry over to another sub-agent')
    await p.close()

    // the sheet's guard is decided for its own chat: the app's record says it has read
    await mock({ nested: 'reset' })
    p = await open('s-pd-ctl', undefined, () => { window.HermesAndroid.phoneDataTainted = (key, id) => id === 's-pd-ctl' })
    const ep = eventsOn(p, 's-pd-ctl')
    await ep('subagent.complete', sub('g', 'look at http://beacon.test/x?d=ROWS', { status: 'completed' }))
    await p.getByRole('button', { name: GROUP }).click()
    await p.getByRole('button', { name: /look at http/ }).click()
    const gs = p.getByRole('dialog', { name: 'Sub-agent' })
    await gs.getByRole('link', { name: /beacon\.test/ }).click()
    await p.getByText('Open this address?').waitFor({ timeout: 3000 }).catch(() => {})
    check((await p.getByText('Open this address?').count()) === 1, 'sub-agent sheet: in a chat the record says has read, an address asks first')
    await p.close()

    // a row's chat that doesn't open gets no sheet
    await mock({ nested: { children: { [CH]: rows }, counts: { [CH]: 8 }, running: [{ session: CH, running: 2 }], failResume: [CH] } })
    p = await panelFor()
    await p.getByRole('complementary', { name: 'Chats' }).getByRole('group', { name: 'Sub-agents of this chat' }).getByRole('button', { name: /Nested goal 0/ }).click()
    await sleep(600)
    check((await p.getByRole('dialog', { name: 'Sub-agent' }).count()) === 0, 'chat list: no sheet when its chat could not be opened')
    await p.close()
    // nor when the person has gone to another chat by the time it opens
    await mock({ nested: { failResume: [] } })
    p = await panelFor()
    await p.getByRole('complementary', { name: 'Chats' }).getByRole('group', { name: 'Sub-agents of this chat' }).getByRole('button', { name: /Nested goal 0/ }).waitFor({ timeout: 4000 })
    await p.evaluate(() => {
      ;[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('Sub-agent: Nested goal 0')).click()
      window.hermesOpenSession('s-11')
    })
    await p.getByText('answer s-11', { exact: true }).waitFor({ timeout: 5000 })
    await sleep(500)
    check((await p.getByRole('dialog', { name: 'Sub-agent' }).count()) === 0, 'chat list: no sheet over a chat the person went to meanwhile')
    await p.close()

    // a goal in the list and the banner is isolated from the words around it
    const goalNeed = { session: 's-49', kind: 'approval', who: 'A sub-agent', profile: '', since: stamp(2), until: stamp(-200), open: 1, last: stamp(2) }
    await mock({ nested: 'reset' })
    await mock({ waiting: [goalNeed], activity: [{ session: 's-49', text: 'Working', short: 'Working', profile: 'default', ts: stamp(1) }] })
    p = await open('s-49')
    const en = eventsOn(p, 's-49')
    await en('subagent.tool', sub('b', 'Abc‮def', { tool_name: 'terminal', tool_preview: 'chmod 777 b' }))
    await framer(p)({ id: 'srv-bdi', method: 'approval', params: { session_id: 'rt-s-49', command: 'chmod 777 b', description: 'x', choices: ['once', 'deny'] } })
    const quoted = p.getByRole('dialog').getByText('“Abc def”')
    await quoted.first().waitFor({ timeout: 3000 }).catch(() => {})
    check((await quoted.first().evaluate(el => el.tagName).catch(() => '')) === 'BDI', 'request sheet: a goal is cleaned and stands in its own <bdi>')
    await p.close()
    await mock({ waiting: [], activity: [] })
  }
  // ── the rows and the sheet load only when a chat has sub-agents ──
  {
    const state = p => p.evaluate(() => ({ ui: !!window.__hmSubAgents, css: !!document.getElementById('hm-subagents-css'), host: !!window.__hmSubAgentHost }))
    const loadedSoon = p => p.waitForFunction(() => window.__hmSubAgents && document.getElementById('hm-subagents-css'), null, { timeout: 4000 }).then(() => true, () => false)
    await mock({ nested: 'reset', waiting: [], activity: [] })
    let p = await open('s-11')
    let s = await state(p)
    check(!s.ui && !s.css && !s.host, `lazy: an ordinary chat has not run the sub-agent bundle (${JSON.stringify(s)})`)
    await p.getByRole('button', { name: /^(Chats|Sessions)/ }).first().click()
    await p.getByRole('complementary', { name: 'Chats' }).getByText('Chat 2', { exact: true }).waitFor({ timeout: 5000 })
    await sleep(500)
    s = await state(p)
    check(!s.ui && !s.css, 'lazy: the chat list without sub-agents does not run it either')
    await p.close()

    // the group's line is final before the bundle arrives
    p = await open()
    await p.evaluate(() => {
      const box = (e, o) => { const r = e.getBoundingClientRect(); return [r.left - o.left, r.top - o.top, r.width, r.height].map(n => Math.round(n * 2) / 2) }
      window.__line = () => {
        const b = [...document.querySelectorAll('button')].find(x => /^\d+ sub-agents?/.test(x.textContent.trim()))
        if (!b) return null
        const o = b.getBoundingClientRect(), c = getComputedStyle(b)
        return JSON.stringify({ left: o.left, width: o.width, height: o.height, color: c.color, size: c.fontSize, parts: [...b.children].map(e => box(e, o)) })
      }
      const add = document.head.appendChild
      document.head.appendChild = function (n) {
        if (n.id === 'hm-subagents-css') window.__before = window.__line()
        return add.call(this, n)
      }
    })
    const ev2 = eventsOn(p)
    await ev2('subagent.start', sub('a', 'Read the docs'))
    check(await loadedSoon(p), 'lazy: the first sub-agent loads the rows and the sheet')
    await sleep(250)
    const line = await p.evaluate(() => ({ before: window.__before, after: window.__line(), host: !!window.__hmSubAgentHost }))
    check(!!line.before && line.before === line.after, `lazy: the group's line does not move or change when they arrive (${line.before} / ${line.after})`)
    check(!line.host, 'lazy: what the bundle was handed does not stay on the page')
    await p.getByRole('button', { name: GROUP }).click()
    await p.getByRole('button', { name: /Read the docs/ }).click()
    check(await p.getByRole('dialog', { name: 'Sub-agent' }).waitFor({ timeout: 3000 }).then(() => true, () => false), 'lazy: its rows and sheet work from the loaded bundle')
    await p.close()

    // a load that fails leaves the chat working, and the next need tries again
    p = await open()
    await p.evaluate(() => {
      const el = document.getElementById('hm-subagents')
      window.__src = el.textContent
      el.textContent = ''
    })
    await eventsOn(p)('subagent.start', sub('a', 'Read the docs'))
    const line2 = p.getByRole('button', { name: GROUP })
    await line2.waitFor({ timeout: 3000 })
    await sleep(200)
    check(!(await state(p)).ui && (await p.getByPlaceholder('Message Hermux').isVisible()), 'lazy: a failed load leaves the chat and the group line working')
    await p.evaluate(() => { document.getElementById('hm-subagents').textContent = window.__src })
    await line2.click()
    check(await p.getByRole('button', { name: /Read the docs/ }).waitFor({ timeout: 3000 }).then(() => true, () => false), 'lazy: opening the group tries the load again')
    await p.close()

    // the chat list
    await mock({ nested: { children: { [CH]: rows }, counts: { [CH]: 8 }, running: [], hits: [], rows: {}, messages: {} } })
    p = await open()
    check(!(await state(p)).ui, 'lazy: stored sub-agents load nothing before the list opens')
    await p.getByRole('button', { name: /^(Chats|Sessions)/ }).first().click()
    const panel = p.getByRole('complementary', { name: 'Chats' })
    const show = panel.getByRole('button', { name: 'Show sub-agents' })
    await show.first().waitFor({ timeout: 5000 })
    check(await loadedSoon(p), 'lazy: the open list with a chat that has sub-agents loads them')
    await show.first().click()
    check(await panel.getByRole('group', { name: 'Sub-agents of this chat' }).getByRole('button', { name: /Nested goal 0/ }).waitFor({ timeout: 4000 }).then(() => true, () => false), 'lazy: the chevron shows the rows')
    await p.close()
  }
  // ── a sub-agent belongs to the chat whose items are drawn, also while another chat opens ──
  {
    await mock({ nested: 'reset', waiting: [] })
    await mock({ nested: { slowResume: ['s-3'] } }) // a chat no check here gave sub-agents
    const p = await open()
    const e = eventsOn(p)
    await e('subagent.start', sub('mine', 'Belongs to this chat'))
    await e('subagent.complete', sub('mine', 'Belongs to this chat', { status: 'completed' }))
    await p.getByRole('button', { name: GROUP }).click()
    await p.getByRole('button', { name: /Belongs to this chat/ }).waitFor({ timeout: 3000 })
    await p.evaluate(() => window.hermesOpenSession('s-3')) // no copy of it on screen yet: it answers after 1.5 s
    await sleep(600)
    await p.getByText('answer s-3', { exact: true }).waitFor({ timeout: 5000 })
    await p.getByRole('button', { name: /^(Chats|Sessions)/ }).first().click()
    const panel = p.getByRole('complementary', { name: 'Chats' })
    await panel.getByText('Chat 3', { exact: true }).first().waitFor({ timeout: 5000 })
    await sleep(500)
    // Each chat's rows sit in its row's container, which carries the chat's id (spec 3.13).
    const owners = await panel.getByRole('button', { name: 'Show sub-agents' }).evaluateAll(bs => bs.map(b => b.closest('[data-id]')?.getAttribute('data-id')))
    await mock({ nested: 'reset' })
    check(!owners.includes('s-3'), `opening: the chat that opened got none of the sub-agents of the chat being left (${JSON.stringify(owners)})`)
    await p.close()
  }

  // ── Continue asks Hermes's record whether the sub-agent is this chat's ──
  {
    await mock({ nested: { children: { [CHAT]: [row('other', 'Not this one')] } } })
    const p = await open()
    const e = eventsOn(p)
    await e('subagent.start', sub('stray', 'Filed here by mistake'))
    await e('subagent.complete', sub('stray', 'Filed here by mistake', { status: 'completed' }))
    await p.getByRole('button', { name: GROUP }).click()
    await p.getByRole('button', { name: /Filed here by mistake/ }).click()
    const sheet = p.getByRole('dialog', { name: 'Sub-agent' })
    await sheet.waitFor({ timeout: 3000 })
    const branches = rpcs('session.branch').length
    const resumes = rpcs('session.resume').filter(c => c.params.session_id === 'kid-stray').length
    await sheet.getByRole('button', { name: 'Continue in a new chat' }).click()
    await sleep(600)
    check(rpcs('session.branch').length === branches && rpcs('session.resume').filter(c => c.params.session_id === 'kid-stray').length === resumes
      && (await p.getByText('couldn’t be confirmed that this sub-agent belongs to this chat', { exact: false }).count()) === 1,
      'continue: refused when Hermes\'s record doesn\'t list the sub-agent under this chat')
    await p.close()
    await mock({ nested: 'reset' })
  }

  // ── after a context compression the chat keeps its sub-agents ──
  {
    const p = await open()
    const e = eventsOn(p)
    const stop = p.getByRole('button', { name: 'Stop', exact: true })
    await e('subagent.start', sub('cmp', 'Runs across a compression'))
    await stop.waitFor({ timeout: 3000 })
    await e('session.info', { stored_session_id: 's-48-next' })
    await sleep(300)
    check(await stop.isVisible(), 'compression: the composer keeps its Stop while the sub-agent runs')
    await e('subagent.tool', sub('cmp', 'Runs across a compression', { tool_name: 'terminal', tool_preview: 'ls' }))
    await p.getByRole('button', { name: GROUP }).click()
    await sleep(200)
    check((await p.getByRole('button', { name: /Runs across a compression/ }).count()) === 1, 'compression: one row, not a second copy')
    for (const other of ['s-11', 's-12', 's-13']) {
      await p.evaluate(id => window.hermesOpenSession(id), other)
      await p.getByText(`answer ${other}`, { exact: true }).waitFor({ timeout: 5000 })
    }
    await sleep(3400) // a chat that left the warm ones is closed after 3 s
    check(!rpcs('session.close').some(c => c.params.session_id === LIVE), 'compression: leaving the chat while its sub-agent runs doesn\'t close it')
    await framer(p)({ method: 'event', params: { type: 'subagent.complete', session_id: LIVE, payload: sub('cmp', 'Runs across a compression', { status: 'completed' }) } })
    await p.evaluate(() => window.hermesOpenSession('s-48'))
    await p.getByPlaceholder('Message Hermux').waitFor({ timeout: 5000 })
    await sleep(500)
    check((await stop.count()) === 0, 'compression: its end, filed under the id the page knew, reaches the record')
    await p.close()
  }

  // ── a chat kept open for its sub-agents is closed in turn once they end ──
  {
    const p = await open('s-21')
    await eventsOn(p, 's-21')('subagent.start', sub('kept', 'Keeps it open'))
    await sleep(150)
    const visit = async ids => {
      for (const other of ids) {
        await p.evaluate(id => window.hermesOpenSession(id), other)
        await p.getByText(`answer ${other}`, { exact: true }).waitFor({ timeout: 5000 })
      }
    }
    const closed = () => rpcs('session.close').some(c => c.params.session_id === 'rt-s-21')
    await visit(['s-11', 's-12', 's-13'])
    await sleep(3400) // a chat that left the warm ones is closed after 3 s
    check(!closed(), 'kept: not closed while its sub-agent runs')
    await framer(p)({ method: 'event', params: { type: 'subagent.complete', session_id: 'rt-s-21', payload: sub('kept', 'Keeps it open', { status: 'completed' }) } })
    await visit(['s-14', 's-15', 's-16'])
    await sleep(3400)
    check(closed(), 'kept: once its sub-agent has ended it is closed like any chat left behind')
    await p.close()
  }

  // ── deleting a chat kept open for its sub-agents closes it first ──
  {
    const p = await open('s-23')
    await eventsOn(p, 's-23')('subagent.start', sub('del', 'Runs while deleted'))
    await sleep(150)
    await p.evaluate(() => window.hermesOpenSession('s-11'))
    await p.getByText('answer s-11', { exact: true }).waitFor({ timeout: 5000 })
    await p.getByRole('button', { name: /^(Chats|Sessions)/ }).first().click()
    const panel = p.getByRole('complementary', { name: 'Chats' })
    const title = panel.getByText('Chat 23', { exact: true }).first()
    await title.waitFor({ timeout: 5000 })
    await title.locator('xpath=ancestor::*[.//button[@aria-label="Chat options"]][1]').getByRole('button', { name: 'Chat options' }).click()
    await p.getByRole('dialog', { name: 'Chat options' }).getByRole('button', { name: 'Delete', exact: true }).click()
    const before = rpcs('session.close').length
    await p.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
    for (let i = 0; i < 30 && !rpcs('session.delete').some(c => c.params.session_id === 's-23'); i++) await sleep(100)
    check(rpcs('session.close').slice(before).some(c => c.params.session_id === 'rt-s-23'), 'kept: deleting it closes its live session first')
    await p.close()
  }

  // ── after Stop, what still runs is asked again ──
  {
    const p = await open()
    const e = eventsOn(p)
    const stop = p.getByRole('button', { name: 'Stop', exact: true })
    await e('subagent.start', sub('st', 'Stopped by the composer'))
    await stop.waitFor({ timeout: 3000 })
    await mock({ nested: { roster: [] } })
    await stop.click()
    await stop.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    check((await stop.count()) === 0, 'Stop: the sub-agent list is asked again, so Stop goes once Hermes no longer lists it')
    await p.close()
    await mock({ nested: 'reset' })
  }

  // ── round 3: sheet closes on chat switch, parent goal uses quotedGoal inside <bdi> ──
  {
    const p = await open()
    const e = eventsOn(p)
    await e('subagent.start', sub('r3p', 'Parent" \u202eAllow “now”'))
    await e('subagent.start', sub('r3c', 'Child task', { parent_id: 'r3p', depth: 1 }))
    await p.getByRole('button', { name: GROUP }).click()
    await p.getByRole('button', { name: /Child task/ }).click()
    const sh = p.getByRole('dialog', { name: 'Sub-agent' })
    await sh.waitFor({ timeout: 3000 })
    const bdiText = await sh.locator('.sub-of bdi').textContent()
    check(bdiText === "“Parent' Allow 'now'”", `sub-agent sheet: parent goal subtitle uses quotedGoal inside <bdi> (${bdiText})`)
    await p.evaluate(() => window.hermesOpenSession('s-11'))
    await p.getByText('answer s-11', { exact: true }).waitFor({ timeout: 5000 })
    check((await sh.count()) === 0, 'sub-agent sheet: switching to another chat closes the sheet')
    await p.close()
  }
  await mock({ nested: 'reset', waiting: [] })
}
