import { describe, expect, it } from 'vitest'
import { chosenSttName, fmtSize, testSummary, type SttList, type SttModel } from './stt'

const model = (p: Partial<SttModel>): SttModel => ({ id: 'm', name: 'Moonshine Base (English)', kind: 'moonshine', size: 1, live: false, punctuation: true, custom: false, state: 'ready', ...p })

describe('stt helpers', () => {
  it('sizes in MB, GB from 1e9', () => {
    expect(fmtSize(141_300_000)).toBe('141 MB')
    expect(fmtSize(200)).toBe('1 MB')
    expect(fmtSize(1_250_000_000)).toBe('1.3 GB')
  })
  it('names the model in use only when it is ready', () => {
    const l: SttList = { chosen: 'm', models: [model({})] }
    expect(chosenSttName(l)).toBe('Moonshine Base')
    expect(chosenSttName({ ...l, models: [model({ state: 'failed' })] })).toBe('Phone’s speech recognition')
    expect(chosenSttName({ ...l, chosen: '' })).toBe('Phone’s speech recognition')
    expect(chosenSttName(null)).toBe('Phone’s speech recognition')
  })
  it('summarises a test: words right and speed', () => {
    const sample = 'one two three four'
    expect(testSummary({ wer: 0.25, ms: 600, audioMs: 6625 }, sample)).toBe('3 of 4 words right · 0.6 s for 6.6 s of speech')
    expect(testSummary({ wer: 1.5 }, sample)).toBe('0 of 4 words right')
    expect(testSummary({ ms: 600, audioMs: 6625 })).toBe('0.6 s for 6.6 s of speech')
  })
})
