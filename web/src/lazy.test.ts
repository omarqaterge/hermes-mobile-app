// @vitest-environment happy-dom
import { expect, test } from 'vitest'
import { runLazy } from './lazy'

test('runs an inert script once and returns its global', async () => {
  const s = document.createElement('script')
  s.type = 'text/hm-lazy'
  s.id = 'hm-test'
  s.textContent = 'window.__hmTestRuns = (window.__hmTestRuns || 0) + 1; window.__hmTest = { ok: true }'
  document.body.append(s)
  const a = await runLazy<{ ok: boolean }>('hm-test', '__hmTest')
  const b = await runLazy<{ ok: boolean }>('hm-test', '__hmTest')
  expect(a.ok).toBe(true)
  expect(b).toBe(a)
  expect((window as unknown as { __hmTestRuns: number }).__hmTestRuns).toBe(1)
})

test('a missing bundle rejects, and a later call can retry', async () => {
  await expect(runLazy('hm-none', '__hmNone')).rejects.toThrow(/not bundled/)
  const s = document.createElement('script')
  s.type = 'text/hm-lazy'
  s.id = 'hm-none'
  s.textContent = 'window.__hmNone = 1'
  document.body.append(s)
  await expect(runLazy('hm-none', '__hmNone')).resolves.toBe(1)
})
