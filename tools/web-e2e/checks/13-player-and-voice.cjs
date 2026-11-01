// Read-aloud player, chat links, dictation, model in the + menu, learning dot.
const path = require('path')
const { MOCK, WEB, calls, rpcs, sleep, check, fail, mock, nativeShell } = require('../lib.cjs')

module.exports = async t => {
  const { browser, page } = t
  // ── player, chat links, dictation, model in the + menu, learning dot (fake native bridge, speech never ends by itself) ──
  const vp = await browser.newPage({ viewport: { width: 375, height: 812 } })
  vp.on('pageerror', e => {
    console.log('PAGEERROR (voice page)', e.message)
    fail()
  })
  await vp.addInitScript(() => {
    let taken = false
    const calls = (window.__nc = [])
    const k = (key, name) => {
      if (key !== 'K') throw new Error('bridge call without the key: ' + name)
      calls.push(name)
    }
    window.HermesAndroid = {
      handshake: () => (taken ? '' : ((taken = true), 'K')),
      getBaseUrl: key => (k(key, 'getBaseUrl'), window.__hmMockBase),
      getToken: key => (k(key, 'getToken'), 'tok'),
      getTokenAsync: (key, id) => {
        k(key, 'getTokenAsync')
        setTimeout(() => window.__hmToken(id, 'tok'), 50)
      },
      httpAsync: (key, id, m, p, b) => {
        k(key, 'httpAsync')
        fetch('/__api' + p, { method: m, headers: b != null ? { 'Content-Type': 'application/json' } : undefined, body: b ?? undefined }).then(async r => window.__hmHttp(id, r.status, await r.text()))
      },
      isInForeground: key => (k(key, 'isInForeground'), true),
      appVersion: key => (k(key, 'appVersion'), 'test'),
      isSystemDark: key => (k(key, 'isSystemDark'), true),
      setBackground: key => k(key, 'setBackground'),
      haptic: key => k(key, 'haptic'),
      notify: key => k(key, 'notify'),
      cancelNotification: key => k(key, 'cancelNotification'),
      setLastChat: key => k(key, 'setLastChat'),
      setReadAloud: key => k(key, 'setReadAloud'),
      mediaBase: key => (k(key, 'mediaBase'), ''),
      speak: (key, text, cfg) => {
        k(key, 'speak')
        ;(window.__spoken ||= []).push(text)
        ;(window.__spokenCfg ||= []).push(cfg)
      },
      stopSpeaking: key => {
        k(key, 'stopSpeaking')
        setTimeout(() => window.__hmVoice('tts-done', ''), 10) // like Voice.java
      },
      startListening: key => k(key, 'startListening'),
      stopListening: key => k(key, 'stopListening')
    }
  })
  await vp.goto(WEB + '/')
  const vbox = vp.getByPlaceholder('Message Hermes')
  await vbox.waitFor({ timeout: 15000 })
  // model moved from the header into the + menu
  check((await vp.locator('header .model-chip').count()) === 0, 'no model chip in the header')
  await vp.getByRole('button', { name: 'Add', exact: true }).click()
  check((await vp.locator('.picker-opt', { hasText: 'Model' }).count()) === 1, '+ menu has the model row')
  await vp.locator('.picker-opt', { hasText: 'Model' }).click()
  check((await vp.locator('.sheet').count()) > 0, 'tapping the model row opens the model picker')
  await vp.evaluate(() => window.hermesBack())
  await sleep(300)
  // chat links
  await vbox.fill('link chats')
  await vp.getByRole('button', { name: 'Send' }).click()
  await vp.locator('.msg.assistant a.chat-link').first().waitFor({ timeout: 5000 })
  check((await vp.locator('.msg.assistant a.chat-link').count()) === 2, 'markdown chat link and a bare session id both become chat links (' + (await vp.locator('.msg.assistant').last().innerHTML()).slice(0, 700) + ')')
  const vResumesBefore = rpcs('session.resume').length
  const vGoalReadsBefore = rpcs('session.control.read').length
  await vp.locator('.msg.assistant a.chat-link').first().click()
  await sleep(800)
  check(rpcs('session.resume').length > vResumesBefore && rpcs('session.resume').pop().params.session_id === 's-6', 'tapping a chat link opens that chat ' + JSON.stringify(rpcs('session.resume').slice(-2)))
  // the chat-open steps (chatopen.ts) ran for the chat that opened: its goal is read with its own session id
  const vRt = rpcs('session.control.read').slice(vGoalReadsBefore)
  check(vRt.length > 0 && vRt.every(c => c.params.session_id), 'opening a chat runs its chat-open steps (goal read ' + JSON.stringify(vRt.map(c => c.params.session_id)) + ')')
  await vp.evaluate(() => window.hermesShortcut('new'))
  await vbox.fill('link chats')
  await vp.getByRole('button', { name: 'Send' }).click()
  await vp.locator('.msg.assistant a.chat-link').first().waitFor({ timeout: 5000 })
  // player
  await vp.getByRole('button', { name: 'Read aloud' }).last().click()
  await vp.locator('.tts-player').waitFor({ timeout: 3000 })
  check(true, 'reading a reply shows the player')
  const said = () => vp.evaluate(() => window.__spoken.slice())
  const nativeCount = n => vp.evaluate(x => window.__nc.filter(c => c === x).length, n)
  await vbox.fill('another question')
  await vp.getByRole('button', { name: 'Send' }).click()
  await sleep(600)
  check((await nativeCount('stopSpeaking')) === 0 && (await vp.locator('.tts-player').count()) === 1, 'sending a new prompt does not stop the reading')
  await vp.evaluate(() => window.__hmVoice('tts-seg', '30,50'))
  const total = Number(await vp.locator('.tts-seek').getAttribute('max'))
  const seek0 = Number(await vp.locator('.tts-seek').inputValue())
  check(seek0 >= 30 && seek0 <= 40, `player follows the reading position (${seek0})`)
  await vp.evaluate(() => window.__hmVoice('tts-seek', '70')) // the card's forward 10 s
  await sleep(50)
  const seekd = Number(await vp.locator('.tts-seek').inputValue())
  check(seekd === 70 && (await vp.locator('.tts-player').count()) === 1, `a native 10 s jump moves the player to its position (${seekd})`)
  // 5 s buttons + time label (the mock has no ttsControl, so this is the browser path: position +/- 5 s at the pace)
  await vp.evaluate(() => window.__hmVoice('tts-pace', '4'))
  const clock = () => vp.locator('.tts-time span').first().innerText()
  check(/^\d+:\d\d \/ ~\d+:\d\d$/.test(await clock()), `time label reads like 0:12 / ~1:40 (${await clock()})`)
  const j0 = Number(await vp.locator('.tts-seek').inputValue())
  await vp.getByRole('button', { name: 'Forward 5 seconds' }).click()
  await sleep(30)
  const tf = Number(await vp.locator('.tts-seek').inputValue())
  check(Math.abs(tf - j0 - 20) <= 2 && (await vp.locator('.tts-flash').innerText()) === '+5 s', `forward 5 s moves the bar by 5 s of pace and flashes +5 s (${j0} -> ${tf})`)
  await vp.getByRole('button', { name: 'Back 5 seconds' }).click()
  await sleep(30)
  const tb = Number(await vp.locator('.tts-seek').inputValue())
  check(Math.abs(tb - j0) <= 2 && (await vp.locator('.tts-flash').innerText()) === '-5 s', `back 5 s returns (${tb}) and flashes -5 s`)
  await vp.getByRole('button', { name: 'Pause reading' }).click()
  await sleep(200)
  const paused = Number(await vp.locator('.tts-seek').inputValue())
  check((await vp.locator('.tts-player').count()) === 1 && (await vp.getByRole('button', { name: 'Resume reading' }).count()) === 1, 'pause keeps the player (stop from native does not close it)')
  const n0 = (await said()).length
  await vp.getByRole('button', { name: 'Resume reading' }).click()
  const sp = await said()
  const full = sp[0]
  check(sp.length === n0 + 1 && sp[n0] === full.slice(paused), `resume reads on from the paused position (${paused})`)
  await vp.locator('.tts-seek').fill(String(Math.floor(total / 2)))
  await sleep(100)
  const sp2 = await said()
  check(sp2[sp2.length - 1] === full.slice(Math.floor(total / 2)), 'scrubbing re-reads from that point')
  await vp.getByRole('button', { name: /^Reading speed/ }).click()
  check(JSON.parse(await vp.evaluate(() => localStorage.getItem('hm.tts'))).rate > 1, 'speed button raises the rate')
  await vp.evaluate(() => window.__hmVoice('tts-done', ''))
  await sleep(300) // inside the re-speak guard, the replaced speech "ending" is ignored
  check((await vp.locator('.tts-player').count()) === 1, 'the replaced speech ending does not close the player')
  await sleep(500)
  await vp.evaluate(() => window.__hmVoice('tts-done', ''))
  await sleep(100)
  check((await vp.locator('.tts-player').count()) === 0, 'player closes when the reading ends')
  // the "Reading aloud" notification: Voice.java owns pause/play; the page follows its tts-paused / tts-resumed
  const lastCfg = JSON.parse(await vp.evaluate(() => window.__spokenCfg[window.__spokenCfg.length - 1]))
  check(lastCfg.notify === true && typeof lastCfg.title === 'string' && 'session' in lastCfg, 'read-aloud asks for the notification card ' + JSON.stringify(lastCfg))
  await vp.evaluate(() => {
    window.__ctl = []
    window.HermesAndroid.ttsControl = cmd => {
      window.__ctl.push(cmd)
      setTimeout(() => window.__hmVoice(cmd === 'pause' ? 'tts-paused' : 'tts-resumed', cmd === 'pause' ? '20' : ''), 10) // like Voice.java
    }
  })
  await vp.getByRole('button', { name: 'Read aloud' }).last().click()
  await vp.locator('.tts-player').waitFor({ timeout: 3000 })
  const spokenBefore = (await said()).length
  const stopsBefore = await nativeCount('stopSpeaking')
  const at = Math.floor(Number(await vp.locator('.tts-seek').getAttribute('max')) / 2)
  await vp.evaluate(x => window.__hmVoice('tts-paused', String(x)), at) // Pause in the notification shade
  await sleep(100)
  check((await vp.getByRole('button', { name: 'Resume reading' }).count()) === 1 && Number(await vp.locator('.tts-seek').inputValue()) === at, 'pause from the notification shows the player paused at that chunk (' + (await vp.locator('.tts-seek').inputValue()) + ' of ' + (await vp.locator('.tts-seek').getAttribute('max')) + ')')
  await vp.evaluate(() => window.__hmVoice('tts-resumed', ''))
  await sleep(100)
  check((await vp.getByRole('button', { name: 'Pause reading' }).count()) === 1, 'play from the notification resumes the player')
  await vp.getByRole('button', { name: 'Pause reading' }).click()
  await sleep(100)
  await vp.getByRole('button', { name: 'Resume reading' }).click()
  await sleep(100)
  check(JSON.stringify(await vp.evaluate(() => window.__ctl)) === '["pause","play"]' && (await said()).length === spokenBefore && (await nativeCount('stopSpeaking')) === stopsBefore, 'in-app pause / resume go through ttsControl (one state with the notification) ' + JSON.stringify(await vp.evaluate(() => window.__ctl)))
  await vp.evaluate(() => window.__hmVoice('tts-paused', '0'))
  await sleep(50)
  await vp.evaluate(() => window.__hmVoice('tts-done', 'stop')) // ✕ in the notification while paused
  await sleep(100)
  check((await vp.locator('.tts-player').count()) === 0, 'stop from the notification closes even a paused player')
  await vp.evaluate(() => delete window.HermesAndroid.ttsControl)
  // dictation: edits made while dictating are kept, the keyboard is not summoned at the end
  await vp.evaluate(() => window.hermesShortcut('new'))
  await vp.getByRole('button', { name: 'Dictate' }).click()
  const ta = vp.getByPlaceholder('Message Hermes')
  await vp.evaluate(() => window.__hmVoice('partial', 'hello wor'))
  await vp.evaluate(() => window.__hmVoice('final', 'hello world'))
  await sleep(150)
  check((await ta.inputValue()) === 'hello world', 'dictated phrase appears: ' + (await ta.inputValue()))
  await ta.focus()
  await ta.press('End')
  await vp.keyboard.insertText(' brave')
  await vp.evaluate(() => window.__hmVoice('partial', 'and more'))
  await vp.evaluate(() => window.__hmVoice('final', 'and more'))
  await sleep(150)
  check((await ta.inputValue()) === 'hello world brave and more', `keyboard edit survives the next dictated phrase (${await ta.inputValue()})`)
  await ta.click({ position: { x: 1, y: 8 } }) // a tap at the very start of the text
  await sleep(150)
  await vp.evaluate(() => window.__hmVoice('partial', 'there'))
  await vp.evaluate(() => window.__hmVoice('final', 'there'))
  await sleep(150)
  check((await ta.inputValue()) === 'there hello world brave and more', `moving the cursor makes dictation insert there (${await ta.inputValue()})`)
  await ta.evaluate(el => el.blur())
  await vp.evaluate(() => window.__hmVoice('end', ''))
  await sleep(200)
  check(await vp.evaluate(() => document.activeElement === document.body || document.activeElement.tagName !== 'TEXTAREA'), 'stopping dictation does not focus the box (no keyboard)')
  await vp.close()

  // ── Settings → Voice → Speech recognition: on-device dictation models (fake shell: window.__stt, window.__sttCalls) ──
  {
    const sp = await browser.newPage({ viewport: { width: 375, height: 812 } })
    sp.on('pageerror', e => {
      console.log('PAGEERROR (speech recognition page)', e.message)
      fail()
    })
    await sp.addInitScript(() => {
      const mb = 1e6
      const base = { live: false, punctuation: true, custom: false, state: 'none', good: 'Most accurate here.', weak: 'Words after each pause.', licence: 'MIT' }
      window.__stt = {
        chosen: '',
        sample: 'After early nightfall the yellow lamps would light up here and there the squalid quarter of the brothels.',
        models: [
          { ...base, id: 'moonshine-base-en', name: 'Moonshine Base (English)', kind: 'moonshine', size: 142 * mb, recommended: true },
          { ...base, id: 'zipformer-en', name: 'Zipformer streaming (English)', kind: 'online-transducer', size: 73 * mb, live: true, punctuation: false, good: 'Words while you speak.', weak: 'Audiobooks only.' }
        ]
      }
    })
    await sp.addInitScript(nativeShell)
    await sp.goto(WEB + '/')
    await sp.getByPlaceholder('Message Hermes').waitFor({ timeout: 15000 })
    await sp.getByRole('button', { name: /^Sessions/ }).click()
    await sp.locator('.nav-tile', { hasText: 'Settings' }).click()
    await sp.locator('.set-row', { hasText: 'Voice' }).first().click()
    const row = sp.locator('.set-row', { hasText: 'Speech recognition' })
    await row.waitFor({ timeout: 5000 })
    check((await row.innerText()).includes('Phone’s speech recognition'), 'Voice page: Speech recognition row shows the phone’s recogniser at first')
    await row.click()
    await sp.locator('.screen .title', { hasText: 'Speech recognition' }).waitFor({ timeout: 5000 })
    const baseCard = sp.getByLabel('Speech model Moonshine Base (English)')
    check(await baseCard.getByText('Recommended', { exact: true }).isVisible(), 'the recommended model is marked')
    check(await sp.getByLabel('Speech model Zipformer streaming (English)').getByText('Words while you speak', { exact: true }).isVisible(), 'a streaming model says words appear while you speak')
    check((await sp.locator('.set-row', { hasText: 'Phone’s speech recognition' }).innerText()).includes('In use'), 'the phone’s recogniser is in use before any model')
    await baseCard.getByRole('button', { name: 'Download 142 MB' }).click()
    await baseCard.getByText(/Downloading… 71 MB of 142 MB/).waitFor({ timeout: 3000 }).then(() => check(true, 'download shows its progress'), () => check(false, 'download shows its progress'))
    check((await baseCard.locator('[role=progressbar]').getAttribute('aria-valuenow')) === '50', 'progress bar at 50%')
    await baseCard.getByText('Checking the model on a test recording…').waitFor({ timeout: 3000 }).then(() => check(true, 'then the check on the test recording'), () => check(false, 'then the check on the test recording'))
    await baseCard.getByText('Test: 18 of 18 words right · 0.6 s for 6.6 s of speech').waitFor({ timeout: 3000 }).then(() => check(true, 'the test result says how many words were right and how fast'), () => check(false, 'the test result says how many words were right and how fast'))
    check(await baseCard.getByText('In use', { exact: true }).isVisible(), 'the first ready model is used')
    check(!(await sp.locator('.set-row', { hasText: 'Phone’s speech recognition' }).innerText()).includes('In use'), 'the phone’s recogniser is no longer marked in use')
    await baseCard.getByRole('button', { name: 'Test model' }).click()
    await sp.locator('.set-row', { hasText: 'Phone’s speech recognition' }).click()
    await sleep(100)
    check(JSON.stringify(await sp.evaluate(() => window.__sttCalls)) === JSON.stringify([['download', 'moonshine-base-en'], ['test', 'moonshine-base-en'], ['use', '']]), 'download, test and back to the phone’s recogniser reach the shell')
    await baseCard.getByRole('button', { name: 'Use' }).click()
    // your own model from a Hugging Face link
    await sp.locator('.set-row', { hasText: 'Add from Hugging Face' }).click()
    await sp.getByPlaceholder('https://huggingface.co/owner/model').fill('https://huggingface.co/someone/sherpa-onnx-whisper-tiny.en')
    await sp.getByRole('alertdialog').getByRole('button', { name: 'Add', exact: true }).click()
    await sp.getByText('Adding the model from huggingface.co/someone/sherpa-onnx-whisper-tiny.en…').waitFor({ timeout: 2000 }).then(() => check(true, 'adding a model by link shows it is busy'), () => check(false, 'adding a model by link shows it is busy'))
    const own = sp.getByLabel('Speech model sherpa-onnx-whisper-tiny.en')
    await own.waitFor({ timeout: 3000 })
    check(await own.getByText('From huggingface.co/someone/sherpa-onnx-whisper-tiny.en').isVisible(), 'your own model says where it came from')
    check(await own.getByText(/Test: 9 of 18 words right/).isVisible(), 'your own model shows its test result')
    await own.getByRole('button', { name: 'Delete' }).click()
    await sp.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await own.waitFor({ state: 'detached', timeout: 2000 }).then(() => check(true, 'Delete (after confirming) removes your own model'), () => check(false, 'Delete (after confirming) removes your own model'))
    await sp.locator('.set-row', { hasText: 'Add files from this phone' }).click()
    check((await sp.evaluate(() => window.__sttCalls.at(-1)[0])) === 'pick', 'Add files from this phone opens the shell’s file picker')
    // Back returns to Voice, whose row now names the model
    await sp.locator('.screen .back, .screen button[aria-label="Back"]').first().click()
    await sp.locator('.set-row', { hasText: 'Speech recognition' }).waitFor({ timeout: 3000 })
    check((await sp.locator('.set-row', { hasText: 'Speech recognition' }).innerText()).includes('Moonshine Base'), 'Back goes to Voice, whose row names the model in use')
    // the shell fell back from a model that wouldn't load
    await sp.evaluate(() => window.__hmVoice('stt-fallback', 'stt-model-load'))
    await sp.getByText(/The on-device speech model couldn’t start/).waitFor({ timeout: 2000 }).then(() => check(true, 'a model that fails to start is explained in a toast'), () => check(false, 'a model that fails to start is explained in a toast'))
    await sp.close()
  }
}
