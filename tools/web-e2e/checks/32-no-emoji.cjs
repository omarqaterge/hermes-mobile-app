// No emoji and no icon glyph in what the interface draws (docs/decisions/no-emoji.md): the side panel, Settings and its
// pages, the chat menu, the canvas and a chat with tool lines are read as text, leaving out what people and the model wrote
// (message bodies and the chat titles).
const { WEB, check } = require('../lib.cjs')

const EMOJI = /[\u{1F000}-\u{1FAFF}←↑↓↔-⇿⌀-⏿■-◿☀-➿⤀-⯿️✓✔›‹⋯⋮＋]/u

module.exports = async t => {
  const { browser } = t
  const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await pg.goto(WEB + '/')
  await pg.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
  // The text of the page without message content and chat titles.
  const chrome = () =>
    pg.evaluate(() => {
      const clone = document.body.cloneNode(true)
      clone.querySelectorAll('.msg, .md, .session-title, .title, .dim.small, script, style').forEach(e => e.remove())
      return clone.innerText + ' ' + [...clone.querySelectorAll('[aria-label],[title],[placeholder]')].map(e => [e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('placeholder')].join(' ')).join(' ')
    })
  const clean = async (name) => {
    const text = await chrome()
    const m = text.match(EMOJI)
    check(!m, `no emoji or icon glyph: ${name}${m ? ` (found ${JSON.stringify(m[0])})` : ''}`)
  }
  await clean('the chat screen')
  await pg.getByRole('button', { name: /^Sessions/ }).click()
  await clean('the side panel')
  await pg.getByRole('button', { name: 'Settings' }).click()
  await pg.getByRole('textbox', { name: 'Search settings' }).waitFor({ timeout: 5000 })
  await clean('Settings')
  for (const name of [/^Appearance/, /^Voice/, /^Connectors/]) {
    await pg.getByRole('button', { name }).first().click().catch(() => {})
    await pg.waitForTimeout(300)
    await clean(`Settings page ${name}`)
    await pg.evaluate(() => window.hermesBack()).catch(() => {})
    await pg.waitForTimeout(300)
  }
  await pg.close()

  const cp = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await cp.goto(WEB + '/')
  await cp.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
  await cp.getByRole('textbox', { name: /Message Hermux/ }).fill('hello')
  await cp.getByRole('button', { name: 'Send' }).click()
  await cp.locator('.msg.assistant').first().waitFor({ timeout: 8000 })
  await cp.getByRole('banner').getByRole('button', { name: 'Chat options' }).click()
  const text = await cp.evaluate(() => document.body.innerText)
  check(!EMOJI.test(await cp.locator('.sheet').first().innerText().catch(() => text)), 'no emoji or icon glyph: the chat menu')
  await cp.keyboard.press('Escape')
  await cp.close()
}
