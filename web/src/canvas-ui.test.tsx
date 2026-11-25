// @vitest-environment happy-dom
// Canvas panel fixes: version history after saves, Downloads file naming, JSON/code DocView without Canvas button.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  api: vi.fn()
}))

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    api: (...args: unknown[]) => mocks.api(...args)
  }
})

import { canvasState, editDoc, flushSave, loadDoc, openCanvas, type Doc } from './canvas'
import { exportFileName } from './components/Canvas'
import { DocView } from './components/DocView'
import { Markdown } from './components/Markdown'
import { setState, type ActiveSession } from './store'

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

describe('exportFileName', () => {
  it('keeps spaces and avoids doubling an existing matching extension', () => {
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

  it('strips unsafe path characters and leading/trailing/repeated dots', () => {
    expect(exportFileName({ title: '../../.env', type: 'text', lang: '' })).toBe('env.txt')
    expect(exportFileName({ title: 'report: Q1 / Q2?', type: 'markdown', lang: '' })).toBe('report Q1 Q2.md')
    expect(exportFileName({ title: '...', type: 'markdown', lang: '' })).toBe('canvas.md')
    expect(exportFileName({ title: 'doc.md.', type: 'markdown', lang: '' })).toBe('doc.md')
  })
})

describe('flushSave version history sync', () => {
  beforeEach(() => {
    mocks.api.mockReset()
    setState({ conn: 'open', profile: 'default', active: chat('s-ver'), opening: null, toasts: [] })
  })

  afterEach(() => {
    setState({ active: null, opening: null, toasts: [] })
  })

  it('keeps loaded versions in sync when PUT /canvas/doc returns no versions list', async () => {
    const initial: Doc = {
      id: 'doc-1',
      title: 'Notes',
      type: 'markdown',
      lang: '',
      rev: 12,
      updated: 1000,
      by: 'agent',
      chars: 5,
      path: '',
      created: 900,
      content: 'hello',
      versions: [
        { rev: 11, at: 990, by: 'agent', note: 'first' },
        { rev: 12, at: 1000, by: 'agent', note: 'second' }
      ]
    }
    mocks.api.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.includes('/canvas?')) return { docs: [initial] }
      if (method === 'GET' && path.includes('/canvas/doc')) return initial
      if (method === 'PUT' && path.includes('/canvas/doc')) {
        // Matches canvas.py `write`: returns updated metadata without `versions`.
        return {
          id: 'doc-1',
          title: 'Notes',
          type: 'markdown',
          lang: '',
          rev: 13,
          updated: 1010,
          by: 'user',
          chars: 11,
          path: '',
          created: 900,
          content: 'hello world'
        }
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
