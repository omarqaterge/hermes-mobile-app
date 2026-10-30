import { describe, expect, it } from 'vitest'
import { nextStep } from './clarify'

const qs = [{ qid: 'a' }, { qid: 'b' }, { qid: 'c' }, { qid: 'd' }]

describe('nextStep', () => {
  it('goes to the next question when nothing is answered', () => {
    expect(nextStep({}, qs, 0)).toBe(1)
  })
  it('skips answered questions', () => {
    expect(nextStep({ b: 'x', c: 'y' }, qs, 0)).toBe(3)
  })
  it('treats blank answers as unanswered', () => {
    expect(nextStep({ b: '  ' }, qs, 0)).toBe(1)
  })
  it('moves to the next index when everything after is answered', () => {
    expect(nextStep({ b: 'x', c: 'y', d: 'z' }, qs, 0)).toBe(1)
  })
  it('never goes past the last question', () => {
    expect(nextStep({}, qs, 3)).toBe(3)
    expect(nextStep({}, qs, 2)).toBe(3)
  })
})
