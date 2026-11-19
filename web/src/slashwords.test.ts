import { describe, expect, it } from 'vitest'
import { detachedRefusal, detachedWork, hermesWords } from './slashwords'

const ch = (...codes: number[]) => String.fromCharCode(...codes)

describe('reading a command as Hermes does', () => {
  it('splits on every separator of Python', () => {
    for (const c of [9, 10, 11, 12, 13, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000]) {
      expect(hermesWords(`/bg${ch(c)}do it`)).toEqual({ name: 'bg', arg: 'do it' })
      expect(hermesWords(`/${ch(c)}bg do it`).name).toBe('bg')
      expect(hermesWords(`${ch(c)}/bg${ch(c)}`).name).toBe('bg')
    }
  })
  it('does not split on what Python keeps in a word', () => {
    expect(hermesWords(`/bg${ch(0xfeff)}x y`).name).toBe(`bg${ch(0xfeff)}x`)
    expect(hermesWords(`/bg${ch(0x200b)}x`).name).toBe(`bg${ch(0x200b)}x`)
  })
  it('takes any number of leading slashes, and copes with nothing', () => {
    expect(hermesWords('///BG  a  b ')).toEqual({ name: 'BG', arg: 'a  b' })
    expect(hermesWords('/')).toEqual({ name: '', arg: '' })
  })
})

describe('commands that start work apart from the chat', () => {
  it('finds a background task, however it is spelled', () => {
    for (const n of ['bg', 'BG', 'bac', 'backg', 'background']) expect(detachedWork(n, 'x')).toBe('a background task')
    for (const n of ['b', 'ba', 'bgx', 'box', 'btw', 'help']) expect(detachedWork(n, 'x')).toBeNull() // /b is ambiguous, /ba is /battery
  })
  it('finds what schedules a prompt, and leaves the rest of /cron alone', () => {
    for (const a of ['add "every 1h" hi', 'ADD x', '"add" x', 'cre"ate" x', 'edit id --prompt y']) expect(detachedWork('cron', a)).toBe('a scheduled job')
    expect(detachedWork('cr', 'add x')).toBe('a scheduled job')
    for (const a of ['', 'list', 'run id', 'pause id', 'remove id', 'resume id']) expect(detachedWork('cron', a)).toBeNull()
    expect(detachedWork('c', 'add x')).toBeNull()
  })
  it('finds board tasks and automations with values', () => {
    expect(detachedWork('kanban', 'create "do it"')).toBe('a board task')
    expect(detachedWork('kanban', '--board main dispatch')).toBe('a board task')
    expect(detachedWork('k', 'daemon')).toBe('a board task')
    for (const a of ['', 'list', 'show t1', 'comment t1 create']) expect(detachedWork('kanban', a)).toBeNull()
    expect(detachedWork('blueprint', 'daily topic=x')).toBe('an automation')
    for (const a of ['', 'daily']) expect(detachedWork('blueprint', a)).toBeNull()
  })
})

describe('the refusal', () => {
  it('says the chat has read only when that is known', () => {
    expect(detachedRefusal('a background task', 'read')).toContain('has read data from your phone, so')
    const unsure = detachedRefusal('a background task', 'unknown')
    expect(unsure).toContain('couldn’t check whether')
    expect(unsure).not.toContain('This chat has read')
  })
})
