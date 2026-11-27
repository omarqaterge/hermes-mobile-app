// @vitest-environment happy-dom
// Canvas panel fixes: version history & save races, Downloads safe file naming & export, tab strip scroll, JSON/code DocView.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  locked: false,
  askUnlock: vi.fn()
}))

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    api: (...args: unknown[]) => mocks.api(...args)
  }
})

vi.mock('./lockview', async () => {
  const actual = await vi.importActual<typeof import('./lockview')>('./lockview')
  return {
    ...actual,
    lockView: () => mocks.locked,
    askUnlock: (...args: unknown[]) => mocks.askUnlock(...args)
  }
})

import { ApiError } from './api'
import {
  canvasState,
  closeCanvas,
  editDoc,
  flushSave,
  loadDoc,
  openCanvas,
  refreshDocs,
  selectDoc,
  startCanvasSync,
  unsavedFor,
  type Doc
} from './canvas'
import { CanvasPanel, exportCopy, exportFileName } from './components/Canvas'
import { DocView } from './components/DocView'
import { Markdown } from './components/Markdown'
import { getState, setState, type ActiveSession } from './store'

const chat = (storedId = 's-cv-ui'): ActiveSession => ({
  runtimeId: `rt-${storedId}`,
  storedId,
  profile: 'default',
  title: 'Canvas UI',
  info: { model: 'm', provider: 'p' } as ActiveSession['info'],
  items: [],
  running: false,
  status: '',
  usage: null,
  ctx: null,
  tps: null,
  todos: [],
  openAssistantId: null,
  attachments: [],
  turnStart: null,
  goal: null
})

const mkDoc = (overrides: Partial<Doc> = {}): Doc => ({
  id: 'doc-1',
  title: 'Notes',
  type: 'markdown',
  lang: '',
  rev: 1,
  updated: 1000,
  by: 'agent',
  chars: 5,
  path: '',
  created: 900,
  content: 'hello',
  ...overrides
})

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length

describe('exportFileName', () => {
  it('keeps spaces and avoids doubling an existing matching allowlisted extension', () => {
    expect(exportFileName({ title: 'doc.md', type: 'markdown', lang: '' })).toBe('doc.md')
    expect(exportFileName({ title: 'doc.MD', type: 'markdown', lang: '' })).toBe('doc.MD')
    expect(exportFileName({ title: 'notes.markdown', type: 'markdown', lang: '' })).toBe('notes.markdown')
    expect(exportFileName({ title: 'T08 Notes 2', type: 'markdown', lang: '' })).toBe('T08 Notes 2.md')
    expect(exportFileName({ title: 'config.yaml', type: 'code', lang: 'yaml' })).toBe('config.yaml')
    expect(exportFileName({ title: 'script.py', type: 'code', lang: 'python' })).toBe('script.py')
    expect(exportFileName({ title: 'Cargo.toml', type: 'code', lang: 'toml' })).toBe('Cargo.toml')
    expect(exportFileName({ title: 'data.json', type: 'json', lang: '' })).toBe('data.json')
    expect(exportFileName({ title: 'T08 Data', type: 'json', lang: '' })).toBe('T08 Data.json')
    expect(exportFileName({ title: 'v1.2', type: 'markdown', lang: '' })).toBe('v1.2.md')
  })

  it('lowercases code lang and refuses arbitrary dangerous extensions via allowlist', () => {
    expect(exportFileName({ title: 'script', type: 'code', lang: 'PYTHON' })).toBe('script.py')
    expect(exportFileName({ title: 'script.py', type: 'code', lang: 'PYTHON' })).toBe('script.py')
    expect(exportFileName({ title: 'app', type: 'code', lang: 'JavaScript' })).toBe('app.js')
    expect(exportFileName({ title: 'config.yaml', type: 'code', lang: 'YAML' })).toBe('config.yaml')
    // Non-allowlisted / dangerous lang values must never pass through as extensions.
    expect(exportFileName({ title: 'Update.apk', type: 'code', lang: 'apk' })).toBe('Update.apk.txt')
    expect(exportFileName({ title: 'Tool.exe', type: 'code', lang: 'exe' })).toBe('Tool.exe.txt')
    expect(exportFileName({ title: 'archive.tar.gz', type: 'code', lang: 'gz' })).toBe('archive.tar.gz.txt')
    expect(exportFileName({ title: 'evil.html', type: 'code', lang: 'html' })).toBe('evil.html.txt')
    expect(exportFileName({ title: 'run.sh', type: 'code', lang: 'sh' })).toBe('run.sh.txt')
  })

  it('ignores prototype property names in lang and type without throwing', () => {
    for (const bad of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(exportFileName({ title: `file.${bad}`, type: 'code', lang: bad })).toBe(`file.${bad}.txt`)
      expect(exportFileName({ title: 'plain', type: 'code', lang: bad })).toBe('plain.txt')
      expect(exportFileName({ title: 'plain', type: bad as Doc['type'], lang: '' })).toBe('plain.txt')
    }
  })

  it('strips unsafe path characters, look-alikes, bidi overrides, control chars and leading/trailing/repeated dots', () => {
    expect(exportFileName({ title: '../../.env', type: 'text', lang: '' })).toBe('env.txt')
    expect(exportFileName({ title: 'report: Q1 / Q2?', type: 'markdown', lang: '' })).toBe('report Q1 Q2.md')
    expect(exportFileName({ title: '...', type: 'markdown', lang: '' })).toBe('canvas.md')
    expect(exportFileName({ title: 'doc.md.', type: 'markdown', lang: '' })).toBe('doc.md')
    // Unicode slash/dot look-alikes, bidi override (U+202E), NUL and control characters.
    expect(exportFileName({ title: 'a\u2215b\uFF0Fc\u29F8d', type: 'text', lang: '' })).toBe('abcd.txt')
    expect(exportFileName({ title: 'x\u3002y\uFF0Ez\u2024md', type: 'markdown', lang: '' })).toBe('xyzmd.md')
    expect(exportFileName({ title: 'safe\u202Egpj.exe', type: 'text', lang: '' })).toBe('safegpj.exe.txt')
    expect(exportFileName({ title: 'bad\0\x01\x1f\x7fname', type: 'text', lang: '' })).toBe('badname.txt')
  })

  it('guards Windows and FAT reserved stems', () => {
    for (const stem of ['CON', 'prn', 'Aux', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9']) {
      expect(exportFileName({ title: stem, type: 'text', lang: '' })).toBe(`canvas-${stem}.txt`)
      expect(exportFileName({ title: `${stem}.md`, type: 'markdown', lang: '' })).toBe(`canvas-${stem}.md`)
      expect(exportFileName({ title: `${stem}.notes`, type: 'text', lang: '' })).toBe(`canvas-${stem}.notes.txt`)
    }
  })

  it('caps the full filename at 200 UTF-8 bytes without splitting surrogate pairs or leaving trailing dots/spaces', () => {
    const longAscii = 'a'.repeat(260) + ' . '
    const outAscii = exportFileName({ title: longAscii, type: 'markdown', lang: '' })
    expect(utf8Bytes(outAscii)).toBeLessThanOrEqual(200)
    expect(outAscii.endsWith('.md')).toBe(true)
    expect(outAscii.slice(0, -3)).not.toMatch(/[.\s]$/)

    // 4-byte UTF-8 surrogate-pair letters (U+1D400 Mathematical Bold Capital A) stay intact at the byte boundary.
    const surrogateTitle = '\u{1D400}'.repeat(80)
    const outSurrogate = exportFileName({ title: surrogateTitle, type: 'markdown', lang: '' }, ' (20)')
    expect(utf8Bytes(outSurrogate)).toBeLessThanOrEqual(200)
    expect(outSurrogate.endsWith(' (20).md')).toBe(true)
    expect(() => encodeURIComponent(outSurrogate)).not.toThrow()

    // Multi-byte CJK + trailing dots right near the trim boundary.
    const cjkTitle = '日本語'.repeat(30) + '...'
    const outCjk = exportFileName({ title: cjkTitle, type: 'text', lang: '' })
    expect(utf8Bytes(outCjk)).toBeLessThanOrEqual(200)
    expect(outCjk.endsWith('.txt')).toBe(true)
    expect(outCjk.slice(0, -4)).not.toMatch(/[.\s]$/)
  })
})

describe('exportCopy', () => {
  beforeEach(() => {
    mocks.api.mockReset()
    mocks.askUnlock.mockReset()
    mocks.locked = false
    setState({ conn: 'open', profile: 'default', active: chat('s-exp'), opening: null, toasts: [] })
  })

  afterEach(() => {
    mocks.locked = false
    setState({ active: null, opening: null, toasts: [] })
  })

  it('refuses to upload while lockView() is active and asks to unlock', async () => {
    mocks.locked = true
    await exportCopy({ title: 'Notes', type: 'markdown', lang: '' }, 'secret')
    expect(mocks.askUnlock).toHaveBeenCalledWith('Unlock the phone to save files')
    expect(mocks.api).not.toHaveBeenCalled()
  })

  it('sends overwrite: false and retries with a free name on 409 conflict', async () => {
    const calls: Array<{ path: string; overwrite: boolean }> = []
    mocks.api.mockImplementation(async (_m: string, _p: string, body: { path: string; overwrite: boolean }) => {
      calls.push({ path: body.path, overwrite: body.overwrite })
      if (calls.length === 1) throw new ApiError('File already exists', 409)
      return {}
    })

    await exportCopy({ title: 'doc.md', type: 'markdown', lang: '' }, 'hello')

    expect(calls).toEqual([
      { path: '/sdcard/Download/doc.md', overwrite: false },
      { path: '/sdcard/Download/doc (2).md', overwrite: false }
    ])
    expect(getState().toasts.at(-1)?.text).toBe('Saved to Downloads/doc (2).md')
  })

  it('stops on non-conflict errors without retrying and re-checks lockView() between retries', async () => {
    mocks.api.mockRejectedValueOnce(new ApiError('Disk full', 500))
    await exportCopy({ title: 'doc.md', type: 'markdown', lang: '' }, 'hello')
    expect(mocks.api).toHaveBeenCalledTimes(1)
    expect(getState().toasts.at(-1)?.level).toBe('error')

    mocks.api.mockReset()
    mocks.askUnlock.mockReset()
    mocks.api.mockImplementationOnce(async () => {
      mocks.locked = true
      throw new ApiError('File already exists', 409)
    })
    await exportCopy({ title: 'doc.md', type: 'markdown', lang: '' }, 'hello')
    expect(mocks.api).toHaveBeenCalledTimes(1)
    expect(mocks.askUnlock).toHaveBeenCalledWith('Unlock the phone to save files')
  })
})

describe('canvas loadDoc and flushSave races', () => {
  let seq = 0

  beforeEach(() => {
    mocks.api.mockReset()
    startCanvasSync()
    setState({ conn: 'open', profile: 'default', active: chat(`s-ver-${++seq}`), opening: null, toasts: [] })
  })

  afterEach(() => {
    closeCanvas()
    setState({ active: null, opening: null, toasts: [] })
  })

  it('keeps loaded versions in sync when PUT /canvas/doc returns no versions list', async () => {
    const initial = mkDoc({
      rev: 12,
      versions: [
        { rev: 11, at: 990, by: 'agent', note: 'first' },
        { rev: 12, at: 1000, by: 'agent', note: 'second' }
      ]
    })
    mocks.api.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.includes('/canvas?')) return { docs: [initial] }
      if (method === 'GET' && path.includes('/canvas/doc')) return initial
      if (method === 'PUT' && path.includes('/canvas/doc')) {
        return mkDoc({ rev: 13, updated: 1010, by: 'user', chars: 11, content: 'hello world' })
      }
      return {}
    })

    openCanvas('doc-1')
    await loadDoc('doc-1', true)
    expect(canvasState().loaded['doc-1']?.versions?.map(v => v.rev)).toEqual([11, 12])

    editDoc('doc-1', 'hello world')
    await flushSave()

    const saved = canvasState().loaded['doc-1']
    expect(saved?.rev).toBe(13)
    expect(saved?.versions?.map(v => v.rev)).toEqual([11, 12, 13])
    expect(saved?.versions?.at(-1)?.by).toBe('user')
  })

  it('loadDoc ignores a late older revision and preserves the newer loaded doc', async () => {
    const lateOld = deferred<Doc>()
    const newer = mkDoc({
      rev: 5,
      content: 'newest',
      versions: [
        { rev: 4, at: 995, by: 'agent', note: '' },
        { rev: 5, at: 1005, by: 'user', note: '' }
      ]
    })
    let interceptOld = false
    mocks.api.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.includes('/canvas?')) return { docs: [newer] }
      if (method === 'GET' && path.includes('/canvas/doc')) {
        if (interceptOld) {
          interceptOld = false
          return lateOld.promise
        }
        return newer
      }
      return {}
    })

    openCanvas('doc-1')
    await loadDoc('doc-1', true)
    expect(canvasState().loaded['doc-1']?.rev).toBe(5)

    // Start a slow loadDoc that will later resolve with stale rev 3; a faster loadDoc with rev 5 settles first.
    interceptOld = true
    const pOld = loadDoc('doc-1', true)
    await loadDoc('doc-1', true)
    expect(canvasState().loaded['doc-1']?.rev).toBe(5)

    lateOld.resolve(mkDoc({ rev: 3, content: 'stale', versions: [{ rev: 3, at: 900, by: 'agent', note: '' }] }))
    const got = await pOld

    expect(got?.rev).toBe(5)
    expect(canvasState().loaded['doc-1']?.rev).toBe(5)
    expect(canvasState().loaded['doc-1']?.content).toBe('newest')
    expect(canvasState().loaded['doc-1']?.versions?.map(v => v.rev)).toEqual([4, 5])
  })

  it('flushSave merges versions loaded in flight and never downgrades a newer loaded rev', async () => {
    const noVers = mkDoc({ rev: 2, content: 'v2' })
    const put1 = deferred<Doc>()
    const put2 = deferred<Doc>()
    let putCount = 0
    let getDocReply: Doc = mkDoc({
      rev: 2,
      content: 'v2',
      versions: [
        { rev: 1, at: 900, by: 'agent', note: '' },
        { rev: 2, at: 1000, by: 'agent', note: '' }
      ]
    })
    mocks.api.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.includes('/canvas?')) return { docs: [noVers] }
      if (method === 'GET' && path.includes('/canvas/doc')) return getDocReply
      if (method === 'PUT' && path.includes('/canvas/doc')) {
        putCount++
        return putCount === 1 ? put1.promise : put2.promise
      }
      return {}
    })

    // Seed loaded doc WITHOUT versions (as after createDoc).
    openCanvas('doc-1')
    mocks.api.mockImplementationOnce(async () => ({ docs: [noVers] }))
    getDocReply = noVers
    await loadDoc('doc-1', true)
    expect(canvasState().loaded['doc-1']?.versions).toBeUndefined()

    // Start PUT; while in flight, loadDoc arrives with rev 2 + versions.
    editDoc('doc-1', 'v3')
    const flushing1 = flushSave()
    getDocReply = mkDoc({
      rev: 2,
      content: 'v2',
      versions: [
        { rev: 1, at: 900, by: 'agent', note: '' },
        { rev: 2, at: 1000, by: 'agent', note: '' }
      ]
    })
    await loadDoc('doc-1', true)
    expect(canvasState().loaded['doc-1']?.versions?.map(v => v.rev)).toEqual([1, 2])

    put1.resolve(mkDoc({ rev: 3, updated: 1010, by: 'user', content: 'v3' }))
    await flushing1
    expect(canvasState().loaded['doc-1']?.rev).toBe(3)
    expect(canvasState().loaded['doc-1']?.versions?.map(v => v.rev)).toEqual([1, 2, 3])

    // Delayed PUT returning an older rev (rev 4) after loadDoc already loaded rev 5 must NOT downgrade rev 5.
    editDoc('doc-1', 'v4')
    const flushing2 = flushSave()
    getDocReply = mkDoc({
      rev: 5,
      content: 'agent v5',
      versions: [
        { rev: 1, at: 900, by: 'agent', note: '' },
        { rev: 5, at: 1050, by: 'agent', note: '' }
      ]
    })
    await loadDoc('doc-1', true)
    put2.resolve(mkDoc({ rev: 4, updated: 1020, by: 'user', content: 'v4' }))
    await flushing2
    expect(canvasState().loaded['doc-1']?.rev).toBe(5)
    expect(canvasState().loaded['doc-1']?.content).toBe('agent v5')
  })

  it('serializes overlapping flushSave calls so the second waits and sends the bumped base_rev', async () => {
    const initial = mkDoc({ rev: 1, content: 'a', versions: [{ rev: 1, at: 900, by: 'agent', note: '' }] })
    const put1 = deferred<Doc>()
    const put2 = deferred<Doc>()
    const put2Started = deferred<void>()
    const puts: Array<{ content: string; base_rev: number }> = []
    mocks.api.mockImplementation(async (method: string, path: string, body?: { content: string; base_rev: number }) => {
      if (method === 'GET' && path.includes('/canvas?')) return { docs: [initial] }
      if (method === 'GET' && path.includes('/canvas/doc')) return initial
      if (method === 'PUT' && path.includes('/canvas/doc') && body) {
        puts.push({ content: body.content, base_rev: body.base_rev })
        if (puts.length === 1) return put1.promise
        put2Started.resolve()
        return put2.promise
      }
      return {}
    })

    openCanvas('doc-1')
    await loadDoc('doc-1', true)

    editDoc('doc-1', 'ab')
    const p1 = flushSave()
    // While PUT #1 is in flight, edit again and request a second flush (e.g. closing panel or switching tab).
    editDoc('doc-1', 'abc')
    const p2 = flushSave()
    // Must not have fired PUT #2 concurrently with stale base_rev: 1.
    expect(puts).toEqual([{ content: 'ab', base_rev: 1 }])

    put1.resolve(mkDoc({ rev: 2, updated: 1010, by: 'user', content: 'ab' }))
    await put2Started.promise
    expect(puts).toEqual([
      { content: 'ab', base_rev: 1 },
      { content: 'abc', base_rev: 2 }
    ])

    put2.resolve(mkDoc({ rev: 3, updated: 1020, by: 'user', content: 'abc' }))
    await Promise.all([p1, p2])
    expect(canvasState().loaded['doc-1']?.rev).toBe(3)
    expect(canvasState().loaded['doc-1']?.content).toBe('abc')
    expect(unsavedFor('doc-1')).toBeNull()
  })

  it('does not clear doc B dirtyText when doc A finishes saving identical text', async () => {
    const docA = mkDoc({ id: 'doc-a', title: 'A', rev: 1, content: 'orig-a' })
    const docB = mkDoc({ id: 'doc-b', title: 'B', rev: 1, content: 'orig-b' })
    const putA = deferred<Doc>()
    const puts: Array<{ id: string; content: string }> = []
    mocks.api.mockImplementation(async (method: string, path: string, body?: { id: string; content: string }) => {
      if (method === 'GET' && path.includes('/canvas?')) return { docs: [docA, docB] }
      if (method === 'GET' && path.includes('id=doc-a')) return docA
      if (method === 'GET' && path.includes('id=doc-b')) return docB
      if (method === 'PUT' && path.includes('/canvas/doc') && body) {
        puts.push({ id: body.id, content: body.content })
        if (body.id === 'doc-a') return putA.promise
        return { ...docB, rev: 2, updated: 1020, by: 'user', content: body.content }
      }
      return {}
    })

    openCanvas('doc-a')
    await loadDoc('doc-a', true)
    await loadDoc('doc-b', true)

    editDoc('doc-a', 'same-text')
    const pA = flushSave()
    // While doc-a is in flight, edit doc-b with the exact same text.
    editDoc('doc-b', 'same-text')
    putA.resolve({ ...docA, rev: 2, updated: 1010, by: 'user', content: 'same-text' })
    await pA

    expect(unsavedFor('doc-b')).toBe('same-text')
    await flushSave()
    expect(puts).toEqual([
      { id: 'doc-a', content: 'same-text' },
      { id: 'doc-b', content: 'same-text' }
    ])
    expect(unsavedFor('doc-b')).toBeNull()
  })

  it('a conflict on doc A still lets the edit queued meanwhile in doc B go out, and names doc A', async () => {
    const docA = mkDoc({ id: 'doc-a', title: 'A', rev: 1, content: 'orig-a' })
    const docB = mkDoc({ id: 'doc-b', title: 'B', rev: 1, content: 'orig-b' })
    const putA = deferred<Doc>()
    const puts: Array<{ id: string; content: string }> = []
    mocks.api.mockImplementation(async (method: string, path: string, body?: { id: string; content: string }) => {
      if (method === 'GET' && path.includes('/canvas?')) return { docs: [docA, docB] }
      if (method === 'GET' && path.includes('id=doc-a')) return docA
      if (method === 'GET' && path.includes('id=doc-b')) return docB
      if (method === 'PUT' && path.includes('/canvas/doc') && body) {
        puts.push({ id: body.id, content: body.content })
        if (body.id === 'doc-a') return putA.promise
        return { ...docB, rev: 2, updated: 1020, by: 'user', content: body.content }
      }
      return {}
    })

    openCanvas('doc-a')
    await loadDoc('doc-a', true)
    await loadDoc('doc-b', true)

    editDoc('doc-a', 'edit-a')
    selectDoc('doc-b') // flushes doc A's edit
    const pA = flushSave()
    editDoc('doc-b', 'edit-b')
    const pB = flushSave() // queued behind doc A's PUT
    putA.reject(new Error('conflict: the document changed'))
    await Promise.all([pA, pB])

    expect(puts).toEqual([
      { id: 'doc-a', content: 'edit-a' },
      { id: 'doc-b', content: 'edit-b' }
    ])
    expect(unsavedFor('doc-b')).toBeNull()
    expect(getState().toasts.some(t => /“A” not saved/.test(t.text))).toBe(true)
  })

  it('ignores a save started on an earlier visit to the same chat (A → B → A)', async () => {
    const doc1 = mkDoc({ id: 'doc-1', rev: 1, content: 'old' })
    const put = deferred<Doc>()
    mocks.api.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.includes('/canvas?')) return { docs: [doc1] }
      if (method === 'GET' && path.includes('/canvas/doc')) return doc1
      if (method === 'PUT' && path.includes('/canvas/doc')) return put.promise
      return {}
    })

    const home = getState().active
    openCanvas('doc-1')
    await loadDoc('doc-1', true)
    editDoc('doc-1', 'edited')
    const p = flushSave()
    setState({ active: chat('s-away'), toasts: [] })
    setState({ active: home, toasts: [] })
    put.reject(new Error('network boom'))
    await p
    expect(canvasState().session).toBe(home?.storedId)
    expect(canvasState().save).toBe('idle')
    // Only the "not saved" note (the edit's one save failed after the switch): no error state in the chat on screen.
    expect(getState().toasts.map(t => t.text)).toEqual(['Canvas edit in “Notes” not saved: network boom'])
  })

  it('a conflict on a tab that is not open leaves the open tab’s save state alone and keeps the edit', async () => {
    const docA = mkDoc({ id: 'doc-a', title: 'A', rev: 1, content: 'orig-a' })
    const docB = mkDoc({ id: 'doc-b', title: 'B', rev: 1, content: 'orig-b' })
    const putA = deferred<Doc>()
    mocks.api.mockImplementation(async (method: string, path: string, body?: { id: string }) => {
      if (method === 'GET' && path.includes('/canvas?')) return { docs: [docA, docB] }
      if (method === 'GET' && path.includes('id=doc-a')) return docA
      if (method === 'GET' && path.includes('id=doc-b')) return docB
      if (method === 'PUT' && path.includes('/canvas/doc') && body?.id === 'doc-a') return putA.promise
      return {}
    })

    openCanvas('doc-a')
    await loadDoc('doc-a', true)
    await loadDoc('doc-b', true)
    editDoc('doc-a', 'edit-a')
    selectDoc('doc-b') // saves doc A's edit; doc B has none
    const p = flushSave()
    putA.reject(new Error('conflict: the document changed'))
    await p

    expect(canvasState().active).toBe('doc-b')
    expect(canvasState().save).toBe('idle')
    expect(unsavedFor('doc-a')).toBe('edit-a')
    expect(getState().toasts.some(t => /“A” not saved: it changed meanwhile/.test(t.text))).toBe(true)
  })

  it('aborts flushSave cleanly on chat switch in both resolve and reject paths', async () => {
    const doc1 = mkDoc({ id: 'doc-1', rev: 1, content: 'old' })
    const putResolve = deferred<Doc>()
    mocks.api.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.includes('/canvas?')) return { docs: [doc1] }
      if (method === 'GET' && path.includes('/canvas/doc')) return doc1
      if (method === 'PUT' && path.includes('/canvas/doc')) return putResolve.promise
      return {}
    })

    openCanvas('doc-1')
    await loadDoc('doc-1', true)
    editDoc('doc-1', 'edited')
    const p1 = flushSave()

    // Switch to another chat before PUT settles.
    setState({ active: chat('s-other-1'), toasts: [] })
    putResolve.resolve(mkDoc({ id: 'doc-1', rev: 2, content: 'edited' }))
    await p1
    expect(canvasState().session).toBe('s-other-1')
    expect(canvasState().loaded['doc-1']).toBeUndefined()
    expect(canvasState().save).toBe('idle')

    // Reject path: switch chat while PUT is in flight, then reject -> no error state or toast in the new chat.
    const putReject = deferred<Doc>()
    mocks.api.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.includes('/canvas?')) return { docs: [doc1] }
      if (method === 'GET' && path.includes('/canvas/doc')) return doc1
      if (method === 'PUT' && path.includes('/canvas/doc')) return putReject.promise
      return {}
    })
    openCanvas('doc-1')
    await loadDoc('doc-1', true)
    editDoc('doc-1', 'edited-2')
    const p2 = flushSave()
    setState({ active: chat('s-other-2'), toasts: [] })
    putReject.reject(new Error('network boom'))
    await p2
    expect(canvasState().session).toBe('s-other-2')
    expect(canvasState().save).toBe('idle')
    expect(canvasState().remote).toBeNull()
    // No error state in the new chat; only the note that the old chat's edit was not saved.
    expect(getState().toasts.map(t => t.text)).toEqual(['Canvas edit in “Notes” not saved: network boom'])
  })
})

describe('CanvasPanel tab-strip scroll behaviour', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.api.mockReset()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    document.documentElement.dataset.motion = 'full'
    setState({ conn: 'open', profile: 'default', active: chat('s-tabs'), opening: null, toasts: [] })
  })

  afterEach(async () => {
    await act(async () => {
      closeCanvas()
      root.unmount()
    })
    host.remove()
    delete document.documentElement.dataset.motion
    setState({ active: null, opening: null, toasts: [] })
  })

  it('respects reduced motion, does not yank on docs refreshes, and aligns left for wider-than-strip tabs', async () => {
    const doc1 = mkDoc({ id: 't1', title: 'Tab 1', rev: 1, content: 'one' })
    const doc2 = mkDoc({ id: 't2', title: 'Tab 2', rev: 1, content: 'two' })
    const doc3 = mkDoc({ id: 't3', title: 'Very wide tab title', rev: 1, content: 'three' })
    mocks.api.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.includes('/canvas?')) return { docs: [doc1, doc2, doc3] }
      if (method === 'GET' && path.includes('id=t1')) return doc1
      if (method === 'GET' && path.includes('id=t2')) return doc2
      if (method === 'GET' && path.includes('id=t3')) return doc3
      return {}
    })

    await act(async () => {
      root.render(<CanvasPanel />)
    })
    await act(async () => {
      openCanvas('t1')
      await refreshDocs()
      await loadDoc('t1', true)
    })

    const strip = host.querySelector('.canvas-tabs') as HTMLDivElement
    expect(strip).toBeTruthy()
    const scrollCalls: Array<{ left?: number; behavior?: ScrollBehavior }> = []
    let scrollLeftVal = 0
    Object.defineProperty(strip, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeftVal,
      set: v => {
        scrollLeftVal = v
      }
    })
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, get: () => 800 })
    Object.defineProperty(strip, 'clientWidth', { configurable: true, get: () => 200 })
    strip.scrollTo = ((opts: ScrollToOptions) => {
      scrollCalls.push({ left: opts.left, behavior: opts.behavior })
      if (typeof opts.left === 'number') scrollLeftVal = opts.left
    }) as typeof strip.scrollTo
    strip.getBoundingClientRect = () => ({ left: 0, right: 200, top: 0, bottom: 40, width: 200, height: 40, x: 0, y: 0, toJSON: () => ({}) })

    const setTabRect = (title: string, left: number, width: number) => {
      const btn = [...host.querySelectorAll<HTMLButtonElement>('.canvas-tab')].find(b => b.textContent?.trim() === title)!
      btn.getBoundingClientRect = () => ({
        left: left - scrollLeftVal,
        right: left + width - scrollLeftVal,
        top: 0,
        bottom: 40,
        width,
        height: 40,
        x: left - scrollLeftVal,
        y: 0,
        toJSON: () => ({})
      })
    }
    setTabRect('Tab 1', 0, 80)
    setTabRect('Tab 2', 300, 90)
    setTabRect('Very wide tab title', 400, 260)

    // 1. Full motion: switching to off-screen Tab 2 scrolls smoothly.
    scrollCalls.length = 0
    await act(async () => {
      await selectDoc('t2')
    })
    expect(scrollCalls).toEqual([{ left: 190, behavior: 'smooth' }])

    // 2. Background refresh updating `docs` does NOT yank a user-scrolled strip back.
    scrollLeftVal = 20
    scrollCalls.length = 0
    await act(async () => {
      await refreshDocs()
    })
    expect(scrollCalls).toEqual([])
    expect(scrollLeftVal).toBe(20)

    // 3. Reduced motion: switching to wider-than-strip Tab 3 aligns its left edge with behavior 'auto'.
    document.documentElement.dataset.motion = 'reduced'
    scrollLeftVal = 0
    scrollCalls.length = 0
    await act(async () => {
      await selectDoc('t3')
    })
    expect(scrollCalls).toEqual([{ left: 400, behavior: 'auto' }])
  })
})

describe('DocView code/json Canvas button suppression', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    setState({ conn: 'open', profile: 'default', active: chat('s-json'), opening: null, toasts: [] })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    setState({ active: null, opening: null, toasts: [] })
  })

  it('hides the Canvas button on json and code DocView documents while keeping Wrap and Copy', async () => {
    await act(async () => {
      root.render(<DocView type="json" title="T08 Data" text='{"fruit":"apple","price":1.25}' network={false} />)
    })
    const jsonBtns = [...host.querySelectorAll('.codeblock-bar button')].map(b => b.textContent?.trim())
    expect(jsonBtns).toEqual(['Wrap', 'Copy'])

    await act(async () => {
      root.render(<DocView type="code" lang="python" title="T08 Code" text={'def hi():\n    x = 1\n    return x\n'} network={false} />)
    })
    const codeBtns = [...host.querySelectorAll('.codeblock-bar button')].map(b => b.textContent?.trim())
    expect(codeBtns).toEqual(['Wrap', 'Copy'])
  })

  it('keeps the Canvas button on 3+ line code blocks in chat Markdown', async () => {
    await act(async () => {
      root.render(<Markdown text={'```json\n{\n  "fruit": "apple",\n  "price": 1.25\n}\n```'} />)
    })
    const mdBtns = [...host.querySelectorAll('.codeblock-bar button')].map(b => b.textContent?.trim())
    expect(mdBtns).toEqual(['Wrap', 'Canvas', 'Copy'])
  })
})
