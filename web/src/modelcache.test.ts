// @vitest-environment happy-dom
// The chat model picker's kept list: per profile, slim, a live refresh only when due and never two at once.
import { afterEach, describe, expect, it } from 'vitest'
import type { ModelOptionsResult } from '@hermes/shared/gateway-contract.generated'
import { REFRESH_EVERY_MS, cachedModels, liveOnce, modelsChanged, refreshDue, refreshing, saveModels, slim } from './modelcache'

const answer = (models: string[]): ModelOptionsResult => ({
  model: 'm1',
  provider: 'p',
  providers: [{ slug: 'p', name: 'P', models, authenticated: true, pricing: { m1: { input: '1' } } as never, capabilities: {} }]
})

afterEach(() => localStorage.clear())

describe('model picker cache', () => {
  it('keeps only what the picker draws, per profile', () => {
    saveModels('default', slim(answer(['m1', 'm2'])), false)
    const got = cachedModels('default')
    expect(got?.providers[0]).toEqual({ slug: 'p', name: 'P', models: ['m1', 'm2'], authenticated: true, is_current: undefined, free_tier: undefined })
    expect(JSON.stringify(got)).not.toContain('pricing')
    expect(cachedModels('mentor')).toBeNull()
  })

  it('asks for a live list only when the last one is old, or after a credential change', () => {
    expect(refreshDue('default')).toBe(true)
    saveModels('default', slim(answer(['m1'])), false)
    expect(refreshDue('default')).toBe(true) // a plain read is not a live list
    saveModels('default', slim(answer(['m1'])), true)
    expect(refreshDue('default')).toBe(false)
    expect(refreshDue('default', Date.now() + REFRESH_EVERY_MS)).toBe(true)
    saveModels('default', slim(answer(['m1'])), false) // a later plain read keeps the live time
    expect(refreshDue('default')).toBe(false)
    modelsChanged()
    expect(refreshDue('default')).toBe(true)
    expect(cachedModels('default')).not.toBeNull() // the list itself stays
  })

  it('runs one live refresh per profile at a time and keeps its answer', async () => {
    let runs = 0
    let finish: (r: ModelOptionsResult) => void = () => {}
    const run = () => {
      runs++
      return new Promise<ModelOptionsResult>(r => (finish = r))
    }
    const a = liveOnce('default', run)
    const b = liveOnce('default', run)
    expect(a).toBe(b)
    expect(refreshing('default')).toBe(true)
    finish(answer(['live']))
    expect((await a).providers[0].models).toEqual(['live'])
    expect(runs).toBe(1)
    expect(refreshing('default')).toBe(false)
    expect(cachedModels('default')?.providers[0].models).toEqual(['live'])
    expect(refreshDue('default')).toBe(false)
  })

  it('a failed refresh leaves the list and the timer as they were', async () => {
    saveModels('default', slim(answer(['old'])), false)
    await expect(liveOnce('default', () => Promise.reject(new Error('down')))).rejects.toThrow('down')
    expect(refreshing('default')).toBe(false)
    expect(cachedModels('default')?.providers[0].models).toEqual(['old'])
    expect(refreshDue('default')).toBe(true)
  })

  it('survives unreadable storage', () => {
    localStorage.setItem('hm.modelOptions.v1', '{not json')
    expect(cachedModels('default')).toBeNull()
    expect(refreshDue('default')).toBe(true)
    saveModels('default', slim(answer(['m1'])), true)
    expect(cachedModels('default')?.providers).toHaveLength(1)
  })
})
