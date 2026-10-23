// @vitest-environment happy-dom
process.env.OPENUI_TELEMETRY_DISABLED = '1'
process.env.DO_NOT_TRACK = '1'
import { act } from 'react'
import { beforeAll, expect, test } from 'vitest'
import type { BlockHandle, BlockProps, OpenUIApi } from './openui-entry'
import { actionMessage, type UiAction } from './openui-msg'
import { makeToolClient } from './openui-query'

// Keep identical to the "show ui" reply in tools/web-e2e/mock.cjs.
const CODE = `root = Card([head, intro, plans, form, more])
head = CardHeader("Pick a plan", "Two options")
intro = TextContent("Both include **support**.")
plans = Buttons([a, b], "row")
a = Button("Option A", @ToAssistant("Pick A"), "primary")
b = Button("Option B", @ToAssistant("Pick B"), "secondary")
form = Form("contact", formBtns, [nameField])
nameField = FormControl("Name", Input("name", "Your name", "text", {required: true}))
formBtns = Buttons([send])
send = Button("Send", @ToAssistant("Here are my details"), "primary")
more = FollowUpBlock([f1])
f1 = FollowUpItem("Compare both")`

let api: OpenUIApi
beforeAll(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await import('./openui-entry')
  api = (window as unknown as { __hmOpenUI: OpenUIApi }).__hmOpenUI
})

const props = (over: Partial<BlockProps> = {}): BlockProps => ({
  code: CODE, streaming: false, mode: 'dark', onAction: () => {}, onState: () => {}, onErrors: () => {}, ...over
})
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 150)) })
async function mount(p: BlockProps) {
  const host = document.createElement('div')
  document.body.append(host)
  let h!: BlockHandle
  await act(async () => { h = api.mount(host, p) })
  await settle()
  return { host, h, root: host.shadowRoot! }
}
const button = (root: ShadowRoot, text: string) => [...root.querySelectorAll('button')].find(b => b.textContent?.includes(text))!

test('draws the card inside a shadow root (the app’s .md CSS can’t reach it)', async () => {
  const { host, h, root } = await mount(props())
  expect(root.textContent).toContain('Pick a plan')
  expect(host.children.length).toBe(0)
  await act(async () => h.unmount())
})

test('a button reports its words', async () => {
  const seen: UiAction[] = []
  const { h, root } = await mount(props({ onAction: e => seen.push(e as UiAction) }))
  await act(async () => button(root, 'Option A').click())
  expect(seen.map(actionMessage)).toEqual(['Pick A'])
  await act(async () => h.unmount())
})

test('form values reach the action', async () => {
  const seen: UiAction[] = []
  const { h, root } = await mount(props({ onAction: e => seen.push(e as UiAction) }))
  const input = root.querySelector('input[name="name"]') as HTMLInputElement
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(input, 'Omar')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => button(root, 'Send').click())
  expect(actionMessage(seen[seen.length - 1])).toBe('Here are my details\n\n- name: Omar')
  await act(async () => h.unmount())
})

test('code that isn’t openui-lang reports an error once streaming is done', async () => {
  const errs: string[] = []
  const { h } = await mount(props({ code: 'this is not openui at all', onErrors: e => errs.push(...e.map(x => x.code)) }))
  expect(errs.length).toBeGreaterThan(0)
  await act(async () => h.unmount())
})

// Keep identical to the "show live ui" reply in tools/web-e2e/mock.cjs.
const LIVE = `root = Card([head, table])
head = CardHeader("Search results")
results = Query("web_search", {query: "openui"}, {data: {web: []}})
table = Table([Col("Title", results.data.web.title), Col("Link", results.data.web.url)])`

test('a Query card draws what the tool client returns', async () => {
  const seen: string[] = []
  const saved = new Map<string, unknown>()
  const client = makeToolClient(
    async name => {
      seen.push(name)
      return { data: { web: [{ title: 'Mock result one', url: 'https://example.com/1' }] } }
    },
    'chat1',
    { load: k => saved.get(k), save: (k, v) => void saved.set(k, v) }
  )
  const { h, root } = await mount(props({ code: LIVE, toolProvider: client }))
  await settle()
  expect(root.textContent).toContain('Mock result one')
  expect(seen).toEqual(['web_search'])
  await act(async () => h.unmount())
})
