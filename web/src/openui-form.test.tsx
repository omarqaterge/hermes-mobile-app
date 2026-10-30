// @vitest-environment happy-dom
process.env.OPENUI_TELEMETRY_DISABLED = '1'
process.env.DO_NOT_TRACK = '1'
import { act } from 'react'
import { beforeAll, expect, test } from 'vitest'
import type { BlockHandle, BlockProps, OpenUIApi } from './openui-entry'
import { actionMessage, type UiAction } from './openui-msg'
import { library, referenceText } from './openui-lib'

// Keep identical to the "show form ui" reply in tools/web-e2e/mock.cjs.
const FORM = `root = Card([head, form])
head = CardHeader("Book a table")
form = Form("booking", formBtns, [nameField, sizeField, dayField])
nameField = FormControl("Name", Input("name", "Your name", "text", {required: true}))
sizeField = FormControl("Party size", Select("size", [SelectItem("2", "Two people"), SelectItem("4", "Four people")], "Choose size", {required: true}))
dayField = FormControl("Day", DatePicker("day", "single", {required: true}))
formBtns = Buttons([send])
send = Button("Book", @ToAssistant("Book it"), "primary")`

let api: OpenUIApi
beforeAll(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await import('./openui-entry')
  api = (window as unknown as { __hmOpenUI: OpenUIApi }).__hmOpenUI
})

const props = (over: Partial<BlockProps> = {}): BlockProps => ({
  code: FORM, streaming: false, mode: 'dark', onAction: () => {}, onState: () => {}, onErrors: () => {}, ...over
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
/** Open the date field's calendar (portalled to <body>) and tap day 15. */
async function pickDay15(root: ShadowRoot) {
  await act(async () => (root.querySelector('.openui-date-picker-renderer-floating-input-container') as HTMLElement).click())
  await settle()
  const day = [...document.querySelectorAll('.openui-date-picker-renderer-floating-content button')].find(b => b.textContent === '15') as HTMLElement
  expect(day).toBeTruthy()
  await act(async () => day.click())
  await settle()
  expect(document.querySelector('.openui-date-picker-renderer-floating-content')).toBeNull() // closed by the pick
}
const key = (el: Element, k: string) => act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) })

test('required pickers (list and date) take the pick: no "required" error and the values are sent', async () => {
  const seen: UiAction[] = []
  const { h, root } = await mount(props({ onAction: e => seen.push(e as UiAction) }))
  const input = root.querySelector('input[name="name"]') as HTMLInputElement
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { setValue.call(input, 'Sam'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  const trigger = root.querySelector('button[role="combobox"]') as HTMLElement
  expect(trigger).toBeTruthy()
  await key(trigger, 'Enter')
  await settle()
  const option = [...document.querySelectorAll('[role="option"]')].find(o => o.textContent?.includes('Four people')) as HTMLElement
  expect(option).toBeTruthy()
  await act(async () => option.focus())
  await key(option, 'Enter')
  await settle()
  expect(trigger.textContent).toContain('Four people')
  await pickDay15(root)
  await act(async () => button(root, 'Book').click())
  await settle()
  expect(root.textContent).not.toContain('required')
  expect(seen.length).toBe(1)
  expect(actionMessage(seen[0])).toMatch(/^Book it\n\n- name: Sam\n- size: 4\n- day: \d{4}-\d{2}-15$/)
  await act(async () => h.unmount())
})

// The reference teaches the "$variable" form: Select("role", items, null, {required: true}, $role).
const BOUND = `root = Card([head, form])
head = CardHeader("Role")
form = Form("signup", formBtns, [roleField])
roleField = FormControl("Role", Select("role", [SelectItem("eng", "Engineer"), SelectItem("des", "Designer")], null, {required: true}, $role))
formBtns = Buttons([send])
send = Button("Join", @ToAssistant("Sign me up"), "primary")`

test('a picker bound to a $variable also passes the required check and is sent', async () => {
  const seen: UiAction[] = []
  const { h, root } = await mount(props({ code: BOUND, onAction: e => seen.push(e as UiAction) }))
  const trigger = root.querySelector('button[role="combobox"]') as HTMLElement
  await key(trigger, 'Enter')
  await settle()
  const option = [...document.querySelectorAll('[role="option"]')].find(o => o.textContent?.includes('Designer')) as HTMLElement
  await act(async () => option.focus())
  await key(option, 'Enter')
  await settle()
  await act(async () => button(root, 'Join').click())
  await settle()
  expect(root.textContent).not.toContain('required')
  expect(seen.length).toBe(1)
  expect(actionMessage(seen[0])).toBe('Sign me up\n\n- role: des')
  await act(async () => h.unmount())
})

// Every other kind of control, in one required form.
const MANY = `root = Card([head, form])
head = CardHeader("Order")
form = Form("order", formBtns, [noteField, toppingField, crustField, tagField, dayField])
noteField = FormControl("Note", TextArea("note", "Any note", 2, {required: true}))
toppingField = FormControl("Toppings", CheckBoxGroup("toppings", [CheckBoxItem("Cheese", "", "cheese"), CheckBoxItem("Olives", "", "olives")], {required: true}))
crustField = FormControl("Crust", RadioGroup("crust", [RadioItem("Thin", "", "thin"), RadioItem("Thick", "", "thick")], null, {required: true}))
tagField = FormControl("Tags", Chips("tags", "single", [ChipItem("hot", "Hot"), ChipItem("mild", "Mild")], null, {required: true}))
dayField = FormControl("Day", DatePicker("day", "single", {required: true}))
formBtns = Buttons([send])
send = Button("Order", @ToAssistant("Place order"), "primary")`

test('text, checkbox, radio, chips and date pickers all keep their value through the required check', async () => {
  const seen: UiAction[] = []
  const { h, root } = await mount(props({ code: MANY, onAction: e => seen.push(e as UiAction) }))
  const note = root.querySelector('textarea[name="note"]') as HTMLTextAreaElement
  const setNote = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => { setNote.call(note, 'No onions'); note.dispatchEvent(new Event('input', { bubbles: true })) })
  const click = (el: Element) => act(async () => (el as HTMLElement).click())
  await click(root.querySelector('button[role="checkbox"]')!)
  await click(root.querySelector('button[role="radio"][value="thick"]')!)
  await click([...root.querySelectorAll('button')].find(b => b.textContent === 'Mild')!)
  await settle()
  // Press Order with the date still empty: only the date complains.
  await click(button(root, 'Order'))
  await settle()
  expect(seen.length).toBe(0)
  expect(root.textContent?.match(/required/gi)?.length).toBe(1)
  await pickDay15(root)
  await click(button(root, 'Order'))
  await settle()
  expect(root.textContent).not.toContain('required')
  expect(seen.length).toBe(1)
  const msg = actionMessage(seen[0])
  expect(msg).toContain('- note: No onions')
  expect(msg).toContain('- toppings: ')
  expect(msg).toContain('- crust: thick')
  expect(msg).toContain('- tags: mild')
  expect(msg).toMatch(/- day: \d{4}-\d{2}-15\b/)
  await act(async () => h.unmount())
})

test('the date picker replacement leaves what Hermes is taught unchanged', async () => {
  const { DatePicker } = await import('./openui-date')
  const swapped = library.extend!({ components: { override: [DatePicker] } })
  expect(swapped.prompt()).toBe(library.prompt())
  expect(referenceText().length).toBeGreaterThan(40000)
})
