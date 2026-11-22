// The states the agent's animations are tied to (agentmotion.ts): each starts with its state and stops with it.
import { expect, test } from 'vitest'
import { composerLight, justSent, liveStep, noteSent, SENT_WINDOW_MS, stepEnd, toolLive, turnTick } from './agentmotion'
import type { ChatItem } from './store'

test('the composer light: working while a turn or sub-agents run, amber and still while Hermux waits, none at rest', () => {
  expect(composerLight(false, false, false)).toBe(null)
  expect(composerLight(true, false, false)).toBe('working')
  expect(composerLight(false, true, false)).toBe('working')
  expect(composerLight(true, false, true)).toBe('waiting')
  expect(composerLight(false, true, true)).toBe('waiting')
  // A request left over after the turn ended lights nothing: the light is tied to the turn.
  expect(composerLight(false, false, true)).toBe(null)
})

test('a step ends once: only a step seen running animates its tick or its cross', () => {
  expect(stepEnd(true, true, false)).toBe(null) // still running
  expect(stepEnd(true, false, false)).toBe('done')
  expect(stepEnd(true, false, true)).toBe('failed')
  expect(stepEnd(false, false, false)).toBe(null) // from history: never seen running
  expect(stepEnd(false, false, true)).toBe(null)
  expect(toolLive('running') && toolLive('generating')).toBe(true)
  expect(toolLive('done') || toolLive('error')).toBe(false)
})

test('a sent message lifts once, just after the send; history does not move', () => {
  const t = 1_000_000
  expect(justSent(t, t)).toBe(false) // nothing sent yet
  noteSent(t)
  expect(justSent(t + 10, t + 50)).toBe(true)
  expect(justSent(undefined, t + 50)).toBe(true)
  expect(justSent(t - 10 * SENT_WINDOW_MS, t + 50)).toBe(false) // an older message mounting now (a window drawn)
  expect(justSent(t + 10, t + SENT_WINDOW_MS + 1)).toBe(false) // too late: a chat reopened later
})

const reply = (text: string, streaming = false): ChatItem => ({ kind: 'assistant', id: 'a', text, reasoning: '', streaming }) as ChatItem

test('the finished turn ticks once, on screen, unlocked, with an answer; never while it runs or for another chat', () => {
  const base = { wasRunning: true, running: false, sameChat: true, visible: true, locked: false, last: reply('Done.') }
  expect(turnTick(base)).toBe(true)
  expect(turnTick({ ...base, running: true })).toBe(false) // still running: steps never tick
  expect(turnTick({ ...base, wasRunning: false })).toBe(false) // nothing ended
  expect(turnTick({ ...base, sameChat: false })).toBe(false) // another chat opened
  expect(turnTick({ ...base, visible: false })).toBe(false) // the app is away
  expect(turnTick({ ...base, locked: true })).toBe(false) // over the lock screen
  expect(turnTick({ ...base, last: reply('  ') })).toBe(false) // no answer (stopped)
  expect(turnTick({ ...base, last: { kind: 'notice', id: 'n', level: 'error', text: 'failed' } as ChatItem })).toBe(false)
})

test('one running step moves: the newest running tool of the running turn, none while a group line shimmers', () => {
  const tool = (id: string, status: string): ChatItem => ({ kind: 'tool', id, name: 'terminal', status }) as unknown as ChatItem
  const user = { kind: 'user', id: 'u', text: 'go' } as ChatItem
  expect(liveStep([user, tool('a', 'running'), tool('b', 'running')], false)).toBe(2)
  expect(liveStep([user, tool('a', 'running'), tool('b', 'done')], false)).toBe(1)
  expect(liveStep([user, tool('a', 'done')], false)).toBe(-1)
  expect(liveStep([tool('old', 'running'), user, tool('a', 'done')], false)).toBe(-1) // an earlier turn's card never moves
  expect(liveStep([user, tool('a', 'running')], true)).toBe(-1)
})
