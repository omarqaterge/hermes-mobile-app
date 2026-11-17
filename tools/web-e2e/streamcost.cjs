// What a streamed reply costs the page: main-thread CPU while the mock streams a Markdown reply at a model's pace.
// Needs the page and the mock running (`run.sh --serve` in another shell, with the same HM_E2E_* ports if it chose others).
//   node streamcost.cjs [chars=8000] [--gap 40] [--runs 3] [--throttle 4] [--top 25]
// Prints, per run and as a median: seconds of main-thread work (all tasks, script, layout, style), tasks over 50 ms,
// and how long the turn took. --top N also prints the N functions with the most own time from a CPU profile of the
// last run (HM_PROFILE_OUT=file saves that profile, for a closer look; build with `vite build --minify false` to get
// real function names). The numbers are a desktop browser's: compare a change with the build before it, on the same
// machine.
const { chromium } = require('playwright')
const { MOCK, WEB, sleep } = require('./lib.cjs')

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name)
  return i > 0 ? Number(process.argv[i + 1]) : dflt
}
const chars = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 8000
const gap = arg('gap', 40)
const runs = arg('runs', 3)
const throttle = arg('throttle', 1)
const top = arg('top', 0)

async function one(browser, profile) {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } })
  await page.addInitScript(b => {
    window.__hmMockBase = b
    try { localStorage.setItem('hm.connectedOnce', '1') } catch { /* */ }
    window.__long = 0
    new PerformanceObserver(l => { window.__long += l.getEntries().length }).observe({ entryTypes: ['longtask'] })
  }, MOCK)
  await page.goto(WEB + '/')
  await page.getByPlaceholder('Message Hermux').waitFor({ timeout: 15000 })
  await sleep(1500) // a fixed wait on purpose: the page's start-up requests must be over before the measuring starts
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
  if (profile) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.start')
  }
  await page.evaluate(() => { window.__long = 0 })
  const before = await metrics()
  const t0 = Date.now()
  await page.getByPlaceholder('Message Hermux').fill(`bench stream ${chars} ${gap}`)
  await page.getByRole('button', { name: 'Send' }).click()
  await page.locator('.msg.assistant .caret').waitFor({ timeout: 15000 })
  await page.locator('.msg.assistant .msg-actions').last().waitFor({ timeout: 600000 })
  const wall = (Date.now() - t0) / 1000
  const after = await metrics()
  const long = await page.evaluate(() => window.__long)
  let hot = null
  if (profile) {
    const { profile: p } = await cdp.send('Profiler.stop')
    if (process.env.HM_PROFILE_OUT) require('fs').writeFileSync(process.env.HM_PROFILE_OUT, JSON.stringify(p))
    const dt = p.timeDeltas, own = new Map()
    p.samples.forEach((id, i) => own.set(id, (own.get(id) || 0) + (dt[i] || 0)))
    const by = new Map()
    for (const n of p.nodes) {
      const f = n.callFrame
      const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber}:${f.columnNumber}`
      by.set(key, (by.get(key) || 0) + (own.get(n.id) || 0))
    }
    hot = [...by].sort((a, b) => b[1] - a[1]).slice(0, top)
  }
  await page.close()
  const d = k => after[k] - before[k]
  return { task: d('TaskDuration'), script: d('ScriptDuration'), layout: d('LayoutDuration'), style: d('RecalcStyleDuration'), long, wall, hot }
}

;(async () => {
  const home = await fetch(MOCK + '/').then(r => r.text(), () => '')
  if (!home.includes('MOCK-HERMES')) {
    console.error(`${MOCK} is not the mock: start it with run.sh --serve`)
    process.exit(3)
  }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined })
  const out = []
  for (let i = 0; i < runs; i++) {
    const r = await one(browser, top > 0 && i === runs - 1)
    out.push(r)
    console.log(`run ${i + 1}: tasks ${r.task.toFixed(2)} s (script ${r.script.toFixed(2)}, layout ${r.layout.toFixed(2)}, style ${r.style.toFixed(2)}), ${r.long} tasks over 50 ms, turn ${r.wall.toFixed(1)} s`)
  }
  await browser.close()
  const med = k => out.map(r => r[k]).sort((a, b) => a - b)[Math.floor(out.length / 2)]
  console.log(`${chars} characters, ${gap} ms between chunks${throttle > 1 ? `, CPU ×${throttle}` : ''}: median tasks ${med('task').toFixed(2)} s (script ${med('script').toFixed(2)}, layout ${med('layout').toFixed(2)}, style ${med('style').toFixed(2)}), ${med('long')} tasks over 50 ms, turn ${med('wall').toFixed(1)} s`)
  const hot = out[out.length - 1].hot
  if (hot) for (const [name, us] of hot) console.log(`  ${(us / 1000).toFixed(0).padStart(6)} ms  ${name}`)
})()
