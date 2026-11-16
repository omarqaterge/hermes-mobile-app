// agentbuild.ts: whether a chat's agent is built, and what may wait for it.
import { describe, expect, test } from 'vitest'
import { BUILD_CAP_MS, READY_CAP, createAgentBuilds } from './agentbuild'

/** A timer the test runs by hand. */
function clock() {
  const due: { fn: () => void; ms: number }[] = []
  return { after: (fn: () => void, ms: number) => void due.push({ fn, ms }), due, fire: () => due.splice(0).forEach(d => d.fn()) }
}
const settled = async (p: Promise<unknown>) => {
  let done = false
  void p.then(() => (done = true), () => (done = true))
  await new Promise(r => setTimeout(r, 0)) // every promise step of a chained switch has run by now
  return done
}

describe('states', () => {
  test('unknown, then building, then ready', () => {
    const b = createAgentBuilds(clock().after)
    expect(b.buildState('r1')).toBe('unknown')
    b.trackBuild('r1')
    expect(b.buildState('r1')).toBe('building')
    b.markBuilt('r1')
    expect(b.buildState('r1')).toBe('ready')
  })

  test('a switch in flight shows as switching, then the state it was in', async () => {
    const b = createAgentBuilds(clock().after)
    b.markBuilt('r1')
    let finish!: () => void
    const run = b.runSwitch('r1', () => new Promise<void>(r => (finish = r)))
    expect(b.buildState('r1')).toBe('switching')
    finish()
    await run
    expect(b.buildState('r1')).toBe('ready')
  })

  test('an empty runtime id is never tracked', () => {
    const c = clock()
    createAgentBuilds(c.after).trackBuild('')
    expect(c.due).toHaveLength(0)
  })
})

describe('trackBuild and markBuilt', () => {
  test('a pick waits for the first session.info', async () => {
    const b = createAgentBuilds(clock().after)
    b.trackBuild('r1')
    const w = b.whenBuilt('r1')
    expect(await settled(w)).toBe(false)
    b.markBuilt('r1')
    expect(await settled(w)).toBe(true)
  })

  test('session.info before the create answer: no wait', async () => {
    const c = clock()
    const b = createAgentBuilds(c.after)
    b.markBuilt('r1')
    b.trackBuild('r1')
    expect(b.buildState('r1')).toBe('ready')
    expect(c.due).toHaveLength(0)
    expect(await settled(b.whenBuilt('r1'))).toBe(true)
  })

  test('a warm resume (same runtime id, already ready) does not wait', async () => {
    const b = createAgentBuilds(clock().after)
    b.trackBuild('r1')
    b.markBuilt('r1')
    b.trackBuild('r1')
    expect(b.buildState('r1')).toBe('ready')
    expect(await settled(b.whenBuilt('r1'))).toBe(true)
  })

  test('tracking twice keeps one wait and one timer', () => {
    const c = clock()
    const b = createAgentBuilds(c.after)
    b.trackBuild('r1')
    b.trackBuild('r1')
    expect(c.due).toHaveLength(1)
  })

  test('the 20 s cap lets a pick go on when session.info never comes', async () => {
    const c = clock()
    const b = createAgentBuilds(c.after)
    b.trackBuild('r1')
    expect(c.due[0].ms).toBe(BUILD_CAP_MS)
    expect(BUILD_CAP_MS).toBe(20_000)
    const w = b.whenBuilt('r1')
    expect(await settled(w)).toBe(false)
    c.fire()
    expect(await settled(w)).toBe(true)
    expect(b.buildState('r1')).toBe('ready')
  })

  test('an unknown runtime does not make a pick wait', async () => {
    expect(await settled(createAgentBuilds(clock().after).whenBuilt('nope'))).toBe(true)
  })

  test('only the last 200 announced runtimes are remembered', () => {
    const b = createAgentBuilds(clock().after)
    expect(READY_CAP).toBe(200)
    for (let i = 0; i < 201; i++) b.markBuilt(`r${i}`)
    expect(b.buildState('r0')).toBe('unknown')
    expect(b.buildState('r1')).toBe('ready')
    expect(b.buildState('r200')).toBe('ready')
  })
})

describe('switching', () => {
  test('a send waits for a switch in flight', async () => {
    const b = createAgentBuilds(clock().after)
    let finish!: () => void
    void b.runSwitch('r1', () => new Promise<void>(r => (finish = r)))
    const w = b.whenSwitched('r1')
    expect(await settled(w)).toBe(false)
    finish()
    expect(await settled(w)).toBe(true)
  })

  test('a send with no switch goes at once', async () => {
    expect(await settled(createAgentBuilds(clock().after).whenSwitched('r1'))).toBe(true)
  })

  test('a failed switch fails its own caller but does not block the next send', async () => {
    const b = createAgentBuilds(clock().after)
    let fail!: (e: Error) => void
    const run = b.runSwitch('r1', () => new Promise<void>((_, rej) => (fail = rej)))
    const w = b.whenSwitched('r1')
    fail(new Error('no'))
    await expect(run).rejects.toThrow('no')
    expect(await settled(w)).toBe(true)
    expect(await settled(b.whenSwitched('r1'))).toBe(true)
    expect(b.buildState('r1')).toBe('unknown')
  })

  test('the switch itself waits for the build when its work asks', async () => {
    const b = createAgentBuilds(clock().after)
    b.trackBuild('r1')
    const order: string[] = []
    const run = b.runSwitch('r1', async () => {
      await b.whenBuilt('r1')
      order.push('config.set')
    })
    expect(b.buildState('r1')).toBe('switching')
    await Promise.resolve()
    expect(order).toEqual([])
    b.markBuilt('r1')
    await run
    expect(order).toEqual(['config.set'])
  })

  test('a second quick pick replaces the first; the first finishing does not remove the second', async () => {
    const b = createAgentBuilds(clock().after)
    let first!: () => void
    let second!: () => void
    const r1 = b.runSwitch('r1', () => new Promise<void>(r => (first = r)))
    const r2 = b.runSwitch('r1', () => new Promise<void>(r => (second = r)))
    first()
    await r1
    expect(b.buildState('r1')).toBe('switching')
    const w = b.whenSwitched('r1')
    expect(await settled(w)).toBe(false)
    await new Promise(r => setTimeout(r, 0))
    second()
    await r2
    expect(await settled(w)).toBe(true)
    expect(b.buildState('r1')).toBe('unknown')
  })

  test('a second pick starts only after the first finished, so the newest is applied last', async () => {
    const b = createAgentBuilds(clock().after)
    const order: string[] = []
    let first!: () => void
    const r1 = b.runSwitch('r1', () => new Promise<void>(r => { order.push('start 1'); first = () => { order.push('end 1'); r() } }))
    const r2 = b.runSwitch('r1', async () => { order.push('start 2'); order.push('end 2') })
    await settled(r2)
    expect(order).toEqual(['start 1'])
    first()
    await Promise.all([r1, r2])
    expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2'])
  })

  test('a failed first switch does not stop or fail the second', async () => {
    const b = createAgentBuilds(clock().after)
    let fail!: (e: Error) => void
    const r1 = b.runSwitch('r1', () => new Promise<void>((_, rej) => (fail = rej)))
    let ran = false
    const r2 = b.runSwitch('r1', async () => { ran = true })
    fail(new Error('no'))
    await expect(r1).rejects.toThrow('no')
    await expect(r2).resolves.toBeUndefined()
    expect(ran).toBe(true)
  })

  test('a send waits for the newest of several queued switches', async () => {
    const b = createAgentBuilds(clock().after)
    let first!: () => void
    let second!: () => void
    void b.runSwitch('r1', () => new Promise<void>(r => (first = r)))
    void b.runSwitch('r1', () => new Promise<void>(r => (second = r)))
    const w = b.whenSwitched('r1')
    first()
    expect(await settled(w)).toBe(false)
    await new Promise(r => setTimeout(r, 0))
    second()
    expect(await settled(w)).toBe(true)
  })

  test('switches on different runtimes do not wait for each other', async () => {
    const b = createAgentBuilds(clock().after)
    void b.runSwitch('r1', () => new Promise<void>(() => {}))
    expect(await settled(b.whenSwitched('r2'))).toBe(true)
  })
})
