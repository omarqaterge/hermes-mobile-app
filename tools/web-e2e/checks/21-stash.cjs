// Composer stash.
const { WEB, check } = require('../lib.cjs')

module.exports = async t => {
  const { browser } = t
  // ── composer stash (stash.ts): put a draft aside from the Add sheet ──
  {
    const sp = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await sp.goto(WEB + '/')
    const sbox = sp.getByPlaceholder('Message Hermes')
    await sbox.waitFor({ timeout: 15000 })
    const addBtn = () => sp.getByRole('button', { name: 'Add', exact: true }).click()
    const stored = () => sp.evaluate(() => JSON.parse(localStorage.getItem('hm.stash.v1') || '[]').map(s => s.text))
    await addBtn()
    check((await sp.locator('.picker-opt', { hasText: 'Stash draft' }).count()) === 0 && (await sp.locator('.picker-opt', { hasText: 'Stashed drafts' }).count()) === 0, 'stash: an empty box and no stashes shows neither option')
    await sp.evaluate(() => window.hermesBack())
    await sp.locator('.picker').waitFor({ state: 'detached', timeout: 3000 })
    await sbox.fill('half written')
    await addBtn()
    await sp.locator('.picker-opt', { hasText: 'Stash draft' }).click()
    await sp.locator('.picker').waitFor({ state: 'detached', timeout: 3000 })
    check((await sbox.inputValue()) === '' && JSON.stringify(await stored()) === '["half written"]', 'stash: Stash draft empties the box and stores the text')
    await sbox.fill('other')
    await addBtn()
    check((await sp.locator('.picker-opt', { hasText: 'Stashed drafts (1)' }).count()) === 1, 'stash: the Add sheet counts the stashes')
    await sp.locator('.picker-opt', { hasText: 'Stashed drafts (1)' }).click()
    await sp.locator('.picker-opt', { hasText: 'half written' }).click()
    await sp.locator('.picker').waitFor({ state: 'detached', timeout: 3000 })
    check((await sbox.inputValue()) === 'half written' && JSON.stringify(await stored()) === '["other"]', 'stash: picking a stash with text in the box swaps them')
    await sbox.fill('')
    await addBtn()
    await sp.locator('.picker-opt', { hasText: 'Stashed drafts (1)' }).click()
    await sp.locator('.picker-opt', { hasText: 'Clear all stashed drafts' }).click()
    await sp.locator('.dialog button', { hasText: 'Clear' }).last().click()
    await sp.locator('.dialog').waitFor({ state: 'detached', timeout: 3000 })
    await addBtn()
    check((await sp.locator('.picker-opt', { hasText: 'Stashed drafts' }).count()) === 0 && (await stored()).length === 0, 'stash: Clear all stashed drafts removes them')
    await sp.close()
  }
}
