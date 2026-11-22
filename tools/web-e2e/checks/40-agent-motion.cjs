// Animations that show the agent at work (spec 3.2 "Agent motion"; web/src/agentmotion.ts, agent-motion.css): the
// composer's light while Hermux works and in amber while it waits, the still glow behind the chat, Send turning into
// Stop, a sent message lifting, the thinking orb, a step's tick or cross, sub-agent lanes, the reply's settle and the
// phone's one tick per finished turn. Each starts with its state and ends with it; Off reaches the same final state with
// nothing mid-animation; a streamed reply redraws no earlier message and moves nothing a reader is reading; no
// animation makes the header or the composer taller, even for a frame; a second after a turn nothing moves.
// Pages use the fake shell, Model bar at its default "Tucked away" (lib.cjs `trayTucked`), and find things by role and name.
const { WEB, nativeShell, check, sleep, expectIdle, trayTucked } = require('../lib.cjs')

module.exports = async t => {
  const { browser } = t
  const open = async (chat, store = {}, size = { width: 360, height: 740 }) => {
    const context = await browser.newContext({ viewport: size })
    const p = await context.newPage()
    await p.addInitScript(nativeShell)
    await p.addInitScript(trayTucked)
    await p.addInitScript(([id, store]) => {
      if (!sessionStorage.getItem('opened')) {
        sessionStorage.setItem('opened', '1')
        if (id) localStorage.setItem('hm.lastSession', JSON.stringify({ id, profile: 'default' }))
        for (const [k, v] of Object.entries(store)) localStorage.setItem(k, v)
      }
      localStorage.setItem('hm.connectedOnce', '1')
    }, [chat, { 'hm.glass': '1', ...store }])
    p.on('pageerror', e => check(false, `agent motion: no page error (${e.message})`))
    await p.goto(WEB + '/')
    await p.getByRole('textbox').first().waitFor({ timeout: 15000 })
    p.on('close', () => context.close().catch(() => {}))
    return p
  }
  const box = p => p.getByRole('textbox').first()
  const send = async (p, text) => {
    await box(p).fill(text)
    await p.getByRole('button', { name: 'Send', exact: true }).click()
  }
  const stop = p => p.getByRole('button', { name: 'Stop', exact: true })
  // The composer's light: its state class and whether its layer turns (a running, repeating animation).
  const light = p => p.evaluate(() => {
    const l = document.querySelector('.composer .edge-light')
    if (!l) return null
    const turning = l.getAnimations({ subtree: true }).some(a => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity)
    const i = l.firstElementChild
    return { cls: l.className, opacity: Number(getComputedStyle(l).opacity), turning, bg: getComputedStyle(i).backgroundColor, paused: l.hasAttribute('data-motion-paused') }
  })
  const glowOn = p => p.evaluate(() => document.querySelector('.work-glow')?.classList.contains('on') ?? null)
  const settled = p => p.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity), null, { timeout: 3000 }).catch(() => {})
  const colour = (p, v) => p.evaluate(v => {
    const d = document.createElement('i')
    d.style.color = `var(${v})`
    document.body.append(d)
    const c = getComputedStyle(d).color
    d.remove()
    return c
  }, v)

  // ── Full: the composer's light travels while a turn runs, Send turns into Stop, the glow fades in behind; all of it
  //    ends with the turn, and a second later nothing moves ──
  {
    const p = await open('s-48', { 'hm.motion': 'full' })
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await settled(p)
    const rest = await light(p)
    check(rest && !/working|waiting/.test(rest.cls) && rest.opacity === 0 && !rest.turning, `agent motion: no light round the text box at rest (${JSON.stringify(rest)})`)
    check((await glowOn(p)) === false, 'agent motion: no glow behind the chat at rest')
    await send(p, 'long slow reply')
    await stop(p).waitFor({ timeout: 3000 })
    // The message just sent lifted out of the composer (once).
    const lifted = await p.evaluate(() => [...document.querySelectorAll('.msg.user')].filter(m => m.classList.contains('just-sent')).map(m => m.textContent))
    check(lifted.length === 1 && lifted[0].includes('long slow reply'), `agent motion: the message just sent lifts out of the composer, and only it (${JSON.stringify(lifted)})`)
    await p.waitForFunction(() => {
      const l = document.querySelector('.composer .edge-light')
      return l?.classList.contains('working') && getComputedStyle(l).opacity === '1'
    }, null, { timeout: 3000 }).catch(() => {})
    const work = await light(p)
    check(work && /\bworking\b/.test(work.cls) && work.turning && work.opacity === 1, `agent motion: a light travels round the text box while Hermux works (${JSON.stringify(work)})`)
    check((await glowOn(p)) === true, 'agent motion: a still glow fades in behind the working chat')
    const stopTurn = await stop(p).evaluate(b => b.querySelector('.stop-square').getAnimations().map(a => a.animationName))
    check(stopTurn.includes('agent-turn-in') || stopTurn.length === 0, `agent motion: Stop arrives with a turn (${JSON.stringify(stopTurn)})`)
    // The glow is still: it never moves, only its opacity changed once.
    const glowMoves = await p.evaluate(() => document.querySelector('.work-glow').getAnimations().filter(a => a.effect?.getTiming().iterations === Infinity).length)
    check(glowMoves === 0, `agent motion: the glow behind the chat never repeats a movement (${glowMoves})`)
    // Away: the light stands still and runs on when the app is back.
    await p.evaluate(() => window.hermesPause())
    const away = await light(p)
    check(away && !away.turning, `agent motion: the light stands still while the app is away (${JSON.stringify(away)})`)
    await p.evaluate(() => window.hermesResume())
    const back = await light(p)
    check(back && back.turning, `agent motion: the light runs again when the app is back (${JSON.stringify(back)})`)
    // Hermux uses an app in the background: its card carries the travelling light, the text box's stays lit but still
    // (one travelling light at a time), and turns again once the app is gone.
    await p.evaluate(() => window.__hmBg({ session: 's-48', pkg: 'com.example.notes', label: 'Notes', action: 'typing', since: Date.now() }))
    await p.locator('.bg-card').waitFor({ timeout: 3000 }).catch(() => {})
    const card = await p.evaluate(() => {
      const l = document.querySelector('.bg-card .edge-light')
      return l ? l.getAnimations({ subtree: true }).some(a => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity) : null
    })
    const held = await light(p)
    check(card === true && held && /\bworking\b/.test(held.cls) && held.opacity === 1 && !held.turning, `agent motion: with a background-app card the card's light travels and the text box's stays lit and still (card ${card}, ${JSON.stringify(held)})`)
    await p.evaluate(() => window.__hmBg(null))
    await p.locator('.bg-card').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    const freed = await light(p)
    check(freed && freed.turning, `agent motion: the text box's light travels again once the background app is gone (${JSON.stringify(freed)})`)
    await stop(p).waitFor({ state: 'detached', timeout: 8000 })
    const after = await light(p)
    check(after && !/working|waiting/.test(after.cls) && !after.turning, `agent motion: the light ends the moment the turn ends (${JSON.stringify(after)})`)
    check((await glowOn(p)) === false, 'agent motion: the glow fades out when the turn ends')
    // The reply's actions settle in once; the reply ends with no fade at its end.
    const fin = await p.evaluate(() => {
      const r = [...document.querySelectorAll('.msg.assistant')].pop()
      return { settled: r.classList.contains('settled'), streaming: r.classList.contains('streaming'), actions: !!r.querySelector('.msg-actions') }
    })
    check(fin.settled && !fin.streaming && fin.actions, `agent motion: the finished reply's actions settle in once (${JSON.stringify(fin)})`)
    await expectIdle(p, 'agent motion, a second after the turn ended')
    // Waiting for the person: the light stands still in amber, and goes when answered.
    await send(p, 'ask me')
    await p.getByRole('dialog').first().waitFor({ timeout: 5000 })
    await p.waitForFunction(() => document.querySelector('.composer .edge-light')?.classList.contains('waiting'), null, { timeout: 3000 }).catch(() => {})
    const wait = await light(p)
    const warn = await colour(p, '--warn')
    check(wait && /\bwaiting\b/.test(wait.cls) && !wait.turning && wait.opacity === 1 && wait.bg === warn, `agent motion: the light stands still in amber while Hermux waits for you (${JSON.stringify(wait)}, amber ${warn})`)
    check((await glowOn(p)) === false, 'agent motion: no gold glow while Hermux waits for you')
    await p.getByRole('dialog').getByText('Red', { exact: true }).click()
    await p.getByRole('dialog').getByRole('button', { name: 'Answer' }).click().catch(() => {})
    await p.getByText('You picked a colour.').waitFor({ timeout: 8000 })
    await stop(p).waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
    const answered = await light(p)
    check(answered && !/working|waiting/.test(answered.cls), `agent motion: the amber light goes once answered and the turn ends (${JSON.stringify(answered)})`)
    await p.close()
  }

  // ── thinking: a turning orb beside "Thinking…", which settles into the brain mark and "Thought for N s" ──
  {
    const p = await open('s-48', { 'hm.motion': 'full' })
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await send(p, 'work slowly')
    const orb = await p.waitForFunction(() => {
      const o = document.querySelector('.reasoning-dot .think-orb')
      return o ? o.getAnimations().filter(a => a.playState === 'running').length : null
    }, null, { timeout: 4000, polling: 20 }).then(h => h.jsonValue(), () => null)
    check(orb !== null && orb > 0, `agent motion: a turning orb shows beside "Thinking…" (${orb} animations)`)
    await p.getByText('Slow work done.').waitFor({ timeout: 8000 })
    const thought = await p.evaluate(() => {
      const d = document.querySelector('.reasoning-dot')
      return d ? { orb: !!d.querySelector('.think-orb'), settled: d.classList.contains('settled'), words: d.parentElement.textContent } : null
    })
    check(thought && !thought.orb && thought.settled && /Thought for/.test(thought.words), `agent motion: the orb settles into "Thought for N s" (${JSON.stringify(thought)})`)
    // Each step seen running ended in a drawn tick, green.
    await p.getByRole('button', { name: /Ran 3 commands/ }).click()
    const ticks = await p.evaluate(() => [...document.querySelectorAll('.tool-state .drawn-mark.done')].map(s => getComputedStyle(s).color))
    const ok = await colour(p, '--ok')
    check(ticks.length === 3 && ticks.every(c => c === ok), `agent motion: each finished step shows a green tick (${JSON.stringify(ticks)}, green ${ok})`)
    await expectIdle(p, 'agent motion, a second after a turn of steps')
    // Reopened, the same steps are still ticked, and nothing draws itself: history never animates.
    await p.reload()
    await p.getByText('Slow work done.').waitFor({ timeout: 8000 })
    const again = await p.evaluate(() => ({ drawn: document.querySelectorAll('.drawn-mark.draw').length, lifted: document.querySelectorAll('.just-sent, .settled').length }))
    check(again.drawn === 0 && again.lifted === 0, `agent motion: a reopened chat draws, lifts and settles nothing (${JSON.stringify(again)})`)
    await p.close()
  }

  // ── a failed step: the group's line shakes once and says it in the error colour; its row's cross is red ──
  {
    const p = await open('s-48', { 'hm.motion': 'full' })
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await send(p, 'fail a step')
    const shook = await p.waitForFunction(() => {
      const g = [...document.querySelectorAll('button')].find(b => /failed/.test(b.textContent) && /sub-agent/.test(b.textContent))
      return g && /step-failed-/.test(g.className) ? g.className : null
    }, null, { timeout: 5000, polling: 20 }).then(h => h.jsonValue(), () => null)
    check(!!shook, `agent motion: a failed step gives its line one short shake (${shook})`)
    await p.getByText('End of the long answer.').waitFor({ timeout: 8000 })
    await p.close()
  }

  // ── sub-agents as lanes: the running one carries a light, the lane fills when it is done ──
  {
    const p = await open('s-48', { 'hm.motion': 'full' })
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await send(p, 'delegate slowly')
    const group = p.getByRole('button', { name: /1 sub-agent/ })
    await group.waitFor({ timeout: 5000 })
    await group.click()
    const lane = await p.waitForFunction(() => {
      const l = document.querySelector('.sub-row .sub-lane')
      return l ? { cls: l.className, moving: l.getAnimations({ subtree: true }).some(a => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity) } : null
    }, null, { timeout: 5000 }).then(h => h.jsonValue(), () => null)
    check(lane && /\blive\b/.test(lane.cls) && lane.moving, `agent motion: a running sub-agent's lane carries a travelling light (${JSON.stringify(lane)})`)
    const shimmering = await group.evaluate(b => !!b.querySelector('.sub-shimmer'))
    check(!shimmering, 'agent motion: with its lanes open the group line stands still (one moving thing per step)')
    await stop(p).click()
    await p.close()
    // A sub-agent that finished: its lane is filled and still.
    const q = await open('s-48', { 'hm.motion': 'full' })
    await q.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await send(q, 'delegate it')
    await q.getByText('The helper counted.').waitFor({ timeout: 8000 })
    await stop(q).waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
    await q.getByRole('button', { name: /1 sub-agent/ }).click()
    const ended = await q.waitForFunction(() => {
      const l = document.querySelector('.sub-row .sub-lane')
      return l ? { cls: l.className, moving: l.getAnimations({ subtree: true }).some(a => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity) } : null
    }, null, { timeout: 5000 }).then(h => h.jsonValue(), () => null)
    check(ended && /\bdone\b/.test(ended.cls) && !ended.moving, `agent motion: a finished sub-agent's lane is filled and still (${JSON.stringify(ended)})`)
    await q.close()
  }

  // ── two repeating animations at most while Hermux works: the text box's light and one running step or lane. Counted
  //    every frame (each element with a running endless animation counts once), with the Model bar tucked away and
  //    open, with a running step, a sub-agent lane and a background app; while Hermux waits, nothing repeats at all ──
  {
    const watch = p => p.evaluate(() => {
      const w = (window.__rep = { max: 0, at: [], frames: 0, run: true })
      const tick = () => {
        if (!w.run) return
        const els = new Set(document.getAnimations().filter(a => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity).map(a => a.effect.target))
        w.frames++
        if (els.size > w.max) {
          w.max = els.size
          w.at = [...els].map(e => `${e.tagName.toLowerCase()}.${String(e.className?.baseVal ?? e.className).trim().replace(/\s+/g, '.')}`)
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const seen = p => p.evaluate(() => ((window.__rep.run = false), window.__rep))
    const p = await open('s-48', { 'hm.motion': 'full' })
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    // Tucked away (the default here): three running steps.
    await watch(p)
    await send(p, 'work slowly')
    await p.getByText('Slow work done.').waitFor({ timeout: 8000 })
    const tucked = await seen(p)
    check(tucked.frames > 30 && tucked.max >= 1 && tucked.max <= 2, `agent motion: Model bar tucked away, running steps: at most two repeating animations in any frame (${tucked.max} over ${tucked.frames} frames: ${tucked.at.join(', ')})`)
    // A background app on the chat while it works: the card's light replaces the text box's.
    await watch(p)
    await send(p, 'work slowly')
    await stop(p).waitFor({ timeout: 3000 })
    await p.evaluate(() => window.__hmBg({ session: 's-48', pkg: 'com.example.notes', label: 'Notes', action: 'typing', since: Date.now() }))
    await p.getByText('Slow work done.').nth(1).waitFor({ timeout: 8000 })
    const bg = await seen(p)
    await p.evaluate(() => window.__hmBg(null))
    check(bg.frames > 30 && bg.max <= 2, `agent motion: with a background app, at most two repeating animations in any frame (${bg.max}: ${bg.at.join(', ')})`)
    // The Model bar open: the status line shows inside it.
    await p.getByRole('button', { name: 'Model and status, closed. Open' }).click()
    await p.getByRole('button', { name: 'Model and status, open. Close' }).waitFor({ timeout: 3000 })
    await watch(p)
    await send(p, 'work slowly')
    await p.getByText('Slow work done.').nth(2).waitFor({ timeout: 8000 })
    const opened = await seen(p)
    check(opened.frames > 30 && opened.max >= 1 && opened.max <= 2, `agent motion: Model bar open, running steps: at most two repeating animations in any frame (${opened.max}: ${opened.at.join(', ')})`)
    // A sub-agent lane: its group opened while it works.
    await watch(p)
    await send(p, 'delegate slowly')
    const group = p.getByRole('button', { name: /1 sub-agent/ })
    await group.waitFor({ timeout: 5000 })
    await group.click()
    await p.locator('.sub-row .sub-lane.live').waitFor({ timeout: 5000 }).catch(() => {})
    await p.waitForFunction(() => window.__rep.frames > 120, null, { timeout: 5000 }).catch(() => {})
    const lanes = await seen(p)
    check(lanes.max >= 1 && lanes.max <= 2, `agent motion: with a sub-agent lane, at most two repeating animations in any frame (${lanes.max}: ${lanes.at.join(', ')})`)
    await stop(p).click().catch(() => {})
    await p.close()
    // Waiting for an approval while its step runs: only the amber light shows it, and nothing repeats.
    const q = await open('s-48', { 'hm.motion': 'full' })
    await q.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await send(q, 'run the thing')
    await q.getByRole('dialog').first().waitFor({ timeout: 5000 })
    await q.waitForFunction(() => document.querySelector('.composer .edge-light')?.classList.contains('waiting'), null, { timeout: 3000 }).catch(() => {})
    await watch(q)
    await q.waitForFunction(() => window.__rep.frames > 30, null, { timeout: 5000 }).catch(() => {})
    const waiting = await seen(q)
    const step = await q.evaluate(() => {
      const t = document.querySelector('.tool.tool-running')
      return t ? { live: t.classList.contains('step-live'), moving: t.getAnimations({ subtree: true }).some(a => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity) } : null
    })
    check(step && !step.live && !step.moving && waiting.max === 0, `agent motion: while Hermux waits for an approval its running step stands still and nothing repeats (step ${JSON.stringify(step)}, ${waiting.max}: ${waiting.at.join(', ')})`)
    await q.close()
  }

  // ── one light tick per finished turn: none for steps, none over the lock screen ──
  {
    const p = await open('s-48', { 'hm.motion': 'full' })
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    const haptics = () => p.evaluate(() => window.__nativeCalls.filter(c => c === 'haptic').length)
    await box(p).fill('work slowly')
    await p.getByRole('button', { name: 'Send', exact: true }).click()
    const sent = await haptics()
    await p.getByText('Slow work done.').waitFor({ timeout: 8000 })
    await stop(p).waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
    // A fixed wait on purpose: a second tick would come right after the turn's end; none may arrive in it.
    await sleep(300)
    check((await haptics()) - sent === 1, `agent motion: a turn of three steps gives one tick when it finishes (${(await haptics()) - sent})`)
    await p.evaluate(() => window.hermesLockView(true))
    const before = await haptics()
    // Over the lock screen a message can still be sent (spoken or typed); its end gives no tick.
    await box(p).fill('slow reply')
    await p.getByRole('button', { name: 'Send', exact: true }).click()
    const afterSend = await haptics()
    await stop(p).waitFor({ timeout: 3000 }).catch(() => {})
    await stop(p).waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
    // A fixed wait on purpose: no tick may arrive in it, even late.
    await sleep(300)
    check((await haptics()) === afterSend && afterSend - before <= 1, `agent motion: no tick for a turn that ends over the lock screen (${before} → ${afterSend} → ${await haptics()})`)
    await p.evaluate(() => window.hermesLockView(false))
    await p.close()
  }

  // ── a long streamed reply redraws no earlier message; a reader scrolled up keeps their place; no animation makes the
  //    header or the composer taller, even for a frame ──
  {
    const p = await open('s-48', { 'hm.motion': 'full' })
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await settled(p)
    const idle = await p.evaluate(() => ({ top: document.querySelector('.bar-top').getBoundingClientRect().height, bottom: document.querySelector('.bar-bottom').getBoundingClientRect().height }))
    // Every frame from the send to the end: the bars' heights.
    await p.evaluate(() => {
      const s = (window.__bars = { top: 0, bottom: 0, frames: 0, run: true })
      const tick = () => {
        s.top = Math.max(s.top, document.querySelector('.bar-top').getBoundingClientRect().height)
        s.bottom = Math.max(s.bottom, document.querySelector('.bar-bottom').getBoundingClientRect().height)
        s.frames++
        if (s.run) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await send(p, 'bench stream 9000 25')
    await p.locator('.msg.assistant.streaming').waitFor({ timeout: 8000 })
    // A fixed wait on purpose: let the reply's first batches draw before sampling starts.
    await sleep(300)
    // How often each earlier message's component draws, sampled every frame (a new props object on its React fiber is
    // one more render); and how often the streaming reply draws, to show the sampling sees renders.
    await p.evaluate(() => {
      const fiberOf = el => {
        const k = Object.keys(el).find(x => x.startsWith('__reactFiber$'))
        return k ? el[k].return : null
      }
      const msgs = [...document.querySelectorAll('.msg')]
      const watch = msgs.map(el => ({ el, f: fiberOf(el), seen: new Set() }))
      const s = (window.__renders = { run: true, watch })
      const tick = () => {
        for (const w of watch) {
          if (!w.f) continue
          w.seen.add(w.f.memoizedProps)
          if (w.f.alternate) w.seen.add(w.f.alternate.memoizedProps)
        }
        if (s.run) requestAnimationFrame(tick)
      }
      tick()
    })
    // The reader scrolls up into the reply being written and stays there.
    await p.waitForFunction(() => document.querySelector('.msg.assistant.streaming')?.getBoundingClientRect().height > 1400, null, { timeout: 20000 }).catch(() => {})
    const chat = p.locator('.chat')
    await chat.evaluate(el => { el.scrollTop = Math.max(0, el.scrollTop - 700) })
    // A fixed wait on purpose: the scroll settles before the reader's place is noted.
    await sleep(200)
    const read0 = await p.evaluate(() => {
      const el = document.querySelector('.chat')
      const h = document.querySelector('.msg.assistant.streaming h2, .msg.assistant.streaming p')
      return { top: el.scrollTop, line: h ? h.getBoundingClientRect().top : null }
    })
    // A fixed wait on purpose: the place must hold while the reply streams on for this long.
    await sleep(1500)
    const read1 = await p.evaluate(() => {
      const el = document.querySelector('.chat')
      const h = document.querySelector('.msg.assistant.streaming h2, .msg.assistant.streaming p')
      return { top: el.scrollTop, line: h ? h.getBoundingClientRect().top : null, still: !!document.querySelector('.msg.assistant.streaming') }
    })
    check(read1.still && Math.abs(read1.top - read0.top) < 1 && Math.abs(read1.line - read0.line) < 1, `agent motion: while the reply streams, a reader scrolled up keeps their place and the text does not move (${JSON.stringify([read0, read1])})`)
    const counts = await p.evaluate(() => {
      window.__renders.run = false
      return window.__renders.watch.map(w => ({ who: w.el.classList.contains('streaming') ? 'streaming' : w.el.classList.contains('user') ? 'user' : 'assistant', renders: w.seen.size }))
    })
    const earlier = counts.filter(c => c.who !== 'streaming')
    const live = counts.find(c => c.who === 'streaming')
    check(earlier.length >= 3 && earlier.every(c => c.renders <= 2) && live && live.renders > 5, `agent motion: streaming draws only the reply being written, no earlier message (${JSON.stringify(counts)})`)
    await stop(p).click().catch(() => {})
    await stop(p).waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
    await settled(p)
    const bars = await p.evaluate(() => ((window.__bars.run = false), window.__bars))
    check(bars.frames > 30 && bars.top <= idle.top + 0.5 && bars.bottom <= idle.bottom + 0.5, `agent motion: no frame of the turn made the header or the composer taller (header ${idle.top} → max ${bars.top}, composer ${idle.bottom} → max ${bars.bottom}, ${bars.frames} frames)`)
    await p.close()
  }

  // ── Reduced and Off: the same states, told by still forms; Off has nothing mid-animation at any step ──
  {
    const p = await open('s-48', { 'hm.motion': 'reduced' })
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await send(p, 'long slow reply')
    await stop(p).waitFor({ timeout: 3000 })
    await p.waitForFunction(() => document.querySelector('.composer .edge-light')?.classList.contains('working'), null, { timeout: 3000 }).catch(() => {})
    await settled(p)
    const red = await light(p)
    const accent = await colour(p, '--accent')
    check(red && /\bworking\b/.test(red.cls) && !red.turning && red.opacity === 1 && red.bg === accent, `agent motion, Reduced: the text box's edge is gold and still while Hermux works (${JSON.stringify(red)})`)
    await stop(p).waitFor({ state: 'detached', timeout: 8000 })
    await p.close()
  }
  {
    const p = await open('s-48', { 'hm.motion': 'off' })
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await settled(p)
    // Every frame of a turn of steps and a reply: nothing is mid-animation (a repeating animation never exists under Off).
    await p.evaluate(() => {
      const s = (window.__mid = { worst: 0, frames: 0, run: true, what: [] })
      const tick = () => {
        const moving = document.getAnimations().filter(a => a.playState === 'running')
        if (moving.length > s.worst) {
          s.worst = moving.length
          s.what = moving.map(a => `${a.animationName || a.transitionProperty} on ${a.effect?.target?.className}`)
        }
        s.frames++
        if (s.run) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await send(p, 'work slowly')
    await stop(p).waitFor({ timeout: 3000 }).catch(() => {})
    const offLight = await light(p)
    check(offLight && /\bworking\b/.test(offLight.cls) && !offLight.turning, `agent motion, Off: the working state still shows, as a still gold edge (${JSON.stringify(offLight)})`)
    await p.getByText('Slow work done.').waitFor({ timeout: 8000 })
    await stop(p).waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
    // A fixed wait on purpose: the frames recorder takes the turn's last frames before it stops.
    await sleep(200)
    const mid = await p.evaluate(() => ((window.__mid.run = false), window.__mid))
    check(mid.frames > 20 && mid.worst === 0, `agent motion, Off: no element was mid-animation in any frame of the turn (${mid.frames} frames, ${JSON.stringify(mid.what)})`)
    const final = await p.evaluate(() => ({
      light: document.querySelector('.composer .edge-light').className,
      glow: document.querySelector('.work-glow').className,
      ticks: document.querySelectorAll('.drawn-mark').length,
      actions: !!document.querySelector('.msg.assistant:last-of-type .msg-actions, .msg.assistant .msg-actions')
    }))
    check(final.light === 'edge-light' && final.glow === 'work-glow' && final.actions, `agent motion, Off: the chat reaches the same final state (${JSON.stringify(final)})`)
    await p.close()
  }

  // ── OLED black has no glow behind the chat ──
  {
    const p = await open('s-48', { 'hm.motion': 'full', 'hm.theme': 'oled' })
    await p.getByText('answer s-48', { exact: true }).waitFor({ timeout: 8000 })
    await send(p, 'long slow reply')
    await stop(p).waitFor({ timeout: 3000 })
    const shown = await p.evaluate(() => getComputedStyle(document.querySelector('.work-glow')).display)
    check(shown === 'none', `agent motion: OLED black draws no glow behind the working chat (${shown})`)
    await stop(p).click()
    await p.close()
  }
}
