// @vitest-environment happy-dom
// Canvas save-file guards: protected paths refused without calling the server; 409 disk-change conflict asks via dialog.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  confirmDialog: vi.fn(),
  lockView: vi.fn(() => false),
  askUnlock: vi.fn()
}))

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    api: (...args: unknown[]) => mocks.api(...args)
  }
})
vi.mock('./dialog', () => ({
  confirmDialog: (...args: unknown[]) => mocks.confirmDialog(...args)
}))
vi.mock('./lockview', async () => {
  const actual = await vi.importActual<typeof import('./lockview')>('./lockview')
  return {
    ...actual,
    lockView: () => mocks.lockView(),
    askUnlock: (...args: unknown[]) => mocks.askUnlock(...args)
  }
})

import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { ApiError } from './api'
import { canvasOpenBlockReason, canvasSaveBlockReason, foldSegment, openFileInCanvas, saveToFile } from './canvas'
import { getState, setState, type ActiveSession } from './store'

const cjsRequire = createRequire(import.meta.url)
const mockCanvas = cjsRequire(path.resolve(__dirname, '../../tools/web-e2e/mock.cjs')) as {
  canvasPathError: (rawPath: string, forSave: boolean) => { status: number; detail: string } | null
  foldSegment: (s: string) => string
}

interface VectorCase {
  path: string
  open: 'allow' | 'refuse'
  save: 'allow' | 'refuse'
  needsSdcard?: boolean
  note?: string
}
const vectors: { cases: VectorCase[] } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../tools/canvas-path-vectors.json'), 'utf8')
)

const chat = (storedId = 's-cv'): ActiveSession => ({
  runtimeId: `rt-${storedId}`,
  storedId,
  profile: 'default',
  title: 'Canvas save',
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

describe('shared canvas-path-vectors.json parity', () => {
  it('matches every open and save vector in tools/canvas-path-vectors.json in both canvas.ts and mock.cjs', () => {
    expect(vectors.cases.length).toBeGreaterThan(80)
    for (const c of vectors.cases) {
      const p = c.path.replace('{HOME}', '/root')
      const openReason = canvasOpenBlockReason(p)
      const saveReason = canvasSaveBlockReason(p)
      const mockOpen = mockCanvas.canvasPathError(p, false)
      const mockSave = mockCanvas.canvasPathError(p, true)
      if (c.open === 'refuse') {
        expect(openReason, `canvas.ts open refuse: ${p} (${c.note})`).not.toBeNull()
        expect(mockOpen, `mock.cjs open refuse: ${p} (${c.note})`).not.toBeNull()
      } else {
        expect(openReason, `canvas.ts open allow: ${p} (${c.note})`).toBeNull()
        expect(mockOpen, `mock.cjs open allow: ${p} (${c.note})`).toBeNull()
      }
      if (c.save === 'refuse') {
        expect(saveReason, `canvas.ts save refuse: ${p} (${c.note})`).not.toBeNull()
        expect(mockSave, `mock.cjs save refuse: ${p} (${c.note})`).not.toBeNull()
      } else {
        expect(saveReason, `canvas.ts save allow: ${p} (${c.note})`).toBeNull()
        expect(mockSave, `mock.cjs save allow: ${p} (${c.note})`).toBeNull()
      }
      for (const seg of p.split('/').filter(Boolean)) {
        expect(foldSegment(seg), `foldSegment parity: ${seg}`).toBe(mockCanvas.foldSegment(seg))
      }
    }
  })
})

describe('canvasOpenBlockReason', () => {
  it('blocks secret and internal files (case-insensitively) and allows read-only paths outside save roots', () => {
    for (const p of [
      '/root/.hermes/.env',
      '/root/.hermes/auth.json',
      '/root/.hermes/profiles/work/auth.json',
      '/root/.hermes/profiles/work/mobile/auto.json',
      '/root/.hermes/mobile/canvas/s/d.json',
      '/root/.hermes-mobile/key',
      '/root/.ssh/id_ed25519',
      '/root/.android/adbkey',
      '/root/.gnupg/secring.gpg',
      '/root/.netrc',
      '/root/.aws/credentials',
      '/root/app/.ENV.LOCAL',
      '/root/.AWS/Credentials',
      '/tmp/bad\0file'
    ]) {
      expect(canvasOpenBlockReason(p), p).not.toBeNull()
    }
    for (const p of [
      '/tmp/log.txt',
      '/etc/hosts',
      '/storage/1234-5678/notes.md',
      '/root/.hermes/config.yaml',
      '/sdcard/Download/note.txt'
    ]) {
      expect(canvasOpenBlockReason(p), p).toBeNull()
    }
  })
})

describe('canvasSaveBlockReason', () => {
  it('blocks paths outside save roots first, and blocks Hermes/secrets/code-exec/shell files case-insensitively', () => {
    for (const p of [
      '/tmp/notes.txt',
      '/storage/1234-5678/doc.md',
      '/etc/passwd',
      '/root/.hermes/config.yaml',
      '/root/.Hermes/Config.YAML',
      '/root/.hermes/profiles/work/config.yaml',
      '/root/.hermes/.env',
      '/root/.hermes/mobile/auto.json',
      '/root/.hermes/plugins/hermes-mobile/canvas.py',
      '/root/.hermes-mobile/key',
      '/data/data/com.termux/files/home/.hermes-mobile/key',
      '/root/projects/app/.env',
      '/root/projects/app/.ENV.LOCAL',
      '/root/.ssh/authorized_keys',
      '/root/.SSH/config',
      '/root/.android/adbkey',
      '/root/.gnupg/gpg.conf',
      '/root/.netrc',
      '/root/.aws/config',
      '/root/.gitconfig',
      '/root/.GitConfig',
      '/root/.config/git/config',
      '/root/.config/fish/config.fish',
      '/root/.Config/Fish/config.fish',
      '/root/bin/hermes-services',
      '/root/.local/bin/tool',
      '/root/.termux/termux.properties',
      '/root/.bashrc',
      '/root/.BashRC',
      '/root/.shinit',
      '/root/.cshrc',
      '/root/.tcshrc',
      '/root/.kshrc',
      '/root/notes/../.hermes/config.yaml',
      '~/.hermes/config.yaml',
      '/root/bad\0.txt',
      'relative/file.txt'
    ]) {
      expect(canvasSaveBlockReason(p), p).not.toBeNull()
    }
  })

  it('allows normal user files under home and /sdcard', () => {
    for (const p of ['/sdcard/Documents/plan.md', '/sdcard/Download/notes.txt', '/storage/emulated/0/note.md', '/root/notes.md', '/root/projects/site/app.py']) {
      expect(canvasSaveBlockReason(p), p).toBeNull()
    }
  })
})

describe('saveToFile', () => {
  beforeEach(() => {
    mocks.api.mockReset()
    mocks.confirmDialog.mockReset()
    mocks.lockView.mockReset()
    mocks.lockView.mockReturnValue(false)
    mocks.askUnlock.mockReset()
    setState({ conn: 'open', profile: 'default', active: chat(), opening: null, toasts: [] })
  })

  afterEach(() => {
    setState({ active: null, opening: null, toasts: [] })
  })

  it('refuses protected files without calling /canvas/save-file', async () => {
    mocks.api.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.includes('/canvas?')) return { docs: [] }
      if (method === 'POST' && path.endsWith('/open-file')) {
        return {
          id: 'd-cfg', title: 'config.yaml', type: 'code', lang: 'yaml', rev: 1, updated: 1, by: 'user',
          chars: 20, path: '/root/.hermes/config.yaml', created: 1, content: 'approvals:\n  mode: off\n'
        }
      }
      return {}
    })
    expect(await openFileInCanvas('/root/.hermes/config.yaml')).toBe(true)
    mocks.api.mockClear()

    await saveToFile('d-cfg')
    expect(mocks.api).not.toHaveBeenCalled()
    expect(getState().toasts.at(-1)?.text).toContain('Settings')
  })

  it('asks with confirmDialog on 409 disk conflict: Cancel does not force-save, Overwrite sends force: true', async () => {
    let failConflict = true
    mocks.api.mockImplementation(async (method: string, path: string, body?: { force?: boolean }) => {
      if (method === 'GET' && path.includes('/canvas?')) return { docs: [] }
      if (method === 'POST' && path.endsWith('/open-file')) {
        return {
          id: 'd-note', title: 'note.md', type: 'markdown', lang: '', rev: 1, updated: 1, by: 'user',
          chars: 5, path: '/sdcard/Documents/note.md', created: 1, content: 'hello'
        }
      }
      if (method === 'POST' && path.endsWith('/save-file')) {
        if (failConflict && !body?.force) throw new ApiError('conflict: the file on disk changed since you opened it', 409)
        failConflict = false
        return { path: '/sdcard/Documents/note.md', chars: 5 }
      }
      return {}
    })
    expect(await openFileInCanvas('/sdcard/Documents/note.md')).toBe(true)
    mocks.api.mockClear()

    mocks.confirmDialog.mockResolvedValueOnce(false)
    await saveToFile('d-note')
    expect(mocks.confirmDialog).toHaveBeenCalledTimes(1)
    expect(mocks.api).toHaveBeenCalledTimes(1)

    mocks.confirmDialog.mockResolvedValueOnce(true)
    await saveToFile('d-note')
    expect(mocks.api).toHaveBeenLastCalledWith(
      'POST',
      '/api/plugins/hermes-mobile/canvas/save-file',
      { session: 's-cv', id: 'd-note', force: true },
      { profile: false }
    )
    expect(getState().toasts.at(-1)?.text).toBe('Saved to /sdcard/Documents/note.md')
  })

  it('blocks saveToFile when lockView is on before saving or after the overwrite dialog', async () => {
    mocks.api.mockImplementation(async (method: string, path: string, body?: { force?: boolean }) => {
      if (method === 'GET' && path.includes('/canvas?')) return { docs: [] }
      if (method === 'POST' && path.endsWith('/open-file')) {
        return {
          id: 'd-lock', title: 'note.md', type: 'markdown', lang: '', rev: 1, updated: 1, by: 'user',
          chars: 5, path: '/sdcard/Documents/note.md', created: 1, content: 'hello'
        }
      }
      if (method === 'POST' && path.endsWith('/save-file') && !body?.force) {
        throw new ApiError('conflict: changed', 409)
      }
      return { path: '/sdcard/Documents/note.md', chars: 5 }
    })
    expect(await openFileInCanvas('/sdcard/Documents/note.md')).toBe(true)
    mocks.api.mockClear()

    // Already locked before first call: asks unlock, sends nothing.
    mocks.lockView.mockReturnValue(true)
    await saveToFile('d-lock')
    expect(mocks.askUnlock).toHaveBeenCalledTimes(1)
    expect(mocks.api).not.toHaveBeenCalled()

    // Unlocks, hits 409, locks during confirmDialog: asks unlock, sends no force-save.
    mocks.lockView.mockReturnValue(false)
    mocks.askUnlock.mockClear()
    mocks.confirmDialog.mockImplementationOnce(async () => {
      mocks.lockView.mockReturnValue(true)
      return true
    })
    await saveToFile('d-lock')
    expect(mocks.api).toHaveBeenCalledTimes(1)
    expect(mocks.askUnlock).toHaveBeenCalledTimes(1)
  })

  it('aborts force-save when the active chat changes during the overwrite dialog', async () => {
    mocks.api.mockImplementation(async (method: string, path: string, body?: { force?: boolean }) => {
      if (method === 'GET' && path.includes('/canvas?')) return { docs: [] }
      if (method === 'POST' && path.endsWith('/open-file')) {
        return {
          id: 'd-sw', title: 'note.md', type: 'markdown', lang: '', rev: 1, updated: 1, by: 'user',
          chars: 5, path: '/sdcard/Documents/note.md', created: 1, content: 'hello'
        }
      }
      if (method === 'POST' && path.endsWith('/save-file') && !body?.force) {
        throw new ApiError('conflict: changed', 409)
      }
      return { path: '/sdcard/Documents/note.md', chars: 5 }
    })
    expect(await openFileInCanvas('/sdcard/Documents/note.md')).toBe(true)
    mocks.api.mockClear()

    mocks.confirmDialog.mockImplementationOnce(async () => {
      setState({ active: chat('s-other') })
      return true
    })
    await saveToFile('d-sw')
    const saveCalls = mocks.api.mock.calls.filter(([, p]) => String(p).endsWith('/save-file'))
    expect(saveCalls).toHaveLength(1)
  })
})
