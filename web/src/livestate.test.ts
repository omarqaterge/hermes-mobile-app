import { describe, expect, test } from 'vitest'
import {
  approvalKind, approvalMayStart, fireStep, hearRoute, hiddenKeepsSpeech, idleMayEnd, isOn, listenOpensMic, listeningAction, liveState,
  mayInterrupt, mayListenOver, muteStep, overAction, overRestartDue, replyAction, restartDue, sentTo, speechEndListens, thinkTimeoutDue,
  type LiveFlags, type LivePhase
} from './livestate'

const base: LiveFlags = { phase: 'listening', muted: false, over: false, finalWait: false, pausePending: false }
const at = (o: Partial<LiveFlags>): LiveFlags => ({ ...base, ...o })
const phases: LivePhase[] = ['off', 'listening', 'thinking', 'speaking']

describe('liveState', () => {
  test.each([
    [at({ phase: 'off' }), 'off'],
    [at({}), 'listening'],
    [at({ finalWait: true }), 'finishing'],
    [at({ muted: true }), 'listening-muted'],
    [at({ phase: 'thinking' }), 'thinking'],
    [at({ phase: 'thinking', muted: true }), 'thinking'],
    [at({ phase: 'speaking' }), 'speaking'],
    [at({ phase: 'speaking', muted: true }), 'speaking'],
    [at({ phase: 'speaking', over: true }), 'speaking-over']
  ])('%j → %s', (s, name) => expect(liveState(s)).toBe(name))
})

test('isOn: every phase but off', () => {
  expect(phases.map(isOn)).toEqual([false, true, true, true])
})

test('approvalKind: none, voice, tap-only', () => {
  expect(approvalKind(null)).toBe('none')
  expect(approvalKind({})).toBe('voice')
  expect(approvalKind({ tapOnly: false })).toBe('voice')
  expect(approvalKind({ tapOnly: true })).toBe('tap-only')
})

describe('hearRoute', () => {
  test.each([
    [at({ phase: 'off' }), 'ignore'],
    [at({}), 'listening'],
    [at({ finalWait: true }), 'listening'],
    [at({ muted: true }), 'ignore'],
    [at({ phase: 'thinking' }), 'ignore'],
    [at({ phase: 'speaking' }), 'ignore'],
    [at({ phase: 'speaking', over: true }), 'over'],
    [at({ phase: 'speaking', over: true, muted: true }), 'over'] // muting clears `over`; if both ever held, barge-in handling still decides
  ])('%j → %s', (s, route) => expect(hearRoute(s)).toBe(route))
})

describe('listeningAction', () => {
  test('a preview always notes the phrase and restarts the countdown', () => {
    expect(listeningAction('partial', at({ finalWait: true, pausePending: true }))).toBe('note-partial')
  })
  test('a finished phrase: send if the countdown waited for it, else arm if none runs, else keep', () => {
    expect(listeningAction('final', at({ finalWait: true, pausePending: true }))).toBe('final-send')
    expect(listeningAction('final', at({ pausePending: false }))).toBe('final-arm')
    expect(listeningAction('final', at({ pausePending: true }))).toBe('final-keep')
  })
  test('error ends Live mode, end restarts the recogniser, quiet does nothing', () => {
    expect(listeningAction('error', base)).toBe('fail')
    expect(listeningAction('end', base)).toBe('restart')
    expect(listeningAction('quiet', base)).toBe('ignore')
  })
})

test('restartDue: only listening, unmuted, with no countdown running', () => {
  expect(restartDue(base)).toBe(true)
  expect(restartDue(at({ muted: true }))).toBe(false)
  expect(restartDue(at({ pausePending: true }))).toBe(false)
  for (const phase of ['off', 'thinking', 'speaking'] as const) expect(restartDue(at({ phase }))).toBe(false)
})

describe('overAction', () => {
  test('error gives up barge-in, end restarts it', () => {
    expect(overAction('error', true)).toBe('give-up')
    expect(overAction('end', false)).toBe('restart')
  })
  test('your words in a preview or phrase cut Hermes off; its own voice, quiet and the rest are ignored', () => {
    expect(overAction('partial', true)).toBe('bargein')
    expect(overAction('final', true)).toBe('bargein')
    expect(overAction('partial', false)).toBe('ignore')
    expect(overAction('final', false)).toBe('ignore')
    expect(overAction('quiet', true)).toBe('ignore')
  })
})

test('overRestartDue: only speaking over Hermes, unmuted', () => {
  expect(overRestartDue(at({ phase: 'speaking', over: true }))).toBe(true)
  expect(overRestartDue(at({ phase: 'speaking', over: false }))).toBe(false)
  expect(overRestartDue(at({ phase: 'speaking', over: true, muted: true }))).toBe(false)
  expect(overRestartDue(at({ phase: 'listening', over: true }))).toBe(false)
})

test('mayListenOver: speaking, unmuted, barge-in available', () => {
  const sp = at({ phase: 'speaking' })
  expect(mayListenOver(sp, true)).toBe(true)
  expect(mayListenOver(sp, false)).toBe(false)
  expect(mayListenOver({ ...sp, muted: true }, true)).toBe(false)
  for (const phase of ['off', 'listening', 'thinking'] as const) expect(mayListenOver(at({ phase }), true)).toBe(false)
})

test('idleMayEnd: only while listening', () => {
  expect(phases.map(idleMayEnd)).toEqual([false, true, false, false])
})

test('listenOpensMic: not while muted', () => {
  expect(listenOpensMic(false)).toBe(true)
  expect(listenOpensMic(true)).toBe(false)
})

describe('fireStep', () => {
  test('a preview with no finished phrase waits once', () => {
    expect(fireStep(base, true, true)).toBe('wait-final')
  })
  test('already waiting: the preview is sent', () => {
    expect(fireStep(at({ finalWait: true }), true, true)).toBe('send')
  })
  test('a finished phrase is sent', () => {
    expect(fireStep(base, false, true)).toBe('send')
  })
  test('nothing to say: dropped', () => {
    expect(fireStep(base, false, false)).toBe('drop')
  })
  test('not listening any more: dropped, never sent', () => {
    for (const phase of ['off', 'thinking', 'speaking'] as const) {
      expect(fireStep(at({ phase }), true, true)).toBe('drop')
      expect(fireStep(at({ phase }), false, true)).toBe('drop')
    }
  })
})

test('sentTo: an approval being asked takes what was said, otherwise Hermes gets it', () => {
  expect(sentTo('none')).toBe('prompt')
  expect(sentTo('voice')).toBe('approval')
  expect(sentTo('tap-only')).toBe('approval') // the tap-only path then refuses it (live.ts)
})

test('thinkTimeoutDue: only while thinking', () => {
  expect(phases.map(thinkTimeoutDue)).toEqual([false, false, true, false])
})

describe('replyAction', () => {
  test('only while thinking', () => {
    for (const phase of ['off', 'listening', 'speaking'] as const) expect(replyAction(phase, 'hello')).toBe('ignore')
  })
  test('text is read, empty or blank text listens again', () => {
    expect(replyAction('thinking', 'hello')).toBe('speak')
    expect(replyAction('thinking', '')).toBe('listen')
    expect(replyAction('thinking', '  \n')).toBe('listen')
  })
})

test('mayInterrupt and speechEndListens: only while speaking', () => {
  expect(phases.map(mayInterrupt)).toEqual([false, false, false, true])
  expect(phases.map(speechEndListens)).toEqual([false, false, false, true])
})

test('approvalMayStart: only while Live mode runs', () => {
  expect(phases.map(approvalMayStart)).toEqual([false, true, true, true])
})

describe('muteStep', () => {
  test('off, or no change: nothing', () => {
    expect(muteStep(at({ phase: 'off' }), true)).toBe('none')
    expect(muteStep(at({}), false)).toBe('none')
    expect(muteStep(at({ muted: true }), true)).toBe('none')
  })
  test('muting closes the microphone when listening or listening over Hermes', () => {
    expect(muteStep(at({}), true)).toBe('mute-close-mic')
    expect(muteStep(at({ phase: 'speaking', over: true }), true)).toBe('mute-close-mic')
  })
  test('muting while thinking or speaking without barge-in has no microphone to close', () => {
    expect(muteStep(at({ phase: 'thinking' }), true)).toBe('mute')
    expect(muteStep(at({ phase: 'speaking' }), true)).toBe('mute')
  })
  test('unmuting: listening restarts the recogniser, speaking re-opens barge-in, thinking just unmutes', () => {
    expect(muteStep(at({ muted: true }), false)).toBe('unmute-listen')
    expect(muteStep(at({ phase: 'speaking', muted: true }), false)).toBe('unmute-listen-over')
    expect(muteStep(at({ phase: 'thinking', muted: true }), false)).toBe('unmute')
  })
})

describe('hiddenKeepsSpeech', () => {
  test('a reply being read keeps playing', () => {
    expect(hiddenKeepsSpeech('speaking', 'none')).toBe(true)
  })
  test('an approval question is cut, whatever kind', () => {
    expect(hiddenKeepsSpeech('speaking', 'voice')).toBe(false)
    expect(hiddenKeepsSpeech('speaking', 'tap-only')).toBe(false)
  })
  test('other phases have nothing to keep', () => {
    for (const phase of ['off', 'listening', 'thinking'] as const) expect(hiddenKeepsSpeech(phase, 'none')).toBe(false)
  })
})
