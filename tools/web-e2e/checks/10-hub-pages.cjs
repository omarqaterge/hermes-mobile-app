// Files and its previews, Projects, Cron, the title menu and Chat details.
const { calls, sleep, check, openLibraryPart, WEB, mock, hitArea, lowContrast, pageTitle } = require('../lib.cjs')

module.exports = async t => {
  const { page } = t
  // ── #21 Files: Back goes up one folder, then leaves ──
  await openLibraryPart(page, 'Files')
  const crumbText = () => page.locator('.crumbs').textContent()
  await page.getByRole('button', { name: /^a( |$)/ }).click()
  await page.locator('.crumbs', { hasText: 'sdcard/a/' }).waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: /^b( |$)/ }).click()
  await page.locator('.crumbs', { hasText: 'sdcard/a/b/' }).waitFor({ timeout: 5000 })
  check(await page.evaluate(() => window.hermesBack()), 'Back is handled inside Files')
  await sleep(300)
  check((await crumbText()) === '/sdcard/a/', `Back goes up one folder (${await crumbText()})`)
  await page.evaluate(() => window.hermesBack())
  await sleep(300)
  check((await crumbText()) === '/sdcard/', `…and again (${await crumbText()})`)
  await page.evaluate(() => window.hermesBack())
  await sleep(300)
  check((await page.locator('.crumbs').count()) === 0, 'at the root chip Back leaves Files')
  check((await page.locator('.screen').count()) === 0, '…back to the chat (Back from Files leaves the Library)')

  // ── Files previews: table, code, page, player, and the note for files with no preview ──
  await openLibraryPart(page, 'Files')
  // Android Back closes the open preview sheet; wait until it is gone before the next tap.
  const closeSheet = async () => {
    await page.evaluate(() => window.hermesBack())
    await page.locator('.sheet').waitFor({ state: 'detached', timeout: 5000 })
  }
  const fileReads = name => calls().filter(c => c.path === '/api/files/read' && decodeURIComponent(c.query).endsWith('/' + name)).length
  await page.locator('.file-row', { hasText: 'table.csv' }).click()
  await page.locator('.sheet table td', { hasText: /^2$/ }).waitFor({ timeout: 5000 }).then(() => check(true, 'Files: a csv shows as a table with its cell'), () => check(false, 'Files: a csv shows as a table with its cell'))
  await closeSheet()
  await page.locator('.file-row', { hasText: 'code.py' }).click()
  await page.locator('.sheet code.hljs, .sheet .hljs').first().waitFor({ timeout: 5000 }).then(() => check(true, 'Files: python code is highlighted'), () => check(false, 'Files: python code is highlighted'))
  await closeSheet()
  await page.locator('.file-row', { hasText: 'page.html' }).click()
  await page.locator('.sheet iframe').waitFor({ timeout: 5000 })
  await page.frameLocator('.sheet iframe').locator('h1', { hasText: 'Hi' }).waitFor({ timeout: 5000 }).then(() => check(true, 'Files: an html file runs in a frame showing its content'), () => check(false, 'Files: an html file runs in a frame showing its content'))
  const sb = (await page.locator('.sheet iframe').getAttribute('sandbox')) || ''
  check(sb.includes('allow-scripts') && !sb.includes('allow-same-origin'), `Files: the page frame is sandboxed without allow-same-origin (${sb})`)
  await closeSheet()
  await page.locator('.file-row', { hasText: 'song.mp3' }).click()
  await page.locator('.sheet audio').waitFor({ state: 'attached', timeout: 5000 }).then(() => check(true, 'Files: an mp3 shows a player'), () => check(false, 'Files: an mp3 shows a player'))
  check(fileReads('song.mp3') === 0, 'Files: the mp3 was never read through /api/files/read')
  await closeSheet()
  await page.locator('.file-row', { hasText: 'doc.pdf' }).click()
  await page.locator('.sheet', { hasText: 'No preview here. Use Open with… to view it in another app.' }).waitFor({ timeout: 5000 }).then(() => check(true, 'Files: a pdf says there is no preview'), () => check(false, 'Files: a pdf says there is no preview'))
  check((await page.locator('.sheet button', { hasText: 'Open with…' }).count()) === 1, 'Files: the pdf sheet keeps Open with…')
  check(fileReads('doc.pdf') === 0, 'Files: the pdf was not read')
  await closeSheet()
  // Back out of Files (at its root chip) leaves the Library for the chat.
  await page.evaluate(() => window.hermesBack())
  await page.locator('.crumbs').waitFor({ state: 'detached', timeout: 5000 })

  // ── #22 Projects: tap a chat to open it ──
  await openLibraryPart(page, 'Projects')
  await page.locator('.card', { hasText: 'Thesis' }).click()
  await page.locator('.project-chat', { hasText: 'Chat 4' }).click({ timeout: 5000 })
  await page.locator('.msg.assistant', { hasText: 'answer s-4' }).waitFor({ timeout: 5000 }).then(() => check(true, 'project chat opens'), () => check(false, 'project chat opens'))
  check((await page.locator('.card', { hasText: 'Thesis' }).count()) === 0, 'Projects screen closed')

  // ── #23 Cron: edit a job (falls back to replace when PUT isn't there), open a run's output ──
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.getByRole('button', { name: /^Scheduled/ }).click()
  await page.locator('.card', { hasText: 'Morning brief' }).getByRole('button', { name: 'Edit' }).click()
  check((await page.locator('.field textarea').inputValue()) === 'Brief me', 'edit form is filled in')
  await page.locator('.field textarea').fill('Brief me, shorter')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.locator('.toast', { hasText: 'Saved as a new job' }).waitFor({ timeout: 5000 }).catch(() => {})
  const cronCalls = calls().filter(c => c.path && c.path.startsWith('/api/cron/jobs'))
  const put = cronCalls.find(c => c.http === 'PUT'), post = cronCalls.filter(c => c.http === 'POST').pop(), del = cronCalls.find(c => c.http === 'DELETE')
  check(put && put.body.updates?.prompt === 'Brief me, shorter' && put.body.updates?.schedule === '0 9 * * *', 'tries PUT with the edited job ({updates: …}, the dashboard\'s shape)')
  check(post && post.body.prompt === 'Brief me, shorter' && del && del.path === '/api/cron/jobs/j1', 'falls back to create + delete')
  await page.locator('.card', { hasText: 'Morning brief' }).getByRole('button', { name: 'Runs' }).click()
  await page.locator('.card.as-button', { hasText: 'saved output' }).click({ timeout: 5000 })
  await page.locator('.sheet h1', { hasText: 'Result' }).waitFor({ timeout: 5000 }).then(() => check(true, 'a run’s saved output opens'), () => check(false, 'a run’s saved output opens'))
  await page.evaluate(() => window.hermesBack())
  await page.locator('.card.as-button', { hasText: 'chat run' }).click()
  await page.locator('.msg.assistant', { hasText: 'answer s-6' }).waitFor({ timeout: 5000 }).then(() => check(true, 'a run with a chat opens that chat'), () => check(false, 'a run with a chat opens that chat'))

  // ── title tap opens the Backend status sheet; Chat details (from ⋮) is read-only ──
  await page.locator('header.topbar .title-btn').click()
  await page.locator('.sheet', { hasText: 'Backend status' }).waitFor({ timeout: 3000 }).then(() => check(true, 'title tap opens the Backend status sheet'), () => check(false, 'title tap opens the Backend status sheet'))
  check((await page.getByRole('dialog').getByRole('button', { name: 'Chat details' }).count()) === 0, 'title tap does not open the chat menu')
  await page.evaluate(() => window.hermesBack())
  await page.locator('header.topbar .subtitle').click()
  await page.locator('.sheet', { hasText: 'Backend status' }).waitFor({ timeout: 3000 }).then(() => check(true, 'tapping "Hermux agent" opens the Backend status sheet'), () => check(false, 'tapping "Hermux agent" opens the Backend status sheet'))
  await page.evaluate(() => window.hermesBack())
  await page.locator('header.topbar').getByRole('button', { name: 'Chat options' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Chat details' }).click({ timeout: 3000 })
  const details = page.locator('.sheet', { hasText: 'Chat details' })
  await details.waitFor({ timeout: 3000 })
  check((await details.locator('input').count()) === 0 && (await details.getByRole('button', { name: /Delete|Undo/ }).count()) === 0, 'details sheet has no duplicate actions')
  await page.evaluate(() => window.hermesBack())

  // ── Task 10: the inner pages (empty states, the bot in the top bar, the Scheduled card, widths, touch targets, Light) ──
  {
    const { browser } = t
    const fresh = async (w, h, store = {}) => {
      const p = await browser.newPage({ viewport: { width: w, height: h } })
      await p.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v) }, store)
      await p.goto(WEB + '/')
      await p.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
      return p
    }
    // A side panel row: on a phone through the Sessions button, on a wide screen straight from the docked list.
    const panelRow = async (p, name) => {
      if (await p.getByRole('button', { name: /^Sessions/ }).count()) await p.getByRole('button', { name: /^Sessions/ }).click()
      await p.getByRole('button', { name }).click()
    }
    const library = async (p, part) => {
      await panelRow(p, /^Library$/)
      await p.getByRole('button', { name: part, exact: true }).click()
    }
    const back = p => p.getByRole('button', { name: 'Back' }).last().click()
    const seen = (loc, what) => loc.waitFor({ timeout: 5000 }).then(() => check(true, what), () => check(false, what))

    // Empty lists say what the thing is and how to start, with one button that starts it.
    await mock({ empty: true })
    const e = await fresh(375, 812)
    await panelRow(e, /^Skills/)
    const skillsEmpty = e.getByRole('group', { name: 'No skills yet' })
    await seen(skillsEmpty, 'empty Skills: says what a skill is')
    check((await skillsEmpty.getByText(/Skills teach Hermux how to do a job/).count()) === 1 && (await skillsEmpty.getByRole('button').count()) === 1, 'empty Skills: one sentence and one button')
    await skillsEmpty.getByRole('button', { name: 'Ask Hermux to make one' }).click()
    await e.locator('.screen').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
    await e.waitForFunction(() => document.querySelector('textarea[placeholder="Message Hermux"]')?.value.startsWith('Make a skill that'), null, { timeout: 3000 }).catch(() => {})
    check((await e.locator('.screen').count()) === 0 && (await e.getByPlaceholder('Message Hermux').inputValue()).startsWith('Make a skill that'), 'empty Skills: the button returns to the chat with the request started')
    await e.getByPlaceholder('Message Hermux').fill('')

    await panelRow(e, /^Scheduled/)
    await seen(pageTitle(e, 'Scheduled'), 'Scheduled: the page is called Scheduled')
    const jobsEmpty = e.getByRole('group', { name: 'Nothing scheduled yet' })
    await seen(jobsEmpty, 'empty Scheduled: says what a scheduled job is')
    await jobsEmpty.getByRole('button', { name: 'New scheduled job' }).click()
    await seen(e.getByRole('dialog').filter({ hasText: 'New scheduled job' }), 'empty Scheduled: the button opens the new job sheet')
    await e.evaluate(() => window.hermesBack())
    await e.getByRole('dialog').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    await back(e)

    await openLibraryPart(e, 'Canvases')
    const canvasEmpty = e.getByRole('group', { name: 'No canvases yet' })
    await seen(canvasEmpty, 'empty Canvases: says what a canvas is')
    await e.getByRole('button', { name: 'Projects', exact: true }).click()
    const projEmpty = e.getByRole('group', { name: 'No projects yet' })
    await seen(projEmpty, 'empty Projects: says what a project is')
    await projEmpty.getByRole('button', { name: 'New project' }).click()
    await seen(e.getByRole('dialog').filter({ hasText: 'New project' }), 'empty Projects: the button opens the new project sheet')
    await e.evaluate(() => window.hermesBack())
    await e.getByRole('dialog').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    await e.getByRole('button', { name: 'Canvases', exact: true }).click()
    await canvasEmpty.getByRole('button', { name: 'New chat' }).click()
    await e.locator('.screen').waitFor({ state: 'detached', timeout: 5000 }).then(() => check(true, 'empty Canvases: New chat returns to a new chat'), () => check(false, 'empty Canvases: New chat returns to a new chat'))

    // Memory, from Settings → Behaviour: both tabs explain themselves; the button opens a new memory.
    await e.getByRole('button', { name: /^Sessions/ }).click()
    await e.getByRole('button', { name: 'Settings', exact: true }).click()
    await e.getByRole('button', { name: /^Behaviour/ }).click()
    await e.getByRole('button', { name: /^See what Hermux remembers/ }).click()
    const memEmpty = e.getByRole('group', { name: 'No notes yet' })
    await seen(memEmpty, 'empty Memory: says what the notes are')
    await e.getByRole('button', { name: 'About you', exact: true }).click()
    await seen(e.getByRole('group', { name: 'Nothing about you yet' }), 'empty Memory, About you: its own words')
    await e.getByRole('group', { name: 'Nothing about you yet' }).getByRole('button', { name: 'Add a memory' }).click()
    await seen(e.getByRole('dialog').filter({ hasText: 'New memory' }), 'empty Memory: Add a memory opens the new memory sheet')
    await e.close()
    await mock({ empty: false })

    // The Scheduled card leads with its next run and its last result, in words, before the schedule.
    const c = await fresh(375, 812)
    await panelRow(c, /^Scheduled/)
    const card = c.locator('.card', { hasText: 'Morning brief' })
    await card.waitFor({ timeout: 5000 })
    const lines = (await card.innerText()).split('\n').map(x => x.trim()).filter(Boolean)
    check(lines[2] === 'No next run planned' && lines[3] === 'Hasn’t run yet' && lines[4] === '0 9 * * *', `Scheduled: the card leads with the next run and the last result, then the schedule (${JSON.stringify(lines.slice(0, 5))})`)
    // Touch targets on the page: the card's buttons and the top bar's.
    const small = []
    for (const b of await card.getByRole('button').all()) {
      const r = await b.boundingBox()
      if (r.height < 44) small.push([await b.innerText(), Math.round(r.height)])
    }
    check(small.length === 0, `Scheduled: every card button is at least 44 px tall (${JSON.stringify(small)})`)
    for (const name of ['Back', 'New job']) {
      const h = await hitArea(c.getByRole('button', { name, exact: true }).last())
      check(h.w >= 44 && h.h >= 44, `Scheduled: ${name} takes taps over at least 44 px (${JSON.stringify(h)})`)
    }
    // One bot: no bot in the top bar.
    check((await c.getByRole('note', { name: /^Bot:/ }).count()) === 0, 'one bot: the Scheduled top bar names no bot')
    await back(c)
    await panelRow(c, /^Skills/)
    await c.locator('.list-row').first().waitFor({ timeout: 5000 })
    check((await c.getByRole('note', { name: /^Bot:/ }).count()) === 0, 'one bot: the Skills top bar names no bot')
    const sw = await hitArea(c.getByRole('button', { name: 'Enabled', exact: true }).nth(1))
    check(sw.h >= 44, `Skills: a skill's switch takes taps over 44 px of height (${JSON.stringify(sw)})`)
    const pill = await c.getByRole('button', { name: 'Enabled', exact: true }).first().boundingBox()
    check(pill.height >= 44, `Skills: the Enabled pill is at least 44 px tall (${Math.round(pill.height)})`)
    await back(c)
    // Several bots: the top bar names the bot the page applies to.
    await mock({ bots: true })
    await c.reload()
    await c.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    await panelRow(c, /^Scheduled/)
    await seen(c.getByRole('note', { name: 'Bot: default' }), 'several bots: the Scheduled top bar names the bot')
    const bar = await c.locator('.screen .topbar').boundingBox()
    check(Math.round(bar.height) <= 57, `several bots: the top bar keeps its height with the bot in it (${Math.round(bar.height)})`)
    await back(c)
    await panelRow(c, /^Skills/)
    await seen(c.getByRole('note', { name: 'Bot: default' }), 'several bots: the Skills top bar names the bot')
    await back(c)
    await mock({ bots: false })
    await c.close()

    // 320 px: nothing wider than the screen. 1000 and 1400 px (the chat list docked beside the page): the content keeps a
    // centred maximum width.
    for (const [w, h] of [[320, 640], [1000, 760], [1400, 900]]) {
      const p = await fresh(w, h)
      for (const [name, open] of [['Scheduled', () => panelRow(p, /^Scheduled/)], ['Skills', () => panelRow(p, /^Skills/)], ['Files', () => library(p, 'Files')]]) {
        await open()
        await p.locator('.screen .screen-body > *').first().waitFor({ timeout: 5000 })
        await sleep(300) // the page's slide-in ends before its box is measured
        const m = await p.evaluate(() => {
          const body = document.querySelector('.screen .screen-body')
          const kids = [...body.children].map(k => k.getBoundingClientRect()).filter(r => r.width)
          const left = Math.min(...kids.map(r => r.left)), right = Math.max(...kids.map(r => r.right))
          const b = body.getBoundingClientRect()
          return { over: document.documentElement.scrollWidth > innerWidth + 1 || body.scrollWidth > body.clientWidth + 1, width: Math.round(right - left), gapL: Math.round(left - b.left), gapR: Math.round(b.right - right) }
        })
        if (w <= 320) check(!m.over, `320 px: ${name} is no wider than the screen (${JSON.stringify(m)})`)
        else check(!m.over && m.width <= 720 && Math.abs(m.gapL - m.gapR) <= 24 && (w < 1400 || m.gapL > 100), `${w} px: ${name}'s content keeps a centred maximum width (${JSON.stringify(m)})`)
        await back(p)
        await p.locator('.screen').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
      }
      if (w > 320) {
        // A sheet is centred at a maximum width too.
        await panelRow(p, /^Scheduled/)
        await p.getByRole('button', { name: 'New job' }).click()
        const sh = await p.getByRole('dialog').boundingBox()
        check(sh.width <= 640 && Math.abs(sh.x + sh.width / 2 - w / 2) <= 2, `${w} px: a sheet is centred at a maximum width (${JSON.stringify(sh)})`)
      }
      await p.close()
    }

    // Light theme: every word on these pages reaches 4.5:1 (3:1 when large), the empty states too.
    for (const empty of [false, true]) {
      await mock({ empty })
      const p = await fresh(375, 812, { 'hm.theme': 'light' })
      for (const [name, open] of [['Scheduled', () => panelRow(p, /^Scheduled/)], ['Skills', () => panelRow(p, /^Skills/)], ['Canvases', () => library(p, 'Canvases')], ['Files', () => library(p, 'Files')], ['Projects', () => library(p, 'Projects')]]) {
        await open()
        await sleep(800) // the page and its list have loaded and slid in before the colours are read
        const bad = await lowContrast(p, '.screen')
        check(bad.length === 0, `Light${empty ? ', empty' : ''}: ${name} has no text under 4.5:1 (${JSON.stringify(bad)})`)
        await back(p)
        await p.locator('.screen').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
      }
      await p.close()
    }
    await mock({ empty: false })

    // ── Scheduled jobs: validate schedule, catch server mismatch, verify deletes stick (F3) ──
    {
      const p = await fresh(375, 812)
      try {
        const since = Date.now()
        const cronPosts = () => calls().filter(c => c.t >= since && c.http === 'POST' && c.path === '/api/cron/jobs')
        const cronDels = () => calls().filter(c => c.t >= since && c.http === 'DELETE' && c.path?.startsWith('/api/cron/jobs/'))
        const cronPauses = () => calls().filter(c => c.t >= since && c.http === 'POST' && /^\/api\/cron\/jobs\/[^/]+\/pause$/.test(c.path || ''))

        // 1. Nonsense schedule "whenever" and unsupported "tomorrow 9am" are rejected before sending; Schedule stays disabled.
        await mock({ cronMode: { jobs: [] } })
        await panelRow(p, /^Scheduled/)
        await p.getByRole('button', { name: 'New scheduled job' }).click()
        const dlg = p.getByRole('dialog')
        await dlg.getByLabel('Name').fill('Bad job')
        await dlg.getByLabel('Schedule').fill('whenever')
        await dlg.getByLabel('What should Hermux do?').fill('Reply hi')
        await dlg.getByRole('alert').waitFor({ timeout: 3000 })
        const disWhenever = await dlg.getByRole('button', { name: 'Schedule', exact: true }).isDisabled()
        await dlg.getByLabel('Schedule').fill('tomorrow 9am')
        await dlg.getByRole('alert').waitFor({ timeout: 3000 })
        const disTomorrow = await dlg.getByRole('button', { name: 'Schedule', exact: true }).isDisabled()
        check(disWhenever && disTomorrow && cronPosts().length === 0, 'cron validation: "whenever" and "tomorrow 9am" show an error, disable Schedule and send nothing')

        // 2. Valid yearly cron "0 3 1 1 *" shows a Jan 1 preview and enables Schedule; if the server returns a mismatched
        // interval (every 30m), the app cancels/deletes it immediately and shows an error instead of "Scheduled".
        const badInterval = { schedule: { kind: 'interval', minutes: 30, display: 'every 30m' }, next_run_at: new Date(Date.now() + 30 * 60_000).toISOString() }
        await mock({ cronMode: { jobs: [], postOverride: badInterval } })
        await dlg.getByLabel('Schedule').fill('0 3 1 1 *')
        const preview = await dlg.getByRole('status').textContent()
        const enabledJan1 = !(await dlg.getByRole('button', { name: 'Schedule', exact: true }).isDisabled())
        check(enabledJan1 && /Will run:.*Jan.*03:00/i.test(preview || ''), `cron validation: "0 3 1 1 *" shows a Jan 1 03:00 preview (${preview})`)
        await dlg.getByRole('button', { name: 'Schedule', exact: true }).click()
        await p.locator('.toast', { hasText: /Job was not kept/ }).waitFor({ timeout: 5000 }).then(
          () => check(true, 'cron mismatch: server returning every 30m for 0 3 1 1 * is rejected with an error'),
          () => check(false, 'cron mismatch: server returning every 30m for 0 3 1 1 * is rejected with an error')
        )
        check(cronDels().some(c => c.path === '/api/cron/jobs/cj-1'), 'cron mismatch: the mis-scheduled job is deleted immediately')

        // 2b. When rollback itself fails (job stays in store or POST returned no id), the form closes and warns loudly
        // instead of claiming "Job was not kept".
        await mock({ cronMode: { jobs: [], postOverride: badInterval, deleteSticks: true } })
        await dlg.getByRole('button', { name: 'Schedule', exact: true }).click()
        await p.locator('.toast', { hasText: /automatic removal failed/ }).waitFor({ timeout: 5000 }).then(
          () => check(true, 'cron mismatch rollback failure: warns clearly and reveals the stuck job'),
          () => check(false, 'cron mismatch rollback failure: warns clearly and reveals the stuck job')
        )
        check((await p.getByText('Bad job', { exact: true }).count()) === 1, 'cron mismatch rollback failure: stuck job card is visible for manual deletion')

        await mock({ cronMode: { jobs: [], postOverride: badInterval, postNoId: true } })
        await p.getByRole('button', { name: 'New job' }).click()
        const dlgNoId = p.getByRole('dialog')
        await dlgNoId.getByLabel('Name').fill('No-id job')
        await dlgNoId.getByLabel('Schedule').fill('0 3 1 1 *')
        await dlgNoId.getByLabel('What should Hermux do?').fill('Reply hi')
        await dlgNoId.getByRole('button', { name: 'Schedule', exact: true }).click()
        await p.locator('.toast', { hasText: /returned no id/ }).waitFor({ timeout: 5000 }).then(
          () => check(true, 'cron mismatch rollback without id: warns clearly instead of claiming cancelled'),
          () => check(false, 'cron mismatch rollback without id: warns clearly instead of claiming cancelled')
        )
        check((await p.getByText('No-id job', { exact: true }).count()) === 1, 'cron mismatch rollback without id: job card is visible for manual deletion')

        // 2c. Editing a one-shot job whose schedule.display is human prose ("once in 30m") pre-fills schedule.run_at
        // so Save stays enabled; if PUT returns a mismatched next_run_at (even with prior last_run_at), the app pauses it.
        const oneShot = {
          id: 'j-once',
          name: 'One-shot job',
          schedule: { kind: 'once', display: 'once in 30m', run_at: '2027-01-01T09:00:00Z' },
          prompt: 'Remind me',
          last_run_at: new Date(Date.now() - 3600_000).toISOString(),
          next_run_at: '2027-01-01T09:00:00Z'
        }
        await mock({
          cronMode: {
            jobs: [oneShot],
            putOverride: { schedule: { kind: 'cron', expr: '0 3 1 1 *' }, next_run_at: new Date(Date.now() + 30 * 60_000).toISOString() }
          }
        })
        await back(p)
        await panelRow(p, /^Scheduled/)
        await p.getByText('One-shot job', { exact: true }).waitFor({ timeout: 5000 })
        await p.getByRole('button', { name: 'Edit', exact: true }).click()
        const editDlg = p.getByRole('dialog')
        const prefilled = await editDlg.getByLabel('Schedule').inputValue()
        const saveReady = !(await editDlg.getByRole('button', { name: 'Save', exact: true }).isDisabled())
        check(prefilled === '2027-01-01T09:00:00Z' && saveReady, `cron edit: one-shot job pre-fills run_at and keeps Save enabled (${prefilled})`)
        await editDlg.getByLabel('Schedule').fill('0 3 1 1 *')
        await editDlg.getByRole('button', { name: 'Save', exact: true }).click()
        await p.locator('.toast', { hasText: /paused so it won’t run at the wrong time/ }).waitFor({ timeout: 5000 }).then(
          () => check(true, 'cron edit mismatch: pauses the job when PUT returns a wrong next_run_at'),
          () => check(false, 'cron edit mismatch: pauses the job when PUT returns a wrong next_run_at')
        )
        check(cronPauses().some(c => c.path === '/api/cron/jobs/j-once/pause'), 'cron edit mismatch: calls /pause on the mismatched job')

        // 2d. A PUT reply that shows no schedule ({ ok: true }) is checked against the job read back from the list, so a
        // wrong stored schedule still pauses the job instead of toasting "Saved".
        const plainJob = { id: 'j-plain', name: 'Plain job', schedule: { kind: 'interval', minutes: 60, display: 'every 60m' }, prompt: 'Ping', next_run_at: new Date(Date.now() + 3600_000).toISOString() }
        await mock({ cronMode: { jobs: [plainJob], putMinimal: true, putOverride: badInterval } })
        await back(p)
        await panelRow(p, /^Scheduled/)
        await p.getByText('Plain job', { exact: true }).waitFor({ timeout: 5000 })
        await p.getByRole('button', { name: 'Edit', exact: true }).click()
        const minDlg = p.getByRole('dialog')
        await minDlg.getByLabel('Schedule').fill('0 3 1 1 *')
        await minDlg.getByRole('button', { name: 'Save', exact: true }).click()
        // (2c's toast may still be up: match this case's own reason)
        await p.locator('.toast', { hasText: /interval schedule instead of cron[\s\S]*was paused so it won’t run at the wrong time/ }).waitFor({ timeout: 5000 }).then(
          () => check(true, 'cron edit mismatch: a PUT reply without a schedule is checked against the job read back'),
          () => check(false, 'cron edit mismatch: a PUT reply without a schedule is checked against the job read back')
        )
        check(cronPauses().some(c => c.path === '/api/cron/jobs/j-plain/pause'), 'cron edit mismatch: the read-back mismatch pauses the job')

        // 2e. A mismatched edit of a job that is already paused is confirmed from a fresh list (not the PUT reply): the
        // toast says it stays paused (the old code trusted the reply and said it "was paused").
        const pausedJob = { ...plainJob, id: 'j-paused', name: 'Paused job', paused: true }
        await mock({ cronMode: { jobs: [pausedJob], putOverride: { ...badInterval, paused: true } } })
        await back(p)
        await panelRow(p, /^Scheduled/)
        await p.getByText('Paused job', { exact: true }).waitFor({ timeout: 5000 })
        await p.getByRole('button', { name: 'Edit', exact: true }).click()
        const pausedDlg = p.getByRole('dialog')
        await pausedDlg.getByLabel('Schedule').fill('0 3 1 1 *')
        await pausedDlg.getByRole('button', { name: 'Save', exact: true }).click()
        await p.locator('.toast', { hasText: /stays paused so it won’t run at the wrong time/ }).waitFor({ timeout: 5000 }).then(
          () => check(true, 'cron edit mismatch: an already-paused job is confirmed paused and the toast says it stays paused'),
          () => check(false, 'cron edit mismatch: an already-paused job is confirmed paused and the toast says it stays paused')
        )

        // 3. Delete that silently fails to remove the job from the store must NOT toast "Deleted" and must keep the job card.
        const stuckJob = { id: 'j-stuck', name: 'Stuck job', schedule: 'every 30m', prompt: 'Ping', next_run_at: new Date(Date.now() + 1800_000).toISOString() }
        await mock({ cronMode: { jobs: [stuckJob], deleteSticks: true } })
        await back(p)
        await panelRow(p, /^Scheduled/)
        await p.getByText('Stuck job', { exact: true }).waitFor({ timeout: 5000 })
        await p.getByRole('button', { name: 'Delete', exact: true }).click()
        await p.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
        await p.locator('.toast', { hasText: /still active/ }).waitFor({ timeout: 5000 }).then(
          () => check(true, 'cron delete: a job that stays in the list shows an error instead of "Deleted"'),
          () => check(false, 'cron delete: a job that stays in the list shows an error instead of "Deleted"')
        )
        check((await p.getByText('Stuck job', { exact: true }).count()) === 1, 'cron delete: the still-active job stays visible on screen')

        // 4. Real delete of a running job confirms removal and notes that the already-started run will finish.
        const runningJob = { ...stuckJob, fire_claim: 'claim-1' }
        await mock({ cronMode: { jobs: [runningJob], deleteSticks: false } })
        await back(p)
        await panelRow(p, /^Scheduled/)
        await p.getByText('Stuck job', { exact: true }).waitFor({ timeout: 5000 })
        await p.getByRole('button', { name: 'Delete', exact: true }).click()
        await p.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
        await p.locator('.toast', { hasText: /Deleted\. A run that had already started will finish\./ }).waitFor({ timeout: 5000 }).then(
          () => check(true, 'cron delete: deleting a running job notes that the started run will finish'),
          () => check(false, 'cron delete: deleting a running job notes that the started run will finish')
        )
        await p.getByText('Nothing scheduled yet', { exact: true }).waitFor({ timeout: 5000 })
        await back(p)
        await p.getByRole('button', { name: /^Sessions/ }).click()
        await p.getByRole('button', { name: /^Scheduled.*None yet/ }).waitFor({ timeout: 5000 }).then(
          () => check(true, 'cron delete: side panel updates to "None yet" right away'),
          () => check(false, 'cron delete: side panel updates to "None yet" right away')
        )
      } finally {
        await mock({ cronMode: null })
        await p.close()
      }
    }
  }
}
