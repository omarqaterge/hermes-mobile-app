// Helpers shared by test.cjs and checks/*.cjs: the mock's call log, check(), and the fake app shell.
const fs = require('fs')
const os = require('os')
const path = require('path')

// The mock and the page; run.sh sets other ports when 9119/5180 are taken.
const MOCK = `http://127.0.0.1:${process.env.HM_E2E_MOCK_PORT || 9119}`
const WEB = `http://127.0.0.1:${process.env.HM_E2E_WEB_PORT || 5180}`
const LOG = process.env.HM_E2E_LOG || path.join(os.tmpdir(), 'hm-web-e2e-calls.jsonl')
const SHOTS = process.env.HM_E2E_SHOTS || os.tmpdir()
const calls = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
const rpcs = m => calls().filter(c => c.rpc === m)
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const fail = () => failures++
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`)
  if (!ok) fail()
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

// The app shell's bridge, faked (injected before the page loads): window.__setup / __fixes drive the Setup check.
const nativeShell = () => {
    const calls = (window.__nativeCalls = [])
    let taken = false
    const k = (key, name) => {
      calls.push(name)
      if (key !== 'K') throw new Error('bridge call without the key: ' + name)
    }
    window.HermesAndroid = {
      handshake: () => (taken ? '' : ((taken = true), 'K')),
      getBaseUrl: key => (k(key, 'getBaseUrl'), window.__hmMockBase || ''),
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
      appVersion: key => (k(key, 'appVersion'), window.__appVersion || 'test'),
      isSystemDark: key => (k(key, 'isSystemDark'), true),
      setBackground: key => k(key, 'setBackground'),
      haptic: key => k(key, 'haptic'),
      setEdgeGrab: (key, on) => (k(key, 'setEdgeGrab'), (window.__edgeGrab = on)),
      notify: key => k(key, 'notify'),
      cancelNotification: key => k(key, 'cancelNotification'),
      setLastChat: key => k(key, 'setLastChat'),
      chatSeen: (key, id) => (k(key, 'chatSeen'), (window.__seen ||= []).push(id)),
      setReadAloud: key => k(key, 'setReadAloud'),
      mediaBase: key => (k(key, 'mediaBase'), ''),
      // Voice: speaking "finishes" after 50 ms (never while window.__ttsHold is set, so a test can catch it mid-way);
      // the test plays the recogniser through window.__hmVoice.
      speak: (key, text) => {
        k(key, 'speak')
        ;(window.__spoken ||= []).push(text)
        if (!window.__ttsHold) setTimeout(() => window.__hmVoice('tts-done', ''), 50)
      },
      stopSpeaking: key => k(key, 'stopSpeaking'),
      startListening: key => k(key, 'startListening'),
      startListeningOver: key => k(key, 'startListeningOver'),
      stopListening: key => k(key, 'stopListening'),
      // Setup check: the test sets window.__setup; fixes are recorded in window.__fixes.
      setupState: key => (k(key, 'setupState'), JSON.stringify(window.__setup || { termux: true, runCommand: true, notifications: true, batteryApp: true, batteryTermux: true, startError: '' })),
      openExternal: (key, u) => (k(key, 'openExternal'), (window.__opened ||= []).push(String(u))),
      setupFix: (key, what) => (k(key, 'setupFix'), (window.__fixes ||= []).push(what)),
      signInTermux: (key, provider, profile) => (k(key, 'signInTermux'), (window.__signins ||= []).push([provider, profile]), true),
      // App-first setup: installs "succeed" after a moment and flip the app to installed in window.__setup; the probe
      // answers window.__probe; window.__progress is the installer's progress (the test pushes lines itself).
      installHelperApp: (key, which) => {
        k(key, 'installHelperApp')
        ;(window.__installs ||= []).push(which)
        const field = { termux: 'termux', 'termux-api': 'termuxApi', 'termux-boot': 'termuxBoot', shizuku: 'shizuku' }[which]
        window.__setup = { ...window.__setup, installing: which }
        setTimeout(() => window.hermesSetupInstall(which, 'downloading', 40, ''), 30)
        setTimeout(() => window.hermesSetupInstall(which, 'installing', 100, ''), 80)
        // window.__installStall: these apps stop at "installing" (Android's prompt was blocked or its answer never reached the page)
        if ((window.__installStall || []).includes(which)) return
        setTimeout(() => {
          window.__setup = { ...window.__setup, [field]: true, installing: '' }
          window.hermesSetupInstall(which, 'done', 100, '')
        }, 150)
      },
      probeTermux: key => {
        k(key, 'probeTermux')
        window.__probes = (window.__probes || 0) + 1
        if (window.__probe) setTimeout(() => window.hermesTermuxProbe(JSON.stringify(window.__probe)), 20)
      },
      probeTermuxNow: key => {
        k(key, 'probeTermuxNow')
        window.__probesNow = (window.__probesNow || 0) + 1
        if (window.__probe) setTimeout(() => window.hermesTermuxProbe(JSON.stringify(window.__probe)), 20)
      },
      setupCommand: key => {
        k(key, 'setupCommand')
        window.__copied = (window.__copied || 0) + 1
        window.__progress = { active: true, lines: [], done: false, fail: '' }
        return true
      },
      setupProgress: key => (k(key, 'setupProgress'), window.__progress ? JSON.stringify(window.__progress) : ''),
      // Settings → About → Remote debugging (plan 14): the test sets window.__rd; the calls are recorded in window.__rdCalls.
      remoteDebuggingState: key => (k(key, 'remoteDebuggingState'), JSON.stringify(window.__rd || { available: false, on: false, minutesLeft: 0 })),
      openRemoteDebugging: key => (k(key, 'openRemoteDebugging'), (window.__rdCalls ||= []).push('open')),
      turnOffRemoteDebugging: key => (k(key, 'turnOffRemoteDebugging'), (window.__rdCalls ||= []).push('off'), (window.__rd = { ...window.__rd, on: false, minutesLeft: 0 }), setTimeout(() => window.dispatchEvent(new Event('hm-devtools')), 20)), // the shell tells the page, as DevTools.apply does
      listVoices: key => k(key, 'listVoices'),
      // On-device dictation models (LocalStt): window.__stt is the list; a download sends progress, then "checking", then
      // ready with a test result; a Hugging Face link adds "custom-1"; the calls are recorded in window.__sttCalls.
      listSttModels: key => (k(key, 'listSttModels'), JSON.stringify(window.__stt || { chosen: '', models: [] })),
      downloadSttModel: (key, id) => {
        k(key, 'downloadSttModel')
        ;(window.__sttCalls ||= []).push(['download', id])
        const set = patch => {
          window.__stt = { ...window.__stt, models: window.__stt.models.map(m => (m.id === id ? { ...m, ...patch } : m)) }
          window.__hmVoice('stt-models', JSON.stringify(window.__stt))
        }
        const total = window.__stt.models.find(m => m.id === id).size
        set({ state: 'downloading', done: 0, total })
        setTimeout(() => set({ done: Math.round(total / 2) }), 60)
        setTimeout(() => set({ state: 'checking', done: undefined, total: undefined }), 400)
        setTimeout(() => {
          set({ state: 'ready', test: { ok: true, text: window.__stt.sample, wer: 0, ms: 600, audioMs: 6625 } })
          if (!window.__stt.chosen) {
            window.__stt = { ...window.__stt, chosen: id }
            window.__hmVoice('stt-models', JSON.stringify(window.__stt))
          }
        }, 1200)
      },
      cancelSttDownload: (key, id) => (k(key, 'cancelSttDownload'), (window.__sttCalls ||= []).push(['cancel', id])),
      deleteSttModel: (key, id) => {
        k(key, 'deleteSttModel')
        ;(window.__sttCalls ||= []).push(['delete', id])
        window.__stt = { ...window.__stt, models: window.__stt.models.filter(m => m.id !== id), chosen: window.__stt.chosen === id ? '' : window.__stt.chosen }
        setTimeout(() => window.__hmVoice('stt-models', JSON.stringify(window.__stt)), 20)
      },
      setSttModel: (key, id) => {
        k(key, 'setSttModel')
        ;(window.__sttCalls ||= []).push(['use', id])
        window.__stt = { ...window.__stt, chosen: id }
        setTimeout(() => window.__hmVoice('stt-models', JSON.stringify(window.__stt)), 20)
      },
      testSttModel: (key, id) => (k(key, 'testSttModel'), (window.__sttCalls ||= []).push(['test', id])),
      pickSttModelFiles: key => (k(key, 'pickSttModelFiles'), (window.__sttCalls ||= []).push(['pick'])),
      addSttModelUrl: (key, url) => {
        k(key, 'addSttModelUrl')
        ;(window.__sttCalls ||= []).push(['url', url])
        window.__stt = { ...window.__stt, importing: 'someone/sherpa-onnx-whisper-tiny.en', importError: undefined }
        window.__hmVoice('stt-models', JSON.stringify(window.__stt))
        setTimeout(() => {
          const m = { id: 'custom-1', name: 'sherpa-onnx-whisper-tiny.en', kind: 'whisper', size: 103e6, onDisk: 103e6, live: false, punctuation: true, custom: true, source: 'huggingface.co/someone/sherpa-onnx-whisper-tiny.en', state: 'ready', test: { ok: true, text: 'After early nightfall the yellow lamps', wer: 0.5, ms: 900, audioMs: 6625 } }
          window.__stt = { ...window.__stt, importing: undefined, models: [...window.__stt.models, m] }
          window.__hmVoice('stt-models', JSON.stringify(window.__stt))
        }, 200)
      },
      startHermes: key => k(key, 'startHermes'),
      watchHermes: key => (k(key, 'watchHermes'), window.__watchHermes = (window.__watchHermes || 0) + 1),
      isAssistant: key => (k(key, 'isAssistant'), !!window.__assistant),
      openAssistantSettings: key => k(key, 'openAssistantSettings'),
      // Talk to Hermes on the lock screen: the values pushed to the shell are recorded.
      setLockAssist: (key, on) => (k(key, 'setLockAssist'), (window.__lockAssist ||= []).push(on)),
      requestUnlock: key => k(key, 'requestUnlock'),
      leaveLockScreen: key => k(key, 'leaveLockScreen'),
      // Claude in Termux: recorded; window.__noTermux = the shell can't open Termux.
      signInTermux: (key, provider, profile) => (k(key, 'signInTermux'), (window.__termuxSignins ||= []).push([provider, profile]), !window.__noTermux),
      // Background app: the test sets state through window.__hmBg; frames come back 120 ms after each request.
      bgState: key => (k(key, 'bgState'), window.__bgNative ? JSON.stringify(window.__bgNative) : ''),
      bgFrameAsync: (key, id, w) => {
        k(key, 'bgFrameAsync')
        const log = (window.__bgAsked ||= [])
        log.push({ t: Date.now(), w })
        window.__bgInflight = (window.__bgInflight || 0) + 1
        window.__bgMaxInflight = Math.max(window.__bgMaxInflight || 0, window.__bgInflight)
        setTimeout(() => {
          window.__bgInflight--
          window.__hmBgFrame(id, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
        }, 120)
      },
      bgAction: (key, what) => {
        k(key, 'bgAction')
        ;(window.__bgActs ||= []).push(what)
        setTimeout(() => window.__hmBg(null), 30) // the shell clears the state once the host answered
        return 'ok'
      },
      // Settings → About → Hermux plugin: the test sets window.__plug (PluginSync's state) and calls
      // window.hermesPluginState(), like PluginSync does; taps go to window.__plugLog.
      pluginState: key => (k(key, 'pluginState'), JSON.stringify(window.__plug || { state: 'current', detail: '', installed: '1793648698', apk: '1793648698', running: '', tries: 0, maxTries: 3 })),
      pluginUpdate: (key, force) => {
        k(key, 'pluginUpdate')
        ;(window.__plugLog ||= []).push(force)
        return window.__plugAnswer || 'ok'
      },
      pluginUpdateConfirmed: (key, force) => {
        k(key, 'pluginUpdateConfirmed')
        ;(window.__plugLog ||= []).push(force ? 'confirmed-force' : 'confirmed')
        return window.__plugAnswer || 'ok'
      },
      // Settings → Uninstall Hermux: every call goes to window.__unLog in order; the test answers through
      // window.__un (the native state) + window.hermesUninstallDone(), like Uninstall.java does.
      uninstallState: key => (k(key, 'uninstallState'), JSON.stringify(window.__un || JSON.parse(localStorage.getItem('__hmUn') || 'null') || { started: false, running: false, removed: false, result: null })),
      uninstallStart: (key, backup, keys, settings) => {
        k(key, 'uninstallStart')
        ;(window.__unLog ||= []).push({ start: { backup, keys, settings } })
        window.__un = { started: true, running: true, removed: false, result: null }
        return 'ok'
      },
      uninstallApp: (key, which) => {
        k(key, 'uninstallApp')
        ;(window.__unLog ||= []).push({ app: which })
        return true
      }
    }
}
// Every page the run opens starts with the app's Animations setting at Off (stored as Appearance stores it, `hm.motion`),
// unless the page already has a level: the checks stay fast and steady. A check about motion sets the level it is about
// with setMotion, or removes the key (an init script of its own) to see the app's default.
const motionOff = () => {
  try {
    if (localStorage.getItem('hm.motion') === null) localStorage.setItem('hm.motion', 'off')
  } catch { /* */ }
}
// Every page the run opens also starts with Settings → Appearance → Model bar at "Always open" (`hm.modelBar`), unless the
// page already has a choice: the checks written before the composer's tray find the model row, the Auto button, the
// context ring and the live status line where they always were. 34-model-bar-tray.cjs checks the tray itself, with
// Model bar at its default, "Tucked away" (`trayTucked`).
const trayOpen = () => {
  try {
    if (localStorage.getItem('hm.modelBar') === null) localStorage.setItem('hm.modelBar', 'open')
  } catch { /* */ }
}
// For a page's own init script, added after the run's: the page starts with Model bar at the default, "Tucked away", on
// its first load only (a choice made in Settings during the check survives a reload).
const trayTucked = () => {
  try {
    if (!sessionStorage.getItem('hm.trayTucked')) {
      sessionStorage.setItem('hm.trayTucked', '1')
      localStorage.setItem('hm.modelBar', 'tucked')
    }
  } catch { /* */ }
}
// Sets the motion level on an open page at once ('full' | 'reduced' | 'off'), as Appearance does.
const setMotion = (page, level) => page.evaluate(l => {
  localStorage.setItem('hm.motion', l)
  document.documentElement.dataset.motion = l
}, level)
// The idle rule (docs/decisions/redesign-costs-no-speed-or-battery.md): one second after the last change, no animation
// is running. Waits a second, then checks document.getAnimations() and names what still runs.
const expectIdle = async (page, what) => {
  await sleep(1000)
  const running = await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').map(a => {
    const t = a.effect && a.effect.target
    return `${a.animationName || a.transitionProperty || a.constructor.name} on ${t ? (t.className || t.tagName) : '?'}`
  }))
  check(running.length === 0, `${what}: a second after the last change no animation is running (${JSON.stringify(running)})`)
}

// Changes the mock's state (POST /__mock).
const mock = b => fetch(MOCK + '/__mock', { method: 'POST', body: JSON.stringify(b) })

// Opens the composer's Add sheet, picks `option` (Photo, File, Camera…) and gives the file chooser `files`.
const addFiles = async (page, option, files) => {
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.picker-opt', { hasText: option }).click()])
  await chooser.setFiles(files)
}

// The Library page on one of its parts: the chat list's Library row, then the part's button (Canvases, Files, Projects).
const openLibraryPart = async (page, part) => {
  await page.getByRole('button', { name: /^Sessions/ }).click()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('button', { name: part, exact: true }).click()
}

// A menu (ui.tsx MenuSheet) and a wider font: measures each control in `dialog` (buttons and switches, found by element
// and role, named by aria-label or text), adds wide letter-spacing to the open dialogs, as a font wider than this
// machine's would be (CI's Linux), measures again and takes the spacing away. `grew` names the controls whose height
// changed (a label that wrapped); `over` is true when anything is wider than the sheet or the screen. With `colours`,
// also each control's text colour and its description's, with the first solid background behind it.
const menuFits = async (page, dialog, colours = false) => {
  const measure = () => dialog.evaluate((d, colours) => {
    const els = [...d.querySelectorAll('button, [role="switch"]')]
    const rgb = c => (c.match(/[\d.]+/g) || []).map(Number)
    const solidBg = e => {
      for (let n = e; n; n = n.parentElement) {
        const c = rgb(getComputedStyle(n).backgroundColor)
        if (c.length === 3 || (c.length === 4 && c[3] === 1)) return c.slice(0, 3)
      }
      return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3)
    }
    const desc = e => document.getElementById(e.getAttribute('aria-describedby') || '')
    return {
      names: els.map(e => e.getAttribute('aria-label') || e.textContent.trim()),
      hs: els.map(e => Math.round(e.getBoundingClientRect().height)),
      over: d.scrollWidth > d.clientWidth + 1 || document.documentElement.scrollWidth > window.innerWidth + 1 || d.getBoundingClientRect().right > window.innerWidth + 1,
      colours: colours
        ? els.flatMap(e => [[e.getAttribute('aria-label') || e.textContent.trim(), rgb(getComputedStyle(e).color).slice(0, 3), solidBg(e)], ...(desc(e) ? [[`${desc(e).textContent} (line)`, rgb(getComputedStyle(desc(e)).color).slice(0, 3), solidBg(e)]] : [])])
        : []
    }
  }, colours)
  const before = await measure()
  const tag = await page.addStyleTag({ content: '[role="dialog"] * { letter-spacing: 2px !important }' })
  const after = await measure()
  await tag.evaluate(t => t.remove())
  return { ...before, grew: before.names.filter((n, i) => after.hs[i] !== before.hs[i]), over: before.over || after.over }
}
// WCAG contrast of two [r, g, b] colours (0-255).
const contrast = (a, b) => {
  const lum = ([r, g, bl]) => [r, g, bl].map(c => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0)
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// The open page (a ScreenShell: a Settings page, the Library…), found by role: a region named by its title that holds
// a level-1 heading (the title). `pageTitle` is that title, or with `name` the open page's title matching it (as
// `hasText` would); `pageHeadings` are the page's section headings (level 3), or with `name` the ones matching it;
// `settingsSection` is the titled section (a group named by its heading) whose heading matches `name`.
const openPage = pg => pg.getByRole('region').filter({ has: pg.getByRole('heading', { level: 1 }) })
const pageTitle = (pg, name) => openPage(pg).getByRole('heading', name === undefined ? { level: 1 } : { level: 1, name }).first()
const pageHeadings = (pg, name) => openPage(pg).getByRole('heading', name === undefined ? { level: 3 } : { level: 3, name })
const settingsSection = (pg, name) => pg.getByRole('group', { name })

// Settings' main page → one of its seven rows (Models, Connectors, Behaviour, Access & privacy, Appearance, Voice, About &
// help): taps the row by its role and name and waits for the page's title. Settings must be open on its main page.
async function settingsPage(page, name) {
  await page.getByRole('button', { name: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click()
  await page.locator('.screen .title', { hasText: name }).waitFor({ timeout: 5000 })
}

// The area a tap reaches a control by: from the middle of `locator`'s box, how far a tap still lands on it (or inside it)
// to the left, right, top and bottom (document.elementFromPoint, 1 px steps, up to 40 px beyond its box). Returns its box
// and the hit area's width and height, so a control drawn small can show a 44 px target without growing.
const hitArea = (locator) => locator.evaluate(el => {
  const r = el.getBoundingClientRect()
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  const on = (x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === el || el.contains(h)) }
  const reach = (dx, dy, half) => { let d = 0; while (d < half + 40 && on(cx + dx * (d + 1), cy + dy * (d + 1))) d++; return d }
  const l = reach(-1, 0, r.width / 2), rt = reach(1, 0, r.width / 2), u = reach(0, -1, r.height / 2), dn = reach(0, 1, r.height / 2)
  return { box: [Math.round(r.width), Math.round(r.height)], w: l + rt + 1, h: u + dn + 1 }
})

// Every visible piece of text inside `root` (a selector) whose contrast with the solid background behind it is under
// WCAG's 4.5:1 (3:1 for large text: 24 px, or 18.7 px bold). Text that is see-through is mixed into that background
// first. Skipped, as WCAG does: disabled controls and anything inside an element made see-through (opacity under 1, a
// paused or disabled look). Returns [text, ratio, font size] for each failure, at most 20.
const lowContrast = (page, root = 'body') => page.evaluate(sel => {
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number)
  const lum = ([r, g, b]) => [r, g, b].map(c => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0)
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const solidBg = e => {
    for (let n = e; n; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor)
      if (c.length === 3 || (c.length === 4 && c[3] === 1)) return c.slice(0, 3)
    }
    return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3)
  }
  const faded = e => { for (let n = e; n; n = n.parentElement) { if (Number(getComputedStyle(n).opacity) < 1) return true; if (n.matches(':disabled')) return true } return false }
  const out = []
  for (const r of document.querySelectorAll(sel)) {
    const walk = document.createTreeWalker(r, NodeFilter.SHOW_TEXT)
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      const e = t.parentElement
      if (!e || !t.textContent.trim() || e.closest('svg, [aria-hidden="true"], .theme-prev')) continue
      const st = getComputedStyle(e)
      const box = e.getBoundingClientRect()
      if (!box.width || !box.height || st.visibility === 'hidden') continue
      if (faded(e)) continue
      const bg = solidBg(e)
      let fg = rgb(st.color)
      if (fg.length === 4) fg = fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]))
      const px = parseFloat(st.fontSize)
      const large = px >= 24 || (px >= 18.66 && Number(st.fontWeight) >= 700)
      const k = ratio(fg.slice(0, 3), bg)
      if (k < (large ? 3 : 4.5)) out.push([t.textContent.trim().slice(0, 40), Math.round(k * 100) / 100, Math.round(px)])
    }
  }
  return out.slice(0, 20)
}, root)

module.exports = { hitArea, lowContrast, settingsPage, openPage, pageTitle, pageHeadings, settingsSection, openLibraryPart, addFiles, MOCK, WEB, LOG, SHOTS, calls, rpcs, sleep, check, fail, failures: () => failures, mock, png, nativeShell, motionOff, trayOpen, trayTucked, setMotion, expectIdle, menuFits, contrast }
