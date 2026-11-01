// Settings → About → What's new: the changelog of every release since the installed version, under the update row.
const { WEB, check, nativeShell } = require('../lib.cjs')

const LOG = `# What's new

## Unreleased

- **Not out yet.**

## v0.8.70 (2026-11-03)

- **Newest thing.**

## v0.8.69 (2026-11-02)

- **Middle thing.**

## v0.8.68 (2026-11-01)

- **Installed thing.**
`

module.exports = async t => {
  const { browser } = t
  // A page in the app shell with version `installed`; GitHub answers with release `tag` and the changelog above.
  const open = async (installed, tag, { changelog = true } = {}) => {
    const pg = await browser.newPage({ viewport: { width: 375, height: 812 } })
    const asked = []
    await pg.route('https://api.github.com/**', route => {
      const u = route.request().url()
      asked.push(u)
      if (u.includes('/releases/latest'))
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ tag_name: tag, assets: [{ name: 'hermes-mobile.apk', browser_download_url: `https://github.com/omarqaterge/hermes-mobile-app/releases/download/${tag}/hermes-mobile.apk` }] }) })
      if (u.includes('/contents/CHANGELOG.md') && changelog)
        return route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: LOG })
      return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' })
    })
    await pg.addInitScript(v => { window.__appVersion = v }, installed)
    await pg.addInitScript(nativeShell)
    await pg.addInitScript(() => { window.HermesAndroid.installUpdate = (key, url) => (window.__installed ||= []).push(url) })
    await pg.goto(WEB + '/')
    await pg.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    await pg.getByRole('button', { name: /^Sessions/ }).click()
    await pg.locator('.nav-tile', { hasText: 'Settings' }).click()
    await pg.locator('.screen .title', { hasText: 'Settings' }).waitFor({ timeout: 5000 })
    return { pg, asked }
  }

  {
    const { pg, asked } = await open('0.8.68', 'v0.8.70')
    const row = pg.locator('button.set-row', { hasText: "What's new" })
    await row.waitFor({ timeout: 5000 })
    check((await row.innerText()).includes('2 versions since yours (0.8.68)'), `what's new: the row counts the versions since the installed one (${await row.innerText()})`)
    check(asked.some(u => u.includes('/contents/CHANGELOG.md?ref=v0.8.70')), "what's new: the changelog is read at the release's tag")
    await row.click()
    const sheet = pg.locator('.sheet', { hasText: "What's new" })
    await sheet.waitFor({ timeout: 3000 })
    const heads = await sheet.locator('.whats-new-version').allInnerTexts()
    check(heads.length === 2 && heads[0].startsWith('0.8.70') && heads[1].startsWith('0.8.69') && heads[0].includes('2026-11-03'), `what's new: newest first, with dates, only newer versions (${JSON.stringify(heads)})`)
    const text = await sheet.innerText()
    check(text.includes('Newest thing.') && text.includes('Middle thing.') && !text.includes('Installed thing.') && !text.includes('Not out yet.'), "what's new: the sections' text, without the installed version or Unreleased")
    check((await sheet.locator('strong', { hasText: 'Newest thing.' }).count()) === 1, "what's new: the notes are rendered as Markdown")
    await sheet.locator('button', { hasText: 'Update to 0.8.70' }).click()
    await sheet.waitFor({ state: 'detached', timeout: 3000 })
    check(JSON.stringify(await pg.evaluate(() => window.__installed)) === '["https://github.com/omarqaterge/hermes-mobile-app/releases/download/v0.8.70/hermes-mobile.apk"]', "what's new: Update in the sheet starts the download")
    await pg.close()
  }
  {
    const { pg } = await open('0.8.69', 'v0.8.70')
    const row = pg.locator('button.set-row', { hasText: "What's new" })
    await row.waitFor({ timeout: 5000 })
    check((await row.innerText()).includes('In 0.8.70'), "what's new: one version says which")
    await pg.close()
  }
  {
    const { pg } = await open('0.8.70', 'v0.8.70')
    await pg.locator('.set-sub', { hasText: "You're on the latest version" }).waitFor({ timeout: 5000 })
    check((await pg.locator('button.set-row', { hasText: "What's new" }).count()) === 0, "what's new: no row when the app is up to date")
    await pg.close()
  }
  {
    const { pg } = await open('0.8.68', 'v0.8.70', { changelog: false })
    await pg.locator('.set-title', { hasText: 'Update to 0.8.70' }).waitFor({ timeout: 5000 })
    await pg.waitForTimeout(500)
    check((await pg.locator('button.set-row', { hasText: "What's new" }).count()) === 0, "what's new: no changelog, no row, and the update row still offers the update")
    await pg.close()
  }
}
