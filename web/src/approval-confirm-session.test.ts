// @vitest-environment happy-dom
// Confirm approvals with fingerprint (docs/decisions/approval-needs-fingerprint.md): a confirmation is filed under the live
// Hermes session (runtime id) the approval came from. One row per way a chat can end up in another live session (a
// reconnect, an opening racing another, a resume racing syncRunning, a prompt left open while its session closes, and the
// paths around them): in every row the first Allow in the new live session asks for the fingerprint and a second one in
// that live session doesn't. The fake shell below keeps its
// confirmed live sessions the way ApprovalLock.java does (and survives a page reload, as the shell's process does).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  api: vi.fn(async () => ({})),
  qs: () => ''
}))

const load = async () => ({
  ...(await import('./store')),
  ...(await import('./lineage')),
  ...(await import('./gateway')),
  ...(await import('./approval-lock'))
})
let M = await load()

type RpcHandler = (method: string, params: Record<string, unknown>) => unknown
let rpcHandler: RpcHandler = () => ({})
let n = 0
let running = new Set<string>() // chats Hermes answers as still working
let runtimeOf = new Map<string, string>() // the live session Hermes answers a resume of this chat with
const resumeReply = (sid: string) => ({
  session_id: runtimeOf.get(sid) ?? `rt-${sid}`,
  stored_session_id: sid,
  messages: [],
  running: running.has(sid),
  info: { title: `Chat ${sid}` }
})

/** The shell's side (ApprovalLock): confirmed live sessions, the prompts it showed, and prompts held open on request. */
const shell = { confirmed: new Set<string>(), prompts: [] as string[], hold: false, held: [] as Array<() => void> }
const installShell = () => {
  ;(window as unknown as { HermesAndroid?: unknown }).HermesAndroid = {
    approvalLockState: () => JSON.stringify({ on: true, secure: true }),
    phoneDataTainted: () => false,
    cancelNotification: () => {},
    chatSeen: () => {},
    setLastChat: () => {},
    confirmApproval: (id: number, runtime: string) => {
      if (runtime && shell.confirmed.has(runtime)) return void setTimeout(() => window.hermesApprovalConfirm?.(id, 'ok'), 0)
      shell.prompts.push(runtime)
      const answer = () => {
        if (runtime) shell.confirmed.add(runtime) // only the live session this prompt was opened for
        window.hermesApprovalConfirm?.(id, 'ok')
      }
      if (shell.hold) shell.held.push(answer)
      else setTimeout(answer, 0)
    },
    forgetApproval: (runtime: string) => shell.confirmed.delete(runtime)
  }
}

const spyClient = () =>
  vi.spyOn(M.client, 'request').mockImplementation((async (method: string, params: Record<string, unknown> = {}) =>
    rpcHandler(method, params)) as typeof M.client.request)

const approval = (runtime: string) => ({
  id: `q${++n}`,
  method: 'approval',
  params: { session_id: runtime, command: 'ls' },
  respond: vi.fn(),
  fail: vi.fn()
})
/** Allow once on an approval from this live session, as the sheet does; true when the shell had to ask. */
const asks = async (runtime: string): Promise<boolean> => {
  const req = approval(runtime)
  M.setState(s => ({ requests: [...s.requests, req as never] }))
  const before = shell.prompts.length
  M.answerRequest(req as never, { choice: 'once' })
  await vi.waitFor(() => expect(req.respond).toHaveBeenCalled())
  return shell.prompts.length > before
}
/** The next session.resume of `chat` waits until the returned function is called. */
const holdResume = (chat: string): (() => void) => {
  let release!: () => void
  const gate = new Promise<void>(r => (release = r))
  const base = rpcHandler
  let once = true
  rpcHandler = (method, params) => {
    if (once && method === 'session.resume' && params.session_id === chat) {
      once = false
      return gate.then(() => base(method, params))
    }
    return base(method, params)
  }
  return () => release()
}

beforeEach(() => {
  localStorage.clear()
  M.resetLineageForTests()
  running = new Set()
  runtimeOf = new Map()
  shell.confirmed = new Set()
  shell.prompts = []
  shell.hold = false
  shell.held = []
  M.setState({ conn: 'open', active: null, opening: null, preview: null, drawer: false, sheet: null, sessions: [], requests: [], profile: 'default' })
  rpcHandler = (method, params) => {
    const sid = String(params.session_id || '')
    if (method === 'session.resume') return resumeReply(sid)
    if (method === 'session.create') return { session_id: `rt-new${++n}`, stored_session_id: `s-new${n}`, messages: [], info: {} }
    if (method === 'session.compress') return { compressed: true, stored_session_id: `${M.getState().active?.storedId}-2` }
    if (method === 'session.branch') return { stored_session_id: 'l-branch' }
    return {}
  }
  spyClient()
  installShell()
})

afterEach(() => {
  delete (window as unknown as { HermesAndroid?: unknown }).HermesAndroid
  vi.restoreAllMocks()
})

/** Each row starts a confirmed live session and moves its chat on some way. `fresh`: live sessions that are new (each asks
 *  once); `same`: a live session that is still the one confirmed (it doesn't ask). */
type Moved = { fresh: string[]; same?: string }
const rows: Array<[string, () => Promise<Moved>]> = [
  ['switching bots while the chat works (left running, no longer followed), then the chat reopens in a new live session', async () => {
    running.add('a')
    await M.resumeSession('a')
    expect(await asks('rt-a')).toBe(true)
    await M.switchProfile('other')
    await M.switchProfile('default')
    runtimeOf.set('a', 'rt-a-2')
    await M.resumeSession('a')
    return { same: 'rt-a', fresh: ['rt-a-2'] }
  }],
  ['a working chat compressed while the page heard nothing, reopened under the new id', async () => {
    running.add('c')
    await M.resumeSession('c')
    expect(await asks('rt-c')).toBe(true)
    await M.resumeSession('c-other') // c is left working
    runtimeOf.set('c-2', 'rt-c-2')
    await M.resumeSession('c-2')
    return { same: 'rt-c', fresh: ['rt-c-2'] }
  }],
  ['newSession with a prev from before its await: the chat opened meanwhile is dropped, then reopened', async () => {
    await M.resumeSession('d')
    expect(await asks('rt-d')).toBe(true)
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    const base = rpcHandler
    rpcHandler = (method, params) => (method === 'session.create' ? gate.then(() => base(method, params)) : base(method, params))
    const made = M.newSession()
    await M.resumeSession('d2') // opened while the new chat was being made
    expect(await asks('rt-d2')).toBe(true)
    rpcHandler = base
    release()
    const created = await made
    runtimeOf.set('d2', 'rt-d2-2')
    await M.resumeSession('d2')
    return { same: 'rt-d2', fresh: [created.runtimeId, 'rt-d2-2'] }
  }],
  ['a resume of the chat on screen started before syncRunning replaced its live session', async () => {
    running.add('e')
    await M.resumeSession('e')
    expect(await asks('rt-e')).toBe(true)
    const release = holdResume('e')
    runtimeOf.set('e', 'rt-e-3')
    const reopening = M.resumeSession('e') // its prev is rt-e
    running.delete('e')
    runtimeOf.set('e', 'rt-e-2')
    M.setState({ opening: null }) // syncRunning acts on the chat on screen
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(M.getState().active?.runtimeId).toBe('rt-e-2'))
    runtimeOf.set('e', 'rt-e-3')
    release()
    await reopening
    return { fresh: ['rt-e-2', 'rt-e-3'] }
  }],
  ['a chat pushed out of the warm ones and reopened inside the 3 s before closeLater closes it', async () => {
    await M.resumeSession('f')
    expect(await asks('rt-f')).toBe(true)
    for (const c of ['f-a', 'f-b', 'f-c']) await M.resumeSession(c)
    runtimeOf.set('f', 'rt-f-2')
    await M.resumeSession('f')
    return { fresh: ['rt-f-2'] }
  }],
  ['a reconnect after Hermes reaped the old socket\'s live sessions: the chat resumes in a new one', async () => {
    await M.resumeSession('f2')
    expect(await asks('rt-f2')).toBe(true)
    runtimeOf.set('f2', 'rt-f2-2')
    await M.resumeSession('f2', { keepItemsIfSame: true })
    return { fresh: ['rt-f2-2'] }
  }],
  ['the live session closes while its fingerprint prompt is open, and the prompt then says ok', async () => {
    await M.resumeSession('g')
    shell.hold = true
    const req = approval('rt-g')
    M.setState(s => ({ requests: [...s.requests, req as never] }))
    M.answerRequest(req as never, { choice: 'once' })
    await vi.waitFor(() => expect(shell.held.length).toBe(1))
    await M.rpc('session.close', { session_id: 'rt-g' }) // forgets rt-g while the prompt is up
    shell.hold = false
    shell.held.shift()!() // the late ok files rt-g, a closed id no later approval carries
    await vi.waitFor(() => expect(req.respond).toHaveBeenCalled())
    runtimeOf.set('g', 'rt-g-2')
    await M.resumeSession('g')
    return { fresh: ['rt-g-2'] }
  }],
  ['page reload: a live session reattached within Hermes\'s 20 s keeps its confirmation, a new one asks', async () => {
    await M.resumeSession('h')
    expect(await asks('rt-h')).toBe(true)
    vi.restoreAllMocks()
    vi.resetModules() // the page's memory is gone; the shell (its process) still has what it confirmed
    M = await load()
    spyClient()
    M.setState({ conn: 'open', active: null, requests: [], profile: 'default' })
    await M.resumeSession('h') // reattached: Hermes hands back rt-h
    expect(M.getState().active?.runtimeId).toBe('rt-h')
    runtimeOf.set('h2', 'rt-h-2')
    await M.resumeSession('h2')
    return { same: 'rt-h', fresh: ['rt-h-2'] }
  }],
  ['switching bots with an idle chat on screen (closed), then back', async () => {
    await M.resumeSession('i')
    expect(await asks('rt-i')).toBe(true)
    await M.switchProfile('other')
    await M.switchProfile('default')
    runtimeOf.set('i', 'rt-i-2')
    await M.resumeSession('i')
    return { fresh: ['rt-i-2'] }
  }],
  ['deleting the chat, then a new chat', async () => {
    await M.resumeSession('j')
    expect(await asks('rt-j')).toBe(true)
    await M.deleteSession('j')
    const created = await M.newSession()
    return { fresh: [created.runtimeId] }
  }],
  ['a compression keeps the live session (its next Allow doesn\'t ask), then the chat closes and reopens under the new id', async () => {
    await M.resumeSession('k')
    expect(await asks('rt-k')).toBe(true)
    await M.compressChat()
    expect(M.getState().active?.runtimeId).toBe('rt-k')
    expect(await asks('rt-k')).toBe(false)
    await M.rpc('session.close', { session_id: 'rt-k' })
    runtimeOf.set('k-2', 'rt-k-2')
    await M.resumeSession('k-2')
    return { fresh: ['rt-k-2'] }
  }],
  ['syncRunning finds the chat on screen ended, under a new live session', async () => {
    running.add('m')
    await M.resumeSession('m')
    expect(await asks('rt-m')).toBe(true)
    running.delete('m')
    runtimeOf.set('m', 'rt-m-2')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(M.getState().active?.runtimeId).toBe('rt-m-2'))
    return { fresh: ['rt-m-2'] }
  }]
]

describe('the fingerprint confirmation belongs to the live session it was made in', () => {
  it.each(rows)('%s', async (_name, run) => {
    const { fresh, same } = await run()
    if (same) expect(await asks(same)).toBe(false)
    for (const rt of fresh) {
      expect(await asks(rt)).toBe(true)
      expect(await asks(rt)).toBe(false)
    }
  }, 15_000)

  it('an approval that names no live session asks every time', async () => {
    expect(await asks('')).toBe(true)
    expect(await asks('')).toBe(true)
  })

  it('the page keeps at most CONFIRMED_MAX confirmed live sessions: past it the oldest asks again', async () => {
    expect(await asks('rt-0')).toBe(true)
    shell.confirmed.clear() // as the shell's own bound would have dropped it too
    for (let i = 1; i <= M.CONFIRMED_MAX; i++) await asks(`rt-${i}`)
    shell.confirmed.clear()
    expect(await asks('rt-0')).toBe(true)
    expect(await asks(`rt-${M.CONFIRMED_MAX}`)).toBe(false) // the newest is still on file in the page
  })
})
