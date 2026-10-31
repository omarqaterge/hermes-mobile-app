// The "New since your last visit" divider.
const { sleep, check } = require('../lib.cjs')

module.exports = async t => {
  const { browser } = t
  // ── "New since your last visit" divider (visit.ts) ──
  {
    const vp = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await vp.addInitScript(() => {
      if (!sessionStorage.getItem('visit-seeded')) {
        sessionStorage.setItem('visit-seeded', '1')
        localStorage.setItem('hm.visit.v1', JSON.stringify({ 's-7': 1790000030 * 1000, 's-visit': 1790000100 * 1000 }))
      }
      localStorage.setItem('hm.lastSession', JSON.stringify({ id: 's-7', profile: 'default' }))
    })
    await vp.goto('http://127.0.0.1:5180/')
    await vp.locator('.msg.assistant', { hasText: 'answer s-7' }).waitFor({ timeout: 5000 })
    check((await vp.locator('.visit-divider').count()) === 1 && (await vp.locator('.visit-divider').textContent()) === 'New since your last visit', 'visit: the divider shows in a chat with newer messages')
    check((await vp.locator('.visit-divider').getAttribute('role')) === 'separator', 'visit: the divider has the separator role')
    check(await vp.evaluate(() => { const d = document.querySelector('.visit-divider'); return !!d && d.parentElement.parentElement.classList.contains('chat') && d.parentElement.querySelector('.msg.assistant')?.textContent.includes('answer s-7') }), 'visit: the divider sits in the wrapper of the first unseen message, one child of the chat')
    check(await vp.evaluate(() => [...document.querySelector('.chat').children].filter(c => c.matches('.msg.user, .msg.assistant') || c.querySelector('.msg.user, .msg.assistant')).length === 2), 'visit: the chat still has one element per message')
    await vp.evaluate(() => window.hermesOpenSession('s-5'))
    await vp.locator('.msg.assistant', { hasText: 'answer s-5' }).waitFor({ timeout: 5000 })
    check((await vp.locator('.visit-divider').count()) === 0, 'visit: a chat never opened before has no divider')
    await vp.evaluate(() => window.hermesOpenSession('s-7'))
    await vp.locator('.msg.assistant', { hasText: 'answer s-7' }).waitFor({ timeout: 5000 })
    check((await vp.locator('.visit-divider').count()) === 0, 'visit: reopening a chat after leaving it shows no divider')
    check(await vp.evaluate(() => Number(JSON.parse(localStorage.getItem('hm.visit.v1'))['s-7']) > 1790000030 * 1000), 'visit: leaving a chat stores the visit time')
    // scroll: the divider opens near the top of the chat, not at the end
    await vp.evaluate(() => window.hermesOpenSession('s-visit'))
    await vp.locator('.visit-divider').waitFor({ timeout: 5000 })
    await sleep(400)
    {
      const db = await vp.locator('.visit-divider').boundingBox()
      const cb = await vp.locator('.chat').boundingBox()
      check(db && cb && db.y >= cb.y && db.y - cb.y < 40, `visit: the chat opens with the divider near the top (${db && cb && Math.round(db.y - cb.y)} px below it)`)
      check(await vp.evaluate(() => document.querySelector('.visit-divider').parentElement.querySelector('.msg.user')?.textContent === 'visit question 2'), 'visit: the divider is right before the first unseen question')
    }
    // away and back with the same chat open (Home while Hermes answers): the shell's hermesPause / hermesResume
    await vp.evaluate(() => window.hermesOpenSession('s-5'))
    await vp.locator('.msg.assistant', { hasText: 'answer s-5' }).waitFor({ timeout: 5000 })
    await vp.getByPlaceholder('Message Hermes').fill('slow reply')
    await vp.locator('.composer').getByRole('button', { name: 'Send' }).click()
    await vp.locator('.msg.assistant', { hasText: 'Slow done.' }).waitFor({ timeout: 5000 })
    await vp.getByPlaceholder('Message Hermes').waitFor({ timeout: 5000 })
    check((await vp.locator('.visit-divider').count()) === 0, 'visit: a reply watched on screen gets no divider')
    await vp.getByPlaceholder('Message Hermes').fill('slow reply')
    await vp.locator('.composer').getByRole('button', { name: 'Send' }).click()
    await vp.evaluate(() => window.hermesPause()) // Home right after sending: the reply starts 300 ms later
    await sleep(2200)
    check((await vp.locator('.visit-divider').count()) === 0, 'visit: no divider while the app is away')
    await vp.evaluate(() => window.hermesResume())
    await vp.locator('.visit-divider').waitFor({ timeout: 3000 }).catch(() => {})
    check(await vp.evaluate(() => { const d = document.querySelector('.visit-divider'); return !!d && d.parentElement.parentElement.classList.contains('chat') && (() => { const r = [...document.querySelectorAll('.msg.assistant')].filter(m => m.textContent.includes('Slow done.')); return r.length === 2 && d.parentElement.contains(r[1]) && !d.parentElement.contains(r[0]) })() }), 'visit: back in the app with the chat still open, the divider is before the reply that came meanwhile')
    await vp.close()
  }
}
