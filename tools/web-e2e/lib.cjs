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
      getBaseUrl: key => (k(key, 'getBaseUrl'), window.__hmMockBase || 'http://127.0.0.1:9119'),
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
      // Settings → Uninstall Hermes: every call goes to window.__unLog in order; the test answers through
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
// Changes the mock's state (POST /__mock).
const mock = b => fetch(MOCK + '/__mock', { method: 'POST', body: JSON.stringify(b) })

// Opens the composer's Add sheet, picks `option` (Photo, File, Camera…) and gives the file chooser `files`.
const addFiles = async (page, option, files) => {
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.picker-opt', { hasText: option }).click()])
  await chooser.setFiles(files)
}

module.exports = { addFiles, MOCK, WEB, LOG, SHOTS, calls, rpcs, sleep, check, fail, failures: () => failures, mock, png, nativeShell }
