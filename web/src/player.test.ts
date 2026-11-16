// @vitest-environment happy-dom
// player.ts: the read-aloud player's decisions, and what voice.ts does with them (stale events, pause / resume place).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  RESEEK_MS, estimatePos, isStaleDone, jumpIsShared, nextPace, paceOf, parsePace, parseSeg, pausedPlace, phaseOf,
  reseekDeadline, resumeFrom, seekTarget, shellHoldsPlace,
} from './player'

describe('phases', () => {
  const playing = { paused: false }
  test('no player is idle; paused wins over the re-speak window', () => {
    expect(phaseOf(null, 0, 1000)).toBe('idle')
    expect(phaseOf({ paused: true }, 5000, 1000)).toBe('paused')
  })
  test('a re-speak is seeking until its window ends, then speaking', () => {
    expect(phaseOf(playing, 0, 1000)).toBe('speaking')
    expect(phaseOf(playing, 1300, 1000)).toBe('seeking')
    expect(phaseOf(playing, 1300, 1300)).toBe('speaking')
  })
  test('the window is 300 ms for a re-speak and none for a fresh speech', () => {
    expect(reseekDeadline(true, 1000)).toBe(1000 + RESEEK_MS)
    expect(RESEEK_MS).toBe(300)
    expect(reseekDeadline(false, 1000)).toBe(0)
  })
})

describe('late events', () => {
  test('a done right after a seek is stale, one after the window is real', () => {
    const until = reseekDeadline(true, 1000)
    expect(isStaleDone('', false, until, 1100)).toBe(true)
    expect(isStaleDone('', false, until, 1300)).toBe(false)
  })
  test('a done while paused is our own stop, so stale', () => {
    expect(isStaleDone('', true, 0, 1000)).toBe(true)
  })
  test("'stop' is final while paused and inside the window", () => {
    expect(isStaleDone('stop', true, 5000, 1000)).toBe(false)
  })
  test('a done with nothing pending is real', () => {
    expect(isStaleDone('', false, 0, 1000)).toBe(false)
  })
})

describe('position', () => {
  test('tts-seg and tts-pace arguments', () => {
    expect(parseSeg('120,48')).toEqual({ at: 120, len: 48 })
    expect(parseSeg('x,4')).toBeNull()
    expect(parseSeg('4')).toBeNull()
    expect(parsePace('14.5')).toBe(14.5)
    expect(parsePace('1')).toBeNull()
    expect(parsePace('121')).toBeNull()
    expect(parsePace('fast')).toBeNull()
  })
  test('the pace is the measured one, else 14 characters per second times the speed', () => {
    expect(paceOf(20, 2)).toBe(20)
    expect(paceOf(0, 1.5)).toBe(21)
    expect(paceOf(0, 0)).toBe(14)
  })
  test('a finished stretch updates the pace: first alone, then averaged; no time measures nothing', () => {
    const seg = { len: 100, t0: 1000 }
    expect(nextPace(0, seg, 3000)).toBe(50)
    expect(nextPace(30, seg, 3000)).toBe(40)
    expect(nextPace(30, seg, 1000)).toBe(30)
    expect(nextPace(30, null, 3000)).toBe(30)
  })
  test('the estimate moves at the pace and stops at the end of the stretch', () => {
    const seg = { at: 200, len: 40, t0: 1000 }
    expect(estimatePos(seg, 2000, 10)).toBe(210)
    expect(estimatePos(seg, 9000, 10)).toBe(240)
  })
})

describe('pause and resume', () => {
  test("the shell's paused place is relative to the speech start and kept inside the text", () => {
    expect(pausedPlace(100, 30, 1000)).toBe(130)
    expect(pausedPlace(100, 30, 120)).toBe(120)
  })
  test('the shell resumes only while the page still stands on its place', () => {
    expect(shellHoldsPlace(true, 130, 130)).toBe(true)
    expect(shellHoldsPlace(true, 130, 130.5)).toBe(true)
    expect(shellHoldsPlace(true, 130, 400)).toBe(false) // seeked while paused: re-speak
    expect(shellHoldsPlace(true, null, 130)).toBe(false) // speed changed: it forgot its place
    expect(shellHoldsPlace(false, 130, 130)).toBe(false) // browser voice
  })
  test('jumps are the shell\'s while playing, or paused on its place', () => {
    expect(jumpIsShared(true, false, null, 5)).toBe(true)
    expect(jumpIsShared(true, true, 5, 5)).toBe(true)
    expect(jumpIsShared(true, true, 5, 50)).toBe(false)
    expect(jumpIsShared(false, false, null, 5)).toBe(false)
  })
  test('a re-spoken resume and a seek stay inside the text', () => {
    expect(resumeFrom(50, 100)).toBe(50)
    expect(resumeFrom(100, 100)).toBe(99)
    expect(resumeFrom(0, 0)).toBe(0)
    expect(seekTarget(49.6, 100)).toBe(50)
    expect(seekTarget(-5, 100)).toBe(0)
    expect(seekTarget(500, 100)).toBe(99)
  })
})

describe('voice.ts with a native shell', () => {
  type V = typeof import('./voice')
  let v: V
  let calls: Array<[string, ...unknown[]]>
  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    calls = []
    ;(window as unknown as { HermesAndroid: unknown }).HermesAndroid = {
      speak: (t: string, c: string) => calls.push(['speak', t, JSON.parse(c).base]),
      stopSpeaking: () => calls.push(['stop']),
      ttsControl: (a: string) => calls.push(['ctl', a]),
    }
    v = await import('./voice')
    v.speak('a', 'x'.repeat(200))
  })
  afterEach(() => {
    vi.useRealTimers()
    delete (window as unknown as { HermesAndroid?: unknown }).HermesAndroid
  })
  const ev = (k: string, t = '') => window.__hmVoice!(k, t)

  test('a done reported right after a seek is ignored; a later one ends the player', () => {
    v.seekSpeaking(100)
    expect(calls.at(-1)).toEqual(['speak', 'x'.repeat(100), 100])
    ev('tts-done')
    expect(v.voiceState().player).not.toBeNull()
    vi.advanceTimersByTime(RESEEK_MS)
    ev('tts-done')
    expect(v.voiceState().player).toBeNull()
  })

  test('pause keeps the shell place and resume says play; a seek while paused re-speaks from the new place', () => {
    v.pauseSpeaking()
    ev('tts-paused', '60')
    expect(v.voiceState().player).toMatchObject({ paused: true, pos: 60 })
    ev('tts-done') // the engine reporting our own stop
    expect(v.voiceState().player).not.toBeNull()
    v.resumeSpeaking()
    expect(calls.at(-1)).toEqual(['ctl', 'play'])
    expect(v.voiceState().player).toMatchObject({ paused: false, pos: 60 })

    v.pauseSpeaking()
    ev('tts-paused', '60')
    v.seekSpeaking(150)
    expect(v.voiceState().player).toMatchObject({ paused: true, pos: 150 })
    v.resumeSpeaking()
    expect(calls.at(-1)).toEqual(['speak', 'x'.repeat(50), 150])
  })

  test("the notification's stop ends the player even while paused", () => {
    v.pauseSpeaking()
    ev('tts-paused', '60')
    ev('tts-done', 'stop')
    expect(v.voiceState().player).toBeNull()
  })
})

describe('voice.ts with the browser speech engine', () => {
  type V = typeof import('./voice')
  type Utt = { text: string; onend?: () => void; onerror?: () => void; onboundary?: (e: { charIndex: number }) => void; rate: number }
  let v: V
  let utts: Utt[]
  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    utts = []
    let current: Utt | null = null
    class FakeUtterance {
      rate = 1
      constructor(public text: string) {}
    }
    // Like a browser: cancel() ends the utterance being spoken, and it reports that a moment later.
    const fake = {
      speak: (u: Utt) => ((current = u), utts.push(u)),
      cancel: () => {
        const old = current
        current = null
        if (old) setTimeout(() => old.onend?.(), 0)
      },
    }
    ;(window as unknown as Record<string, unknown>).SpeechSynthesisUtterance = FakeUtterance
    ;(window as unknown as Record<string, unknown>).speechSynthesis = fake
    ;(globalThis as unknown as Record<string, unknown>).SpeechSynthesisUtterance = FakeUtterance
    ;(globalThis as unknown as Record<string, unknown>).speechSynthesis = fake
    v = await import('./voice')
    v.speak('a', 'x'.repeat(200))
  })
  afterEach(() => {
    vi.useRealTimers()
    for (const o of [window, globalThis] as unknown as Record<string, unknown>[]) {
      delete o.speechSynthesis
      delete o.SpeechSynthesisUtterance
    }
  })

  test('the replaced utterance ending after a seek does not clear the player', () => {
    v.seekSpeaking(100)
    expect(utts).toHaveLength(2)
    vi.advanceTimersByTime(1) // the old utterance reports its end now
    expect(v.voiceState().player).not.toBeNull()
    expect(v.voiceState().speakingId).toBe('a')
  })

  test('the replaced utterance ending after a speed change does not clear the player', () => {
    v.setReadingSpeed(1.5)
    vi.advanceTimersByTime(1)
    expect(v.voiceState().player).not.toBeNull()
  })

  test('the utterance that is current ending clears the player', () => {
    v.seekSpeaking(100)
    vi.advanceTimersByTime(1)
    utts[1].onend!()
    expect(v.voiceState().player).toBeNull()
  })

  test('an old utterance ending late, after stop and a new speech, does not clear the new player', () => {
    v.stopSpeaking()
    v.speak('b', 'y'.repeat(100))
    vi.advanceTimersByTime(1)
    expect(v.voiceState().player).not.toBeNull()
  })
})
