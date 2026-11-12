import { describe, expect, it } from 'vitest'
import { pluginRow, updateAnswer, updateDialog, type PluginState } from './plugin-sync'

const base: PluginState = { state: 'current', detail: '', installed: '1793648698', apk: '1793648698', running: '', tries: 0, maxTries: 3 }

describe('pluginRow', () => {
  it('shows the installed version as a date, an old copy as "Old version"', () => {
    expect(pluginRow(base).value).toBe('2026-11-02')
    expect(pluginRow({ ...base, installed: '0', state: 'older' }).value).toBe('Old version')
    expect(pluginRow({ ...base, installed: '' }).value).toBe('—')
  })
  it('offers an update only where one makes sense', () => {
    expect(pluginRow(base).action).toBe(null)
    expect(pluginRow({ ...base, state: 'older' }).action).toBe('update')
    expect(pluginRow({ ...base, state: 'busy' }).action).toBe('update')
    expect(pluginRow({ ...base, state: 'failed' }).action).toBe('update')
    expect(pluginRow({ ...base, state: 'modified' }).action).toBe('force')
    for (const state of ['newer', 'held', 'not-ready', 'unknown']) expect(pluginRow({ ...base, state }).action).toBe(null)
  })
  it('a running check or update has no action', () => {
    expect(pluginRow({ ...base, state: 'older', running: 'apply' })).toMatchObject({ action: null, sub: expect.stringMatching(/^Updating/) })
    expect(pluginRow({ ...base, state: 'older', running: 'check' }).action).toBe(null)
  })
  it('a failure says the old plugin still works, and whether it retries by itself', () => {
    const f = pluginRow({ ...base, state: 'failed', detail: 'load rolled-back', tries: 1 })
    expect(f.sub).toContain('(load rolled-back)')
    expect(f.sub).toContain('still works')
    expect(f.sub).toContain('later by itself')
    expect(pluginRow({ ...base, state: 'failed', tries: 3 }).sub).toContain('only when you tap')
  })
})

describe('updateAnswer', () => {
  it('maps the shell answers', () => {
    expect(updateAnswer('ok')).toBe('')
    expect(updateAnswer('working')).toMatch(/working/)
    expect(updateAnswer('error: this app build has no plugin')).toBe('this app build has no plugin')
  })
})

describe('an old plugin whose work can’t be asked (busy-unknown)', () => {
  it('has a row of its own that says a tap may cut off work, and is not "waiting"', () => {
    const r = pluginRow({ ...base, state: 'busy-unknown', detail: 'unknown' })
    expect(r.action).toBe('update')
    expect(r.sub).toMatch(/cut off/)
    expect(r.sub).not.toMatch(/Waiting/)
  })
  it('asks before an update in that state, before replacing hand changes, and not otherwise', () => {
    expect(updateDialog('busy-unknown', false)?.message).toMatch(/cut off/)
    expect(updateDialog('modified', true)?.message).toMatch(/changes made by hand go/)
    expect(updateDialog('modified', true)?.message).not.toMatch(/cut off/)
    expect(updateDialog('busy-unknown', true)?.message).toMatch(/cut off/)
    expect(updateDialog('older', false)).toBeNull()
    expect(updateDialog('busy', false)).toBeNull()
    expect(updateDialog(undefined, false)).toBeNull()
  })
  it('on a switched phone asks before every tap that restarts Hermes, and says so to the shell', () => {
    for (const st of ['older', 'failed', 'busy', 'busy-unknown']) {
      const d = updateDialog(st, false, true)
      expect(d?.message).toMatch(/cut off/)
      expect(d?.cut).toBe(true)
    }
    expect(updateDialog('modified', true, true)?.cut).toBe(true)
    expect(updateDialog('modified', true, true)?.message).toMatch(/cut off/)
    expect(updateDialog('modified', true, false)?.cut).toBe(false)
    expect(updateDialog('current', false, true)).toBeNull()
    expect(updateDialog('held', false, true)).toBeNull()
  })
})
