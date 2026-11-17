// @vitest-environment happy-dom
// order.ts syncOrder: the phone's copy (plugin GET /prefs) is compared with the local copy as it is when the answer
// arrives. A pin made while the answer was on its way is newer and must survive and reach the plugin.
import { beforeEach, describe, expect, test, vi } from 'vitest'

const net = vi.hoisted(() => ({
  puts: [] as { pinned: string[]; at: number }[],
  answer: null as null | ((v: unknown) => void)
}))
vi.mock('./api', () => ({
  api: vi.fn((method: string, _path: string, body?: { pinned: string[]; at: number }) => {
    if (method === 'PUT') {
      net.puts.push(body!)
      return Promise.resolve({})
    }
    return new Promise(res => (net.answer = res)) // GET: held until the test answers
  })
}))

import { getOrder, syncOrder, updateOrder } from './order'

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0))
}

describe('syncOrder', () => {
  beforeEach(() => {
    net.puts.length = 0
    net.answer = null
    localStorage.clear()
  })

  test('a pin made while the GET is on its way is kept and uploaded, not replaced by the older remote copy', async () => {
    syncOrder('race')
    expect(net.answer).toBeTypeOf('function')
    updateOrder('race', o => ({ ...o, pinned: ['s-43'] }))
    const pinAt = getOrder('race').at!
    net.answer!({ order: { pinned: [], manual: null, at: pinAt - 20000 } })
    await flush()
    expect(getOrder('race').pinned).toEqual(['s-43'])
    expect(JSON.parse(localStorage.getItem('hm.order.v1.race') || 'null').pinned).toEqual(['s-43'])
    // One upload, the newest copy: the pin's own and the sync's are the same debounced write.
    await new Promise(r => setTimeout(r, 1100))
    expect(net.puts.map(p => p.pinned)).toEqual([['s-43']])
    expect(net.puts[0].at).toBe(pinAt)
  })

  test('a newer remote copy still wins over an older local one', async () => {
    updateOrder('newer', o => ({ ...o, pinned: ['old'] }))
    const localAt = getOrder('newer').at!
    syncOrder('newer')
    net.answer!({ order: { pinned: ['phone'], manual: null, at: localAt + 1000 } })
    await flush()
    expect(getOrder('newer').pinned).toEqual(['phone'])
  })
})
