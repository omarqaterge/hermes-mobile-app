// Files and its previews, Projects, Cron, the title menu and Chat details.
const { calls, sleep, check } = require('../lib.cjs')

module.exports = async t => {
  const { page } = t
  // ── #21 Files: Back goes up one folder, then leaves ──
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.locator('.nav-tile', { hasText: 'Hermes' }).click()
  await page.locator('.hub-card', { hasText: 'Files' }).click()
  const crumbText = () => page.locator('.crumbs').textContent()
  await page.locator('.file-row', { hasText: /^📁a/ }).click()
  await page.locator('.crumbs', { hasText: 'sdcard/a/' }).waitFor({ timeout: 5000 })
  await page.locator('.file-row', { hasText: /^📁b/ }).click()
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
  check((await page.locator('.hub-card').count()) === 6, '…back to the Hermes hub that opened it')
  await page.evaluate(() => window.hermesBack())
  await sleep(200)
  check((await page.locator('.hub-card').count()) === 0, 'Back again closes the hub')

  // ── Files previews: table, code, page, player, and the note for files with no preview ──
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.locator('.nav-tile', { hasText: 'Hermes' }).click()
  await page.locator('.hub-card', { hasText: 'Files' }).click()
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
  // Back out of Files (at its root chip) and then out of the hub, waiting for each to close.
  await page.evaluate(() => window.hermesBack())
  await page.locator('.crumbs').waitFor({ state: 'detached', timeout: 5000 })
  await page.evaluate(() => window.hermesBack())
  await page.locator('.hub-card').first().waitFor({ state: 'detached', timeout: 5000 })

  // ── #22 Projects: tap a chat to open it ──
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.locator('.nav-tile', { hasText: 'Hermes' }).click()
  await page.locator('.hub-card', { hasText: 'Projects' }).click()
  await page.locator('.card', { hasText: 'Thesis' }).click()
  await page.locator('.project-chat', { hasText: 'Chat 4' }).click({ timeout: 5000 })
  await page.locator('.msg.assistant', { hasText: 'answer s-4' }).waitFor({ timeout: 5000 }).then(() => check(true, 'project chat opens'), () => check(false, 'project chat opens'))
  check((await page.locator('.card', { hasText: 'Thesis' }).count()) === 0, 'Projects screen closed')

  // ── #23 Cron: edit a job (falls back to replace when PUT isn't there), open a run's output ──
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.locator('.nav-tile', { hasText: 'Hermes' }).click()
  await page.locator('.hub-card', { hasText: 'Scheduled jobs' }).click()
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

  // ── #26 title tap = the ⋮ menu; Chat details is read-only ──
  await page.locator('header.topbar .title-btn').click()
  await page.locator('.menu-item', { hasText: 'Chat details' }).click({ timeout: 3000 })
  const details = page.locator('.sheet', { hasText: 'Chat details' })
  await details.waitFor({ timeout: 3000 })
  check((await details.locator('input').count()) === 0 && (await details.getByRole('button', { name: /Delete|Undo/ }).count()) === 0, 'details sheet has no duplicate actions')
  await page.evaluate(() => window.hermesBack())
}
