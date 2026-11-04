// @vitest-environment happy-dom
// Live mode leaving the screen: the microphone closes, a reply being read keeps playing.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const voice = vi.hoisted(() => ({
  hear: null as null | ((kind: string, t: string) => void),
  over: false, // the phone app can listen while it speaks
  overCalls: 0,
  bridge: { active: false, onReply: (_t: string) => {}, onApproval: (_r: unknown) => {}, stop: () => {} }
}))
vi.mock('./voice', () => ({
  canListenOver: () => voice.over,
  liveBridge: voice.bridge,
  onTtsDone: () => () => {},
  setLiveMuted: () => {},
  setLivePhase: () => {},
  speak: vi.fn(),
  speakable: (t: string) => t,
  startListening: (cb: (kind: string, t: string) => void) => {
    voice.hear = cb
  },
  startListeningOver: (cb: (kind: string, t: string) => void) => {
    voice.overCalls++
    voice.hear = cb
  },
  stopListening: vi.fn(),
  stopSpeaking: vi.fn(),
  voiceErrorText: (t: string) => t,
  voiceInputAvailable: () => true
}))
vi.mock('./gateway', () => ({ answerRequest: vi.fn(), errText: String, sendPrompt: vi.fn(() => Promise.resolve()) }))
vi.mock('./store', () => ({ getState: () => ({}), toast: vi.fn() }))

const live = await import('./live')
const v = await import('./voice')

function hide() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('Live mode when the app is hidden', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(v.stopSpeaking).mockClear()
    vi.mocked(v.stopListening).mockClear()
    live.startLive()
  })
  afterEach(() => {
    live.stopLive()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    vi.useRealTimers()
  })

  test('a reply being read keeps playing; the microphone closes and Live mode ends', () => {
    voice.hear!('final', 'count slowly to thirty')
    vi.advanceTimersByTime(live.getLivePause() * 1000 + 10)
    voice.bridge.onReply('One. Two. Three.')
    vi.mocked(v.stopListening).mockClear()
    hide()
    expect(live.liveOn()).toBe(false)
    expect(v.stopListening).toHaveBeenCalled()
    expect(v.stopSpeaking).not.toHaveBeenCalled()
  })

  test('an approval question is cut (answering it needs the microphone)', () => {
    voice.bridge.onApproval({ id: 'a1', method: 'approval', params: { command: 'chmod 777 /tmp/x' } })
    hide()
    expect(live.liveOn()).toBe(false)
    expect(v.stopSpeaking).toHaveBeenCalled()
  })

  test('while listening, leaving stops everything as before', () => {
    hide()
    expect(live.liveOn()).toBe(false)
    expect(v.stopSpeaking).toHaveBeenCalled()
  })
})

describe('Live mode waits for a phrase still being finished', () => {
  const g = () => vi.mocked(gw.sendPrompt)
  let gw: typeof import('./gateway')
  beforeEach(async () => {
    vi.useFakeTimers()
    gw = await import('./gateway')
    g().mockClear()
    live.startLive()
  })
  afterEach(() => {
    live.stopLive()
    vi.useRealTimers()
  })
  const pause = () => live.getLivePause() * 1000

  test('the pause ends on a preview: the finished phrase is sent when it comes, not the preview', () => {
    voice.hear!('partial', 'remind me to call')
    vi.advanceTimersByTime(pause() + 10)
    expect(g()).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)
    voice.hear!('final', 'Remind me to call my sister tomorrow.')
    expect(g()).toHaveBeenCalledWith('Remind me to call my sister tomorrow.')
  })

  test('no finished phrase within 1.5 s: the preview is sent', () => {
    voice.hear!('partial', 'remind me to call')
    vi.advanceTimersByTime(pause() + 1500 + 10)
    expect(g()).toHaveBeenCalledWith('remind me to call')
  })

  test('speaking again while waiting restarts the pause', () => {
    voice.hear!('partial', 'remind me')
    vi.advanceTimersByTime(pause() + 10)
    voice.hear!('partial', 'remind me to call my sister')
    vi.advanceTimersByTime(1500)
    expect(g()).not.toHaveBeenCalled()
    voice.hear!('final', 'Remind me to call my sister.')
    vi.advanceTimersByTime(pause() + 10)
    expect(g()).toHaveBeenCalledWith('Remind me to call my sister.')
  })

  test('a finished phrase before the pause ends is sent without waiting', () => {
    voice.hear!('partial', 'hello')
    voice.hear!('final', 'Hello there.')
    vi.advanceTimersByTime(pause() + 10)
    expect(g()).toHaveBeenCalledWith('Hello there.')
  })
})

describe('Interrupting Hermes while it speaks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(v.stopSpeaking).mockClear()
    live.startLive()
  })
  afterEach(() => {
    live.stopLive()
    vi.useRealTimers()
  })

  test('the reading stops and Live mode listens again at once', async () => {
    const gw = await import('./gateway')
    voice.hear!('final', 'tell me a long story')
    vi.advanceTimersByTime(live.getLivePause() * 1000 + 10)
    voice.bridge.onReply('Once upon a time…')
    voice.hear = null
    live.interruptLive()
    expect(v.stopSpeaking).toHaveBeenCalled()
    expect(voice.hear).not.toBeNull() // listening again
    vi.mocked(gw.sendPrompt).mockClear()
    voice.hear!('final', 'Stop, tell me a short one.')
    vi.advanceTimersByTime(live.getLivePause() * 1000 + 10)
    expect(gw.sendPrompt).toHaveBeenCalledWith('Stop, tell me a short one.')
  })

  test('does nothing while listening', () => {
    live.interruptLive()
    expect(v.stopSpeaking).not.toHaveBeenCalled()
    expect(live.liveOn()).toBe(true)
  })
})

describe('Interrupting Hermes by talking (barge-in)', () => {
  let gw: typeof import('./gateway')
  const reply = 'The weather today is sunny with a light breeze from the west.'
  beforeEach(async () => {
    vi.useFakeTimers()
    gw = await import('./gateway')
    vi.mocked(gw.sendPrompt).mockClear()
    vi.mocked(v.stopSpeaking).mockClear()
    vi.mocked(v.stopListening).mockClear()
    localStorage.removeItem('hm.live.bargein')
    voice.over = true
    voice.overCalls = 0
    live.startLive()
    voice.hear!('final', 'what is the weather')
    vi.advanceTimersByTime(live.getLivePause() * 1000 + 10)
    vi.mocked(gw.sendPrompt).mockClear()
    voice.bridge.onReply(reply)
  })
  afterEach(() => {
    live.stopLive()
    voice.over = false
    vi.useRealTimers()
  })

  test('the microphone stays on while Hermes speaks', () => {
    expect(voice.overCalls).toBe(1)
  })

  test("Hermes's own voice coming back is ignored", () => {
    voice.hear!('partial', 'the weather today is sunny')
    voice.hear!('final', 'The weather today is sunny with a light')
    expect(v.stopSpeaking).not.toHaveBeenCalled()
  })

  test('your words cut it off and are sent after the pause', () => {
    voice.hear!('partial', 'what about tomorrow')
    expect(v.stopSpeaking).toHaveBeenCalled()
    voice.hear!('final', 'What about tomorrow?')
    vi.advanceTimersByTime(live.getLivePause() * 1000 + 10)
    expect(gw.sendPrompt).toHaveBeenCalledWith('What about tomorrow?')
  })

  test('"stop" alone cuts it off and sends nothing', () => {
    voice.hear!('final', 'Stop.')
    expect(v.stopSpeaking).toHaveBeenCalled()
    vi.advanceTimersByTime(live.getLivePause() * 1000 + 2000)
    expect(gw.sendPrompt).not.toHaveBeenCalled()
  })

  test('Interrupt restarts the recogniser, so the echo it was hearing is dropped', () => {
    voice.hear = null
    live.interruptLive() // the reading ending by itself takes the same path (relisten)
    expect(v.stopSpeaking).toHaveBeenCalled()
    expect(v.stopListening).toHaveBeenCalled()
    expect(voice.hear).not.toBeNull() // listening again with a new recogniser
  })

  test('off in Settings: the microphone stays closed while Hermes speaks', () => {
    live.stopLive()
    voice.overCalls = 0
    live.setLiveBargeIn(false)
    live.startLive()
    voice.hear!('final', 'hello')
    vi.advanceTimersByTime(live.getLivePause() * 1000 + 10)
    voice.bridge.onReply(reply)
    expect(voice.overCalls).toBe(0)
    localStorage.removeItem('hm.live.bargein')
  })
})

describe('isUserSpeech', () => {
  const said = new Set('the weather today is sunny with a light breeze'.split(' '))
  test.each([
    ['the weather today', false],
    ['weather', false],
    ['tomorrow', false], // one stray word is not enough
    ['stop', true],
    ['wait', true],
    ['what about tomorrow', true],
    ['the weather tomorrow then', false],
    ['', false]
  ])('%s → %s', (heard, user) => expect(live.isUserSpeech(heard, said)).toBe(user))
})

describe('a phone-data request is never answered by voice', () => {
  const hex = (s: string) => Array.from(new TextEncoder().encode(s), b => b.toString(16).padStart(2, '0')).join('')
  const pd = { id: 'p1', method: 'approval', params: { tool_name: 'phone_data', command: '<phone_data> (plugin approval rule)', description: `phone_data:v1:location:0123456789ab:${hex('{}')}` } }
  beforeEach(() => {
    vi.useFakeTimers()
    live.startLive()
  })
  afterEach(() => {
    live.stopLive()
    vi.useRealTimers()
  })

  test('only a request that is not phone data may be answered by voice', () => {
    expect(live.voiceMayAnswer(pd as never)).toBe(false)
    expect(live.voiceMayAnswer({ id: 'a', method: 'approval', params: { command: 'ls', description: 'x' } } as never)).toBe(true)
    // the same text as a shell command's words does not count as phone data (so it is asked as an ordinary command)
    expect(live.voiceMayAnswer({ id: 'b', method: 'approval', params: { command: pd.params.description } } as never)).toBe(true)
  })

  test('the prompt says it needs a tap, and "yes, allow" is neither an answer nor sent to Hermes', async () => {
    const gw = await import('./gateway')
    vi.mocked(gw.answerRequest).mockClear()
    vi.mocked(gw.sendPrompt).mockClear()
    vi.mocked(v.speak).mockClear()
    voice.bridge.onApproval(pd)
    expect(vi.mocked(v.speak).mock.calls.some(c => c.includes(live.PHONE_DATA_VOICE))).toBe(true)
    expect(live.PHONE_DATA_VOICE).toContain('needs a tap in the app')
    voice.hear!('final', 'yes allow')
    vi.advanceTimersByTime(live.getLivePause() * 1000 + 10)
    expect(gw.answerRequest).not.toHaveBeenCalled()
    expect(gw.sendPrompt).not.toHaveBeenCalled()
  })
})
