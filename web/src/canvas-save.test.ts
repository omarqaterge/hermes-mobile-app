// @vitest-environment happy-dom
// Canvas save-file guards: protected paths refused without calling the server; 409 disk-change conflict asks via dialog.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  confirmDialog: vi.fn()
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

import { ApiError } from './api'
import { canvasSaveBlockReason, openFileInCanvas, saveToFile } from './canvas'
import { getState, setState, type ActiveSession } from './store'

const chat = (): ActiveSession => ({
  runtimeId: 'rt-cv',
  storedId: 's-cv',
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

describe('canvasSaveBlockReason', () => {
  it('blocks Hermes config, secrets, plugin, shell init and system paths (including traversal)', () => {
    for (const p of [
      '/root/.hermes/config.yaml',
      '/root/.hermes/profiles/work/config.yaml',
      '/root/.hermes/.env',
      '/root/.hermes/mobile/auto.json',
      '/root/.hermes/plugins/hermes-mobile/canvas.py',
      '/root/.hermes-mobile/key',
      '/data/data/com.termux/files/home/.hermes-mobile/key',
      '/root/projects/app/.env',
      '/root/projects/app/.env.local',
      '/root/.ssh/authorized_keys',
      '/root/bin/hermes-services',
      '/root/.bashrc',
      '/etc/passwd',
      '/root/notes/../.hermes/config.yaml',
      '~/.hermes/config.yaml',
      'relative/file.txt'
    ]) {
      expect(canvasSaveBlockReason(p), p).not.toBeNull()
    }
  })

  it('allows normal user files under home and /sdcard', () => {
    for (const p of ['/sdcard/Documents/plan.md', '/sdcard/Download/notes.txt', '/root/notes.md', '/root/projects/site/app.py']) {
      expect(canvasSaveBlockReason(p), p).toBeNull()
    }
  })
})

describe('saveToFile', () => {
  beforeEach(() => {
    mocks.api.mockReset()
    mocks.confirmDialog.mockReset()
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
})
