// What the interface costs at the moments a person feels: start-up, opening a chat, the first words of a streamed reply,
// scrolling a long chat, opening the chat list and scrolling it, in a desktop browser with the CPU slowed down (4× by default).
// Needs the page and the mock running (`run.sh --serve` in another shell, with the same HM_E2E_* ports if it chose others).
//   node uicost.cjs [--runs 5] [--throttle 4] [--motion off|reduced|full] [--glass on|off]
// Opening the chat list, opening a chat from it and the first words of a reply are tapped and timed inside the page,
// frame by frame (start-up from the navigation until the reply shows).
// Prints, per moment, the median over the runs of: the time until the result shows (ms) and the main thread's work
// meanwhile (ms of tasks); for scrolling, frames slower than 25 ms and the 95th percentile frame. Compare a change with
// the build before it, on the same machine, with the same options (docs/performance-history.md).
const { chromium } = require('playwright')
const { MOCK, WEB, sleep } = require('./lib.cjs')

const opt = (name, dflt) => {
  const i = process.argv.indexOf('--' + name)
  return i > 0 ? process.argv[i + 1] : dflt
}
const runs = Number(opt('runs', 5))
const throttle = Number(opt('throttle', 4))
const motion = opt('motion', '') // empty: whatever the app chooses by itself
const glass = opt('glass', '')

async function open(browser, chat) {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await page.addInitScript(([b, chat, motion, glass]) => {
    window.__hmMockBase = b
    try {
      localStorage.setItem('hm.connectedOnce', '1')
      if (chat && !sessionStorage.getItem('opened')) {
        sessionStorage.setItem('opened', '1')
        localStorage.setItem('hm.lastSession', JSON.stringify({ id: chat, profile: 'default' }))
      }
      if (motion) localStorage.setItem('hm.motion', motion)
      if (glass) localStorage.setItem('hm.glass', glass === 'off' ? '0' : '1')
    } catch { /* */ }
  }, [MOCK, chat, motion, glass])
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })
  const work = async () => (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'TaskDuration').value * 1000
  return { page, cdp, work }
}

// Runs `act` and waits for `done`; returns the time it took and the main thread's work meanwhile.
async function timed(work, act, done) {
  const w0 = await work()
  const t0 = Date.now()
  await act()
  await done()
  return { ms: Date.now() - t0, work: (await work()) - w0 }
}

// Taps `selector` (or the innermost element whose text is `text`) inside the page and counts frames until `shown()`
// holds; returns that time and the main thread's work meanwhile.
async function inPage(page, work, selector, text, shown) {
  const w0 = await work()
  const ms = await page.evaluate(([selector, text, shown]) => new Promise((res, rej) => {
    const ok = new Function('return (' + shown + ')()')
    const el = selector ? document.querySelector(selector) : [...document.querySelectorAll('body *')].reverse().find(e => e.textContent === text)
    if (!el) return rej(new Error('nothing to tap: ' + (selector || text)))
    const t0 = performance.now()
    el.click()
    const tick = () => (ok() ? res(performance.now() - t0) : performance.now() - t0 > 10000 ? rej(new Error('never shown')) : requestAnimationFrame(tick))
    requestAnimationFrame(tick)
  }), [selector, text, shown.toString()])
  return { ms: Math.round(ms), work: (await work()) - w0 }
}

// Scrolls the box `find()` returns by `by` px a frame for `n` frames; frame times from requestAnimationFrame.
async function frameScroll(page, work, find, n, by) {
  const w0 = await work()
  const frames = await page.evaluate(([find, n, by]) => new Promise((res, rej) => {
    const sc = new Function('return (' + find + ')()')()
    if (!sc) return rej(new Error('nothing to scroll'))
    const ts = []
    let i = 0
    const step = t => {
      ts.push(t)
      sc.scrollTop += by
      if (++i < n) requestAnimationFrame(step)
      else res(ts.slice(1).map((x, j) => x - ts[j]))
    }
    requestAnimationFrame(step)
  }), [find.toString(), n, by])
  const sorted = [...frames].sort((a, b) => a - b)
  return { ms: Math.round(frames.reduce((a, b) => a + b, 0)), work: (await work()) - w0, slow: frames.filter(f => f > 25).length, p95: sorted[Math.floor(sorted.length * 0.95)] }
}

async function one(browser) {
  const out = {}
  // Start-up: the page loads with the last chat, until its reply is on screen.
  {
    const { page, work } = await open(browser, 's-48')
    out.startup = await timed(work, () => page.goto(WEB + '/'), () => page.getByText('answer s-48', { exact: true }).waitFor({ timeout: 30000 }))
    await sleep(1500)
    // Opening the chat list: the Sessions button until the list has slid in and its rows show; then opening a chat
    // from it, until its reply shows. Both are tapped and timed inside the page (frame by frame): Playwright's own click
    // first waits for the target to stand still and its waits poll in steps, which would count as the page's time.
    out.list = await inPage(page, work, `button[aria-label^="Sessions"]`, null, () => {
      const d = document.querySelector('[role="complementary"]') || document.querySelector('aside')
      const l = d && d.getBoundingClientRect().left // in place: at the edge (docked, or the full-height drawer before the side panel) or the sheet's 8 px in
      return !!d && (Math.abs(l) < 1 || Math.abs(l - 8) < 1) && d.textContent.includes('Chat 46')
    })
    // The list's rows finish arriving first (untimed).
    await page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity), null, { timeout: 3000 }).catch(() => {})
    // Scrolling the chat list: 60 frames of 40 px down its scrolling area, then back to the top (untimed).
    out.listScroll = await frameScroll(page, work, () => {
      const d = document.querySelector('[role="complementary"]') || document.querySelector('aside')
      return d && [...d.querySelectorAll('*')].find(e => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight)
    }, 60, 40)
    await page.evaluate(() => { const d = document.querySelector('[role="complementary"]') || document.querySelector('aside'); for (const e of d.querySelectorAll('*')) e.scrollTop = 0 })
    await sleep(300)
    out.chat = await inPage(page, work, null, 'Chat 46', () => [...document.querySelectorAll('.msg.assistant')].some(e => e.textContent.includes('answer s-46')))
    await sleep(800)
    // The first words of a streamed reply, from Send.
    await page.getByPlaceholder('Message Hermux').fill('bench stream 1500 40')
    out.stream = await inPage(page, work, 'button.send[aria-label="Send"]', null, () => [...document.querySelectorAll('.msg.assistant')].some(e => e.textContent.includes('Step 1: checking the result')))
    await page.close()
  }
  // Scrolling a long chat: 90 frames of 40 px upwards, frame times from requestAnimationFrame.
  {
    const { page, work } = await open(browser, 's-long')
    await page.goto(WEB + '/')
    await page.getByText('answer 149', { exact: true }).waitFor({ timeout: 30000 })
    await sleep(1500)
    out.scroll = await frameScroll(page, work, () => {
      let sc = [...document.querySelectorAll('strong')].find(e => e.textContent === 'answer 149')
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
      return sc
    }, 90, -40)
    await page.close()
  }
  return out
}

;(async () => {
  const home = await fetch(MOCK + '/').then(r => r.text(), () => '')
  if (!home.includes('MOCK-HERMES')) {
    console.error(`${MOCK} is not the mock: start it with run.sh --serve`)
    process.exit(3)
  }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined })
  const all = []
  for (let i = 0; i < runs; i++) {
    const r = await one(browser)
    all.push(r)
    console.log(`run ${i + 1}: ` + Object.entries(r).map(([k, v]) => `${k} ${v.ms} ms / ${Math.round(v.work)} ms work${v.slow != null ? ` / ${v.slow} slow frames, p95 ${v.p95.toFixed(1)} ms` : ''}`).join('; '))
  }
  await browser.close()
  const med = (k, f) => all.map(r => r[k][f]).sort((a, b) => a - b)[Math.floor(all.length / 2)]
  console.log(`median of ${runs}, CPU ×${throttle}${motion ? `, motion ${motion}` : ''}${glass ? `, glass ${glass}` : ''}:`)
  for (const [k, name] of [['startup', 'start-up'], ['chat', 'opening a chat'], ['stream', 'first words of a reply'], ['scroll', 'scrolling a long chat'], ['list', 'opening the chat list'], ['listScroll', 'scrolling the chat list']]) {
    console.log(`  ${name.padEnd(24)} ${String(med(k, 'ms')).padStart(6)} ms, main thread ${String(Math.round(med(k, 'work'))).padStart(5)} ms${k === 'scroll' || k === 'listScroll' ? `, ${med(k, 'slow')} frames over 25 ms, p95 ${med(k, 'p95').toFixed(1)} ms` : ''}`)
  }
})()
