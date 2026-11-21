// @vitest-environment happy-dom
// Security review 5 of the sub-agent work: finding 1 (the chat on screen judged by itself, not by what is drawn, and by every
// id of the chat asked about) and finding 2 (a fingerprint confirmation ends with every live session it came through).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RpcHandler = (method: string, params: Record<string, unknown>) => unknown
let rpcHandler: RpcHandler = () => ({})

vi.mock('./api', () => ({
  api: vi.fn(async () => ({}))
}))

const { getState, setState } = await import('./store')
const { noteLineage, resetLineageForTests } = await import('./lineage')
const { moveChat, resetSubAgents } = await import('./subagents')
const { client } = await import('./gateway')
const { chatTainted, docTainted } = await import('./phone-data-taint')

type ActiveItems = NonNullable<ReturnType<typeof getState>['active']>['items']
const phoneItems: ActiveItems = [{ kind: 'tool', id: 't1', name: 'phone_data', status: 'done' } as ActiveItems[number]]
const activeOf = (storedId: string, items: ActiveItems = [], runtimeId = `rt-${storedId}`) => ({
  runtimeId,
  storedId,
  profile: 'default',
  title: `Chat ${storedId}`,
  info: {},
  items,
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
const shell = (tainted: string[]) => {
  ;(window as unknown as { HermesAndroid?: unknown }).HermesAndroid = { phoneDataTainted: (id: string) => tainted.includes(id) }
}

beforeEach(() => {
  localStorage.clear()
  resetSubAgents()
  resetLineageForTests()
  setState({ conn: 'open', active: null, opening: null, preview: null, drawer: false, sheet: null, sessions: [], requests: [] })
  rpcHandler = (method, params) => {
    if (method === 'session.resume') {
      const sid = String(params.session_id || 's')
      return { session_id: `rt-${sid}`, stored_session_id: sid, messages: [], info: { title: `Chat ${sid}` } }
    }
    return {}
  }
  vi.spyOn(client, 'request').mockImplementation((async (method: string, params: Record<string, unknown> = {}) =>
    rpcHandler(method, params)) as typeof client.request)
})

afterEach(() => {
  delete (window as unknown as { HermesAndroid?: unknown }).HermesAndroid
  vi.restoreAllMocks()
})

describe('round 5, 1(a): while another chat opens, the active chat is judged by its own items, not the preview drawn', () => {
  it('docTainted and chatTainted see the phone_data item of the chat being left', () => {
    setState({
      active: activeOf('r5a-chat', phoneItems),
      opening: 'r5a-other',
      preview: { storedId: 'r5a-other', items: [] } as unknown as ReturnType<typeof getState>['preview']
    })
    expect(docTainted('r5a-chat')).toBe(true)
    expect(chatTainted('r5a-chat')).toBe(true)
    expect(docTainted('r5a-other')).toBe(false)
  })

  it('and the app\'s record for the active chat\'s live id, while another chat opens', () => {
    shell(['rt-r5a2-chat'])
    setState({
      active: activeOf('r5a2-chat'),
      opening: 'r5a2-other',
      preview: { storedId: 'r5a2-other', items: [] } as unknown as ReturnType<typeof getState>['preview']
    })
    expect(chatTainted('r5a2-chat')).toBe(true)
  })
})

describe('round 5, 1(b): the chat on screen never answers clean where docTainted would answer tainted', () => {
  it('an earlier id in the lineage of the id asked about, not in the active chat\'s own lineage', () => {
    shell(['r5b-earlier'])
    setState({ active: activeOf('r5b-old') })
    moveChat('r5b-old', 'r5b-new') // matched through resolveChat only
    noteLineage(['r5b-new', 'r5b-earlier'])
    expect(chatTainted('r5b-new')).toBe(true)
  })

  it('where a compression moved the id asked about, when only resolveChat links it', () => {
    shell(['r5c-tip'])
    setState({ active: activeOf('r5c-a1') })
    moveChat('r5c-a1', 'r5c-tip')
    moveChat('r5c-a0', 'r5c-tip')
    expect(chatTainted('r5c-a0')).toBe(true)
    expect(docTainted('r5c-a0')).toBe(true)
  })

  it('a clean chat on screen stays clean', () => {
    shell([])
    setState({ active: activeOf('r5d-chat') })
    expect(chatTainted('r5d-chat')).toBe(false)
  })
})
