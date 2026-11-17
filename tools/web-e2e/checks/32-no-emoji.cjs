// No emoji and no icon glyph in what the interface draws (docs/decisions/no-emoji.md). Regions are found by role and
// name; nothing is left out of the text read, because the test's own chat is plain ASCII (its prompts, the mock's replies
// and chat titles), so any emoji or glyph found is the interface's. The text read is what is drawn plus every accessible
// name, title and placeholder inside the region.
const { WEB, check } = require('../lib.cjs')

const EMOJI = /[\u{1F000}-\u{1FAFF}←↑↓↔-⇿⌀-⏿■-◿☀-➿⤀-⯿️✓✔›‹⋯⋮＋－]/u

const readOf = loc =>
  loc.evaluate(el => {
    const attrs = [...el.querySelectorAll('[aria-label],[title],[placeholder]')].map(e => [e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('placeholder')].filter(Boolean).join(' '))
    return `${el.innerText}\n${attrs.join('\n')}`
  })

module.exports = async t => {
  const { browser } = t
  const clean = async (name, loc, mustHave) => {
    const shown = await loc.waitFor({ timeout: 5000 }).then(() => true, () => false)
    if (!shown) return check(false, `no emoji or icon glyph: ${name} (it did not open)`)
    const text = await readOf(loc)
    const m = text.match(EMOJI)
    const there = !mustHave || text.includes(mustHave)
    check(!m && there, `no emoji or icon glyph: ${name}${m ? ` (found ${JSON.stringify(m[0])})` : ''}${there ? '' : ` (the region did not hold "${mustHave}")`}`)
  }
  const open = async () => {
    const p = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await p.goto(WEB + '/')
    await p.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
    return p
  }
  const send = async (p, text, done) => {
    await p.getByPlaceholder('Message Hermux').fill(text)
    await p.getByRole('button', { name: 'Send' }).click()
    await p.getByText(done, { exact: false }).first().waitFor({ timeout: 8000 })
  }

  // ── the chat screen, the side panel, Settings and three of its pages ──
  {
    const p = await open()
    await clean('the chat screen', p.locator('body'))
    await clean('the header', p.getByRole('banner'))
    await p.getByRole('button', { name: /^Sessions/ }).click()
    await clean('the side panel', p.getByRole('complementary'), 'Settings')
    await p.getByRole('button', { name: 'Settings' }).click()
    await p.getByRole('textbox', { name: 'Search settings' }).waitFor({ timeout: 5000 })
    await clean('Settings', p.locator('body'), 'Appearance')
    for (const name of [/^Appearance/, /^Voice/, /^Connectors/]) {
      await p.getByRole('button', { name }).first().click()
      await p.waitForTimeout(300)
      await clean(`Settings page ${name}`, p.locator('body'))
      await p.evaluate(() => window.hermesBack())
      await p.waitForTimeout(300)
    }
    await p.close()
  }

  // ── the chat menu, and a chat with tool lines and a task card ──
  {
    const p = await open()
    await send(p, 'use tools', 'All four done.')
    await p.getByRole('banner').getByRole('button', { name: 'Chat options' }).click()
    await clean('the chat menu', p.getByRole('dialog'), 'Rename')
    await p.evaluate(() => window.hermesBack()) // Android Back closes the sheet
    await p.waitForTimeout(300)
    const folded = p.getByRole('button', { name: /Ran 2 commands/ }).last()
    await folded.click()
    await clean('a chat with tool lines (the run opened)', p.locator('body'), 'Ran echo')
    await send(p, 'plan it', 'Planned.')
    await p.getByRole('button', { name: /Updated tasks/ }).last().click()
    await clean('a task card with its steps', p.locator('body'), 'Read')
    await p.close()
  }

  // ── the canvas: the panel and its toolbar, its New document menu, its options menu, the editor bar ──
  {
    const p = await open()
    await p.getByRole('button', { name: 'Canvas' }).first().click()
    const panel = p.getByRole('dialog', { name: 'Canvas' })
    await clean('the canvas panel (empty)', panel, 'Your canvas is empty')
    await p.getByRole('button', { name: 'New document' }).first().click()
    await clean('the canvas New document menu', p.getByRole('dialog').last(), 'Notes / document')
    await p.getByRole('button', { name: /Notes \/ document/ }).click()
    await p.getByRole('alertdialog').getByRole('textbox').fill('Plan')
    await p.getByRole('alertdialog').getByRole('button', { name: 'Create' }).click()
    await p.getByRole('button', { name: 'Edit', exact: true }).waitFor({ timeout: 5000 })
    await clean('the canvas toolbar', panel, 'Edit')
    await p.getByRole('button', { name: 'Edit', exact: true }).click()
    await clean('the canvas editor bar', panel, 'Undo')
    await p.getByRole('button', { name: 'More' }).click()
    await clean('the canvas options menu', p.getByRole('dialog').last(), 'Rename')
    await p.close()
  }
}
