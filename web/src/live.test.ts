// @vitest-environment happy-dom
// Live mode leaving the screen: the microphone closes, a reply being read keeps playing.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const voice = vi.hoisted(() => ({
  hear: null as null | ((kind: string, t: string) => void),
  bridge: { active: false, onReply: (_t: string) => {}, onApproval: (_r: unknown) => {}, stop: () => {} }
}))
vi.mock('./voice', () => ({
  liveBridge: voice.bridge,
  onTtsDone: () => () => {},
  setLiveMuted: () => {},
  setLivePhase: () => {},
  speak: vi.fn(),
  startListening: (cb: (kind: string, t: string) => void) => {
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
